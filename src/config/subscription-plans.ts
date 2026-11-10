/**
 * LokFeel Connection OS —— **可售订阅套餐目录**（对外定价的单一事实源）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 为什么又新增一个文件，而不是改 `src/config/plans.ts`
 * ----------------------------------------------------
 * 本仓历史上存在**三套**并行的"套餐"概念，它们服务三条不同产品线：
 *
 *   1. `src/config/plans.ts`        —— 旧 B2C 交友会员（FREE / LADY_FREE /
 *      PREMIUM_MONTHLY / PREMIUM_YEARLY / LIFETIME）。**受 Prisma 枚举
 *      `SubscriptionPlan` 约束**，与"每周匹配数 / 隐身 / 保险箱"这类权益绑定。
 *   2. `src/config/products.ts`     —— 产品目录（品牌 → 产品 → 定价状态），
 *      管的是"谁在卖、能不能卖、退款承诺出处"，**故意不含金额**。
 *   3. `src/lib/billing/plans.ts`   —— 组织级用量计费的**限额表**
 *      （STARTER / GROWTH / SCALE），纯常量、零 IO，供 `evaluateLimits()` 判定。
 *
 * 把它们合并成一个文件会立刻产生语义污染：B2C 会员的"每周 5 个匹配"与
 * Connection OS 的"每月 200 次提案"不是同一件事，共享一张表就意味着某天
 * 改 B2C 权益会**静默改掉** SaaS 报价。这正是 `billing.prisma` 文件头里
 * 「不复用 Subscription / Payment」的同一理由。
 *
 * 所以本文件的定位很窄，只有一件事：
 *
 *   > **Connection OS 对外的三档订阅 × 月付/年付 = 多少钱、对应哪个 Dodo 商品。**
 *
 * ── 三条硬约束 ────────────────────────────────────────────────────────
 *
 *   R1. **金额只在这里出现。** 任何组件 / API / 邮件模板都不得硬编码价格，
 *       一律从 `PLAN_CATALOG` 派生（`formatPrice()` / `priceCentsOf()`）。
 *   R2. **限额不在这里重写。** 档位能做什么由 `src/lib/billing/plans.ts` 的
 *       `PLAN_LIMITS` 说话 —— 本文件只引用，不复制。否则"报价页写 200 次、
 *       系统实际放行 150 次"这种偏差会没有任何报错地长期存在。
 *   R3. **商品 id 走环境变量，不进代码。** Dodo 的 `product_id` 是测试环境与
 *       生产环境各一套的**外部标识**，写死会让"在测试环境点结账，扣了生产的钱"
 *       成为一次误操作就能达成的结果。这里只声明**变量名**。
 *
 * ── 关于价格本身 ──────────────────────────────────────────────────────
 * 下面三组数字是**已批准的对外报价**（决策记录见 `PRICING_APPROVAL`）。
 * 年付统一按"付 10 个月用 12 个月"定价（≈17% off），这是最容易向客户解释的
 * 一种折扣结构，也避免每年重算一个奇怪的百分比。
 */

import { PLAN_LIMITS, type PlanLimits } from '@/lib/billing/plans';

// ═══════════════════════════════════════════════════════════════
// 标识与类型
// ═══════════════════════════════════════════════════════════════

/** 可售档位。**与 Prisma `BillingPlan` 枚举逐字一致**（不含 FREE —— 没订阅不是一种订阅）。 */
export const SELLABLE_PLAN_IDS = ['STARTER', 'GROWTH', 'SCALE'] as const;
export type SellablePlanId = (typeof SELLABLE_PLAN_IDS)[number];

export type BillingInterval = 'monthly' | 'yearly';
export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly'] as const;

/** 报价的审批留痕。改价格必须同步改它，否则 `validatePlanCatalog()` 在 CI 报红。 */
export const PRICING_APPROVAL = {
  /** 谁批的（产品所有者本人）。 */
  approvedBy: 'product-owner',
  /** 何时批的（ISO 日期）。 */
  approvedAt: '2026-11-10',
  /** 依据：本次上线指令「输出订阅套餐的设置和计划」。 */
  basis: 'V20.5 GA 上线指令 · 订阅套餐定价',
  /** 目录版本号：价格变动必须递增，便于对账时区分"什么时候的价"。 */
  version: '2026-11-10.1',
} as const;

export interface PlanPrice {
  /** 整数**美分**（Dodo 的 `price` 同样是"最低货币单位"，两者同口径，不经过浮点）。 */
  cents: number;
  /** 展示用（**由 cents 派生**，不手写）。 */
  display: string;
}

export interface SellablePlan {
  id: SellablePlanId;
  name: string;
  tagline: string;
  /** 一句话定位，用于卡片副标题。 */
  audience: string;
  prices: Record<BillingInterval, PlanPrice>;
  /** 免费试用天数（Dodo `subscription_data.trial_period_days`）。0 = 无试用。 */
  trialDays: number;
  /** 承载该档位权益的限额（**引用** `PLAN_LIMITS`，不复制数值）。 */
  limits: PlanLimits;
  /** 卡片上的权益要点（面向人读；权威配额看 `limits`）。 */
  highlights: readonly string[];
  /** 该档最受欢迎标记（纯展示）。 */
  highlighted?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 价格与商品 id 的映射
// ═══════════════════════════════════════════════════════════════

/** 分 → 美元字符串。`4900 → "49.00"`。 */
function usd(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * 每档每年的美分数 = 月付 × 10（送 2 个月）。
 * 用函数算而不是手写两个数，是为了让"年付永远比月付便宜"成为**结构保证**，
 * 而不是靠人记得同步改两处。
 */
function yearlyOf(monthlyCents: number): number {
  return monthlyCents * 10;
}

function price(monthlyCents: number): { monthly: PlanPrice; yearly: PlanPrice } {
  return {
    monthly: { cents: monthlyCents, display: `$${usd(monthlyCents)}` },
    yearly: { cents: yearlyOf(monthlyCents), display: `$${usd(yearlyOf(monthlyCents))}` },
  };
}

/**
 * 商品 id 的**环境变量名**。
 *
 * ⚠️ 这里返回的是**变量名**而不是值。`dodoProductIdOf()` 在运行时读 `process.env`，
 * 读不到就返回 `null` —— 调用方据此返回 503（未接入），而不是把 `undefined`
 * 拼进请求 URL 让 Dodo 回一个看不懂的 404。
 */
export const DODO_PRODUCT_ENV: Record<SellablePlanId, Record<BillingInterval, string>> = {
  STARTER: { monthly: 'DODO_PRODUCT_STARTER_MONTHLY', yearly: 'DODO_PRODUCT_STARTER_YEARLY' },
  GROWTH: { monthly: 'DODO_PRODUCT_GROWTH_MONTHLY', yearly: 'DODO_PRODUCT_GROWTH_YEARLY' },
  SCALE: { monthly: 'DODO_PRODUCT_SCALE_MONTHLY', yearly: 'DODO_PRODUCT_SCALE_YEARLY' },
};

// ═══════════════════════════════════════════════════════════════
// THE CATALOG
// ═══════════════════════════════════════════════════════════════

export const PLAN_CATALOG: Record<SellablePlanId, SellablePlan> = {
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    tagline: '把第一个真实流程跑通',
    audience: '刚开始用 Connection OS 的小团队',
    prices: price(4_900), // $49/mo · $490/yr
    trialDays: 14,
    limits: PLAN_LIMITS.STARTER,
    highlights: [
      '每月 200 次连接提案 / 30 次介绍',
      '每月 100 份成果上报 · 25 次核验',
      '最多 25 个席位',
      'Consent 依据与撤回全程留痕',
    ],
  },
  GROWTH: {
    id: 'GROWTH',
    name: 'Growth',
    tagline: '让协作成为组织的日常',
    audience: '已有稳定协作节奏的团队与社群',
    prices: price(14_900), // $149/mo · $1,490/yr
    trialDays: 14,
    limits: PLAN_LIMITS.GROWTH,
    highlighted: true,
    highlights: [
      '每月 1,500 次提案 / 200 次介绍',
      '每月 800 份成果上报 · 200 次核验',
      '最多 100 个席位',
      '机器面 MCP / A2A 全量开放',
      '优先支持（1 个工作日内响应）',
    ],
  },
  SCALE: {
    id: 'SCALE',
    name: 'Scale',
    tagline: '跨组织协作，按你的规模跑',
    audience: '需要跨社群桥接与审计的大型机构',
    prices: price(39_900), // $399/mo · $3,990/yr
    trialDays: 14,
    limits: PLAN_LIMITS.SCALE,
    highlights: [
      '提案 / 介绍 / 成果 / 核验均不限量',
      '最多 500 个席位',
      '跨社群桥接协议（Bridge）',
      '审计导出与合规留痕',
      '专属上线支持',
    ],
  },
};

export const PLAN_LIST: readonly SellablePlan[] = SELLABLE_PLAN_IDS.map((id) => PLAN_CATALOG[id]);

// ═══════════════════════════════════════════════════════════════
// 派生工具（所有展示与对接都必须走这里）
// ═══════════════════════════════════════════════════════════════

export function isSellablePlanId(value: unknown): value is SellablePlanId {
  return typeof value === 'string' && (SELLABLE_PLAN_IDS as readonly string[]).includes(value);
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'monthly' || value === 'yearly';
}

/** 取金额（整数美分）。未知档位抛错 —— 静默回 `0` 会变成"免费送"的事故。 */
export function priceCentsOf(id: SellablePlanId, interval: BillingInterval): number {
  const plan = PLAN_CATALOG[id];
  if (!plan) throw new Error(`未知套餐：${String(id)}`);
  return plan.prices[interval].cents;
}

/** 展示价，如 `$149.00`。 */
export function formatPrice(id: SellablePlanId, interval: BillingInterval): string {
  return PLAN_CATALOG[id].prices[interval].display;
}

/** 年付相对月付的节省百分比（整数）。结构上恒为 17%。 */
export function yearlySavingsPercent(id: SellablePlanId): number {
  const m = PLAN_CATALOG[id].prices.monthly.cents;
  const y = PLAN_CATALOG[id].prices.yearly.cents;
  if (!m || !y) return 0;
  return Math.round((1 - y / (m * 12)) * 100);
}

/** 年付折算到每月（展示用，如 `$124.17/mo`）。 */
export function yearlyPerMonth(id: SellablePlanId): string {
  return `$${usd(Math.round(PLAN_CATALOG[id].prices.yearly.cents / 12))}`;
}

/** 运行时读 Dodo 商品 id。缺变量 → `null`（调用方按"未接入"处理）。 */
export function dodoProductIdOf(
  id: SellablePlanId,
  interval: BillingInterval,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const name = DODO_PRODUCT_ENV[id]?.[interval];
  if (!name) return null;
  const raw = env[name];
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length > 0 ? v : null;
}

export interface ResolvedPlanTarget {
  plan: SellablePlanId;
  interval: BillingInterval;
  productId: string;
  amountCents: number;
}

/**
 * 由**前端只报 (plan, interval)** 解析出真正的结算目标。
 *
 * 🔴 前端永远不传 `productId`。理由与 `creem-plan-resolve.ts` 逐字相同：
 * 让前端自报商品 id，等于允许它买任意商品（包括未上架 / 已成历史价的旧商品），
 * 而 webhook 那边只能看到一个陌生 id，无从判断该授予哪一档权益。
 * 商品 id 只能由「本地目录 + 环境变量」共同决定。
 */
export function resolvePlanTarget(
  input: { plan: unknown; interval: unknown },
  env: Readonly<Record<string, string | undefined>> = process.env,
): { ok: true; target: ResolvedPlanTarget } | { ok: false; reason: 'invalid_plan' | 'invalid_interval' | 'product_not_configured'; message: string } {
  if (!isSellablePlanId(input.plan)) {
    return { ok: false, reason: 'invalid_plan', message: `未知套餐：${String(input.plan)}` };
  }
  if (!isBillingInterval(input.interval)) {
    return { ok: false, reason: 'invalid_interval', message: `未知计费周期：${String(input.interval)}` };
  }
  const productId = dodoProductIdOf(input.plan, input.interval, env);
  if (!productId) {
    return {
      ok: false,
      reason: 'product_not_configured',
      message: `套餐 ${input.plan}/${input.interval} 尚未绑定 Dodo 商品（缺 ${DODO_PRODUCT_ENV[input.plan][input.interval]}）`,
    };
  }
  return {
    ok: true,
    target: {
      plan: input.plan,
      interval: input.interval,
      productId,
      amountCents: priceCentsOf(input.plan, input.interval),
    },
  };
}

/**
 * 反向解析：webhook 只带 `product_id`，要还原成"哪一档"。
 *
 * 匹配不到的返回 `null` —— 调用方必须**记日志并忽略**，不能猜一个默认档位。
 * 「猜 GROWTH」意味着客户付了 SCALE 的钱却拿到 GROWTH 的权益，而系统不会报错。
 */
export function planOfDodoProductId(
  productId: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { plan: SellablePlanId; interval: BillingInterval } | null {
  if (!productId) return null;
  for (const plan of SELLABLE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (dodoProductIdOf(plan, interval, env) === productId) return { plan, interval };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 目录自检（CI 门禁与单测共用）
// ═══════════════════════════════════════════════════════════════

/**
 * 返回问题列表（空数组 = 通过）。
 *
 * 检查的是**目录自身的内部一致性**，不检查"环境变量填了没" ——
 * 后者是部署态，属于 `/api/health` 的职责。把两者混在一起会出现
 * "CI 因为没配生产密钥而红"，那不是代码问题。
 */
export function validatePlanCatalog(
  catalog: Record<SellablePlanId, SellablePlan> = PLAN_CATALOG,
): string[] {
  const problems: string[] = [];

  for (const id of SELLABLE_PLAN_IDS) {
    const plan = catalog[id];
    if (!plan) {
      problems.push(`${id}：目录中缺失`);
      continue;
    }
    if (plan.id !== id) problems.push(`${id}：id 字段与键不一致（${plan.id}）`);

    for (const interval of BILLING_INTERVALS) {
      const cents = plan.prices[interval]?.cents;
      if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) {
        problems.push(`${id}/${interval}：金额必须是正整数美分，当前 ${String(cents)}`);
      }
      const display = plan.prices[interval]?.display;
      const expected = typeof cents === 'number' ? `$${(cents / 100).toFixed(2)}` : null;
      if (expected && display !== expected) {
        problems.push(`${id}/${interval}：display（${display}）与 cents（${cents}）不一致，必须派生`);
      }
    }

    // R3：商品 id 必须是"变量名"形状，不能是值
    for (const interval of BILLING_INTERVALS) {
      const envName = DODO_PRODUCT_ENV[id]?.[interval];
      if (!envName) {
        problems.push(`${id}/${interval}：缺少 DODO_PRODUCT_ENV 映射`);
      } else if (!/^DODO_PRODUCT_[A-Z0-9_]+$/.test(envName)) {
        problems.push(`${id}/${interval}：${envName} 不是合法的大写环境变量名`);
      }
    }

    // R2：限额必须来自 PLAN_LIMITS（引用相等即可证明"没有复制一份"）
    if (plan.limits !== PLAN_LIMITS[id]) {
      problems.push(`${id}：limits 不是 PLAN_LIMITS 的引用 —— 不允许复制一份配额`);
    }

    if (!Number.isInteger(plan.trialDays) || plan.trialDays < 0 || plan.trialDays > 60) {
      problems.push(`${id}：trialDays 必须是 0–60 的整数，当前 ${String(plan.trialDays)}`);
    }
    if (plan.highlights.length === 0) problems.push(`${id}：highlights 为空`);

    // 年付必须严格便宜于"月付 × 12"，否则"年付"没有存在理由
    const monthly = plan.prices.monthly.cents;
    const yearly = plan.prices.yearly.cents;
    if (monthly > 0 && yearly >= monthly * 12) {
      problems.push(`${id}：年付（${yearly}）不低于月付 ×12（${monthly * 12}），年付无意义`);
    }
  }

  // 商品 id 的唯一性只能在**同一环境**下判断，这里只能查"变量名不重复"
  const seen = new Set<string>();
  for (const id of SELLABLE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      const name = DODO_PRODUCT_ENV[id][interval];
      if (seen.has(name)) problems.push(`环境变量名重复：${name}`);
      seen.add(name);
    }
  }

  return problems;
}
