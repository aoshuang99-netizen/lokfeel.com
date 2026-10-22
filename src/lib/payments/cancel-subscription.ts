/**
 * 取消订阅 · 核心逻辑（V18-04）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ------------
 * `public/pay.html` 承诺了 "cancel in one click"。而全仓与取消相关的代码只有
 * Stripe webhook 的**被动**处理（收到 `customer.subscription.updated` 就改状态），
 * **没有任何取消入口** —— 用户找不到那个 "click"。
 *
 * 两种修法：
 *   A. 把文案改了，删掉承诺；
 *   B. 真的做一个取消能力。
 *
 * 本文件选 B，但有一条硬约束：**绝不伪造成功**。
 *   · 没有服务商订阅 id ⇒ 409（诚实地说"这笔订阅不在服务商那里，请联系我们"）；
 *   · 凭据没配 ⇒ 503 + `PAYMENT_NOT_CONFIGURED`（与其它 7 个入口同一套码）；
 *   · 服务商报错 ⇒ 502（上游问题，不是我们的 500）；
 *   · 服务商说"没排上取消" ⇒ 也当失败，**不写库**。
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

export const CANCEL_CODES = {
  NO_ACTIVE_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
  NO_REMOTE_SUBSCRIPTION: 'NO_REMOTE_SUBSCRIPTION',
  PAYMENT_NOT_CONFIGURED: 'PAYMENT_NOT_CONFIGURED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
} as const;

export type CancelCode = (typeof CANCEL_CODES)[keyof typeof CANCEL_CODES];

export interface ActiveSubscription {
  id: string;
  stripeSubscriptionId: string | null;
  /** 已排定期末取消的时间（幂等判据） */
  cancelledAt: Date | null;
}

export interface CancelDeps {
  /** 取该用户**当前有效**的订阅（没有则 null） */
  loadActive: (userId: string) => Promise<ActiveSubscription | null>;
  /** Stripe 凭据是否就绪（`isPaymentChannelReady('stripe.card')`） */
  isStripeReady: () => boolean;
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

export async function cancelSubscriptionForUser(
  userId: string,
  deps: CancelDeps,
): Promise<CancelResult> {
  const now = deps.now ?? (() => new Date());

  const active = await deps.loadActive(userId);
  if (!active) {
    return {
      ok: false,
      status: 404,
      code: CANCEL_CODES.NO_ACTIVE_SUBSCRIPTION,
      message: 'No active subscription to cancel.',
    };
  }

  // 已经排过期末取消：幂等返回，**不再打服务商**（避免重复调用与重复写库）
  if (active.cancelledAt) {
    return {
      ok: true,
      alreadyScheduled: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: null,
    };
  }

  // 本地有订阅但服务商那边没有 id ⇒ 这笔不是通过服务商开通的（赠送/手工开通）。
  // 不能假装取消成功 —— 那种"取消"只是在本站骗自己。
  if (!active.stripeSubscriptionId) {
    return {
      ok: false,
      status: 409,
      code: CANCEL_CODES.NO_REMOTE_SUBSCRIPTION,
      message:
        'This subscription has no payment-provider record, so it cannot be cancelled here. Please contact support.',
    };
  }

  // 凭据没配：**在触库与触网之前**就返回，保证"未接入"时数据库一个字节都不动
  if (!deps.isStripeReady()) {
    return {
      ok: false,
      status: 503,
      code: CANCEL_CODES.PAYMENT_NOT_CONFIGURED,
      message: 'Payment system is not configured. Please try again later.',
    };
  }

  let remote: { cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null };
  try {
    remote = await deps.cancelAtPeriodEnd(active.stripeSubscriptionId);
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
