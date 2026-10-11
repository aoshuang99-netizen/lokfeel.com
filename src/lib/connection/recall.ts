/**
 * T04 · 双向互补召回与可解释排序（纯函数内核）
 *
 * 本模块**不碰数据库、不 import 任何东西** —— 刻意如此：
 *   1. 纯函数可被"固定测试集"逐字复现（AC-13 的证据要求）；
 *   2. 避免 `@/lib/connection` barrel → next-auth 的 ESM 传递依赖（T03 已踩过）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 四段式（顺序即语义，来自 T00 复用矩阵 B1）
 * ═══════════════════════════════════════════════════════════════
 *
 *     硬门控 ──▶ 结构化过滤 ──▶ 双向互补召回 ──▶ 解释性排序
 *     gates     filter         recall          rank + evidence
 *
 * 三条不可动摇的规则：
 *
 * 【规则 1】**过滤必须在召回与排序之前**。
 *   本模块用**类型**而不是"约定"来保证：`recall()` 只接受 `GatedRow[]`，
 *   而 `GatedRow` 只能由 `applyGates()` 产出。想绕过门控直接召回的代码
 *   **编译不过**（与 T03 用 `ExternalAudience` 排除 `SELF` 同一手法）。
 *
 * 【规则 2】**无候选时不伪造**。
 *   没有任何双向重叠 → 返回空数组 + 一个能说出口的原因（`NoCandidateReason`）。
 *   绝不用"猜你喜欢"式的占位候选填满列表。
 *
 * 【规则 3】**每个候选都必须带得走依据**（evidence 是必填字段，不是可选装饰）。
 *   依据是**实际命中的词元**（哪一侧的哪些词），不是 0..1 的"匹配度百分比" ——
 *   后者看起来精确，实际上不可复算、不可争辩，正是 AC-13 要避免的"无依据推荐"。
 */

// ═══════════════════════════════════════════════════════════════
// 词元化：结构化召回的"最小可用单位"
// ═══════════════════════════════════════════════════════════════

/**
 * 拉丁词元的最小长度。低于此长度的词（a / of / 我 / 的）不参与匹配 ——
 * 它们在任何两段文本里都会同时出现，命中它们不构成任何"互补"证据。
 */
const MIN_LATIN_TOKEN = 3
/**
 * CJK 用 2-gram（双字滑窗）切分。
 *
 * 为什么不按空格切：中文不写空格，`"我需要东南亚供应链"` 会被当成一个词元，
 * 两段不同的中文文本几乎永不命中 —— 召回转不动。
 * 为什么不用分词库：引入词典会带来"词典决定召回结果"的不可复现性
 * （换词典 → 排序变），而 AC-13 要的是固定测试集可复现。
 * 2-gram 是**确定性、无依赖、可复算**的折中。
 */
const CJK_GRAM = 2

const isCJK = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0
  return (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK 统一表意
    (c >= 0x3040 && c <= 0x30ff) || // 日文假名
    (c >= 0xac00 && c <= 0xd7af) // 韩文音节
  )
}

/**
 * 词元化：拉丁按非字母数字切分（单词，长度 ≥ 3），CJK 按 2-gram 滑窗。
 *
 * 输出**去重且有序**（首次出现顺序）。顺序稳定 → 依据列表可复现。
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const push = (t: string) => {
    if (seen.has(t)) return
    seen.add(t)
    out.push(t)
  }

  const src = (text ?? '').toString()
  let latin = ''

  const flushLatin = () => {
    if (latin.length >= MIN_LATIN_TOKEN) push(latin)
    latin = ''
  }

  let gram = ''
  for (const raw of src) {
    if (isCJK(raw)) {
      flushLatin()
      gram += raw
      if ([...gram].length >= CJK_GRAM) {
        push(gram)
        // 滑窗：去掉最左一个字（用 code point 而非 UTF-16 单元，避免代理对切坏）
        gram = [...gram].slice(1).join('')
      }
      continue
    }
    // 非 CJK：CJK 缓冲结束
    gram = ''
    if (/[0-9a-zA-Z]/.test(raw)) {
      latin += raw.toLowerCase()
    } else {
      flushLatin()
    }
  }
  flushLatin()

  return out
}

/** 两侧词元的交集（按 a 的首次出现顺序，稳定可复现）。 */
export function overlapTokens(a: readonly string[], b: readonly string[]): string[] {
  if (a.length === 0 || b.length === 0) return []
  const setB = new Set(b)
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of a) {
    if (setB.has(t) && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

// ═══════════════════════════════════════════════════════════════
// 门控（硬过滤）
// ═══════════════════════════════════════════════════════════════

/** 被门控拒绝的原因码。每个码都要能在 UI 里说出一句话，不允许多义的 `blocked`。 */
export type GateCode =
  | 'cross_tenant' // 跨租户
  | 'intent_not_active' // 意图已撤销
  | 'intent_expired' // 意图已过期
  | 'not_participant' // 对手方不是该任务的 ACTIVE 参与人
  | 'self' // 自己

export interface GateContext {
  /** 发起方的租户。 */
  organizationId: string
  /** 发起方本人（用于排除自己）。 */
  viewerId: string
  /** 任务 id（用于校验对手方确实在该任务下）。 */
  missionId: string
  /** 该任务下 ACTIVE 参与人的 userId 集合。 */
  activeParticipantIds: ReadonlySet<string>
  /** 判定"已过期"的时刻。**显式传入**，否则测试无法固定时间。 */
  now: Date
}

/** 一条待门控的候选行。刻意只含判定所需字段 —— 不需要的不进内存。 */
export interface CandidateRow {
  intentId: string
  userId: string
  organizationId: string
  missionId: string
  status: 'ACTIVE' | 'WITHDRAWN'
  expiresAt: Date | null
}

export interface Gate<T> {
  readonly code: GateCode
  /** 命中即拒绝；返回 null 表示放行。**不抛异常** —— 拒绝是正常结果，不是错误。 */
  readonly blocks: (row: T, ctx: GateContext) => boolean
}

/**
 * 召回前的硬门控清单。
 *
 * ⚠️ 顺序**不参与正确性**（任一门控命中即拒），但会影响被记录的**首个**原因，
 * 所以顺序按"越根本越靠前"排列：跨租户 → 状态 → 参与关系 → 自己。
 * 测试对这个顺序有断言，防止有人重排后让原因码变得难以理解。
 */
export const RECALL_GATES: readonly Gate<CandidateRow>[] = [
  {
    code: 'cross_tenant',
    blocks: (row, ctx) => row.organizationId !== ctx.organizationId,
  },
  {
    code: 'intent_not_active',
    blocks: (row) => row.status !== 'ACTIVE',
  },
  {
    code: 'intent_expired',
    blocks: (row, ctx) => Boolean(row.expiresAt && row.expiresAt.getTime() <= ctx.now.getTime()),
  },
  {
    code: 'not_participant',
    blocks: (row, ctx) => !ctx.activeParticipantIds.has(row.userId),
  },
  {
    code: 'self',
    blocks: (row, ctx) => row.userId === ctx.viewerId,
  },
]

export interface BlockedRow<T> {
  row: T
  code: GateCode
}

export interface GateOutcome<T> {
  allowed: T[]
  blocked: BlockedRow<T>[]
}

/**
 * 施加门控。
 *
 * 这是**唯一**能产出 `GatedRow` 的函数 —— 因此 `recall()` 不可能看到未过滤的行。
 * 这不是"约定"，是类型系统层面的：`GatedRow` 的构造签名在模块外不可得。
 */
export function applyGates<T extends CandidateRow>(
  rows: readonly T[],
  ctx: GateContext,
  gates: readonly Gate<T>[] = RECALL_GATES as unknown as readonly Gate<T>[]
): GateOutcome<T> {
  const allowed: T[] = []
  const blocked: BlockedRow<T>[] = []

  for (const row of rows) {
    const hit = gates.find((g) => g.blocks(row, ctx))
    if (hit) blocked.push({ row, code: hit.code })
    else allowed.push(row)
  }

  return { allowed, blocked }
}

/** 品牌类型：只由 `applyGates` 的返回值产生，用来在类型上禁止"跳过门控"。 */
declare const GATED: unique symbol
export type GatedRow<T extends CandidateRow> = T & { readonly [GATED]: true }

/** 把门控结果转成品牌类型。**不要**在别处调用 —— 其余调用点会破坏"过滤先于召回"。 */
export function markGated<T extends CandidateRow>(rows: readonly T[]): GatedRow<T>[] {
  return rows as unknown as GatedRow<T>[]
}

// ═══════════════════════════════════════════════════════════════
// 双向互补召回
// ═══════════════════════════════════════════════════════════════

export interface IntentSide {
  need: string
  offer: string
}

/** 一条候选的完整输入（门控字段 + 互补判定所需的正文）。 */
export interface RecallRow extends CandidateRow, IntentSide {}

/** 一次双向命中的全部依据。**两侧都要有**才算双向（见 `recall`）。 */
export interface ReciprocalEvidence {
  /** 我的 need 命中的对手方 offer 词元。 */
  myNeedTheirsOffer: string[]
  /** 对手方 need 命中的我的 offer 词元。 */
  theirNeedMyOffer: string[]
}

export interface RecalledCandidate<R extends RecallRow> {
  row: R
  evidence: ReciprocalEvidence
  /** 双向命中词元总数（**不是**概率、不是百分比）。排序主键之一。 */
  matchedTokens: number
}

/**
 * 双向互补召回。
 *
 * **"双向"是可判定的硬条件，不是形容词**：只有 `我的需要 ↔ 他的供给` 与
 * `他的需要 ↔ 我的供给` **同时**有词元命中，才算候选。
 * 单向命中（我单方面想要他给的）不构成"互惠"—— 那正是 T00 审计里
 * B1 要修掉的旧行为（`Match` 是 sender→receiver 单向投递）。
 *
 * 入参是 `GatedRow`：**类型上不可能**把未过门控的行传进来。
 */
export function recall<R extends RecallRow>(
  me: IntentSide,
  rows: readonly GatedRow<R>[]
): RecalledCandidate<R>[] {
  const myNeed = tokenize(me.need)
  const myOffer = tokenize(me.offer)

  const out: RecalledCandidate<R>[] = []
  for (const row of rows) {
    const theirNeed = tokenize(row.need)
    const theirOffer = tokenize(row.offer)

    const a = overlapTokens(myNeed, theirOffer)
    const b = overlapTokens(theirNeed, myOffer)

    // 规则：双向都命中才算候选
    if (a.length === 0 || b.length === 0) continue

    out.push({
      row,
      evidence: { myNeedTheirsOffer: a, theirNeedMyOffer: b },
      matchedTokens: a.length + b.length,
    })
  }
  return out
}

// ═══════════════════════════════════════════════════════════════
// 解释性排序
// ═══════════════════════════════════════════════════════════════

/**
 * 排序键（**全序**，因此结果可复现）：
 *   1. 双向命中词元总数（多者优先）
 *   2. 侧向均衡：两侧命中数的较小值（避免"一侧狂命中、另一侧勉强 1 个"排在前）
 *   3. userId 字典序升序（**打破平局的最终手段**；没有它，同分候选的顺序取决于
 *      数据库返回顺序 —— 那是不可复现的，会让固定测试集变成随机测试）
 */
function rankCompare<R extends RecallRow>(a: RecalledCandidate<R>, b: RecalledCandidate<R>): number {
  if (b.matchedTokens !== a.matchedTokens) return b.matchedTokens - a.matchedTokens

  const minOf = (c: RecalledCandidate<R>) =>
    Math.min(c.evidence.myNeedTheirsOffer.length, c.evidence.theirNeedMyOffer.length)
  const am = minOf(a)
  const bm = minOf(b)
  if (bm !== am) return bm - am

  return a.row.userId < b.row.userId ? -1 : a.row.userId > b.row.userId ? 1 : 0
}

// ═══════════════════════════════════════════════════════════════
// 档案投影 —— 刻意**不在**本模块
// ═══════════════════════════════════════════════════════════════

/**
 * 候选阶段可以看到对方档案的哪个受众档位 —— 答案由披露层给出，见下方。
 *
 * 本模块不做档案投影，也不持有任何档案数据：它的职责是回答"谁值得被推荐、
 * 凭什么"；"谁能看到对方的哪些字段"是**披露层**的职责，唯一出口是
 * `discloseSubject()`（T03 立下的规矩）。
 *
 * 上一刀在这里放过一个 `subject` 占位字段（恒为 `{}`），用来表达"候选阶段
 * 暂不披露任何字段"。决策落定后它被**删除**，而不是就地改成 CANDIDATE ——
 * 一个纯排序内核不该假装自己知道投影这件事。留着它，下一个人就会以为
 * "候选的字段是在这里拼的"，于是新增通道时绕过了 `discloseSubject()`，
 * 那正是 AC-03 最怕的漂移。
 *
 * 真实装配在服务层 `candidates.ts`：`buildCandidates()` 定序 → 对每个候选
 * `discloseSubject(profile, live, CANDIDATE_PROFILE_AUDIENCE)`。
 *
 * 🔴 投影档位**必须**是 `CANDIDATE`，不能用 `COUNTERPARTY`：T03 已向用户
 * 分别声明过两者（"同任务的伙伴" vs "匹配后的对手方"）。候选是**同意之前**
 * 的潜在对手方，用 COUNTERPARTY 渲染候选，就是把"只授权给已同意对手方"的
 * 字段提前给到"还没同意的人"—— 静默放宽一个已声明的受众范围（AC-03 红线）。
 * 该取舍收敛在 `field-catalog.ts` 的 `CANDIDATE_PROFILE_AUDIENCE` 一个常量上。
 */

// ═══════════════════════════════════════════════════════════════
// 端到端管线
// ═══════════════════════════════════════════════════════════════

/**
 * 没有候选时的原因。**必须能说出口**，不许用空列表糊过去。
 *
 * 前三个由本模块的行级管线产出；最后两个由**服务层前置判定**产出
 * （决定"该不该进入管线"的问题，不是行级问题，所以不在这里判）。
 */
export type NoCandidateReason =
  | 'no_own_intent' // 自己还没在这条任务上提交意图（或已撤销/已过期）
  | 'no_other_intents' // 该任务下除自己外没有其他 ACTIVE 意图
  | 'all_gated_out' // 有其他意图，但全部被硬门控拒绝
  | 'no_reciprocal_overlap' // 过了门控，但没有一条构成"双向"互补

/** 本模块能产出的原因码子集（断言用；防止有人误以为 `no_own_intent` 出自这里）。 */
export const PIPELINE_REASONS = [
  'no_other_intents',
  'all_gated_out',
  'no_reciprocal_overlap',
] as const satisfies readonly NoCandidateReason[]

/**
 * 一个候选。
 *
 * ⚠️ **刻意不含 `subject`**（对方档案）：本模块只回答"谁值得被推荐、凭什么"，
 * 档案投影由服务层经 `discloseSubject()` 完成（原因见上方"档案投影"一节）。
 */
export interface CandidateMatch {
  intentId: string
  userId: string
  /** 互补依据（必填）。 */
  evidence: ReciprocalEvidence
  matchedTokens: number
}

export interface CandidateResult {
  candidates: CandidateMatch[]
  /** 没有候选时给出原因；有候选时为 null。 */
  noCandidatesReason: NoCandidateReason | null
  /** 被门控拒绝的明细（**计数与原因码**，不返回对方内容）。 */
  gatedOut: { code: GateCode; count: number }[]
  /** 参与本次判定的总行数（过了门控之后），供前端解释"为什么只有这些"。 */
  considered: number
}

/**
 * 四段式管线的唯一入口。
 *
 *   门控 → 结构化过滤（在此体现为"仅 ACTIVE/未过期/同任务参与人"，已由门控完成）
 *        → 双向互补召回 → 解释性排序
 *
 * ⚠️ 注意 `rows` 的**入参类型是原始行**，门控在函数内部完成 —— 这样调用方
 * 无法"忘记先门控"。函数内部先把门控结果转成 `GatedRow` 再交给 `recall()`。
 *
 * ⚠️ 返回类型**刻意不带行类型参数**（上一刀的 `CandidateMatch<R>` 泛型已删）：
 * 内核的产出已经与"传进来的行长什么样"完全无关 —— 它只回 `intentId` /
 * `userId` / 命中的词元，连对方的 `need`/`offer` 正文都要调用方自己按 userId 回填
 * （见 `candidates.ts`）。把行类型透传出去，等于给"顺手把行里的档案字段塞进候选"
 * 留了一条类型上的便道；这里把便道堵死。
 */
export function buildCandidates(
  me: IntentSide & { userId: string },
  rows: readonly RecallRow[],
  ctx: GateContext,
  options: { limit?: number } = {}
): CandidateResult {
  const limit = Math.max(0, Math.floor(options.limit ?? 50))

  const { allowed, blocked } = applyGates(rows, ctx)

  const gatedOut = (() => {
    const acc = new Map<GateCode, number>()
    for (const b of blocked) acc.set(b.code, (acc.get(b.code) ?? 0) + 1)
    return [...acc.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((x, y) => (x.code < y.code ? -1 : 1))
  })()

  if (rows.length === 0) {
    return { candidates: [], noCandidatesReason: 'no_other_intents', gatedOut, considered: 0 }
  }
  if (allowed.length === 0) {
    return { candidates: [], noCandidatesReason: 'all_gated_out', gatedOut, considered: 0 }
  }

  const recalled = recall(me, markGated(allowed))
  if (recalled.length === 0) {
    return { candidates: [], noCandidatesReason: 'no_reciprocal_overlap', gatedOut, considered: allowed.length }
  }

  const ranked = [...recalled].sort(rankCompare).slice(0, limit)

  return {
    candidates: ranked.map((c) => ({
      intentId: c.row.intentId,
      userId: c.row.userId,
      evidence: c.evidence,
      matchedTokens: c.matchedTokens,
      // ⚠️ 这里**不拼对方档案**（上一刀的 `subject: {}` 已删除）：
      //    投影是披露层的职责，装配点在服务层 candidates.ts，经 discloseSubject()。
    })),
    noCandidatesReason: null,
    gatedOut,
    considered: allowed.length,
  }
}

/**
 * 生成**人类可读**的推荐依据（一行一条）。
 *
 * 刻意只描述"哪一侧需要什么、被哪一侧供给什么"，并**引用命中的原词元**：
 * 用户能看到"系统凭什么把我俩排在一起"，从而能反驳它。
 * 不输出任何百分比/分数 —— 不可复算的数字比没有数字更糟。
 */
export function explainCandidate(evidence: ReciprocalEvidence, labels: { me: string; them: string }): string[] {
  const lines: string[] = []
  if (evidence.myNeedTheirsOffer.length > 0) {
    lines.push(`${labels.me}需要 ↔ ${labels.them}提供：${evidence.myNeedTheirsOffer.join('、')}`)
  }
  if (evidence.theirNeedMyOffer.length > 0) {
    lines.push(`${labels.them}需要 ↔ ${labels.me}提供：${evidence.theirNeedMyOffer.join('、')}`)
  }
  return lines
}
