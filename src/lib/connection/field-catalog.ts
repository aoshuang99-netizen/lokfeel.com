/**
 * T03 · 披露字段目录 —— **单一事实来源**
 *
 * 为什么必须集中定义：
 *   AC-03（BLOCKER）要求「未经授权的字段不出现在 API 响应、向量索引、Agent 上下文」。
 *   只要字段清单散落在各处（前端一份、投影一份、导入检查一份），就一定会漂移 ——
 *   典型后果是「前端没这个选项、但后端投影里还留着」，于是用户根本无从授权，
 *   而数据却已经在往外走。因此本文件是字段的**唯一**定义处，其余模块只许引用。
 *
 * 两条取值取向（都刻意的）：
 *   1. **受众档位是包含式的**：`ORGANIZER` 档 = 自己 + 组织者；`COUNTERPARTY` 档 =
 *      自己 + 组织者 + 对手方。所以档位越高，能看到的人越多（`audienceRank` 单调）。
 *      ⚠️ 不要把它理解成"平行受众"——那是另一种语义，会让"组织者看不到自己人的资料"
 *      这种反直觉行为发生。
 *   2. **缺省一律 `SELF`（不披露）**：`suggestedDisclosure()` 里的 `defaultAudience`
 *      只是**给前端表单的建议勾选**，不是 API 的缺省值。API 侧「字段没写 = 未授权」，
 *      「用户没选」绝不等于「用户同意」。
 */

// ═══════════════════════════════════════════════════════════
// 受众档位
// ═══════════════════════════════════════════════════════════

/** 声明顺序即权限大小。新增档位**必须**追加在末尾，否则历史数据的相对可见性会变。 */
export const DISCLOSURE_AUDIENCES = ['SELF', 'ORGANIZER', 'COUNTERPARTY'] as const

export type DisclosureAudience = (typeof DISCLOSURE_AUDIENCES)[number]

/** 档位的包含式次序（索引越大 = 受众越广）。 */
export const AUDIENCE_ORDER: readonly DisclosureAudience[] = DISCLOSURE_AUDIENCES

/**
 * 档位序号。**非法值一律返回 SELF 的序号**（0）—— fail-closed：
 * 遇到不认识的档位时，宁可把它当成"不披露"，也不要当成"披露给所有人"。
 */
export function audienceRank(audience: DisclosureAudience): number {
  const i = AUDIENCE_ORDER.indexOf(audience)
  return i < 0 ? 0 : i
}

export function isAudience(value: unknown): value is DisclosureAudience {
  return typeof value === 'string' && (DISCLOSURE_AUDIENCES as readonly string[]).includes(value)
}

/** 外部受众：投影的**合法目标**。`SELF` 不在其中（原因见下方 `audienceCanSee`）。 */
export type ExternalAudience = Exclude<DisclosureAudience, 'SELF'>

export const EXTERNAL_AUDIENCES: readonly ExternalAudience[] = ['ORGANIZER', 'COUNTERPARTY']

/**
 * 某受众能否看到"被授权到 `granted` 档"的字段。
 * 规则：`rank(granted) >= rank(viewer)`，即"受权范围覆盖到了这位受众"。
 *
 * ⚠️ `viewer === 'SELF'` **恒为 false**。这不是遗漏，是刻意的：
 *   `SELF` 档的语义就是"不披露"，而"本人"根本不需要走投影 —— 他直接读自己的数据。
 *   若允许 `viewer='SELF'`，`discloseSubject(profile, {}, 'SELF')` 就会返回**整份档案**
 *   （每个字段的档位都 >= 0），那就成了一个"传 SELF 即全量"的危险 API 形状：
 *   将来有人把它接到"查看我的资料"接口、又不小心把结果返回给第三方，就是全量泄露。
 *   因此投影受众类型收紧为 `ExternalAudience`，在**编译期**排除 SELF。
 */
export function audienceCanSee(
  granted: DisclosureAudience,
  viewer: DisclosureAudience
): boolean {
  if (viewer === 'SELF') return false
  return audienceRank(granted) >= audienceRank(viewer)
}

/** 缺省档位：字段未在披露表中出现时按此处理。**常量而非配置**，防止有人"顺手调宽"。 */
export const MISSING_FIELD_AUDIENCE: DisclosureAudience = 'SELF'

// ═══════════════════════════════════════════════════════════
// 字段定义
// ═══════════════════════════════════════════════════════════

/** 字段键的字面量集合。`DisclosureFieldKey` 由它推导，避免"定义了却没登记"的漏项。 */
export const DISCLOSURE_FIELD_KEYS = [
  'displayName',
  'avatarUrl',
  'bio',
  'city',
  'country',
  'occupation',
  'company',
  'industry',
  'selectedTags',
  'lifePriorities',
  'age',
  'genderIdentity',
  'relationshipGoal',
  'email',
] as const

export type DisclosureFieldKey = (typeof DISCLOSURE_FIELD_KEYS)[number]

export type FieldGroup = 'identity' | 'professional' | 'background' | 'preference' | 'contact'

export interface FieldSpec {
  key: DisclosureFieldKey
  /** 中文标签（前端表单直接渲染，避免前端再维护一份文案而漂移）。 */
  label: string
  group: FieldGroup
  /**
   * 敏感字段。用于：表单默认不勾选、审计中单独标注「本次是否扩大了敏感字段的披露范围」。
   * 注意：敏感 ≠ 禁止披露，而是"必须由用户显式选择"。
   */
  sensitive: boolean
  /**
   * 是否**允许**通过披露表授权。
   * `false` 的字段（联系方式类）在本任务里**结构性不可授权** —— 任何把它写进
   * `disclosure` 的请求一律 400。联系方式只能走 T05 的双边同意流程交换，
   * 不能让一个"逐字段开关"把邮箱放出去（AC-03）。
   */
  disclosable: boolean
  /** 是否允许从账户档案导入（`importFromProfile` 的检查依据）。 */
  importable: boolean
  /** 表单**建议**档位。⚠️ 不是 API 缺省值（API 缺省恒为 SELF）。 */
  defaultAudience: DisclosureAudience
}

const FIELD_DEFS: readonly FieldSpec[] = [
  // ── 身份 ──
  { key: 'displayName', label: '昵称', group: 'identity', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  { key: 'avatarUrl', label: '头像', group: 'identity', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  { key: 'bio', label: '个人简介', group: 'identity', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  { key: 'city', label: '城市', group: 'identity', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  { key: 'country', label: '国家/地区', group: 'identity', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  // ── 职业 ──
  { key: 'occupation', label: '职业', group: 'professional', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  { key: 'company', label: '公司', group: 'professional', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  { key: 'industry', label: '行业', group: 'professional', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  // ── 背景（敏感）──
  { key: 'age', label: '年龄', group: 'background', sensitive: true, disclosable: true, importable: true, defaultAudience: 'SELF' },
  { key: 'genderIdentity', label: '性别认同', group: 'background', sensitive: true, disclosable: true, importable: true, defaultAudience: 'SELF' },
  // ── 偏好（敏感）──
  { key: 'relationshipGoal', label: '关系目标', group: 'preference', sensitive: true, disclosable: true, importable: true, defaultAudience: 'SELF' },
  { key: 'selectedTags', label: '兴趣标签', group: 'preference', sensitive: false, disclosable: true, importable: true, defaultAudience: 'ORGANIZER' },
  { key: 'lifePriorities', label: '人生优先级', group: 'preference', sensitive: false, disclosable: true, importable: true, defaultAudience: 'SELF' },
  // ── 联系方式（结构性不可授权 / 不可导入）──
  { key: 'email', label: '邮箱', group: 'contact', sensitive: true, disclosable: false, importable: false, defaultAudience: 'SELF' },
]

export const DISCLOSURE_FIELDS: readonly FieldSpec[] = FIELD_DEFS

/** 字段键 → 规格。查找失败返回 null（调用方按"未知字段"处理，而不是抛异常）。 */
export function fieldSpec(key: string): FieldSpec | null {
  return FIELD_DEFS.find((f) => f.key === key) ?? null
}

export function isFieldKey(value: unknown): value is DisclosureFieldKey {
  return typeof value === 'string' && (DISCLOSURE_FIELD_KEYS as readonly string[]).includes(value)
}

/** 结构性禁止授权的字段（联系方式类）。 */
export const PROTECTED_FIELD_KEYS: readonly DisclosureFieldKey[] = FIELD_DEFS.filter(
  (f) => !f.disclosable
).map((f) => f.key)

/** 允许从账户档案导入的字段。 */
export const IMPORTABLE_FIELD_KEYS: readonly DisclosureFieldKey[] = FIELD_DEFS.filter(
  (f) => f.importable
).map((f) => f.key)

/** 敏感字段（表单默认不勾选、审计单独标注）。 */
export const SENSITIVE_FIELD_KEYS: readonly DisclosureFieldKey[] = FIELD_DEFS.filter(
  (f) => f.sensitive
).map((f) => f.key)

/**
 * 表单**建议**披露表（用户点"采用建议"时使用）。
 * 再次强调：这不是 API 缺省值。API 侧缺失字段一律 SELF。
 */
export function suggestedDisclosure(): Record<DisclosureFieldKey, DisclosureAudience> {
  const out = {} as Record<DisclosureFieldKey, DisclosureAudience>
  for (const f of FIELD_DEFS) out[f.key] = f.defaultAudience
  return out
}

/** 目录自检（供测试与启动期诊断使用）：返回不一致项，空数组 = 健康。 */
export function auditCatalog(): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const f of FIELD_DEFS) {
    if (seen.has(f.key)) problems.push(`duplicate field key: ${f.key}`)
    seen.add(f.key)
    if (!isAudience(f.defaultAudience)) problems.push(`bad defaultAudience for ${f.key}`)
    if (!f.disclosable && f.defaultAudience !== 'SELF') {
      problems.push(`non-disclosable field ${f.key} must default to SELF`)
    }
    if (!f.disclosable && f.importable) {
      problems.push(`non-disclosable field ${f.key} must not be importable`)
    }
  }
  for (const k of DISCLOSURE_FIELD_KEYS) {
    if (!seen.has(k)) problems.push(`declared key without spec: ${k}`)
  }
  for (const k of seen) {
    if (!(DISCLOSURE_FIELD_KEYS as readonly string[]).includes(k)) {
      problems.push(`spec without declared key: ${k}`)
    }
  }
  return problems
}
