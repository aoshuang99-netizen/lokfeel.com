/**
 * Webhook 记账：`invoice.paid` / `invoice.payment_failed` → `Payment` 行。
 *
 * 钉住三件事：
 *   1. `stripePaymentIntentId` 必须真的取到（旧实现读已移除的 `Invoice.payment_intent`，
 *      永远写 `undefined` —— 不报错但数据静默残缺）；
 *   2. 同一个 PaymentIntent 不会 create 两次（`[stripePaymentIntentId]` 是 @unique，
 *      Stripe 重试会用同一个 PI ⇒ 直接 create 会撞约束 → webhook 500 → 无限重投）；
 *   3. 解析收款标的失败时**降级记账**，不让 webhook 抛错。
 */
import type Stripe from "stripe";

import {
  recordInvoicePayment,
  type PaymentRecordPort,
} from "@/lib/stripe/invoice-payment-record";
import type { InvoicePaymentPort } from "@/lib/stripe/invoice-payment";

const INVOICE = "in_test_1";
const PI = "pi_test_1";

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: INVOICE,
    object: "invoice",
    amount_paid: 5000,
    amount_due: 5000,
    currency: "usd",
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

function harness(opts: {
  paymentsInline?: Stripe.InvoicePayment[];
  paymentsListed?: Stripe.InvoicePayment[];
  listImpl?: () => Promise<unknown>;
  existing?: { id: string } | null;
}) {
  const list = jest.fn(async () => ({
    data: opts.paymentsListed ?? [],
  }));
  if (opts.listImpl) list.mockImplementation(opts.listImpl as never);

  const stripe: InvoicePaymentPort = {
    invoicePayments: { list: list as unknown as InvoicePaymentPort["invoicePayments"]["list"] },
  };

  // 这些 mock 的**入参必须显式声明**：`jest.fn(async () => ({}))` 会推断出空参数元组，
  // 于是 `mock.calls[0][0]` 在类型层是非法下标（TS2493）—— ts-jest 默认把诊断当错误上报。
  const findUnique = jest.fn(
    async (_args: { where: Record<string, unknown> }): Promise<{ id: string } | null> =>
      opts.existing ?? null
  );
  const update = jest.fn(
    async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({})
  );
  const create = jest.fn(
    async (_args: { data: Record<string, unknown> }) => ({})
  );
  const payments = {
    findUnique,
    update,
    create,
  } as unknown as PaymentRecordPort;

  return { stripe, payments, list, findUnique, update, create };
}

/**
 * 取某次调用的首个实参。
 * 直接写 `mock.calls[0][0]` 时，空参数元组会触发 TS2493；这里集中做一次取值，
 * 并显式处理「调用不存在」的情况（正常应由前置 `toHaveBeenCalledTimes` 兜住）。
 */
function argOf<T>(mock: { mock: { calls: readonly unknown[][] } }, n = 0): T {
  const call = mock.mock.calls[n];
  if (!call) throw new Error(`expected call #${n}`);
  return call[0] as T;
}

type CreateArgs = { data: Record<string, unknown> };

const baseInput = (inv: Stripe.Invoice) => ({
  userId: "u_1",
  invoice: inv,
  amount: 50,
  status: "SUCCEEDED" as const,
  description: "LokFee! PREMIUM renewal",
});

describe("recordInvoicePayment", () => {
  it("从 invoice.payments 取到 payment_intent 并落到 Payment 行", async () => {
    const h = harness({});
    const inv = invoice({ payments: { data: [invoicePayment()] } });

    const result = await recordInvoicePayment(
      { stripe: h.stripe, payments: h.payments },
      baseInput(inv)
    );

    expect(result).toEqual({ action: "created", paymentIntentId: PI });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(argOf<CreateArgs>(h.create)).toMatchObject({
      data: {
        userId: "u_1",
        amount: 50,
        currency: "usd",
        status: "SUCCEEDED",
        stripePaymentIntentId: PI,
      },
    });
  });

  it("invoice.payments 缺失时回落 invoicePayments.list", async () => {
    const h = harness({ paymentsListed: [invoicePayment()] });
    const result = await recordInvoicePayment(
      { stripe: h.stripe, payments: h.payments },
      baseInput(invoice())
    );

    expect(h.list).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: INVOICE })
    );
    expect(result.paymentIntentId).toBe(PI);
  });

  it("同一 PaymentIntent 已存在 ⇒ update 而不是 create（避免撞 @unique）", async () => {
    const h = harness({ existing: { id: "pay_old" } });
    const inv = invoice({ payments: { data: [invoicePayment()] } });

    const result = await recordInvoicePayment(
      { stripe: h.stripe, payments: h.payments },
      baseInput(inv)
    );

    expect(result).toEqual({ action: "updated", paymentIntentId: PI });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "pay_old" },
      data: expect.objectContaining({ status: "SUCCEEDED", stripePaymentIntentId: PI }),
    });
  });

  it("重试成功：既有的 FAILED 记录被纠正为 SUCCEEDED", async () => {
    const h = harness({ existing: { id: "pay_failed" } });
    const inv = invoice({ payments: { data: [invoicePayment()] } });

    await recordInvoicePayment(
      { stripe: h.stripe, payments: h.payments },
      baseInput(inv)
    );

    expect(
      argOf<{ where: { id: string }; data: Record<string, unknown> }>(h.update).data
    ).toMatchObject({ status: "SUCCEEDED" });
  });

  it("解析失败（Stripe 抖动）⇒ 降级：仍记账，只是没有 PI，且**不抛错**", async () => {
    const h = harness({
      listImpl: async () => {
        throw new Error("stripe unavailable");
      },
    });

    const result = await recordInvoicePayment(
      { stripe: h.stripe, payments: h.payments },
      baseInput(invoice())
    );

    expect(result).toEqual({ action: "created", paymentIntentId: null });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(argOf<CreateArgs>(h.create).data).not.toHaveProperty("stripePaymentIntentId");
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("只有 charge 的发票 ⇒ 不写 stripePaymentIntentId（该字段只装 PI）", async () => {
    const h = harness({
      paymentsInline: [
        invoicePayment({ payment: { type: "charge", charge: "ch_test_1" } }),
      ],
    });
    const inv = invoice({ payments: { data: [invoicePayment({ payment: { type: "charge", charge: "ch_test_1" } })] } });

    const result = await recordInvoicePayment(
      { stripe: h.stripe, payments: h.payments },
      baseInput(inv)
    );

    expect(result.paymentIntentId).toBeNull();
    expect(argOf<CreateArgs>(h.create).data).not.toHaveProperty("stripePaymentIntentId");
  });

  it("失败事件按 FAILED 记账", async () => {
    const h = harness({});
    const inv = invoice({ payments: { data: [invoicePayment({ status: "open" })] } });

    await recordInvoicePayment(
      { stripe: h.stripe, payments: h.payments },
      { ...baseInput(inv), status: "FAILED" }
    );

    expect(argOf<CreateArgs>(h.create).data).toMatchObject({ status: "FAILED" });
  });
});
