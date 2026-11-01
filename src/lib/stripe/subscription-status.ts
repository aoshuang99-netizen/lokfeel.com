/**
 * Stripe 订阅状态 → 本地 `SubscriptionStatus`（纯映射，无 IO、无 Prisma）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么单独抽出来
 * ----------------
 * `webhooks/stripe/route.ts` 原来的写法是：
 *
 *     const statusMap = { active, trialing, past_due, canceled, unpaid };
 *     status: statusMap[subscription.status] || "ACTIVE"
 *
 * Stripe 的 `Subscription.Status` 有 **8** 个值，这里只映射了 5 个。剩下三个
 * 全部落进 `|| "ACTIVE"` 的兜底：
 *
 *   · `incomplete`         —— 首期付款**没完成**（3DS 未过、卡被拒、用户关页面）
 *   · `incomplete_expired` —— 上述状态超时（默认 23h）后的**终态**，钱从没收到
 *   · `paused`             —— 订阅被暂停（试用结束未绑卡等），Stripe 不收钱
 *
 * 于是「没付钱」被写成「有效的 ACTIVE 订阅」。这不是显示问题：
 * `user/limits`、`message-guards`、`matches/request` 三处门禁都只认
 * `status === 'ACTIVE'`，`ACTIVE` 即等于「无限私信 + 每周 5 次连接」。
 *
 * 更糟的是 `incomplete_expired` 是**终态** —— 后续不会再有事件来纠正它，
 * 而本仓没有对账任务，这一行会永久停在 ACTIVE。
 *
 * 复现路径（不需要任何越权技巧）：
 *   1. 老用户（库里已有 `stripeCustomerId`）上次到期后被判 CANCELLED；
 *   2. 他再点一次订阅，Stripe 先发 `customer.subscription.created`（status=incomplete）；
 *   3. handler 按 `stripeCustomerId` 找到那行旧记录 ⇒ 写成 ACTIVE ⇒ **立刻拿到 Premium**；
 *   4. 他关掉 3DS 页面不付款，23h 后收到 `incomplete_expired` ⇒ 仍写成 ACTIVE。
 *   ⇒ 一分钱没付，Premium 永久生效。
 *
 * 设计原则：**支付墙遇到不认识的状态必须 fail closed（关），不能 fail open（开）**。
 * 同一产品里 Creem 侧已经这么做了 —— `creem-events.ts` 把 `pause` 显式映射成
 * `PAST_DUE` 并注释「宁可让用户看到逾期去找客服，也不能继续白送」。
 * 两个支付通道对同一件事必须给同一个答案。
 *
 * ⚠️ 有损映射（与 Creem 侧一致，故意如此）
 * ----------------------------------------
 * 本地枚举没有 `PAUSED` / `INCOMPLETE`，因此：
 *   · `incomplete` / `paused` → `PAST_DUE`（不发权益，且非终态：下一条事件会纠正）
 *   · `incomplete_expired`    → `EXPIRED`（终态）
 *   · 未知状态                 → `PAST_DUE` + `unknown: true`（fail closed，并留告警位）
 */

/** 与 `prisma/schema/core.prisma` 的 `SubscriptionStatus` 逐字一致。 */
export type LocalSubscriptionStatus =
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'CANCELLED'
  | 'EXPIRED';

/**
 * Stripe `Subscription.Status` 全集（API 2023-10-16 起 8 个）。
 *
 * 🔴 这张表是**显式**的，不用 `default` 兜底 —— 目的是让 Stripe 将来新增状态时，
 *    代码里的人必须再看一眼这里，而不是被兜底悄悄放过。
 */
const STATUS_MAP: Readonly<Record<string, LocalSubscriptionStatus>> = Object.freeze({
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  canceled: 'CANCELLED',
  unpaid: 'EXPIRED',
  // ↓ 原实现漏掉的三个
  incomplete: 'PAST_DUE',
  incomplete_expired: 'EXPIRED',
  paused: 'PAST_DUE',
});

/** 已知的 Stripe 状态（供测试与自检用，避免集合漂移） */
export const KNOWN_STRIPE_STATUSES: readonly string[] = Object.freeze([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

/** 只有这两种状态发放付费权益 */
const ENTITLED: readonly LocalSubscriptionStatus[] = Object.freeze(['ACTIVE', 'TRIALING']);

export interface StatusTranslation {
  /** 写库用的本地状态 */
  status: LocalSubscriptionStatus;
  /** Stripe 原始状态（日志/排障用，不做判断） */
  raw: string;
  /** 是否应发放 Premium 权益 —— **唯一**判据，不要在调用点再写一遍 */
  entitled: boolean;
  /** 不在已知集合内（需要告警；映射按 fail closed 处理） */
  unknown: boolean;
}

/** `status` 是否发放权益（`ACTIVE` / `TRIALING`） */
export function isEntitledStatus(status: LocalSubscriptionStatus): boolean {
  return ENTITLED.includes(status);
}

/**
 * Stripe 状态 → 本地状态。
 *
 * 未知状态**不会**抛错：webhook 必须回 200，否则 Stripe 会持续重投同一事件，
 * 把一条无法处理的事件变成无限重试。未知状态记为 `PAST_DUE` + `unknown:true`，
 * 由调用点 `console.warn` 留痕，等下一条件正常事件覆盖。
 */
export function translateStripeStatus(raw: unknown): StatusTranslation {
  const key = typeof raw === 'string' ? raw : '';
  const mapped = STATUS_MAP[key];

  if (!mapped) {
    return { status: 'PAST_DUE', raw: key, entitled: false, unknown: true };
  }

  return { status: mapped, raw: key, entitled: isEntitledStatus(mapped), unknown: false };
}

/**
 * 计算写库的 `cancelledAt`。
 *
 * 三种情形：
 *   1. 用户刚排定期末取消（`cancel_at_period_end === true`）→ 记 `now`（幂等判据）；
 *   2. 订阅恢复且**仍有权**（例如取消后又续费）→ 清空，否则 `/api/payments/cancel`
 *      会永远回「已排定取消」，用户再也点不动取消按钮；
 *   3. 订阅**无权**（incomplete / expired / paused）→ **保留原值**。
 *
 * 第 3 条是原实现的隐性缺陷：`cancelledAt: cancel_at_period_end ? new Date() : null`
 * 会在「未付款的新订阅」到达时把历史取消记录抹成 null，等于凭空洗掉一条审计痕迹。
 */
export function nextCancelledAt(
  previous: Date | null,
  translation: Pick<StatusTranslation, 'entitled'>,
  cancelAtPeriodEnd: boolean,
  now: Date = new Date(),
): Date | null {
  if (cancelAtPeriodEnd) return now;
  if (translation.entitled) return null;
  return previous;
}

/**
 * 周期结束时间（秒 → Date），读 `current_period_end`。
 *
 * 该字段在不同 API 版本里位置不同（顶层 / `items.data[0]` 上），做兼容读取；
 * 读不到返回 `null`（**不要**用 `now + 30d` 猜 —— 那是 B-12 的同类错误）。
 */
export function periodEndOf(subscription: unknown): Date | null {
  const fromTop = (subscription as { current_period_end?: unknown } | null)?.current_period_end;
  if (typeof fromTop === 'number') return new Date(fromTop * 1000);

  const item = (
    subscription as { items?: { data?: Array<{ current_period_end?: unknown }> } } | null
  )?.items?.data?.[0];
  const fromItem = item?.current_period_end;
  return typeof fromItem === 'number' ? new Date(fromItem * 1000) : null;
}
