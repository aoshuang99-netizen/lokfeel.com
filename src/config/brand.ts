/**
 * ============================================================================
 * 品牌与定位文案 —— 公开页面的单一来源
 * ============================================================================
 *
 * 背景（V16 · T02）：
 * 落地页已切到 Connection OS 叙事，但 9 个公开子页仍写着 "LokFeel"
 * （拼写错误）与 "relationship matching engine"（旧交友定位）。
 * 结果是：同一站点对同一访问者讲两个产品。
 *
 * 规则：
 *   ✅ 公开页面的 title / description / H1 / CTA 一律从本文件派生；
 *   ❌ 不要在各页面里再手写品牌名、品类名或价值主张。
 *
 * 门禁：`npm run verify:brand-scan` 会扫描全部公开路由，命中禁词即判红。
 * ============================================================================
 */

export const BRAND = {
  /** 对外品牌名（注意拼写：LokFeel，不是 LokFee） */
  name: 'LokFeel',
  /**
   * 法律实体名。D8：真实注册主体未经核验前不得对外声称具体法人。
   * V23 保持原值，禁止代填 "LokFeel Inc." 或注册地址。
   */
  legalName: 'LokFeel',
  /** V23 冻结品类：AI 原生关系与生成式社交平台 */
  category: 'AI-Native Relationship & Generative Social Platform',
  /** 主标题（对外统一，来自 V23 STRATEGY_LOCK §1） */
  tagline: 'Meet people worth knowing.',
  /** 副标题 */
  subheading:
    'AI helps you find meaningful introductions, with clear intent, mutual consent, and room for real connections to grow.',
  /** 一句话描述，用于 metadata description / OG。不得含 verified / compiles / 技术词 / 未批价格 */
  description:
    'LokFeel helps real people meet the right people: clearer relationship intent, a small number of explained introductions, and a real choice for both sides before anything is shared.',
  /** 短版，用于卡片与列表 */
  shortDescription:
    'Find people worth knowing — with clear intent, mutual consent, and real follow-through.',
} as const

/**
 * 禁词表：公开叙事里不得出现的旧定位词。
 *
 * 说明：这里既包含"交友"语义，也包含品牌拼写错误 ——
 * 后者看似小事，但它是同一批模板遗留的标记，拼错的品牌名会直接损害可信度。
 */
export const LEGACY_PUBLIC_TERMS = [
  // V23：关系产品本身不再是禁词；这里禁的是「旧交友线」的营销话术、
  // 未经验证的匹配科学、以及拼错的旧品牌。
  'relationship matching engine',
  'dating app',
  'dating platform',
  'online dating',
  'find your match',
  'perfect match',
  'soulmate',
  'singles',
  'swiping',
  'swipe right',
  'soul mate',
  'LokFee',
  'Agent-Native Connection OS',
  'Every outcome verified',
] as const

/** 允许出现的例外：路由前缀 → 允许的禁词（默认空） */
export const LEGACY_SCAN_EXEMPTIONS: Record<string, readonly string[]> = {
  // 法律文本中如确需引用历史名称，在此登记并写明理由；默认不允许。
}
