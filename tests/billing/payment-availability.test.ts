/**
 * 支付可用性判定 —— 真值表 + 反向对照 + 不泄值。
 *
 * 为什么值得单独测：
 *   1. 这套布尔值是「上线前最后一步」的**唯一判据**（/api/health 直接把它吐给公开端点）。
 *      判错方向的代价是不对称的：把「未接入」判成「已接入」会让发布方以为可以收费，
 *      而真实用户点升级只会拿到 503。
 *   2. 它是**公开响应**的一部分 ⇒ 任何一次「顺手把 env[key] 塞进 missing」
 *      都会变成凭据泄露。这条必须有断言，不能靠 review。
 *   3. 「全绿」这类断言最容易变成恒真：所有通道都缺时也"全绿"是不可能的，
 *      但「配置齐全时 missing 为空」单独看仍然是弱证据 —— 所以每条正向断言
 *      都配一条**反向对照**（删掉一个变量，必须恰好翻掉对应通道）。
 */
import {
  PAYMENT_CHANNELS,
  isPaymentChannelReady,
  missingForChannel,
  readPaymentAvailability,
  describePaymentAvailability,
} from "@/lib/payments/availability";

/** 全就绪的基准环境（假值，形状合法即可）。 */
const READY: Record<string, string> = {
  CREEM_API_KEY: "creem_0123456789abcdef",
  CREEM_WEBHOOK_SECRET: "creem_whsec_0123456789abcdef",
  CREEM_ENV: "production",
  STRIPE_SECRET_KEY: "sk_test_0123456789abcdef",
  STRIPE_WEBHOOK_SECRET: "whsec_0123456789abcdef",
};

/** 去掉若干键（模拟"忘了配某个变量"）。 */
function without(...keys: string[]): Record<string, string> {
  const copy = { ...READY };
  for (const k of keys) delete copy[k];
  return copy;
}

describe("payment availability · 真值表", () => {
  it("空环境：五个通道全部未就绪，缺 4 个变量", () => {
    const a = readPaymentAvailability({});

    expect(a.configured).toBe(false);
    expect(a.charging).toBe(false);
    expect(PAYMENT_CHANNELS).toHaveLength(5);
    for (const channel of PAYMENT_CHANNELS) {
      expect(a.channels[channel]).toBe(false);
    }
    // STRIPE_SECRET_KEY 被两个通道共用，去重后恰好 4 个
    expect(a.missing).toEqual([
      "CREEM_API_KEY",
      "CREEM_WEBHOOK_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(a.malformed).toEqual([]);
  });

  it("全部就绪：configured / charging 均为 true，missing 为空", () => {
    const a = readPaymentAvailability(READY);

    expect(a.configured).toBe(true);
    expect(a.charging).toBe(true);
    expect(a.missing).toEqual([]);
    expect(a.malformed).toEqual([]);
    for (const channel of PAYMENT_CHANNELS) {
      expect(a.channels[channel]).toBe(true);
    }
  });

  it("只接 Creem（订阅主链路）时 charging=true 但 configured=false", () => {
    const a = readPaymentAvailability(without("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"));

    expect(a.charging).toBe(true);
    expect(a.configured).toBe(false);
    expect(a.channels["creem.checkout"]).toBe(true);
    expect(a.channels["creem.webhook"]).toBe(true);
    expect(a.channels["stripe.card"]).toBe(false);
    expect(a.channels["stripe.webhook"]).toBe(false);
    expect(a.missing).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  });

  it("缺 checkout 的 key 时 charging=false —— 收了钱也没有入口", () => {
    const a = readPaymentAvailability(without("CREEM_API_KEY"));

    expect(a.charging).toBe(false);
    expect(a.channels["creem.checkout"]).toBe(false);
    // 它的 webhook 仍然"就绪"，但主链路不闭环
    expect(a.channels["creem.webhook"]).toBe(true);
  });

  it("CREEM_ENV 缺省视作 production（不误判为误配）", () => {
    const a = readPaymentAvailability(without("CREEM_ENV"));
    expect(a.malformed).toEqual([]);
  });

  it("CREEM_*_PRODUCT_ID 不是必填 —— 缺了不算未接入（订阅页走实时产品列表）", () => {
    const a = readPaymentAvailability(READY);
    expect(a.missing).not.toContain("CREEM_MONTHLY_PRODUCT_ID");
    expect(a.missing).not.toContain("CREEM_YEARLY_PRODUCT_ID");
    expect(a.channels["creem.checkout"]).toBe(true);
  });
});

describe("payment availability · 反向对照（证明断言有牙齿）", () => {
  // 每删掉一个必备变量，必须至少有一个通道由 true 翻 false，且该变量出现在 missing 里。
  // 若某条规则被写空（例如 requires 被改成 []），这一组会立刻变红 —— 这是本文件的核心价值。
  const CASES: Array<{ variable: string; affected: string[] }> = [
    { variable: "CREEM_API_KEY", affected: ["creem.checkout"] },
    { variable: "CREEM_WEBHOOK_SECRET", affected: ["creem.webhook"] },
    { variable: "STRIPE_SECRET_KEY", affected: ["stripe.card", "stripe.refund", "stripe.webhook"] },
    { variable: "STRIPE_WEBHOOK_SECRET", affected: ["stripe.webhook"] },
  ];

  for (const { variable, affected } of CASES) {
    it(`删掉 ${variable} 会翻掉 ${affected.join(" / ")}`, () => {
      const full = readPaymentAvailability(READY);
      const dropped = readPaymentAvailability(without(variable));

      expect(full.channels[affected[0] as keyof typeof full.channels]).toBe(true);
      for (const channel of affected) {
        expect(dropped.channels[channel as keyof typeof dropped.channels]).toBe(false);
      }
      expect(dropped.missing).toContain(variable);
      expect(dropped.configured).toBe(false);
    });
  }
});

describe("payment availability · 误配（malformed > missing）", () => {
  it("sk_live 形状合法 ⇒ 判为就绪（是否真能用由真探测回答）", () => {
    const a = readPaymentAvailability({ ...READY, STRIPE_SECRET_KEY: "sk_live_0123456789abcdef" });
    expect(a.channels["stripe.card"]).toBe(true);
    expect(a.malformed).toEqual([]);
  });

  it("把 webhook 密钥写进 STRIPE_SECRET_KEY ⇒ malformed，而不是静默就绪", () => {
    const a = readPaymentAvailability({ ...READY, STRIPE_SECRET_KEY: "whsec_0123456789abcdef" });
    expect(a.channels["stripe.card"]).toBe(false);
    expect(a.channels["stripe.webhook"]).toBe(false);
    expect(a.malformed).toContain("STRIPE_SECRET_KEY");
    expect(a.configured).toBe(false);
  });

  it("Creem key 前缀写错 ⇒ malformed", () => {
    const a = readPaymentAvailability({ ...READY, CREEM_API_KEY: "sk_test_0123456789abcdef" });
    expect(a.channels["creem.checkout"]).toBe(false);
    expect(a.malformed).toContain("CREEM_API_KEY");
  });

  it("CREEM_ENV 取值非法 ⇒ malformed（否则 SDK 会静默打到生产）", () => {
    for (const bad of ["staging", "TEST", "prod"]) {
      const a = readPaymentAvailability({ ...READY, CREEM_ENV: bad });
      expect(a.malformed).toContain("CREEM_ENV");
      expect(a.configured).toBe(false);
    }
  });

  it("CREEM_ENV 首尾空白会被 trim，不算误配", () => {
    const a = readPaymentAvailability({ ...READY, CREEM_ENV: " production " });
    expect(a.malformed).toEqual([]);
    expect(a.configured).toBe(true);
  });

  it("空白值等于没配（'   ' 不算就绪）", () => {
    const a = readPaymentAvailability({ ...READY, CREEM_API_KEY: "   " });
    expect(a.channels["creem.checkout"]).toBe(false);
    expect(a.missing).toContain("CREEM_API_KEY");
  });
});

describe("payment availability · 公开响应不泄值", () => {
  it("missing / malformed 只含变量名，序列化结果不含任何值", () => {
    const secrets = [
      "creem_0123456789abcdef",
      "creem_whsec_0123456789abcdef",
      "sk_test_0123456789abcdef",
      "whsec_0123456789abcdef",
    ];

    // 就绪态与"部分缺失 + 一个格式错"两种形态都要查
    const payloads = [
      JSON.stringify(describePaymentAvailability(READY)),
      JSON.stringify(
        describePaymentAvailability({ ...READY, STRIPE_SECRET_KEY: "sk_test_short" }),
      ),
      JSON.stringify(describePaymentAvailability({})),
    ];

    for (const payload of payloads) {
      for (const secret of secrets) {
        expect(payload).not.toContain(secret);
      }
      // 也不允许出现密钥前缀的片段（保守断言：连 `creem_0123` 这样的子串都不该有）
      expect(payload).not.toMatch(/sk_(test|live)_|whsec_[A-Za-z0-9]{4}/);
    }
  });

  it("missingForChannel 只回该通道的变量", () => {
    expect(missingForChannel("creem.checkout", {})).toEqual(["CREEM_API_KEY"]);
    expect(missingForChannel("stripe.webhook", {})).toEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    // 手机验证与退款共用同一个 key，单独问也只回它
    expect(missingForChannel("stripe.refund", { STRIPE_SECRET_KEY: "sk_test_0123456789abcdef" })).toEqual([]);
  });

  it("isPaymentChannelReady 是 readPaymentAvailability 的薄封装（同一口径）", () => {
    for (const channel of PAYMENT_CHANNELS) {
      expect(isPaymentChannelReady(channel, READY)).toBe(true);
      expect(isPaymentChannelReady(channel, {})).toBe(false);
    }
  });
});
