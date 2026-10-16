/**
 * AC-10 · 账号级数据生命周期 —— **导出清单**与**删除政策**（纯函数，无 IO）
 *
 * ## 为什么单独一个文件
 *
 * `policy.ts` 管的是**保留期清理**（"到点该清什么"）；本文件管的是另外两支：
 *
 *   1. **导出（数据可携带）** —— 用户有权拿走自己的数据；
 *   2. **删除请求（被遗忘权）** —— 用户有权让自己的数据不再可识别。
 *
 * 两支都要求"**按政策生效**"，所以政策在这里同样是**数据 + 纯函数**：
 *   - 导出要**脱敏哪些字段** → `redactUserForExport()`
 *   - 删除要**动哪些表、动成什么样** → `ERASURE_ACTIONS` + `buildErasurePatch()`
 * 于是"删完还剩什么"可以**离线断言**，不需要真库。
 *
 * ## 🔴 删除政策的关键决定：匿化 + 状态收窄，**不是**裸删
 *
 * 理由（每条都是这台机器上真实存在的约束）：
 *
 *   1. **`User.deletedAt` 目前没有任何业务查询在读**（已核实：全仓 `src/` 下除 Prisma
 *      生成类型外零引用）。所以"只置 `deletedAt`"**等于没删** —— 用户照样出现在
 *      发现页、照样能被候选召回。必须让数据本身变得**不可识别**，而不是依赖
 *      某个"以后会加上"的过滤条件。
 *   2. **`Profile.profileStatus` 才是各查询面的实际闸门**（发现/匹配/候选都以
 *      `APPROVED` 为条件）。把它改成 `DEACTIVATED` 并 `isApproved=false`，
 *      匿化后的账号**自动**从全部面向用户的查询里消失，无需改动任何查询。
 *   3. **硬删会打断别人的数据**：`ConnectionProposal` / `Outcome` 的另一侧是**对方**的
 *      记录；`AuditLog` / `TenantAuditEvent` 是合规证据。裸删 `User` 行会让对方面前
 *      凭空多出一堆指向"不存在的人"的记录，且**审计被一并抹掉**。
 *      ⇒ 保留**不可识别的最小骨架**（行仍在、id 仍在、PII 已清），既满足"不可识别",
 *        又不破坏引用完整性与审计链。这也是 GDPR 里"erasure + 最小留存"的常见落法。
 *
 * ## 覆盖边界（诚实清单）
 *
 * ✅ 已覆盖：账号凭据、档案**全部可描述属性**（含 age/gender/sexuality 等粗粒度属性与
 *    匹配偏好）、意图正文、参与状态、桥接 opt-in、Agent 原始文本、站内信、**用户维度缓存**。
 * ⚠️ **保留**（不匿化，理由见 `ERASURE_ACTIONS` 的 `retain` 项）：`Membership`（组织审计）、
 *    `ConnectionProposal` / `ProposalDecision` / `Outcome`（对方侧与合规证据）。
 * ❌ **未覆盖**：IM 会话/消息、匹配史（属 B2C 域，本仓 AC-10 的范围之外）
 *    —— 见 `docs/implementation/LIFECYCLE.md` §"仍开放"。
 */

/** 导出格式版本 —— 写进导出文件，便于回答"这份导出按哪版清单生成"。 */
export const ACCOUNT_EXPORT_VERSION = '2026-10-16'

/** 删除政策版本 —— 写进删除报告。 */
export const ERASURE_POLICY_VERSION = '2026-10-16'

/**
 * 导出时**必须剔除**的 `User` 字段。
 *
 * 判据是"这份导出物会落到用户手里" —— 凭据哈希、令牌版本、Bot 行为配置
 * 一旦随导出外流，等于**把口令离线爆破的成本降到零**。
 */
export const USER_REDACTED_FIELDS = ['password', 'tokenVersion', 'botConfig'] as const

/** 单表导出行数上限。超出只给计数 + `truncated: true`（不静默截断成"看起来完整"）。 */
export const EXPORT_ROW_LIMIT = 1000

/** 销号后的邮箱域。`.invalid` 是 RFC 2606 保留后缀 —— 永远不可投递。 */
export const ERASED_EMAIL_DOMAIN = 'erased.invalid'

/** 销号后的档案显示名。 */
export const ERASED_DISPLAY_NAME = '已注销用户'

/**
 * 销号邮箱。`User.email` 有 `@unique`，所以**必须**唯一 —— 用 `userId`（cuid）
 * 保证唯一且**不可反查**到原邮箱。
 */
export function erasedEmailFor(userId: string): string {
  return `erased+${userId}@${ERASED_EMAIL_DOMAIN}`
}

export type ErasureActionKind = 'anonymize' | 'state-change' | 'purge' | 'retain'

export interface ErasureAction {
  /** 目标表/对象。 */
  target: string
  action: ErasureActionKind
  /** 具体做什么（人话，用于报告与文档）。 */
  detail: string
}

/**
 * 「删除请求」执行的**完整动作清单**。
 *
 * 这份常量是**单一真相源**：文档、接口报告、测试都引用它 ——
 * 于是"删了什么/留了什么"不存在两份说法。
 */
export const ERASURE_ACTIONS: readonly ErasureAction[] = [
  {
    target: 'User',
    action: 'anonymize',
    detail:
      'email → erased+<id>@erased.invalid（唯一且不可投递）；name/image/password → null；tokenVersion++（现存会话立即失效）',
  },
  {
    target: 'User',
    action: 'state-change',
    detail: 'deletedAt 置位（留痕），但**不**作为可见性判据 —— 见文件头说明 ①',
  },
  {
    target: 'Profile',
    action: 'anonymize',
    detail:
      'displayName → 「已注销用户」；可空字段（bio/avatar/galleryPhotos/city/country/occupation/company/industry/边界/风格/偏好/人格/adminNotes）→ null 或 []；' +
      '🔴 非空列用**中性哨兵**而不是留原值：age→0、gender→PREFER_NOT_TO_SAY、sexuality→""、relationshipGoal→NOT_SURE —— 这些列不允许 null，留原值等于留下一份粗粒度画像',
  },
  {
    target: 'Profile',
    action: 'state-change',
    detail: 'profileStatus → DEACTIVATED；isApproved=false；是各查询面的实际闸门（文件头说明 ②）',
  },
  {
    target: 'SocialIntent',
    action: 'anonymize',
    detail: 'need/offer/constraints/disclosure 正文清空（自由文本是 PII 风险面）',
  },
  {
    target: 'SocialIntent',
    action: 'state-change',
    detail: 'status → CANCELLED（未结束的意图不得继续参与召回）',
  },
  {
    target: 'MissionParticipation',
    action: 'state-change',
    detail: 'status → WITHDRAWN（保留行：任务方仍需知道"曾有人参与过"）',
  },
  {
    target: 'BridgeMemberOptIn',
    action: 'state-change',
    detail: 'status → WITHDRAWN + disclosedFieldKeys 清空（跨群披露授权必须立刻收回）',
  },
  {
    target: 'AgentRun',
    action: 'anonymize',
    detail: 'goal/rawText/proposalJson 清空（含用户原始文本 = 不可信输入面）',
  },
  {
    target: 'Notification',
    action: 'purge',
    detail: '删除该用户全部站内信（通知不是审计证据）',
  },
  {
    target: 'Cache（auth:user / settings / discover:profile / who-liked-me）',
    action: 'purge',
    detail:
      '失效用户维度缓存：本人键按精确键失效；who-liked-me 前缀**全局**失效（它的键属于他人、值里含本人快照，按 id 找不到）—— 键定义见 src/lib/cache-keys.ts',
  },
  {
    target: 'Membership',
    action: 'retain',
    detail: '**保留**：组织审计需要"曾有哪些成员"。行内不含 PII（只有 userId + role + status）',
  },
  {
    target: 'ConnectionProposal / ProposalDecision / Outcome',
    action: 'retain',
    detail: '**保留**：这是**对方**的记录与合规证据；裸删会在对方面前留下悬空引用',
  },
  {
    target: 'AuditLog / TenantAuditEvent',
    action: 'retain',
    detail: '**保留**：合规证据，本身不承载 PII（actor 是软引用）',
  },
]

/** 该动作清单里"要动数据"的项（`retain` 不算动作）。用于报告的确定性断言。 */
export function activeErasureActions(): ErasureAction[] {
  return ERASURE_ACTIONS.filter((a) => a.action !== 'retain')
}

/** 从任意行对象里剔除脱敏字段（不改原对象）。 */
export function redactUserForExport<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if ((USER_REDACTED_FIELDS as readonly string[]).includes(k)) continue
    out[k] = v
  }
  return out
}

/** `Profile` 里**不进导出**的字段：内部运营备注，不是用户数据。 */
export const PROFILE_REDACTED_FIELDS = ['adminNotes'] as const

/** 从档案行里剔除内部字段（不改原对象）。 */
export function redactProfileForExport<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if ((PROFILE_REDACTED_FIELDS as readonly string[]).includes(k)) continue
    out[k] = v
  }
  return out
}

/**
 * `Profile` 销号后的字段补丁。
 *
 * 返回**显式类型**（不是 `Record<string, unknown>`）—— 这样它能直接 spread 进
 * Prisma 的 `update.data`，由编译器核对每个字段名与类型。写成宽泛字典反而会把
 * "字段名写错"从编译期错误变成运行期错误（libSQL 只在写的时候才报）。
 */
export interface ErasedProfilePatch {
  displayName: string
  bio: null
  avatar: null
  avatarType: null
  galleryPhotos: string
  city: null
  occupation: null
  company: null
  industry: null
  linkedInVerified: boolean
  verificationBadge: null
  personalityData: null
  adminNotes: null
  genderIdentity: null
  boundaries: null
  dealbreakers: null
  lifePriorities: null
  kinkInterests: string
  hardLimits: string
  selectedTags: string
  // 🔴 以下 4 列**非空**（不允许 null），所以销号只能写中性哨兵；
  //    留原值等于把年龄/性别/性取向/关系目标这份粗粒度画像留着。
  age: number
  gender: 'PREFER_NOT_TO_SAY'
  sexuality: string
  relationshipGoal: 'NOT_SURE'
  // 其余可空字段：一律清空
  country: null
  attachmentStyle: null
  communicationStyle: null
  conflictResolution: null
  loveLanguage: null
  emotionalAvailability: null
  domSubRole: null
  preferredRole: null
  kinkExperienceLevel: null
  preferredAgeMin: null
  preferredAgeMax: null
  preferredGender: null
  preferredDistance: null
  preferredLocation: null
  compatibilityScore: null
  profileStatus: 'DEACTIVATED'
  isApproved: boolean
  isVerified: boolean
}

export function erasedProfilePatch(): ErasedProfilePatch {
  return {
    displayName: ERASED_DISPLAY_NAME,
    bio: null,
    avatar: null,
    avatarType: null,
    galleryPhotos: '[]',
    city: null,
    occupation: null,
    company: null,
    industry: null,
    linkedInVerified: false,
    verificationBadge: null,
    personalityData: null,
    adminNotes: null,
    genderIdentity: null,
    boundaries: null,
    dealbreakers: null,
    lifePriorities: null,
    kinkInterests: '[]',
    hardLimits: '[]',
    selectedTags: '[]',
    // 🔴 非空列用中性哨兵（不是留原值）
    age: 0,
    gender: 'PREFER_NOT_TO_SAY',
    sexuality: '',
    relationshipGoal: 'NOT_SURE',
    // 可空字段一律清空
    country: null,
    attachmentStyle: null,
    communicationStyle: null,
    conflictResolution: null,
    loveLanguage: null,
    emotionalAvailability: null,
    domSubRole: null,
    preferredRole: null,
    kinkExperienceLevel: null,
    preferredAgeMin: null,
    preferredAgeMax: null,
    preferredGender: null,
    preferredDistance: null,
    preferredLocation: null,
    compatibilityScore: null,
    profileStatus: 'DEACTIVATED',
    isApproved: false,
    isVerified: false,
  }
}
