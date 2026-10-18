import type Stripe from "stripe";

import {
  resolveInvoicePaymentTarget,
  type InvoicePaymentPort,
} from "./invoice-payment";

/**
 * 把发票事件（`invoice.paid` / `invoice.payment_failed`）落成一条 `Payment` 记录。
 *
 * ## 为什么单独抽出来
 *
 * 原来的两份 webhook handler 都写：
 *
 * ```ts
 * stripePaymentIntentId: (invoice as any).payment_intent as string || undefined,
 * ```
 *
 * `Invoice.payment_intent` 自 `dahlia` 起已移除 ⇒ 这两行**永远**写入 `undefined`，
 * 续费/失败的 `Payment` 行因此没有 Stripe 侧的可回溯 ID（不报错，只是数据静默残缺）。
 * 正确取法见 `./invoice-payment.ts`。
 *
 * ## 为什么要判重
 *
 * `Payment.stripePaymentIntentId` 是 `@unique`。订阅扣款失败后 Stripe 会**复用同一个
 * PaymentIntent** 重试；同一张发票先 `payment_failed` 再 `payment_paid` 时，若直接 create
 * 就会撞唯一约束 → webhook 500 → Stripe 反复重投。所以这里先按 PI 查一次：
 * 命中就 `update`（把 FAILED 纠正为 SUCCEEDED），没命中才 `create`。
 *
 * 依赖注入（`stripe` 端口 + `payments` 端口）让这套逻辑可以脱离真实 Stripe 与数据库单测。
 */

export interface PaymentRecordPort {
  findUnique(args: {
    where: { stripePaymentIntentId: string };
    select?: { id: true };
  }): Promise<{ id: string } | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

export interface RecordInvoicePaymentInput {
  userId: string;
  invoice: Stripe.Invoice;
  /** 单位：元（与 `Payment.amount` 一致）。 */
  amount: number;
  status: "SUCCEEDED" | "FAILED";
  description: string;
}

export interface RecordInvoicePaymentResult {
  action: "created" | "updated";
  /** 解析不到时为空 —— 记录照建，只是缺这个 ID（不因此让 webhook 失败）。 */
  paymentIntentId: string | null;
}

export async function recordInvoicePayment(
  deps: { stripe: InvoicePaymentPort; payments: PaymentRecordPort },
  input: RecordInvoicePaymentInput
): Promise<RecordInvoicePaymentResult> {
  // 解析失败（Stripe 抖动/权限）不应让 webhook 5xx：记账比溯源更重要。
  const target = await resolveInvoicePaymentTarget(deps.stripe, input.invoice).catch(
    (error) => {
      console.error("[InvoicePayment] Failed to resolve payment target:", error);
      return null;
    }
  );

  const paymentIntentId = target?.kind === "payment_intent" ? target.id : null;

  const data: Record<string, unknown> = {
    userId: input.userId,
    amount: input.amount,
    currency: input.invoice.currency || "usd",
    status: input.status,
    description: input.description,
  };

  if (paymentIntentId) {
    const existing = await deps.payments.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true },
    });

    if (existing) {
      await deps.payments.update({
        where: { id: existing.id },
        data: { ...data, stripePaymentIntentId: paymentIntentId },
      });
      return { action: "updated", paymentIntentId };
    }
    data.stripePaymentIntentId = paymentIntentId;
  }

  await deps.payments.create({ data });
  return { action: "created", paymentIntentId };
}
