/**
 * ============================================================================
 * LokFeel — 订阅计划「单一配置源」（Single Source of Truth）
 * ============================================================================
 *
 * 背景（Open-Core 改造 P0-7）：
 * 改造前，套餐与价格在三个地方各写了一遍，且互相冲突：
 *
 *   1. src/constants/index.ts:69        —— FREE / LADY_FREE / $19.99 / $149.99
 *   2. src/lib/creem.ts:47              —— 1999 分 / 14999 分（与 1 一致）
 *   3. src/components/subscription/paywall.tsx:38
 *                                       —— PLUS $9.99 / PREMIUM $39.90 / FOUNDER $149.99（完全不同的四档体系）
 *
 * 后果：对外定价页与结账页可能显示不同价格，商业地基不可信。
 *
 * ── 本文件是唯一权威来源 ────────────────────────────────────────────────────
 * 规则（改价格时请遵守）：
 *   ✅ 只在本文件的 PLANS 中修改价格与功能配额；
 *   ❌ 不要在任何组件、API、服务里硬编码金额或套餐名；
 *   ✅ 其他模块必须从本文件派生（derive），不得复制粘贴。
 *
 * 价格单位约定：
 *   · PLANS[].priceCents —— 权威值，**整数美分**（避免浮点误差，对接支付网关友好）
 *   · 展示用的美元字符串一律通过 formatPlanPrice() 生成，不要手写 "$19.99"
 *
 * 与数据库的一致性：
 *   PLAN_IDS 必须与 prisma/schema.prisma 的 `enum SubscriptionPlan` 完全一致。
 *   该约束由 tests/plans-consistency.test.ts 自动校验，CI 中会拦截漂移。
 * ============================================================================
 */

// ============================================================================
// Plan IDs —— 必须与 prisma enum SubscriptionPlan 严格一致
// ============================================================================

export const PLAN_IDS = [
  'FREE',
  'LADY_FREE',
  'PREMIUM_MONTHLY',
  'PREMIUM_YEARLY',
  'LIFETIME',
] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export type BillingPeriod = 'monthly' | 'yearly';

// ============================================================================
// Types
// ============================================================================

export interface PlanFeatures {
  /** 每周可获取的匹配数；-1 表示不限 */
  weeklyMatches: number;
  /** 每个匹配可发送的消息数；-1 表示不限 */
  messagesPerMatch: number;
  canSeeWhoLikedMe: boolean;
  canRematch: boolean;
  advancedFilters: boolean;
  prioritySupport: boolean;
  incognitoMode: boolean;
  readReceipts: boolean;
  vaultControl: 'readonly' | 'full';
  matchExplanation: 'basic' | 'full';
  priorityMatching: boolean;
  travelMode: boolean;
  premiumBadge: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  /** 内部/日志用名称 */
  name: string;
  /** 面向用户的副标题 */
  tagline: string;
  description: string;
  /** 权威价格：整数美分 */
  priceCents: { monthly: number; yearly: number };
  /** 是否一次性买断（LIFETIME 类） */
  isOneTime?: boolean;
  /** 是否不对外销售（如免费档、或价格待定档） */
  notForSale?: boolean;
  features: PlanFeatures;
}

// ============================================================================
// 功能配额基线 —— 避免在多个套餐里重复书写同一组默认值
// ============================================================================

/** 免费档功能集 */
const FEATURES_FREE: PlanFeatures = {
  weeklyMatches: 3,
  messagesPerMatch: 2,
  canSeeWhoLikedMe: false,
  canRematch: false,
  advancedFilters: false,
  prioritySupport: false,
  incognitoMode: false,
  readReceipts: false,
  vaultControl: 'readonly',
  matchExplanation: 'basic',
  priorityMatching: false,
  travelMode: false,
  premiumBadge: false,
};

/** 付费档通用功能集（女用户免费档同样享受此档能力） */
const FEATURES_PREMIUM: PlanFeatures = {
  weeklyMatches: 5,
  messagesPerMatch: -1, // unlimited
  canSeeWhoLikedMe: true,
  canRematch: true,
  advancedFilters: true,
  prioritySupport: true,
  incognitoMode: true,
  readReceipts: true,
  vaultControl: 'readonly',
  matchExplanation: 'full',
  priorityMatching: true,
  travelMode: true,
  premiumBadge: true,
};

// ============================================================================
// THE SINGLE SOURCE OF TRUTH
// ============================================================================

export const PLANS: Record<PlanId, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    tagline: 'Get started with basic matching',
    description: 'Get started with basic matching',
    priceCents: { monthly: 0, yearly: 0 },
    notForSale: true,
    features: FEATURES_FREE,
  },

  LADY_FREE: {
    id: 'LADY_FREE',
    name: 'Lady Free',
    tagline: 'Because you deserve the best — always free for women',
    description: 'Because you deserve the best — always free for women',
    priceCents: { monthly: 0, yearly: 0 },
    notForSale: true,
    features: {
      ...FEATURES_PREMIUM,
      // 女用户免费档保留与付费档的差异化（沿用改造前行为，逐项显式声明）
      canRematch: false,
      prioritySupport: false,
      priorityMatching: false,
      travelMode: false,
      premiumBadge: false,
      vaultControl: 'full',
    },
  },

  PREMIUM_MONTHLY: {
    id: 'PREMIUM_MONTHLY',
    name: 'Premium Monthly',
    tagline: 'Unlock full matching potential',
    description: 'Full power for serious seekers — monthly billing',
    priceCents: { monthly: 1999, yearly: 0 }, // $19.99
    features: FEATURES_PREMIUM,
  },

  PREMIUM_YEARLY: {
    id: 'PREMIUM_YEARLY',
    name: 'Premium Yearly',
    tagline: 'Best value for serious seekers',
    description: 'Full power for serious seekers — yearly billing (save 37%)',
    priceCents: { monthly: 0, yearly: 14999 }, // $149.99 ≈ $12.50/月
    features: FEATURES_PREMIUM,
  },

  /**
   * LIFETIME 存在于 Prisma enum 中，但当前没有对外定价。
   * ⚠️ 待商业决策：定档前不要在任何 UI 中展示该档，也不要接入结账流程。
   * 一旦定价确定，只需修改这里，其余模块自动生效。
   */
  LIFETIME: {
    id: 'LIFETIME',
    name: 'Lifetime',
    tagline: 'One-time payment, lifetime access',
    description: 'One-time payment, lifetime access',
    priceCents: { monthly: 0, yearly: 0 },
    isOneTime: true,
    notForSale: true, // TODO(商业决策)：定价后移除此标记
    features: FEATURES_PREMIUM,
  },
};

// ============================================================================
// 派生工具（所有展示与支付对接都必须走这里）
// ============================================================================

/** 分 → 美元字符串，例如 1999 → "19.99" */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 分 → 展示价，例如 formatPlanPrice('PREMIUM_MONTHLY','monthly') → "$19.99/mo" */
export function formatPlanPrice(id: PlanId, period: BillingPeriod = 'monthly'): string {
  const plan = PLANS[id];
  const cents = plan.priceCents[period];
  if (cents === 0) return '$0';
  return `$${centsToAmount(cents)}/${period === 'monthly' ? 'mo' : 'yr'}`;
}

/** 取权威美分数，供支付网关使用 */
export function getPlanPriceCents(id: PlanId, period: BillingPeriod): number {
  return PLANS[id].priceCents[period];
}

/** 取美元数值（仅用于展示或旧接口兼容），供旧代码（如 constants 的 price.monthly）使用 */
export function getPlanPriceDollars(id: PlanId): { monthly: number; yearly: number } {
  return {
    monthly: PLANS[id].priceCents.monthly / 100,
    yearly: PLANS[id].priceCents.yearly / 100,
  };
}

/**
 * 年付相对月付的节省比例（百分比，四舍五入）。
 *
 * ⚠️ 注意本数据模型的一个特性：月付与年付是**两个独立的 plan id**
 * （PREMIUM_MONTHLY 只填 monthly，PREMIUM_YEARLY 只填 yearly）。
 * 因此折扣率**无法**从单个 plan 内算出，必须跨两个 plan 比较 ——
 * 这也正是本函数需要两个参数的原因。
 *
 * 计算：$19.99/月 × 12 = $239.88；年付 $149.99 → 节省 37%
 */
export function getYearlySavingsPercent(
  monthlyPlanId: PlanId = 'PREMIUM_MONTHLY',
  yearlyPlanId: PlanId = 'PREMIUM_YEARLY',
): number {
  const monthly = PLANS[monthlyPlanId].priceCents.monthly;
  const yearly = PLANS[yearlyPlanId].priceCents.yearly;
  if (!monthly || !yearly) return 0;
  return Math.round((1 - yearly / (monthly * 12)) * 100);
}

/** 每周匹配配额（供匹配引擎读取，替代散落的 MATCH_CONFIG.weeklyMatches） */
export const WEEKLY_MATCH_LIMITS: Record<PlanId, number> = PLAN_IDS.reduce(
  (acc, id) => {
    acc[id] = PLANS[id].features.weeklyMatches;
    return acc;
  },
  {} as Record<PlanId, number>,
);

/** 对外销售的付费档（自动排除免费档与未定价档） */
export const SELLABLE_PLAN_IDS: PlanId[] = PLAN_IDS.filter(
  (id) => !PLANS[id].notForSale,
);

/** 真正的付费订阅档（不含 LIFETIME 买断），供 Creem/Stripe 等周期扣款通道使用 */
export const RECURRING_PLAN_IDS = PLAN_IDS.filter(
  (id) => !PLANS[id].notForSale && !PLANS[id].isOneTime,
);

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}
