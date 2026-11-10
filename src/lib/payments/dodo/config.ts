/**
 * Dodo Payments —— 运行时配置解析（**唯一**的环境判定处）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 与 `src/lib/creem.ts` 的历史教训直接相关：那边原来的写法是
 * `env === "test" ? "test" : "prod"`，于是 `CREEM_ENV=staging`、拼写错误、
 * 或者压根没设，都会**静默落到生产**去创建真实收款会话。
 * Dodo 这边把同一类错误变成**显式失败**：
 *
 *   · `DODO_PAYMENTS_ENVIRONMENT` 只接受 `test_mode` / `live_mode`；
 *   · 缺失或取值非法 ⇒ `malformed`，通道判定为**未就绪**（fail-closed），
 *     `/api/payments/dodo/checkout` 直接 503，而不是猜一个环境去收钱。
 *
 * 🔴 为什么不采用"缺省 = test_mode"
 *   对开发者友好，对生产危险：生产环境少配一个变量，就会在 test 环境收款，
 *   客户付了钱、我们一分未收到，而页面显示"支付成功"。宁可在上线时报 503。
 */

/** 只读环境视图（便于单测注入，不读全局 `process.env`）。 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

import {
  BILLING_INTERVALS,
  DODO_PRODUCT_ENV,
  SELLABLE_PLAN_IDS,
  type BillingInterval,
  type SellablePlanId,
} from '@/config/subscription-plans';

export type DodoEnvironment = 'test_mode' | 'live_mode';

export const DODO_ENVIRONMENTS: readonly DodoEnvironment[] = ['test_mode', 'live_mode'] as const;

/** 两个环境各自的服务端基址（官方文档明确给出的两套 host）。 */
export const DODO_BASE_URL: Record<DodoEnvironment, string> = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
};

export const DODO_API_KEY_VAR = 'DODO_PAYMENTS_API_KEY';
export const DODO_WEBHOOK_KEY_VAR = 'DODO_PAYMENTS_WEBHOOK_KEY';
export const DODO_ENVIRONMENT_VAR = 'DODO_PAYMENTS_ENVIRONMENT';

/**
 * API Key 的形状。
 *
 * Dodo 的密钥没有像 Stripe 那样公开固定的前缀约定（`sk_live_` / `sk_test_`），
 * 因此这里只做**下限**校验：至少 16 个非空白字符。
 * 目的是挡住"空串 / `TODO` / `xxx`"这类**看起来配了其实没配**的值 ——
 * 它们比缺失更危险，因为缺了会立刻 503，占位符会让请求真的发出去再 401。
 */
const API_KEY_PATTERN = /^\S{16,}$/;

/** Webhook secret 的官方形状：`whsec_` + base64。验签要用 base64 解码后的字节。 */
const WEBHOOK_KEY_PATTERN = /^whsec_[A-Za-z0-9+/=]{8,}$/;

export interface DodoConfig {
  environment: DodoEnvironment;
  baseUrl: string;
  apiKey: string;
  webhookKey: string;
}

export type DodoConfigResult =
  | { ok: true; config: DodoConfig }
  | { ok: false; missing: string[]; malformed: string[] };

function nonEmpty(env: EnvLike, name: string): string | null {
  const raw = env[name];
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length > 0 ? v : null;
}

/**
 * 解析配置。**纯函数**：不抛错、不联网、不读全局状态（默认参数除外）。
 *
 * `requiresWebhook` 决定是否把 webhook 密钥算进"必需"：
 * 创建结账会话不需要它（只有接收事件需要），把它写进 checkout 的必填集合
 * 会让"结账通了但 webhook 还没配"这个**合法的中间状态**被误判成"完全没接好"。
 */
export function readDodoConfig(
  env: EnvLike = process.env,
  options: { requiresWebhook?: boolean } = {},
): DodoConfigResult {
  const missing: string[] = [];
  const malformed: string[] = [];

  const envRaw = nonEmpty(env, DODO_ENVIRONMENT_VAR);
  let environment: DodoEnvironment | null = null;
  if (envRaw === null) {
    missing.push(DODO_ENVIRONMENT_VAR);
  } else if ((DODO_ENVIRONMENTS as readonly string[]).includes(envRaw)) {
    environment = envRaw as DodoEnvironment;
  } else {
    // fail-closed：非法取值不猜，直接判未就绪
    malformed.push(DODO_ENVIRONMENT_VAR);
  }

  const apiKey = nonEmpty(env, DODO_API_KEY_VAR);
  if (apiKey === null) missing.push(DODO_API_KEY_VAR);
  else if (!API_KEY_PATTERN.test(apiKey)) malformed.push(DODO_API_KEY_VAR);

  const webhookKey = nonEmpty(env, DODO_WEBHOOK_KEY_VAR);
  const needsWebhook = options.requiresWebhook === true;
  if (webhookKey === null) {
    if (needsWebhook) missing.push(DODO_WEBHOOK_KEY_VAR);
  } else if (!WEBHOOK_KEY_PATTERN.test(webhookKey)) {
    malformed.push(DODO_WEBHOOK_KEY_VAR);
  }

  if (missing.length > 0 || malformed.length > 0 || environment === null || apiKey === null) {
    return { ok: false, missing: [...missing].sort(), malformed: [...malformed].sort() };
  }

  return {
    ok: true,
    config: {
      environment,
      baseUrl: DODO_BASE_URL[environment],
      apiKey,
      // 未配置时给空串：调用方须先过 `readDodoConfig(env, {requiresWebhook:true})`
      webhookKey: webhookKey ?? '',
    },
  };
}

/** 结账是否就绪（只需 API Key + 合法环境）。 */
export function isDodoCheckoutReady(env: EnvLike = process.env): boolean {
  return readDodoConfig(env).ok;
}

/** webhook 是否就绪（需要三者齐备）。 */
export function isDodoWebhookReady(env: EnvLike = process.env): boolean {
  return readDodoConfig(env, { requiresWebhook: true }).ok;
}

/** 每档 × 每周期是否已绑定 Dodo 商品（`true` 才允许把按钮点下去）。 */
export type SkuBindings = Record<SellablePlanId, Record<BillingInterval, boolean>>;

/**
 * 逐个 SKU 的商品绑定状态。
 *
 * 为什么要**逐 SKU**、而不是一个全局布尔：
 * Dodo 对单笔金额有商户级上限（实测 $3,000，超了创建商品直接
 * `CART_AMOUNT_EXCEEDS_LIMIT`）。于是"Scale 年付 $3,990 建不出来"是
 * 一个**合法外部约束**，不是配置写错。若用一个全局 `ready` 表达，
 * 这 1 个 SKU 的缺失会把另外 5 个可售的套餐一起禁掉 —— 少卖 5 个，
 * 只因 1 个撞了风控上限。所以绑定状态必须能落到 (档位, 周期) 这一格。
 */
export function readSkuBindings(env: EnvLike = process.env): SkuBindings {
  const out = {} as SkuBindings;

  for (const plan of SELLABLE_PLAN_IDS) {
    out[plan] = {} as Record<BillingInterval, boolean>;
    for (const interval of BILLING_INTERVALS) {
      const v = env[DODO_PRODUCT_ENV[plan][interval]];
      out[plan][interval] = typeof v === 'string' && v.trim().length > 0;
    }
  }

  return out;
}

/**
 * 收银台就绪度。**两个层次不可混为一谈**：
 *
 *   · `ready`           = 凭据齐备 ⇒ 能创建结账会话。这是"通道是否接上"。
 *   · `unboundProducts` = 哪些 SKU 还没绑商品 ⇒ 那一格按钮要禁用。
 *
 * 早期版本把 `ready` 定义成"凭据齐备且 6 个 SKU 全绑定"，在遇到单笔
 * 金额上限时会导致整页禁售。现在 `ready` 只表达凭据；逐格可用性看
 * `readSkuBindings()`。
 *
 * 返回值只含**变量名**，可直接进公开页面（不含任何值）。
 */
export function readStoreReadiness(env: EnvLike = process.env): {
  ready: boolean;
  missingCredentials: string[];
  unboundProducts: string[];
} {
  const config = readDodoConfig(env);
  const missingCredentials = config.ok ? [] : [...config.missing, ...config.malformed];

  const unboundProducts: string[] = [];
  for (const plan of SELLABLE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      const name = DODO_PRODUCT_ENV[plan][interval];
      const v = env[name];
      if (typeof v !== 'string' || !v.trim()) unboundProducts.push(name);
    }
  }

  return {
    ready: config.ok,
    missingCredentials,
    unboundProducts,
  };
}
