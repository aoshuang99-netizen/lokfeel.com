/**
 * 取消订阅 · 核心逻辑（V18-04）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ------------
 * 站内有两处"可以随时取消"的承诺，而全仓与取消相关的代码原本只有
 * Stripe webhook 的**被动**处理（收到 `customer.subscription.updated` 就改状态），
 * **没有任何取消入口** —— 用户找不到那个"按钮"。
 *
 * 盘清楚之后其实是**三家服务商、三条不同的路**（详见 `20_REFUND_PROMISES.md`）：
 *
 *   · Hlua Pass（`/pay.html`）→ **Gumroad** 收款，取消在 Gumroad 侧完成；
 *     本站该做的是"告诉他去哪里取消"，不是自己造一个取消按钮。
 *   · 旧 B2C 会员（`/dashboard/subscription`）→ **Creem**；
 *   · Connection OS（`/console`）→ **Stripe**（本文件覆盖的这条）。
 *
 * 所以本文件只做一件事：**Stripe 订阅的期末取消**。Creem 那条返回
 * `PROVIDER_NOT_SELF_SERVICE` 并指向客服 —— 不是"待办文案"，是因为
 * 本仓没有验证过 Creem 的取消 API，凭据也没有，编一个调用比不做更危险。
 *
 * 硬约束：**绝不伪造成功**。
 *   · 没有服务商订阅 id ⇒ 409（诚实地说"这笔订阅不在服务商那里，请联系我们"）；
 *   · 凭据没配 ⇒ 503 + `PAYMENT_NOT_CONFIGURED`（与其它 7 个入口同一套码）；
 *   · 服务商报错 ⇒ 502（上游问题，不是我们的 500）；
 *   · 服务商说"没排上取消" ⇒ 也当失败，**不写库**；
 *   · 两家通道都配着 ⇒ 409 `PROVIDER_AMBIGUOUS`（库里那两列分不出归属）。
 *
 * 🔴 最关键的一条：**先让服务商确认，再写库。**
 *   顺序反过来（先 `status=CANCELED` 再调服务商）会出现"页面上已取消、实际还在扣款"
 *   —— 这是支付系统里最贵的一类 bug，退款都不一定救得回来。
 *
 * 为什么把依赖注入进来
 * --------------------
 * 这个函数要能在 jest 里被完整测试（含"服务商炸了但库没动"），
 * 而不是只能靠一套真实凭据去线上试。`CancelDeps` 就是那层缝。
 */

import type { CancelProvider } from './cancel-provider';

export const CANCEL_CODES = {
  NO_ACTIVE_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
  NO_REMOTE_SUBSCRIPTION: 'NO_REMOTE_SUBSCRIPTION',
  PAYMENT_NOT_CONFIGURED: 'PAYMENT_NOT_CONFIGURED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  /**
   * 两家支付通道同时配置 —— 库里那两列**分不出**归属（Creem 也往 stripe* 列里写 id），
   * 因此拒绝执行。宁可让用户联系客服，也不能把 A 家的 id 拿去 B 家取消。
   */
  PROVIDER_AMBIGUOUS: 'PROVIDER_AMBIGUOUS',
  /**
   * 订阅确实存在，但该服务商没有可实现的自助取消（当前是 Creem：
   * 它的取消 API 未在本仓验证过，凭据也没有，不写"猜出来的"调用）。
   */
  PROVIDER_NOT_SELF_SERVICE: 'PROVIDER_NOT_SELF_SERVICE',
} as const;

export type CancelCode = (typeof CANCEL_CODES)[keyof typeof CANCEL_CODES];

/** UI 可读的判定理由（GET 端点回它，前端据此渲染，不解析文案） */
export type CancelReason =
  | 'READY'
  | 'ALREADY_SCHEDULED'
  | 'NO_ACTIVE_SUBSCRIPTION'
  | 'NO_REMOTE_SUBSCRIPTION'
  | 'PAYMENT_NOT_CONFIGURED'
  | 'PROVIDER_AMBIGUOUS'
  | 'PROVIDER_NOT_SELF_SERVICE';

export interface ActiveSubscription {
  id: string;
  stripeSubscriptionId: string | null;
  /** 已排定期末取消的时间（幂等判据） */
  cancelledAt: Date | null;
}

export interface CancelDeps {
  /** 取该用户**当前有效**的订阅（没有则 null） */
  loadActive: (userId: string) => Promise<ActiveSubscription | null>;
  /**
   * 判定服务商归属。**不要**在这里"挑一个"—— 拿不准必须回 `ambiguous`。
   * （旧接口是 `isStripeReady: () => boolean`，它默认"只有 Stripe"这个假设，
   *   而 Creem 也把 id 写进 stripe* 列，所以那个假设是错的。）
   */
  resolveProvider: () => CancelProvider;
  /** 调服务商把订阅设为「期末取消」 */
  cancelAtPeriodEnd: (
    stripeSubscriptionId: string,
  ) => Promise<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null }>;
  /** 服务商确认**之后**才允许调用 */
  markCancelScheduled: (subscriptionId: string, at: Date) => Promise<void>;
  now?: () => Date;
}

export type CancelResult =
  | {
      ok: true;
      /** 幂等：本来就已经排定取消，本次没有再打服务商 */
      alreadyScheduled: boolean;
      cancelAtPeriodEnd: true;
      currentPeriodEnd: string | null;
    }
  | {
      ok: false;
      status: 404 | 409 | 502 | 503;
      code: CancelCode;
      message: string;
    };

/** 内部判定：`ready` 才允许触网；其余一律拒绝（且拒绝原因可被 GET 复用） */
type Decision =
  | { kind: 'ready'; active: ActiveSubscription }
  | {
      kind: 'already';
      active: ActiveSubscription;
    }
  | {
      kind: 'reject';
      status: 404 | 409 | 503;
      code: CancelCode;
      message: string;
    };

/**
 * 🔴 单一判定入口。
 *
 * POST 与 GET **必须**共用它 —— 否则会出现
 * 「GET 说可以取消（按钮亮着）→ POST 却 409」这种最伤人的错位：
 * 用户被允许点，点下去被告知不行。这类 bug 不会让服务挂，但会让信任挂。
 */
async function evaluate(userId: string, deps: CancelDeps): Promise<Decision> {
  const active = await deps.loadActive(userId);
  if (!active) {
    return {
      kind: 'reject',
      status: 404,
      code: CANCEL_CODES.NO_ACTIVE_SUBSCRIPTION,
      message: 'No active subscription to cancel.',
    };
  }

  // 已经排过期末取消：幂等（不再打服务商，也不重复写库）
  if (active.cancelledAt) {
    return { kind: 'already', active };
  }

  // 先判"这笔订阅属于谁"，再决定要不要调服务商。
  const provider = deps.resolveProvider();

  if (provider === 'none') {
    return {
      kind: 'reject',
      status: 503,
      code: CANCEL_CODES.PAYMENT_NOT_CONFIGURED,
      message: 'Payment system is not configured. Please try again later.',
    };
  }

  if (provider === 'ambiguous') {
    return {
      kind: 'reject',
      status: 409,
      code: CANCEL_CODES.PROVIDER_AMBIGUOUS,
      message:
        'More than one payment provider is configured, so this subscription cannot be cancelled automatically. Please contact support.',
    };
  }

  if (provider === 'creem') {
    // 诚实地说"这条路还没修好"，而不是调一个猜出来的接口
    return {
      kind: 'reject',
      status: 409,
      code: CANCEL_CODES.PROVIDER_NOT_SELF_SERVICE,
      message:
        'This subscription is managed by Creem and self-service cancellation is not available yet. Please contact support.',
    };
  }

  // 本地有订阅但服务商那边没有 id ⇒ 这笔不是通过服务商开通的（赠送/手工开通）。
  // 不能假装取消成功 —— 那种"取消"只是在本站骗自己。
  if (!active.stripeSubscriptionId) {
    return {
      kind: 'reject',
      status: 409,
      code: CANCEL_CODES.NO_REMOTE_SUBSCRIPTION,
      message:
        'This subscription has no payment-provider record, so it cannot be cancelled here. Please contact support.',
    };
  }

  return { kind: 'ready', active };
}

/**
 * 取消订阅（用户自助）。
 *
 * 🔴 顺序铁律：**先让服务商确认，再写库。**
 *    反过来就是"页面显示已取消、实际还在扣款"。
 */
export async function cancelSubscriptionForUser(
  userId: string,
  deps: CancelDeps,
): Promise<CancelResult> {
  const now = deps.now ?? (() => new Date());

  const decision = await evaluate(userId, deps);

  if (decision.kind === 'reject') {
    return {
      ok: false,
      status: decision.status,
      code: decision.code,
      message: decision.message,
    };
  }

  if (decision.kind === 'already') {
    return {
      ok: true,
      alreadyScheduled: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: null,
    };
  }

  const active = decision.active;

  let remote: { cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null };
  try {
    remote = await deps.cancelAtPeriodEnd(active.stripeSubscriptionId as string);
  } catch (err) {
    // 上游异常 ≠ 我们 500：分开是为了让监控能区分"服务商挂了"和"我们写错了"
    return {
      ok: false,
      status: 502,
      code: CANCEL_CODES.UPSTREAM_ERROR,
      message: `Payment provider rejected the cancellation: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  // 服务商回话说"没排上取消" —— 那就**不许**写库。宁可不成功，也不许假成功。
  if (remote.cancelAtPeriodEnd !== true) {
    return {
      ok: false,
      status: 502,
      code: CANCEL_CODES.UPSTREAM_ERROR,
      message: 'Payment provider did not confirm a scheduled cancellation.',
    };
  }

  await deps.markCancelScheduled(active.id, now());

  return {
    ok: true,
    alreadyScheduled: false,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: remote.currentPeriodEnd
      ? new Date(remote.currentPeriodEnd * 1000).toISOString()
      : null,
  };
}

export interface CancelEligibility {
  /** 有没有"当前有效"的订阅 */
  hasActive: boolean;
  /** 已经排定期末取消（按钮应显示"取消已排定"，而不是"取消"） */
  alreadyScheduled: boolean;
  /** 现在点"取消"会不会成功 —— 与 POST 共用同一判定，不会错位 */
  cancellable: boolean;
  /** 服务商归属（用于解释"为什么不能自助取消"），不含任何 id */
  provider: CancelProvider;
  /** 机器可读的理由 */
  reason: CancelReason;
  /** 给人看的一句话 */
  message: string;
}

/**
 * `GET` 用：告诉前端"现在能不能取消、为什么"。
 *
 * 只读：**不触网、不写库**。它存在的意义是让按钮状态与真实能力一致 ——
 * 一个"永远可点、点了才告诉你不行"的按钮，比没有按钮更差。
 */
export async function describeCancelEligibility(
  userId: string,
  deps: CancelDeps,
): Promise<CancelEligibility> {
  const provider = deps.resolveProvider();
  const decision = await evaluate(userId, deps);

  if (decision.kind === 'ready') {
    return {
      hasActive: true,
      alreadyScheduled: false,
      cancellable: true,
      provider,
      reason: 'READY',
      message: 'You can cancel at the end of the current billing period.',
    };
  }

  if (decision.kind === 'already') {
    return {
      hasActive: true,
      alreadyScheduled: true,
      cancellable: true,
      provider,
      reason: 'ALREADY_SCHEDULED',
      message:
        'Cancellation is already scheduled. Access continues until the end of the current period.',
    };
  }

  const reason: CancelReason =
    decision.code === CANCEL_CODES.NO_ACTIVE_SUBSCRIPTION
      ? 'NO_ACTIVE_SUBSCRIPTION'
      : decision.code === CANCEL_CODES.NO_REMOTE_SUBSCRIPTION
        ? 'NO_REMOTE_SUBSCRIPTION'
        : decision.code === CANCEL_CODES.PAYMENT_NOT_CONFIGURED
          ? 'PAYMENT_NOT_CONFIGURED'
          : decision.code === CANCEL_CODES.PROVIDER_AMBIGUOUS
            ? 'PROVIDER_AMBIGUOUS'
            : 'PROVIDER_NOT_SELF_SERVICE';

  return {
    hasActive: reason !== 'NO_ACTIVE_SUBSCRIPTION',
    alreadyScheduled: false,
    cancellable: false,
    provider,
    reason,
    message: decision.message,
  };
}
