import type Stripe from "stripe";

import {
  resolveInvoicePaymentTarget,
  type InvoicePaymentPort,
  type PaymentTarget,
} from "./invoice-payment";

/**
 * Stripe 订阅退款 —— **单一实现**，供两条 admin 路由共用
 * （`/api/admin/subscriptions/[id]` 的 POST 与 `.../[id]/refund` 的 POST）。
 *
 * ## 为什么要有这个文件
 *
 * 两条路由原先各自复制了一份「取 latest_invoice → 读 `payment_intent` → 退款」的逻辑，
 * 而这段逻辑在 Stripe API `2026-08-26.dahlia`（以及更高版本）下**必然失败**：
 *
 *   1. `Subscription.latest_invoice` 默认只是一个**字符串 ID**，不解引用就拿不到任何字段；
 *   2. 即便 `expand` 成对象，`Invoice.payment_intent` 自 `dahlia` 起**已被移除** ——
 *      旧代码靠 `as any` 绕过类型检查，运行时读到的永远是 `undefined`，
 *      于是每次都走进「No payment found to refund」分支，两条路由恒 400。
 *
 * 现在的取法（与 Stripe 现行 API 一致）：
 *
 *   - `subscriptions.retrieve(id, { expand: ["latest_invoice"] })` 拿到发票对象；
 *   - 发票上的收款记录在 `invoice.payments`（`InvoicePayment` 列表）里，
 *     每一项的 `payment.payment_intent` / `payment.charge` 才是可退款的标的；
 *   - `invoice.payments` 是可选字段（需 expand），缺失时回落到
 *     `invoicePayments.list({ invoice })` 显式拉取，**不依赖** expand 深度。
 *
 * ## 刻意做成「纯函数 + 依赖注入」
 *
 * `executeSubscriptionRefund` 只接收一个结构化的 Stripe 端口（真正用到的那几个方法），
 * 不 import 具体客户端、不碰数据库、不碰 Next 的 Request/Response。
 * 这样退款决策（金额、可退余额、幂等键、部分/全额）可以**在没有 Stripe 凭据**的环境下
 * 被单元测试完整覆盖 —— 路由层只负责鉴权、取库、写库和映射 HTTP 状态码。
 *
 * ## 可退余额从哪来
 *
 * `invoice.amount_paid` 是该发票实付金额；已退金额取自 `refunds.list()`（排除
 * `failed` / `canceled`）。**不用** `Invoice.amount_remaining`：它表示「本发票还欠多少」，
 * 与「已退多少」是两件事，用错会把部分退款算成未支付。
 */

/** `refunds.create.reason` 只接受这三个值，传别的 Stripe 会直接 400。 */
export const STRIPE_REFUND_REASONS = [
  "duplicate",
  "fraudulent",
  "requested_by_customer",
] as const;

export type StripeRefundReason = (typeof STRIPE_REFUND_REASONS)[number];

export function isStripeRefundReason(value: unknown): value is StripeRefundReason {
  return (
    typeof value === "string" &&
    (STRIPE_REFUND_REASONS as readonly string[]).includes(value)
  );
}

/** 单笔退款最多扫描的既有退款条数（一张发票的退款笔数远小于这个量级）。 */
const REFUND_SCAN_LIMIT = 100;

/** 与「已退金额」统计无关的退款状态：这两种钱并没有真的退出去。 */
const NON_EFFECTIVE_REFUND_STATUSES = new Set(["failed", "canceled"]);

/**
 * 真正用到的那部分 Stripe 能力。
 * 用**结构化类型**而不是 `Stripe` 类，测试可以传一个普通对象；
 * 真实客户端因为方法参数是双变的，可直接赋给这个端口。
 *
 * 收款记录的解析（`invoice.payments` → payment_intent）与 Webhook 记账共用，
 * 见 `src/lib/stripe/invoice-payment.ts`。
 */
export interface StripeRefundPort extends InvoicePaymentPort {
  subscriptions: {
    retrieve(
      id: string,
      params?: { expand?: string[] }
    ): Promise<Pick<Stripe.Subscription, "id" | "latest_invoice">>;
  };

  refunds: {
    list(params: {
      payment_intent?: string;
      charge?: string;
      limit?: number;
    }): Promise<{
      data: Array<Pick<Stripe.Refund, "id" | "amount" | "status">>;
    }>;
    create(
      params: {
        payment_intent?: string;
        charge?: string;
        amount: number;
        reason?: StripeRefundReason;
      },
      options?: { idempotencyKey?: string }
    ): Promise<Pick<Stripe.Refund, "id" | "status" | "created" | "amount">>;
  };
}

export type RefundFailureCode =
  | "invalid_type"
  | "invalid_amount"
  | "invalid_reason"
  | "no_paid_invoice"
  | "no_payment_intent"
  | "nothing_refundable"
  | "amount_exceeds_refundable";

export interface RefundFailure {
  ok: false;
  /** 供路由映射 HTTP 状态码，同时让测试能钉住「失败原因不是靠文案猜的」。 */
  code: RefundFailureCode;
  message: string;
}

export interface RefundSuccess {
  ok: true;
  refund: {
    id: string;
    /** 本次退款金额（分）。 */
    amountCents: number;
    status: string | null;
    created: number;
  };
  /** 退款标的：`payment_intent` 或 `charge`。 */
  target: PaymentTarget;
  invoiceId: string;
  /** 发票实付金额（分）。 */
  amountPaidCents: number;
  /** 本次之前已退金额（分）。 */
  refundedBeforeCents: number;
  /** 本次退款后是否已把这张发票退干净 —— 只有它为 true 才该动订阅状态。 */
  fullyRefunded: boolean;
  currency: string | null;
  /** 传给 Stripe 的幂等键；同一次「同一余额下的同一金额」重复提交不会重复扣款。 */
  idempotencyKey: string;
}

export type RefundResult = RefundSuccess | RefundFailure;

export interface RefundRequest {
  stripeSubscriptionId: string;
  /** `full` 忽略 `amount`；`partial` 必填 `amount`（单位：元）。 */
  type?: string | null;
  /** 单位：元（与后台表单一致），内部换算成分。 */
  amount?: unknown;
  reason?: unknown;
}

function fail(code: RefundFailureCode, message: string): RefundFailure {
  return { ok: false, code, message };
}

/** `latest_invoice` 可能是 ID 字符串（未 expand）、发票对象或 null。 */
function asInvoice(
  value: Stripe.Subscription["latest_invoice"]
): Stripe.Invoice | null {
  if (!value || typeof value === "string") return null;
  return value;
}

/** 累计**已经真退出去**的金额：`failed` / `canceled` 的退款不计入。 */
async function sumRefunded(stripe: StripeRefundPort, target: PaymentTarget) {
  const listed = await stripe.refunds.list({
    ...(target.kind === "payment_intent"
      ? { payment_intent: target.id }
      : { charge: target.id }),
    limit: REFUND_SCAN_LIMIT,
  });

  return listed.data
    .filter((r) => !NON_EFFECTIVE_REFUND_STATUSES.has(String(r.status)))
    .reduce((sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0), 0);
}

/**
 * 计算本次应退金额（分）。
 * `amount` 是元，允许小数；换算后必须是正整数，且不超过可退余额。
 */
function resolveAmountCents(
  request: RefundRequest,
  refundableCents: number
): { ok: true; amountCents: number } | RefundFailure {
  const type = request.type ?? null;
  if (type !== null && type !== "full" && type !== "partial") {
    return fail("invalid_type", "Invalid refund type");
  }

  // `partial` 却没给金额 ⇒ 拒绝。绝不能「没给金额就当全额」——
  // 那是把一次参数缺失放大成不可撤销的全额退款。
  if (type === "partial" && (request.amount === undefined || request.amount === null)) {
    return fail("invalid_amount", "Partial refund requires an amount");
  }

  const wantsFull = type === "full" || request.amount === undefined || request.amount === null;

  if (wantsFull) {
    return { ok: true, amountCents: refundableCents };
  }

  const raw = typeof request.amount === "string" ? Number(request.amount) : request.amount;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return fail("invalid_amount", "Refund amount must be a positive number");
  }

  const amountCents = Math.round(raw * 100);
  if (amountCents <= 0) {
    return fail("invalid_amount", "Refund amount is too small");
  }
  if (amountCents > refundableCents) {
    return fail(
      "amount_exceeds_refundable",
      `Refund amount exceeds refundable balance (${(refundableCents / 100).toFixed(2)})`
    );
  }
  return { ok: true, amountCents };
}

/**
 * 执行一次订阅退款。**不做**数据库写入 —— 订阅状态由调用方按
 * `fullyRefunded` 决定（部分退款不应该停掉订阅）。
 */
export async function executeSubscriptionRefund(
  stripe: StripeRefundPort,
  request: RefundRequest
): Promise<RefundResult> {
  const subscription = await stripe.subscriptions.retrieve(
    request.stripeSubscriptionId,
    { expand: ["latest_invoice"] }
  );

  const invoice = asInvoice(subscription.latest_invoice);
  if (!invoice) {
    return fail(
      "no_paid_invoice",
      "No invoice found for this subscription (latest_invoice is not expanded or missing)"
    );
  }

  const amountPaidCents = Number(invoice.amount_paid ?? 0);
  if (!Number.isFinite(amountPaidCents) || amountPaidCents <= 0) {
    return fail("nothing_refundable", "This invoice has no paid amount to refund");
  }

  // 收款记录的解析与 Webhook 记账共用同一实现（`invoice.payments` → payment_intent）。
  const target = await resolveInvoicePaymentTarget(stripe, invoice);
  if (!target) {
    return fail(
      "no_payment_intent",
      "No refundable payment (payment_intent/charge) found for the latest invoice"
    );
  }

  const refundedBeforeCents = await sumRefunded(stripe, target);
  const refundableCents = Math.max(0, amountPaidCents - refundedBeforeCents);
  if (refundableCents <= 0) {
    return fail("nothing_refundable", "This invoice has already been fully refunded");
  }

  const amount = resolveAmountCents(request, refundableCents);
  if (amount.ok === false) return amount;

  let reason: StripeRefundReason = "requested_by_customer";
  if (request.reason !== undefined && request.reason !== null && request.reason !== "") {
    if (!isStripeRefundReason(request.reason)) {
      return fail(
        "invalid_reason",
        `Invalid refund reason, expected one of: ${STRIPE_REFUND_REASONS.join(", ")}`
      );
    }
    reason = request.reason;
  }

  // 幂等键把「同一标的 + 同一已退余额 + 同一金额」折叠成一笔：
  // admin 双击/超时重试不会退两次；等余额变了再退同额，键就不同，允许。
  const idempotencyKey = [
    "admin-refund",
    target.id,
    String(refundedBeforeCents),
    String(amount.amountCents),
  ].join(":");

  const refund = await stripe.refunds.create(
    {
      ...(target.kind === "payment_intent"
        ? { payment_intent: target.id }
        : { charge: target.id }),
      amount: amount.amountCents,
      reason,
    },
    { idempotencyKey }
  );

  return {
    ok: true,
    refund: {
      id: refund.id,
      amountCents: amount.amountCents,
      status: refund.status ?? null,
      created: refund.created,
    },
    target,
    invoiceId: invoice.id,
    amountPaidCents,
    refundedBeforeCents,
    fullyRefunded: refundedBeforeCents + amount.amountCents >= amountPaidCents,
    currency: invoice.currency ?? null,
    idempotencyKey,
  };
}

/**
 * 退款成功后的订阅状态迁移。
 * 只有把这张发票**退干净**才置 `CANCELLED`；部分退款保留原状态（用户仍应享有服务）。
 */
export function subscriptionUpdateForRefund(result: RefundSuccess): {
  status?: "CANCELLED";
  cancelledAt?: Date;
} {
  if (!result.fullyRefunded) return {};
  return { status: "CANCELLED", cancelledAt: new Date() };
}
