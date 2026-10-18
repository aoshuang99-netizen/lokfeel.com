import type Stripe from "stripe";

/**
 * 从发票（Invoice）里找出**可退款的标的**。
 *
 * 这是 `dahlia` 之后唯一正确的取法：`Invoice.payment_intent` 已被移除，
 * 收款信息搬到了 `invoice.payments[]`（`InvoicePayment`）里的
 * `payment.payment_intent` / `payment.charge`。
 *
 * 两种使用方：
 *   - 退款链路（`src/lib/stripe/refund.ts`）—— 需要 payment_intent 才能 `refunds.create`；
 *   - Webhook 记账（`/api/webhooks/stripe`）—— 需要把 `stripePaymentIntentId` 落到 `Payment` 表，
 *     否则续费记录永远无法回溯到 Stripe。
 *
 * 之所以单独成文件：这两个使用方都必须遵守同一套「先 expand，再回落列表」的规则，
 * 写在两处迟早有一处写错（本轮发现的两处 `(invoice as any).payment_intent` 就是这么来的）。
 */

export type PaymentTarget =
  | { kind: "payment_intent"; id: string }
  | { kind: "charge"; id: string };

/** 只依赖真正用到的方法，便于测试注入假客户端。 */
export interface InvoicePaymentPort {
  invoicePayments: {
    list(params: {
      invoice: string;
      expand?: string[];
      limit?: number;
    }): Promise<{ data: Stripe.InvoicePayment[] }>;
  };
}

/**
 * 在收款记录里挑一笔：优先默认收款单（Stripe 对每张发票自动建的那笔），
 * 其次最新的；`canceled` 的直接跳过。
 */
export function pickPaymentTarget(
  payments: Stripe.InvoicePayment[]
): PaymentTarget | null {
  const candidates = payments
    .filter((p) => p.status !== "canceled")
    .slice()
    .sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return b.created - a.created;
    });

  for (const payment of candidates) {
    const intent = payment.payment?.payment_intent;
    if (intent) {
      return {
        kind: "payment_intent",
        id: typeof intent === "string" ? intent : intent.id,
      };
    }
    const charge = payment.payment?.charge;
    if (charge && payment.payment?.type === "charge") {
      return { kind: "charge", id: typeof charge === "string" ? charge : charge.id };
    }
  }
  return null;
}

/**
 * 拿到发票的收款记录：优先用 expand 带回来的内联 `payments`，
 * 缺失时用 `invoicePayments.list()` 显式拉取。
 * 后者不依赖调用方是否 expand，也不受单次 expand 深度限制。
 */
export async function listInvoicePayments(
  port: InvoicePaymentPort,
  invoice: Stripe.Invoice
): Promise<Stripe.InvoicePayment[]> {
  const inline = invoice.payments?.data;
  if (inline && inline.length > 0) return inline;

  const listed = await port.invoicePayments.list({
    invoice: invoice.id,
    expand: ["data.payment.payment_intent"],
    limit: 10,
  });
  return listed.data;
}

export async function resolveInvoicePaymentTarget(
  port: InvoicePaymentPort,
  invoice: Stripe.Invoice
): Promise<PaymentTarget | null> {
  return pickPaymentTarget(await listInvoicePayments(port, invoice));
}
