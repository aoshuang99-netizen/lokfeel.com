/**
 * POST /api/payments/cancel —— 期末取消当前订阅（V18-04）
 * ═══════════════════════════════════════════════════════════════════════
 * 这个端点存在的唯一理由：`public/pay.html` 写了 "cancel in one click"，
 * 而全仓**没有任何取消入口**。承诺与能力必须对齐 —— 要么撤承诺，要么补能力。
 *
 * 行为契约（详见 `src/lib/payments/cancel-subscription.ts`）：
 *
 * | 情形 | 状态码 | 码 | 是否动库 |
 * |---|---|---|---|
 * | 没有有效订阅 | 404 | NO_ACTIVE_SUBSCRIPTION | 否 |
 * | 本地有、服务商无 | 409 | NO_REMOTE_SUBSCRIPTION | 否 |
 * | 已排定取消（重复点） | 200 | —（alreadyScheduled: true） | 否 |
 * | 凭据未配 | 503 | PAYMENT_NOT_CONFIGURED | **否** |
 * | 服务商报错 / 未确认 | 502 | UPSTREAM_ERROR | **否** |
 * | 成功 | 200 | — | 是（只写 cancelledAt） |
 *
 * 🔴 注意「只写 cancelledAt」：**不改 `status`**。
 *   期末取消意味着**当期仍有权益**，真正的状态变更由 Stripe webhook
 *   （`customer.subscription.updated` / `deleted`）驱动。
 *   在这里直接把 status 打成 CANCELLED，等于用户付了钱当场被断权。
 *
 * 为什么不复用 admin 的退款路由：
 *   退款是**退钱**（admin 权限、动余额），取消是**停止续费**（用户自助、不动已付的钱）。
 *   塞进一个端点，权限模型立刻说不清。
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { handleApiError } from '@/lib/api-handler';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isPaymentChannelReady } from '@/lib/payments/availability';
import {
  CANCEL_CODES,
  cancelSubscriptionForUser,
  type CancelDeps,
} from '@/lib/payments/cancel-subscription';
import { paymentNotConfigured } from '@/lib/payments/not-configured';
import { STRIPE_API_VERSION } from '@/lib/stripe/config';

export const dynamic = 'force-dynamic';

/** 视为「仍然有效」的状态：这两种都应该允许用户排定期末取消 */
const ACTIVE_STATUSES = ['ACTIVE', 'TRIALING'] as const;

const deps: CancelDeps = {
  loadActive: async (userId) => {
    const sub = await db.subscription.findFirst({
      where: {
        userId,
        status: { in: [...ACTIVE_STATUSES] },
        deletedAt: null,
      },
      select: { id: true, stripeSubscriptionId: true, cancelledAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return sub ?? null;
  },

  // 惰性判定：不要在模块求值时把 env 固化进闭包（补了密钥的进程应立刻生效）
  isStripeReady: () => isPaymentChannelReady('stripe.card'),

  cancelAtPeriodEnd: async (stripeSubscriptionId) => {
    // 🔴 禁止裸 `new Stripe(key)`：SDK 主版本会静默更换默认 API 版本
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: STRIPE_API_VERSION,
    });
    const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    // `current_period_end` 在不同 API 版本里位置不同（顶层 / items 上），做兼容读取
    const fromTop = (updated as unknown as { current_period_end?: number }).current_period_end;
    const fromItem = (
      updated.items?.data?.[0] as unknown as { current_period_end?: number } | undefined
    )?.current_period_end;
    return {
      cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
      currentPeriodEnd: typeof fromTop === 'number' ? fromTop : (fromItem ?? null),
    };
  },

  markCancelScheduled: async (subscriptionId, at) => {
    await db.subscription.update({
      where: { id: subscriptionId },
      // 只写 cancelledAt：当期权益不变，状态变更交给 webhook
      data: { cancelledAt: at },
    });
  },
};

// ⚠️ `handleApiError` 是**立即执行**的包装（返回 Promise），不是工厂。
//    写成 `export const POST = handleApiError(...)` 会在**模块求值时**就跑一遍业务逻辑。
export async function POST() {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const result = await cancelSubscriptionForUser(user.id, deps);

    if (!result.ok) {
      if (result.code === CANCEL_CODES.PAYMENT_NOT_CONFIGURED) {
        // 与其它 7 个入口共用同一套 503 + 稳定码，监控口径才一致
        return paymentNotConfigured('stripe.card');
      }
      return NextResponse.json(
        { ok: false, code: result.code, error: result.message },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      cancelAtPeriodEnd: true,
      alreadyScheduled: result.alreadyScheduled,
      currentPeriodEnd: result.currentPeriodEnd,
      message: result.alreadyScheduled
        ? 'Cancellation was already scheduled.'
        : 'Cancellation scheduled. Access continues until the end of the current period.',
    });
  });
}
