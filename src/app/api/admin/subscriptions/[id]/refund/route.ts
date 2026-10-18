import { createSubscriptionRefundHandler } from "@/lib/stripe/refund-route";

/**
 * POST /api/admin/subscriptions/[id]/refund - Process refund for a subscription
 *
 * 逻辑见 `src/lib/stripe/refund.ts`（退款决策）与 `src/lib/stripe/refund-route.ts`
 * （鉴权 + 读写库 + HTTP 映射）。两条 admin 退款路由共用同一份实现。
 */
export const POST = createSubscriptionRefundHandler();
