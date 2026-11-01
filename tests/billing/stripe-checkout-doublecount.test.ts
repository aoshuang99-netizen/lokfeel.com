/**
 * Stripe `checkout.session.completed` 授权/记账回归 —— 钉住三个已修缺陷。
 *
 * 这三条都是「日志全绿、钱算错」的类型，没有真实 Stripe 流量时几乎不可能被发现：
 *
 *   B-10（P1）订阅模式首期款记两遍：`session.payment_intent` 在订阅模式恒为 null，
 *        原实现仍 `payment.create()`，与 `invoice.payment_succeeded` 各落一条
 *        SUCCEEDED ⇒ 管理台收入恒为真实值 2 倍，且第一条无 PI 无法对账。
 *   B-11（P2）`payment_status:"unpaid"` 也发 Premium（异步支付方式的首跳）。
 *   B-12（P2）年付的有效期被写死 30 天。
 *
 * 本文件不需要 Stripe 凭据、不连库：决策是纯函数，记账走注入端口。
 */
import {
  decideCheckoutGrant,
  recordCheckoutPayment,
  subscriptionDataFor,
  type CheckoutGrant,
  type CheckoutPaymentPort,
  type CheckoutSessionLike,
} from "@/lib/stripe/checkout-grant";

const NOW = new Date("2026-11-01T00:00:00Z");

function session(overrides: Partial<CheckoutSessionLike> = {}): CheckoutSessionLike {
  return {
    id: "cs_test_1",
    payment_status: "paid",
    customer: "cus_test_1",
    subscription: "sub_test_1",
    invoice: "in_test_1",
    payment_intent: null,
    amount_total: 1999,
    currency: "usd",
    metadata: { userId: "user_1", plan: "PREMIUM_MONTHLY" },
    ...overrides,
  };
}

/** 记账端口替身：记录每次调用，便于断言「到底写没写」。 */
function fakePayments(existing: { id: string } | null = null) {
  const calls = {
    findUnique: [] as unknown[],
    update: [] as unknown[],
    create: [] as unknown[],
  };
  const port: CheckoutPaymentPort = {
    async findUnique(args) {
      calls.findUnique.push(args);
      return existing;
    },
    async update(args) {
      calls.update.push(args);
      return {};
    },
    async create(args) {
      calls.create.push(args);
      return {};
    },
  };
  return { port, calls };
}

function grantOf(overrides: Partial<CheckoutSessionLike> = {}): CheckoutGrant {
  const outcome = decideCheckoutGrant(session(overrides), NOW);
  if (outcome.kind !== "grant") {
    throw new Error(`expected grant, got skip:${outcome.reason}`);
  }
  return outcome.grant;
}

describe("B-10 订阅模式首期款不得在 checkout 记账", () => {
  it("有 invoice ⇒ 记账权交给 invoice.payment_succeeded，一次写都不发生", async () => {
    const { port, calls } = fakePayments();
    const result = await recordCheckoutPayment(
      { payments: port },
      grantOf(),
      "LokFee! Monthly Premium"
    );

    expect(result).toEqual({ action: "deferred-to-invoice", invoiceId: "in_test_1" });
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(calls.findUnique).toHaveLength(0);
  });

  it("订阅模式即使 payment_intent 被展开成对象也照样 defer（不因取不到 id 而回退成写库）", async () => {
    const { port, calls } = fakePayments();
    const result = await recordCheckoutPayment(
      { payments: port },
      grantOf({ payment_intent: { id: "pi_expanded" } }),
      "desc"
    );

    expect(result.action).toBe("deferred-to-invoice");
    expect(calls.create).toHaveLength(0);
  });

  it("一次性支付（无 invoice）才落账，且金额按「分 → 元」换算", async () => {
    const { port, calls } = fakePayments();
    const result = await recordCheckoutPayment(
      { payments: port },
      grantOf({ invoice: null, subscription: null, payment_intent: "pi_once", amount_total: 4999 }),
      "LokFee! Lifetime"
    );

    expect(result).toEqual({ action: "created", paymentIntentId: "pi_once" });
    expect(calls.create).toHaveLength(1);
    const data = (calls.create[0] as { data: Record<string, unknown> }).data;
    expect(data.amount).toBe(49.99);
    expect(data.status).toBe("SUCCEEDED");
    expect(data.stripePaymentIntentId).toBe("pi_once");
    expect(data.userId).toBe("user_1");
  });

  it("同一 PI 重投 ⇒ update 而非新增（stripePaymentIntentId 是 @unique，create 会 500）", async () => {
    const { port, calls } = fakePayments({ id: "pay_existing" });
    const result = await recordCheckoutPayment(
      { payments: port },
      grantOf({ invoice: null, subscription: null, payment_intent: "pi_once" }),
      "desc"
    );

    expect(result).toEqual({ action: "updated", paymentIntentId: "pi_once" });
    expect(calls.create).toHaveLength(0);
    expect((calls.update[0] as { where: { id: string } }).where.id).toBe("pay_existing");
  });
});

describe("B-11 未到账不得授权", () => {
  it("payment_status=unpaid ⇒ skip(unpaid)，既不授权也不写钱", () => {
    const outcome = decideCheckoutGrant(session({ payment_status: "unpaid" }), NOW);
    expect(outcome).toEqual({ kind: "skip", reason: "unpaid" });
  });

  it("payment_status=no_payment_required（100% 优惠码/试用）⇒ 正常授权", () => {
    const outcome = decideCheckoutGrant(
      session({ payment_status: "no_payment_required", amount_total: 0 }),
      NOW
    );
    expect(outcome.kind).toBe("grant");
    if (outcome.kind === "grant") {
      expect(outcome.grant.amount).toBe(0);
    }
  });

  it("缺 userId ⇒ skip(no-user)", () => {
    const outcome = decideCheckoutGrant(session({ metadata: {} }), NOW);
    expect(outcome).toEqual({ kind: "skip", reason: "no-user" });
  });
});

describe("B-12 有效期按套餐，不写死 30 天", () => {
  it("月付 ⇒ 30 天", () => {
    expect(grantOf().periodEnd.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("年付 ⇒ 365 天", () => {
    const yearly = grantOf({ metadata: { userId: "user_1", plan: "PREMIUM_YEARLY" } });
    expect(yearly.plan).toBe("PREMIUM_YEARLY");
    expect(yearly.periodEnd.toISOString()).toBe("2027-11-01T00:00:00.000Z");
  });

  it("metadata.plan 是脏值 ⇒ 回落月付，不抛错", () => {
    const grant = grantOf({ metadata: { userId: "user_1", plan: "LIFETIME_FREE" } });
    expect(grant.plan).toBe("PREMIUM_MONTHLY");
  });
});

describe("字段解析", () => {
  it("customer/invoice/subscription 被 expand 成对象时取 id", () => {
    const grant = grantOf({
      customer: { id: "cus_obj" },
      invoice: { id: "in_obj" },
      subscription: { id: "sub_obj" },
    });
    expect(grant.customerId).toBe("cus_obj");
    expect(grant.invoiceId).toBe("in_obj");
    expect(grant.subscriptionId).toBe("sub_obj");
  });

  it("subscription 缺失时写 undefined 而不是空串（空串会污染 stripeSubscriptionId）", () => {
    const grant = grantOf({ subscription: null, invoice: null, payment_intent: "pi_x" });
    expect(grant.subscriptionId).toBeNull();
    expect(subscriptionDataFor(grant).stripeSubscriptionId).toBeUndefined();
  });

  it("订阅写入的权益与套餐一致（Premium 5 次/周 + 可发起聊天 + 可看完整资料）", () => {
    const data = subscriptionDataFor(grantOf());
    expect(data).toMatchObject({
      plan: "PREMIUM_MONTHLY",
      status: "ACTIVE",
      weeklyMatchLimit: 5,
      canInitiateChat: true,
      canViewFullProfile: true,
      cancelledAt: null,
    });
  });
});
