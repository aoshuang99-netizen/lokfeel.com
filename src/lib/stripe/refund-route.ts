import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { prisma } from "@/lib/prisma";
import { STRIPE_API_VERSION } from "@/lib/stripe/config";
import {
  executeSubscriptionRefund,
  subscriptionUpdateForRefund,
} from "@/lib/stripe/refund";
import Stripe from "stripe";

/**
 * 退款路由的**唯一**实现。
 *
 * 历史上有两条路由各自复制了一份退款逻辑（`/api/admin/subscriptions/[id]` 的 POST
 * 与 `.../[id]/refund` 的 POST），两份都靠 `as any` 读 `invoice.payment_intent`，
 * 在 Stripe `dahlia` 之后恒 400。现在它们都只是 `createSubscriptionRefundHandler()`
 * 的一行导出，逻辑集中在 `src/lib/stripe/refund.ts`。
 *
 * body: `{ amount?: number(元), reason?: "duplicate"|"fraudulent"|"requested_by_customer",
 *          type?: "full"|"partial" }`
 * 不传 `type` / `amount` ⇒ 全额退款（退到本发票可退余额为止）。
 */
export function createSubscriptionRefundHandler() {
  // 只在配置了密钥时实例化；显式钉住 API 版本（见 src/lib/stripe/config.ts）。
  const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })
    : null;

  return withPermission("payment.refund", { dangerous: true })(
    // `context` 不写显式 `any`：类型由 `withPermission` 的 HandlerFunction 推出
    // （`{ params?: any }`）。lint 棘轮逐文件逐规则计数，这里多一个 `any` 就是新增债。
    async (request: NextRequest, context) => {
      try {
        if (!stripe) {
          return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
        }

        const { id } = await context.params;

        // body 允许为空（后台「退款」按钮就是裸 POST ⇒ 全额退款）。
        const body = await request.json().catch(() => ({}));
        const { amount, reason, type } = body ?? {};

        const subscription = await prisma.subscription.findUnique({
          where: { id },
          select: { id: true, status: true, stripeSubscriptionId: true },
        });

        if (!subscription) {
          return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
        }

        if (!subscription.stripeSubscriptionId) {
          return NextResponse.json(
            { error: "No Stripe subscription ID found" },
            { status: 400 }
          );
        }

        const result = await executeSubscriptionRefund(stripe, {
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          amount,
          reason,
          type,
        });

        if (!result.ok) {
          // 全部是「这次请求 / 当前账单状态不允许」⇒ 400；
          // Stripe 侧异常仍由 catch → 500。
          return NextResponse.json(
            { error: result.message, code: result.code },
            { status: 400 }
          );
        }

        const update = subscriptionUpdateForRefund(result);
        if (update.status) {
          await prisma.subscription.update({ where: { id }, data: update });
        }

        // Note: Audit logging is handled by withPermission({ dangerous: true }) middleware

        return NextResponse.json({
          success: true,
          refund: {
            id: result.refund.id,
            amount: result.refund.amountCents / 100,
            currency: result.currency,
            status: result.refund.status,
            created: result.refund.created,
            fullyRefunded: result.fullyRefunded,
          },
          paymentIntent: result.target.kind === "payment_intent" ? result.target.id : null,
          invoiceId: result.invoiceId,
        });
      } catch (error) {
        console.error("Refund error:", error);
        return NextResponse.json({ error: "Failed to process refund" }, { status: 500 });
      }
    }
  );
}
