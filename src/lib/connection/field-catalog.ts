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
 *      自己 + 组织者 + 已同意的对手方；`CANDIDATE` 档 = 自己 + 组织者 +
 *      同任务的互补伙伴（最宽）。所以档位越高，能看到的人越多（`audienceRank` 单调）。
 *      ⚠️ 不要把它理解成"平行受众"——那是另一种语义，会让"组织者看不到自己人的资料"
 *      这种反直觉行为发生。
 *   2. **缺省一律 `SELF`（不披露）**：`suggestedDisclosure()` 里的 `defaultAudience`
 *      只是**给前端表单的建议勾选**，不是 API 的缺省值。API 侧「字段没写 = 未授权」，
 *      「用户没选」绝不等于「用户同意」。
 */

// ═══════════════════════════════════════════════════════════
// 受众档位
// ═══════════════════════════════════════════════════════════

/**
 * 声明顺序即权限大小（索引越大 = 受众越广）。
 *
 * ⚠️ 新增档位时**不得改变已存在档位的相对次序** —— 库里的 `disclosure` 文本存的是
 * 档位**名字**，理解这些名字的是本数组的次序；次序一变，**历史数据**的可见性
 * 就会静默漂移，而且没有任何迁移能"顺便修好"它。因此新档位通常应**追加在末尾**。
 *
 * ⚠️ `CANDIDATE` 之所以追加在 `COUNTERPARTY` **之后**（而不是"候选比对手方窄"）：
 *   记 `C` = 已同意的对手方集合，`P` = 同任务的互补伙伴集合。**`C ⊆ P`** ——
 *   任何对手方，在双方同意之前本来就是一名候选伙伴。于是
 *   `{组织者} ∪ C ⊆ {组织者} ∪ P`，即"给已同意者看" ⊂ "给伙伴看"。
 *   `CANDIDATE` 是**更宽**的那一档。
 *
 *   若把次序写反（插在 `COUNTERPARTY` 之前），`rank(granted) >= rank(viewer)`
 *   就会让 `rank(COUNTERPARTY) >= rank(CANDIDATE)` 成立 →
 *   **尚未同意的人看到了用户只授权给已同意对手方的字段**：一次静默的越权披露。
 *   `field-catalog.test.ts` 对此有一条不变量断言（T04 加）。
 */
export const DISCLOSURE_AUDIENCES = ['SELF', 'ORGANIZER', 'COUNTERPARTY', 'CANDIDATE'] as const

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

export const EXTERNAL_AUDIENCES: readonly ExternalAudience[] = [
  'ORGANIZER',
  'COUNTERPARTY',
  'CANDIDATE',
]

/**
 * 表单渲染用的档位清单（**单一事实来源**），按"受众由窄到宽"排列。
 *
 * 为什么放这里而不是放进 `.tsx`：T03 已经因为"前端自己维护一份字段文案"吃过亏
 * （见本文件顶部）。档位清单同理 —— 若前端硬编码三项，那么新增 `CANDIDATE` 时
 * 前端会**静默**少一个选项，用户根本无从授权，而后端投影却已经支持这一档：
 * 表现为"字段明明可以开给伙伴，但界面不给开关"。
 */
export const AUDIENCE_OPTIONS: readonly { value: DisclosureAudience; label: string }[] = [
  { value: 'SELF', label: '仅自己' },
  { value: 'ORGANIZER', label: '组织者' },
  { value: 'COUNTERPARTY', label: '匹配后的对手方' },
  { value: 'CANDIDATE', label: '同任务的伙伴' },
]

/**
 * 某受众能否看到"被授权到 `granted` 档"的字段。
 * 规则：`rank(granted) >= rank(viewer)`，即"受权范围覆盖到了这位受众"。
 *
 * 完整真相表（写下来是为了避免下一个人凭直觉猜方向 —— T04 我自己就先猜反过一次）：
 *
 *   granted        | viewer=ORGANIZER | viewer=COUNTERPARTY | viewer=CANDIDATE
 *   ---------------|------------------|---------------------|-----------------
 *   SELF           | ✗                | ✗                   | ✗
 *   ORGANIZER      | ✓                | ✗                   | ✗
 *   COUNTERPARTY   | ✓                | ✓                   | ✗
 *   CANDIDATE      | ✓                | ✓                   | ✓
 *
 * 读法：「档位 = 我允许看到它的**最宽**人群」。最关键的一项是
 * **`COUNTERPARTY` 档对候选不可见** —— 用户写了"只给已配对的对手方看"，
 * 那么还没配对成功的人就不该看到（这正是把 `CANDIDATE` 追加在末尾的理由）。
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

/**
 * **候选阶段**（T04 双向检索）投影对方档案时使用的受众档位。
 *
 * 取值必须是 `CANDIDATE`，不能用 `COUNTERPARTY`。这两档是**向用户分别声明过**的：
 *   「匹配后的对手方」= 双方都同意了才会看到；
 *   「同任务的伙伴」  = 同一条任务里与我互补的成员（含尚未同意者）。
 * 候选页的浏览者恰恰是「同任务的伙伴」。若改用 `COUNTERPARTY` 投影，
 * `rank(COUNTERPARTY) >= rank(COUNTERPARTY)` 成立 → **还没同意的人看到了
 * 用户只授权给已同意对手方的字段** —— 静默放宽一个已声明的受众范围，AC-03 不允许。
 *
 * 这个常量存在的意义：把"候选能看到哪一档"收敛成**唯一一个可审计的字面量**。
 * 有人若想放宽，改的是这一行，而不是散落各处的投影调用点。
 */
export const CANDIDATE_PROFILE_AUDIENCE: ExternalAudience = 'CANDIDATE'

/**
 * T05 · 「双方同意后」的档案档位。
 *
 * ⚠️ 这个常量是 **`COUNTERPARTY` 档位唯一的生效入口**。T05 之前，该档位虽然
 * 存在于目录、也能被用户选中，却**没有任何读路径** —— 用户把字段设成
 * 「匹配后可见」，结果永远不会有人看到它们（功能静默失效，且没有任何报错）。
 * 双边同意落地后，本常量才第一次被投影调用点引用。
 *
 * 收敛成常量与 `CANDIDATE_PROFILE_AUDIENCE` 同理：想改「已介绍的对手方能看什么」，
 * 改的是这一行，而不是散落各处的投影调用点。
 */
export const COUNTERPARTY_PROFILE_AUDIENCE: ExternalAudience = 'COUNTERPARTY'

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

  // 表单档位清单必须与档位声明**完全一致**（缺一个 = 用户无从授权该档，
  // 多一个 = 界面给出后端不认的档位）。顺序也要求一致，因为那就是权限次序。
  const optValues = AUDIENCE_OPTIONS.map((o) => o.value)
  if (optValues.join(',') !== DISCLOSURE_AUDIENCES.join(',')) {
    problems.push(
      `AUDIENCE_OPTIONS out of sync with DISCLOSURE_AUDIENCES: [${optValues.join(',')}]`
    )
  }
  if (!EXTERNAL_AUDIENCES.includes(CANDIDATE_PROFILE_AUDIENCE)) {
    problems.push(`CANDIDATE_PROFILE_AUDIENCE must be an external audience`)
  }
  if (!EXTERNAL_AUDIENCES.includes(COUNTERPARTY_PROFILE_AUDIENCE)) {
    problems.push(`COUNTERPARTY_PROFILE_AUDIENCE must be an external audience`)
  }
  // T05：两个**投影档位常量**之间必须有确定的秩关系。
  // 「已同意的对手方」在集合上包含于「同任务的伙伴」，所以 `COUNTERPARTY` 必须更窄 ——
  // 若把它设成更宽，就会出现"候选人看不到、已同意的人反而能看到"的反漏斗：
  // 它不会报错，只会让用户在同意之后**失去**之前能看到的信息。
  if (audienceRank(COUNTERPARTY_PROFILE_AUDIENCE) >= audienceRank(CANDIDATE_PROFILE_AUDIENCE)) {
    problems.push(
      `COUNTERPARTY_PROFILE_AUDIENCE must be narrower than CANDIDATE_PROFILE_AUDIENCE`
    )
  }

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
