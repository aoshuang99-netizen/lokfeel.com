/**
 * 支付可用性 —— **唯一**判定来源。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要这个模块
 * ═══════════════════════════════════════════════════════════════════════
 * 「支付还没接入」是一个**合法的发布状态**，不是故障：
 * 上线前必须先让其余全部功能可用，最后一步才是把支付凭据填进去。
 * 但在本模块出现之前，代码里有 7 处各自 `if (!process.env.XXX)`：
 *
 *   · Creem checkout      → 503（正确）
 *   · Stripe verify-card  → 503（正确）
 *   · Creem products      → 500 + 把 SDK 原始错误文本回给前端
 *   · Stripe webhook      → 500 "Webhook secret not configured"
 *   · Creem webhook       → 500
 *   · 退款路由            → 500 "Stripe not configured"
 *
 * 同一件事（没配凭据）出现三种状态码、两种语义，后果是：
 *   ① 监控把「未接入」算成「服务端 5xx」，发布前无法用告警判断真实健康度；
 *   ② 前端拿到的 `err.message` 是 SDK 的原始报错，既不可读也可能泄露内部信息；
 *   ③ 「接上支付」这件事没有可验证的完成判据 —— 只能靠人肉记忆。
 *
 * 所以这里把它收敛成一份**只读、只回布尔与变量名**的快照：
 *   · 路由据此返回稳定的 503 + `PAYMENT_NOT_CONFIGURED`；
 *   · `/api/health` 据此汇报「还差哪几个变量」，让"最后一步"变成一行可查的输出；
 *   · 任何分支都**不回传变量值**（/api/health 是公开端点）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 另一个真实风险：CREEM_ENV 误配会静默打到**生产**
 * ═══════════════════════════════════════════════════════════════════════
 * `src/lib/creem.ts` 原来的写法是 `env === "test" ? "test" : "prod"`。
 * 也就是说 `CREEM_ENV=staging` / `CREEM_ENV=TEST` / 拼写错误，
 * 都会**落到生产服务器**去创建真实收款会话 —— 你以为在沙箱，其实在收真钱。
 * 这在"接入支付"这一步是最危险的失误，因此这里把非法取值判为 `malformed`
 * （fail-closed：判定为未就绪，路由 503），并由 `getCreemClient()` 直接拒绝实例化。
 */

/** 一条独立可用的支付通道。名称会出现在 API 响应里，改动等于改契约。 */
export type PaymentChannel =
  | "creem.checkout"
  | "creem.webhook"
  | "stripe.card"
  | "stripe.refund"
  | "stripe.webhook";

/** 只读环境变量视图（便于单测注入，不依赖 process.env 的全局状态）。 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

interface ChannelRule {
  /** 全部存在（且格式合法）才算就绪 */
  readonly requires: readonly string[];
  /** 格式校验：只判前缀/形状，不判真伪（真伪只有打 API 才知道） */
  readonly format?: Readonly<Record<string, RegExp>>;
}

/**
 * 通道 → 变量依赖。
 *
 * 注意 `creem.checkout` **不**要求 `CREEM_MONTHLY_PRODUCT_ID` /
 * `CREEM_YEARLY_PRODUCT_ID`：订阅页是拿实时产品列表里的 `productId` 下单的，
 * 这两个变量只服务旧的 `plan` 请求体。缺它们时旧路径会给出明确的 400/503，
 * 不影响新路径 —— 若把可选变量写进必填集合，会让"接好了"被误判成"没接好"。
 */
const CHANNEL_RULES: Readonly<Record<PaymentChannel, ChannelRule>> = {
  "creem.checkout": {
    requires: ["CREEM_API_KEY"],
    // 与 /api/debug/creem-config 的既有判定保持一致（creem_ 前缀）
    format: { CREEM_API_KEY: /^creem_[A-Za-z0-9_-]{6,}$/ },
  },
  "creem.webhook": {
    requires: ["CREEM_WEBHOOK_SECRET"],
    // Webhook 密钥无公开的固定前缀约定，只要求有足够长度（避免把空串/占位符当就绪）
    format: { CREEM_WEBHOOK_SECRET: /^.{16,}$/ },
  },
  "stripe.card": {
    requires: ["STRIPE_SECRET_KEY"],
    format: { STRIPE_SECRET_KEY: /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/ },
  },
  "stripe.refund": {
    requires: ["STRIPE_SECRET_KEY"],
    format: { STRIPE_SECRET_KEY: /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/ },
  },
  "stripe.webhook": {
    // 验签只需 secret，但 handler 内部会调 Stripe API（订阅/退款核对）
    // ⇒ 两个都缺一不可，否则验签通过后仍在处理阶段 500。
    requires: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    format: {
      STRIPE_SECRET_KEY: /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/,
      STRIPE_WEBHOOK_SECRET: /^whsec_[A-Za-z0-9]{8,}$/,
    },
  },
};

export const PAYMENT_CHANNELS = Object.keys(CHANNEL_RULES) as PaymentChannel[];

export interface PaymentAvailability {
  /** 全部通道 + 环境标识都就绪 ⇒ 可以开始收费 */
  configured: boolean;
  /** 收费主链路（创建会话 + 收到它的 webhook）是否闭环 */
  charging: boolean;
  /** 逐通道就绪状态 */
  channels: Record<PaymentChannel, boolean>;
  /** 缺失的**变量名**（去重、排序；不含任何值） */
  missing: string[];
  /** 有值但格式不对 / 取值非法的**变量名**（比 missing 更危险：它看起来已配置） */
  malformed: string[];
}

function nonEmpty(env: EnvLike, name: string): string | null {
  const raw = env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 环境级校验：`CREEM_ENV` 只允许 production / test。 */
function malformedEnvVars(env: EnvLike): string[] {
  const creemEnv = nonEmpty(env, "CREEM_ENV");
  if (creemEnv === null) return [];
  return creemEnv === "production" || creemEnv === "test" ? [] : ["CREEM_ENV"];
}

/**
 * 计算当前进程的支付可用性。
 *
 * 纯函数：不读全局状态（默认参数除外）、不联网、不抛错。
 */
export function readPaymentAvailability(env: EnvLike = process.env): PaymentAvailability {
  const channels = {} as Record<PaymentChannel, boolean>;
  const missing = new Set<string>();
  const malformed = new Set<string>(malformedEnvVars(env));

  for (const channel of PAYMENT_CHANNELS) {
    const rule = CHANNEL_RULES[channel];
    let ready = true;

    for (const name of rule.requires) {
      const value = nonEmpty(env, name);
      if (value === null) {
        missing.add(name);
        ready = false;
        continue;
      }
      const pattern = rule.format?.[name];
      if (pattern && !pattern.test(value)) {
        malformed.add(name);
        ready = false;
      }
    }

    channels[channel] = ready;
  }

  return {
    configured: malformed.size === 0 && PAYMENT_CHANNELS.every((c) => channels[c]),
    charging: channels["creem.checkout"] && channels["creem.webhook"],
    channels,
    missing: [...missing].sort(),
    malformed: [...malformed].sort(),
  };
}

/** 单个通道是否就绪（路由守卫用）。 */
export function isPaymentChannelReady(channel: PaymentChannel, env: EnvLike = process.env): boolean {
  return readPaymentAvailability(env).channels[channel];
}

/** 某通道还缺哪些变量名（用于 503 响应体）。 */
export function missingForChannel(channel: PaymentChannel, env: EnvLike = process.env): string[] {
  const rule = CHANNEL_RULES[channel];
  const out: string[] = [];
  for (const name of rule.requires) {
    const value = nonEmpty(env, name);
    const pattern = rule.format?.[name];
    if (value === null || (pattern && !pattern.test(value))) out.push(name);
  }
  return out;
}

/**
 * `/api/health` 用的公开摘要。
 *
 * 只含布尔、通道名、**变量名**；绝不含值、绝不含凭据片段。
 * 那条「missing 里会不会把密钥打出去」的断言在
 * `tests/billing/payment-availability.test.ts` 里以真值注入的方式钉住。
 */
export function describePaymentAvailability(env: EnvLike = process.env) {
  const a = readPaymentAvailability(env);
  return {
    configured: a.configured,
    charging: a.charging,
    channels: a.channels,
    missing: a.missing,
    malformed: a.malformed,
  };
}
