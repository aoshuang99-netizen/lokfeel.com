/**
 * 退款链路回归 —— 钉住 Stripe `dahlia` 之后「`Invoice.payment_intent` 已移除」这个事实。
 *
 * 背景（2026-10-17 发现）：两条 admin 退款路由都写过
 *
 * ```ts
 * const latestInvoice = stripeSubscription.latest_invoice as any;
 * if (!latestInvoice || !latestInvoice.payment_intent) { ... 400 ... }
 * ```
 *
 * 而 `latest_invoice` 默认只是**字符串 ID**；即便 expand 成对象，`payment_intent`
 * 自 `dahlia` 起也已被移除 —— 真正带收款信息的是 `invoice.payments[].payment.payment_intent`。
 * 于是只要配置了 `STRIPE_SECRET_KEY`，退款就恒 400。生产当时没有 Stripe 密钥，
 * 所以这个缺陷一直没暴露；这组用例保证它不会在启用支付后再回来。
 *
 * 本文件**不需要** Stripe 凭据、不发网络请求：`executeSubscriptionRefund` 只依赖
 * 结构化端口（`StripeRefundPort`），这里传假客户端。
 */
import type Stripe from "stripe";

import {
  executeSubscriptionRefund,
  subscriptionUpdateForRefund,
  isStripeRefundReason,
  type StripeRefundPort,
} from "@/lib/stripe/refund";

const SUB = "sub_test_1";
const INVOICE = "in_test_1";
const PI = "pi_test_1";
const CHARGE = "ch_test_1";

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: INVOICE,
    object: "invoice",
    amount_paid: 5000,
    amount_remaining: 0,
    currency: "usd",
    status: "paid",
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function invoicePayment(overrides: Record<string, unknown> = {}): Stripe.InvoicePayment {
  return {
    id: "inpay_1",
    object: "invoice_payment",
    amount_paid: 5000,
    amount_requested: 5000,
    created: 1_700_000_000,
    currency: "usd",
    invoice: INVOICE,
    is_default: true,
    livemode: false,
    payment: { type: "payment_intent", payment_intent: PI },
    status: "paid",
    status_transitions: {},
    ...overrides,
  } as unknown as Stripe.InvoicePayment;
}

interface Harness {
  port: StripeRefundPort;
  retrieve: jest.Mock;
  listPayments: jest.Mock;
  listRefunds: jest.Mock;
  createRefund: jest.Mock;
}

/**
 * 构造假客户端。
 * `paymentsInline` 模拟 expand 后的 `invoice.payments`；
 * `paymentsListed` 模拟回落到 `invoicePayments.list()` 的结果。
 */
function harness(opts: {
  latestInvoice?: Stripe.Invoice | string | null;
  paymentsInline?: Stripe.InvoicePayment[];
  paymentsListed?: Stripe.InvoicePayment[];
  priorRefunds?: Array<{ id: string; amount: number; status: string | null }>;
  retrieveImpl?: () => Promise<unknown>;
} = {}): Harness {
  const retrieve = jest.fn(async () =>
    opts.retrieveImpl
      ? opts.retrieveImpl()
      : {
          id: SUB,
          latest_invoice:
            opts.latestInvoice === undefined
              ? invoice({ payments: { data: opts.paymentsInline ?? [invoicePayment()] } })
              : opts.latestInvoice,
        }
  );

  const listPayments = jest.fn(async () => ({
    data: opts.paymentsListed ?? [],
  }));

  const listRefunds = jest.fn(async () => ({
    data: opts.priorRefunds ?? [],
  }));

  const createRefund = jest.fn(async (params: { amount: number }) => ({
    id: "re_test_1",
    status: "succeeded",
    created: 1_700_000_100,
    amount: params.amount,
  }));

  const port: StripeRefundPort = {
    subscriptions: { retrieve: retrieve as unknown as StripeRefundPort["subscriptions"]["retrieve"] },
    invoicePayments: {
      list: listPayments as unknown as StripeRefundPort["invoicePayments"]["list"],
    },
    refunds: {
      list: listRefunds as unknown as StripeRefundPort["refunds"]["list"],
      create: createRefund as unknown as StripeRefundPort["refunds"]["create"],
    },
  };

  return { port, retrieve, listPayments, listRefunds, createRefund };
}

// ═══════════════════════════════════════════════════════════
describe("取款标的：dahlia 之后的正确路径", () => {
  it("发票只有 payments（没有 payment_intent 字段）也能退 —— 旧实现正是在这里恒 400", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 前置非空：确认假发票确实**没有** payment_intent 字段，否则本用例会假绿。
    const inv = await h.retrieve();
    expect(
      Object.prototype.hasOwnProperty.call(inv.latest_invoice, "payment_intent")
    ).toBe(false);

    expect(result.target).toEqual({ kind: "payment_intent", id: PI });
    expect(h.createRefund).toHaveBeenCalledTimes(1);
    expect(h.createRefund.mock.calls[0][0]).toMatchObject({
      payment_intent: PI,
      amount: 5000,
      reason: "requested_by_customer",
    });
  });

  it("retrieve 必须 expand latest_invoice（否则拿到的是字符串 ID）", async () => {
    const h = harness();
    await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });
    expect(h.retrieve).toHaveBeenCalledWith(SUB, { expand: ["latest_invoice"] });
  });

  it("latest_invoice 仍是字符串 ⇒ no_paid_invoice，且**不**发起退款", async () => {
    const h = harness({ latestInvoice: "in_unexpanded" });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(result).toMatchObject({ ok: false, code: "no_paid_invoice" });
    expect(h.createRefund).not.toHaveBeenCalled();
  });

  it("latest_invoice 为 null ⇒ no_paid_invoice", async () => {
    const h = harness({ latestInvoice: null });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });
    expect(result).toMatchObject({ ok: false, code: "no_paid_invoice" });
  });

  it("invoice.payments 缺失时回落到 invoicePayments.list（不依赖 expand 深度）", async () => {
    const h = harness({
      latestInvoice: invoice(), // 没有 payments 字段
      paymentsListed: [invoicePayment({ id: "inpay_listed" })],
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(h.listPayments).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: INVOICE, expand: ["data.payment.payment_intent"] })
    );
    expect(result.ok).toBe(true);
  });

  it("默认收款单优先于后加的收款单", async () => {
    const h = harness({
      paymentsInline: [
        invoicePayment({ id: "inpay_new", is_default: false, created: 2_000, payment: { type: "payment_intent", payment_intent: "pi_new" } }),
        invoicePayment({ id: "inpay_def", is_default: true, created: 1_000, payment: { type: "payment_intent", payment_intent: "pi_def" } }),
      ],
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });
    expect(result.ok && result.target.id).toBe("pi_def");
  });

  it("没有 payment_intent 但有 charge ⇒ 退回 charge 标的", async () => {
    const h = harness({
      paymentsInline: [
        invoicePayment({
          payment: { type: "charge", charge: CHARGE },
        }),
      ],
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).toEqual({ kind: "charge", id: CHARGE });
    expect(h.createRefund.mock.calls[0][0]).toMatchObject({ charge: CHARGE });
    expect(h.createRefund.mock.calls[0][0]).not.toHaveProperty("payment_intent");
  });

  it("收款记录全是 canceled ⇒ no_payment_intent", async () => {
    const h = harness({
      paymentsInline: [invoicePayment({ status: "canceled" })],
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });
    expect(result).toMatchObject({ ok: false, code: "no_payment_intent" });
  });
});

// ═══════════════════════════════════════════════════════════
describe("金额：全额 / 部分 / 可退余额", () => {
  it("不传 amount/type ⇒ 全额（amount_paid 分）", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.refund.amountCents).toBe(5000);
    expect(result.fullyRefunded).toBe(true);
    expect(h.createRefund.mock.calls[0][0].amount).toBe(5000);
  });

  it("部分退款：元 → 分（含小数四舍五入）", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      type: "partial",
      amount: 12.345,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.refund.amountCents).toBe(1235);
    expect(result.fullyRefunded).toBe(false);
  });

  it("「已退过一部分」时全额退款只退剩余可退额度", async () => {
    const h = harness({
      priorRefunds: [{ id: "re_old", amount: 2000, status: "succeeded" }],
    });
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      type: "full",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.refundedBeforeCents).toBe(2000);
    expect(result.refund.amountCents).toBe(3000);
    expect(result.fullyRefunded).toBe(true);
  });

  it("failed / canceled 的退款不计入已退金额", async () => {
    const h = harness({
      priorRefunds: [
        { id: "re_failed", amount: 4000, status: "failed" },
        { id: "re_canceled", amount: 1000, status: "canceled" },
        { id: "re_ok", amount: 500, status: "succeeded" },
      ],
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.refundedBeforeCents).toBe(500);
    expect(result.refund.amountCents).toBe(4500);
  });

  it("超出可退余额 ⇒ amount_exceeds_refundable，且不发起退款", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      type: "partial",
      amount: 50.01,
    });

    expect(result).toMatchObject({ ok: false, code: "amount_exceeds_refundable" });
    expect(h.createRefund).not.toHaveBeenCalled();
  });

  it.each([
    ["0", 0],
    ["负数", -5],
    ["NaN", Number.NaN],
    ["非数字字符串", "abc"],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("非法金额 %s ⇒ invalid_amount", async (_label, amount) => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      type: "partial",
      amount,
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(h.createRefund).not.toHaveBeenCalled();
  });

  it("已退干净 ⇒ nothing_refundable（先证 amount_paid 非空，排除空集假绿）", async () => {
    const h = harness({
      priorRefunds: [{ id: "re_full", amount: 5000, status: "succeeded" }],
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(result).toMatchObject({ ok: false, code: "nothing_refundable" });
    expect(h.createRefund).not.toHaveBeenCalled();
  });

  it("发票实付为 0 ⇒ nothing_refundable（不进入金额计算）", async () => {
    const h = harness({
      latestInvoice: invoice({ amount_paid: 0, payments: { data: [invoicePayment()] } }),
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });
    expect(result).toMatchObject({ ok: false, code: "nothing_refundable" });
  });

  it("非法 type ⇒ invalid_type", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      type: "everything",
      amount: 10,
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_type" });
  });

  it("type=partial 但没给金额 ⇒ invalid_amount（不能静默升级成全额）", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      type: "partial",
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(h.createRefund).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
describe("退款原因与幂等键", () => {
  it("未传 reason ⇒ requested_by_customer", async () => {
    const h = harness();
    await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });
    expect(h.createRefund.mock.calls[0][0].reason).toBe("requested_by_customer");
  });

  it("合法 reason 原样透传", async () => {
    const h = harness();
    await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      reason: "duplicate",
    });
    expect(h.createRefund.mock.calls[0][0].reason).toBe("duplicate");
  });

  it("非法 reason ⇒ invalid_reason（不再把 Stripe 的 400 变成 500）", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      reason: "because",
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_reason" });
    expect(h.createRefund).not.toHaveBeenCalled();
  });

  it("同一标的 + 同一已退余额 + 同一金额 ⇒ 同一幂等键（双击不会退两次）", async () => {
    const h = harness();
    const a = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });
    const b = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(h.createRefund.mock.calls[0][1]).toEqual({ idempotencyKey: a.idempotencyKey });
    expect(a.idempotencyKey).toContain(PI);
  });

  it("已退余额变化后，同样金额的再次退款得到**不同**幂等键（允许分两次部分退款）", async () => {
    const first = harness();
    const r1 = await executeSubscriptionRefund(first.port, {
      stripeSubscriptionId: SUB,
      type: "partial",
      amount: 10,
    });

    const second = harness({
      priorRefunds: [{ id: "re_1", amount: 1000, status: "succeeded" }],
    });
    const r2 = await executeSubscriptionRefund(second.port, {
      stripeSubscriptionId: SUB,
      type: "partial",
      amount: 10,
    });

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.idempotencyKey).not.toBe(r2.idempotencyKey);
  });
});

// ═══════════════════════════════════════════════════════════
describe("订阅状态迁移：只有退干净才 CANCELLED", () => {
  it("部分退款不动订阅状态", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, {
      stripeSubscriptionId: SUB,
      type: "partial",
      amount: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(subscriptionUpdateForRefund(result)).toEqual({});
  });

  it("全额退款 ⇒ CANCELLED + cancelledAt", async () => {
    const h = harness();
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const update = subscriptionUpdateForRefund(result);
    expect(update.status).toBe("CANCELLED");
    expect(update.cancelledAt).toBeInstanceOf(Date);
  });

  it("「补齐剩余额度」也算退干净 ⇒ CANCELLED", async () => {
    const h = harness({
      priorRefunds: [{ id: "re_old", amount: 4000, status: "succeeded" }],
    });
    const result = await executeSubscriptionRefund(h.port, { stripeSubscriptionId: SUB });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.refund.amountCents).toBe(1000);
    expect(subscriptionUpdateForRefund(result).status).toBe("CANCELLED");
  });
});

// ═══════════════════════════════════════════════════════════
describe("isStripeRefundReason", () => {
  it.each(["duplicate", "fraudulent", "requested_by_customer"])("%s ⇒ true", (value) => {
    expect(isStripeRefundReason(value)).toBe(true);
  });

  it.each(["", "other", null, undefined, 42])("%p ⇒ false", (value) => {
    expect(isStripeRefundReason(value)).toBe(false);
  });
});
