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
  /** 对外品牌名（注意拼写：LokFeel，不是 LokFeel） */
  name: 'LokFee',
  /** 法律实体名（如与实际注册主体不一致，需法务复核后修改） */
  legalName: 'LokFeel Inc.',
  /** 品类定义：这是产品的"货架位置" */
  category: 'Agent-Native Connection OS',
  /** 主标题（对外统一） */
  tagline: 'Turn intent into meaningful action.',
  /** 副标题 */
  subheading:
    'An agent-native workspace for teams and communities to coordinate connections, approvals, and measurable outcomes.',
  /** 一句话描述，用于 metadata description / OG */
  description:
    'LokFeel compiles a plain-language goal into a structured workspace — missions, per-field consent, agents and measurable outcomes. Every number traceable, every outcome verified.',
  /** 短版，用于卡片与列表 */
  shortDescription:
    'Compile a goal into a workspace of missions, consent gates and agents — then run it with your team.',
} as const

/**
 * 禁词表：公开叙事里不得出现的旧定位词。
 *
 * 说明：这里既包含"交友"语义，也包含品牌拼写错误 ——
 * 后者看似小事，但它是同一批模板遗留的标记，拼错的品牌名会直接损害可信度。
 */
export const LEGACY_PUBLIC_TERMS = [
  'relationship matching',
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
] as const

/** 允许出现的例外：路由前缀 → 允许的禁词（默认空） */
export const LEGACY_SCAN_EXEMPTIONS: Record<string, readonly string[]> = {
  // 法律文本中如确需引用历史名称，在此登记并写明理由；默认不允许。
}
