/**
 * Living Connection OS · P2 —— Field 关系网络的**装配器**（纯函数、零 IO）
 *
 * 依据：`DESIGN/02-plan.md` P2「Field 升级为 2.5D 关系网络」。
 *
 * ═══════════════════════════════════════════════════════════════
 * 「2.5D」在这里是**可验证的映射**，不是形容词
 * ═══════════════════════════════════════════════════════════════
 *
 *   第三个维度（深度 z）= **关系强度**，其唯一来源是服务端已经算好的
 *   `matchedTokens`（双向命中词元总数，**不是概率、不是百分比**，见 `recall.ts`）。
 *   映射是纯函数、确定性的，因此可单测、可复算：
 *
 *     depth ∈ [0,1]（在本图展示的这批候选内做 min-max 归一化）
 *       → 半径（越强越靠近中心，产生透视）/ 节点缩放 / 不透明度
 *
 *   ⚠️ 刻意**不用**随机抖动或"力导向"模拟：那会让同一个输入每次渲染都不同，
 *      而"看起来在动"与"数据变了"在界面上长得一模一样 —— 属于假状态。
 *      布局是**输入的函数**，没有输入就没有位移。
 *
 * ═══════════════════════════════════════════════════════════════
 * 五条纪律（与 P1 的 `workspace-spec/assemble.ts` 同源，一条不少）
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. **零 IO**：取数在组件（`useApiGet`），映射在这里 ⇒ 可单测、可被 E2E 直接喂真实载荷。
 *   2. **不猜、不美化**：状态/桶/原因码一律**逐字**取自服务端，映射表缺键时
 *      回退到原始码（而不是编一个"看起来合理"的中文）。
 *   3. **来源不可用 ≠ 没有数据**：读取失败 ⇒ **不产节点** 且写明原因；
 *      绝不渲染成"暂无候选"（两者是完全不同的处境，混为一谈会让用户以为"真的没人"）。
 *   4. **不静默丢**：任何被省略的东西都要有一条 note（截断的规模、被排除的计数）。
 *   5. **截断必须可见**：`truncated` / 超出图容量 ⇒ note 明说"图上的不是全量"。
 *
 * ⚠️ 另一条本切片特有的诚实点：服务端的提案投影（`OrgConnectionRow`）
 *    **刻意不含**双方身份（`operations.ts` 的隐私边界）。因此提案节点**不能**
 *    连到具体候选节点 —— 硬连就是编造关系。图上的提案走独立外环 + 说明。
 */

import type { DisclosedProfile } from '@/lib/connection'
import { DISCLOSURE_FIELDS } from '@/lib/connection/field-catalog'
import {
  FIELD_GATE_LABELS,
  FIELD_INTRODUCE_BLOCKER_LABELS,
  FIELD_NO_CANDIDATE_LABELS,
  FIELD_PROPOSAL_STATE_LABELS,
  type FieldBucket,
  type FieldCandidateList,
  type FieldGateCode,
  type FieldIntroduceBlocker,
  type FieldNoCandidateReason,
  type FieldPipeline,
  type FieldProposalState,
  type FieldSourceState,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// 布局常量（导出以便单测与门禁直接引用，避免"测试里抄一份数字"）
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_LAYOUT = {
  /** 中心：我自己。 */
  CENTER: { x: 0, y: 0 },
  /** 候选环的半径区间：depth=1（关系最强）落在近端。 */
  CANDIDATE_R_NEAR: 200,
  CANDIDATE_R_FAR: 400,
  /** 提案走更外的一环（"已推进到执行层"与"候选"不是同一类关系）。 */
  PROPOSAL_R: 540,
  /** 起始角：-90°，让第一个节点落在正上方（视觉上更像"网"而不是"半圆"）。 */
  START_ANGLE: -Math.PI / 2,
} as const

/** 图容量。超出即截断，且**必须**产 note（纪律 5）。 */
export const FIELD_LIMITS = {
  maxCandidates: 24,
  maxProposals: 24,
  /** 边标签最多展示几个命中词元（其余用计数概括）。 */
  maxEdgeTokens: 3,
} as const

/** 深度 → 视觉参数的线性映射（导出以便单测钉住，且渲染层不另算一套）。 */
export function depthToScale(depth: number): number {
  return 0.82 + 0.18 * clamp01(depth)
}
export function depthToOpacity(depth: number): number {
  return 0.55 + 0.45 * clamp01(depth)
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// ─────────────────────────────────────────────────────────────────────────────
// 输出形状
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldDisclosedRow {
  key: string
  label: string
  value: string
}

export interface FieldNodeDetail {
  /** 参与匹配的正文（对方 intent 的 need/offer —— 默认受众是"同任务参与者"）。 */
  need: string
  offer: string
  /** 互补依据：两侧命中的词元（可复算）。 */
  evidence: { myNeedTheirsOffer: string[]; theirNeedMyOffer: string[] }
  matchedTokens: number
  /** 对方档案的披露投影（未授权字段的键**不存在**）。 */
  disclosed: FieldDisclosedRow[]
  /** 名称是否来自真实披露字段（false = 未授权任何可命名字段）。 */
  named: boolean
}

export interface FieldProposalDetail {
  missionId: string
  missionTitle: string | null
  state: FieldProposalState
  bucket: FieldBucket
  introduced: boolean
  introducedAt: string | null
  createdAt: string
  /** 服务端阶段原名（此处不翻译：译文是另一套语义，见 `workflow/stage-machine`）。 */
  stage: string | null
  stalled: boolean
  canIntroduce: boolean
  blockers: { code: FieldIntroduceBlocker; label: string }[]
}

export type FieldNodeKind = 'viewer' | 'candidate' | 'proposal'

export interface FieldGraphNode {
  id: string
  kind: FieldNodeKind
  label: string
  /** 2.5D 深度 ∈ [0,1]。viewer 恒为 1（自己最近）。 */
  depth: number
  /** 确定性布局坐标（同一输入恒等）。 */
  position: { x: number; y: number }
  detail?: FieldNodeDetail
  proposal?: FieldProposalDetail
}

export type FieldEdgeKind = 'reciprocal' | 'proposal'

export interface FieldGraphEdge {
  id: string
  source: string
  target: string
  kind: FieldEdgeKind
  label: string
  /** 真实计数（候选=双向命中词元数；提案=1，不编造强度）。 */
  weight: number
}

export interface FieldGraph {
  nodes: FieldGraphNode[]
  edges: FieldGraphEdge[]
  /** 诚实说明（来源不可用 / 空原因 / 门控计数 / 截断）。 */
  notes: string[]
}

export interface FieldInput {
  candidates: FieldSourceState<FieldCandidateList>
  pipeline: FieldSourceState<FieldPipeline>
  /** 我的显示名（来自会话）。null → 中性标签「你」。 */
  viewerLabel: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────────────────────

const VIEWER_NODE_ID = 'viewer'

/** 命名优先级：取**披露投影里真实存在**的第一个字符串字段。 */
const LABEL_PRIORITY = ['displayName', 'occupation', 'company', 'industry', 'city', 'country'] as const

function candidateIdentity(subject: DisclosedProfile, userId: string): { label: string; named: boolean } {
  for (const key of LABEL_PRIORITY) {
    const v = subject[key]
    if (typeof v === 'string' && v.trim().length > 0) return { label: v.trim(), named: true }
  }
  // 🔴 不编名字：未授权任何可命名字段时用**可核对**的标识（userId 前缀）并标注。
  return { label: `候选 ${userId.slice(0, 8)}…`, named: false }
}

function formatFieldValue(v: string | number | readonly string[]): string {
  if (Array.isArray(v)) return v.length === 0 ? '（空）' : v.join('、')
  const s = String(v)
  return s.trim().length === 0 ? '（空）' : s
}

/** 把披露投影展平成可渲染的行。顺序取自 `DISCLOSURE_FIELDS`（单一文案源，不另抄一份）。 */
function disclosedRows(subject: DisclosedProfile): FieldDisclosedRow[] {
  const out: FieldDisclosedRow[] = []
  for (const spec of DISCLOSURE_FIELDS) {
    const v = subject[spec.key]
    // 键不存在 = 服务端未授权给本档位 ⇒ 跳过（不是"空值"）。
    if (v === undefined) continue
    out.push({ key: spec.key, label: spec.label, value: formatFieldValue(v) })
  }
  return out
}

/** min-max 归一化到 [0,1]。空输入 → 空；全等 → 全部 1（无从比较强弱时，都算"最近"）。 */
export function normalizeDepth(values: readonly number[]): number[] {
  if (values.length === 0) return []
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min
  if (span === 0) return values.map(() => 1)
  return values.map((v) => clamp01((v - min) / span))
}

function ringPosition(angle: number, radius: number): { x: number; y: number } {
  // round 到整数：消除浮点尾差，让"同一输入恒得同一布局"可被断言。
  return { x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)) }
}

function edgeTokens(evidence: { myNeedTheirsOffer: string[]; theirNeedMyOffer: string[] }): string {
  const all = [...evidence.myNeedTheirsOffer, ...evidence.theirNeedMyOffer]
  if (all.length === 0) return '（无命中词元）'
  const head = all.slice(0, FIELD_LIMITS.maxEdgeTokens).join(' ⇄ ')
  return all.length > FIELD_LIMITS.maxEdgeTokens ? `${head} 等 ${all.length} 项` : head
}

function blockerLabel(code: FieldIntroduceBlocker): string {
  return FIELD_INTRODUCE_BLOCKER_LABELS[code] ?? code
}
function gateLabel(code: FieldGateCode): string {
  return FIELD_GATE_LABELS[code] ?? code
}
function reasonLabel(reason: FieldNoCandidateReason): string {
  return FIELD_NO_CANDIDATE_LABELS[reason] ?? reason
}
function proposalStateLabel(state: FieldProposalState): string {
  return FIELD_PROPOSAL_STATE_LABELS[state] ?? state
}

// ─────────────────────────────────────────────────────────────────────────────
// 装配
// ─────────────────────────────────────────────────────────────────────────────

export function assembleFieldGraph(input: FieldInput): FieldGraph {
  const notes: string[] = []
  const nodes: FieldGraphNode[] = []
  const edges: FieldGraphEdge[] = []

  // ── 中心：我自己 ──
  nodes.push({
    id: VIEWER_NODE_ID,
    kind: 'viewer',
    label: input.viewerLabel?.trim() || '你',
    depth: 1,
    position: FIELD_LAYOUT.CENTER,
  })

  // ── 候选（纪律 3：来源不可用 ⇒ 不产节点） ──
  const cl = input.candidates.data
  if (cl === null) {
    if (input.candidates.error !== null) {
      notes.push(
        `候选来源不可用（${input.candidates.error}）—— 本图不显示候选节点，也不显示「暂无候选」：` +
          '「读不到」与「真的没有」是两件事，混为一谈会让用户以为没人可匹配。',
      )
    }
    // isLoading 时什么都不说：加载中不是结论。
  } else {
    const list = cl.candidates
    if (list.length === 0) {
      const reason = cl.noCandidatesReason
      notes.push(
        reason !== null
          ? reasonLabel(reason)
          : '服务端返回了空候选却没有给原因码 —— 这是服务端契约问题，本图不替它猜原因。',
      )
    } else {
      const shown = list.slice(0, FIELD_LIMITS.maxCandidates)
      if (list.length > shown.length) {
        notes.push(
          `候选共 ${list.length} 条，图上只画了前 ${shown.length} 条（按服务端排序）—— 图上的不是全量。`,
        )
      }

      const depths = normalizeDepth(shown.map((c) => c.matchedTokens))
      const n = shown.length
      shown.forEach((c, i) => {
        // 均匀分布 + 每个候选独立的角度偏移，避免 n=1 时"只有一个点贴在正中上方"的呆板感。
        const angle = FIELD_LAYOUT.START_ANGLE + (2 * Math.PI * i) / n
        const depth = depths[i] ?? 1
        const radius =
          FIELD_LAYOUT.CANDIDATE_R_FAR - (FIELD_LAYOUT.CANDIDATE_R_FAR - FIELD_LAYOUT.CANDIDATE_R_NEAR) * depth
        const id = `cand:${c.userId}`
        const identity = candidateIdentity(c.subject, c.userId)

        nodes.push({
          id,
          kind: 'candidate',
          label: identity.label,
          depth,
          position: ringPosition(angle, radius),
          detail: {
            need: c.need,
            offer: c.offer,
            evidence: {
              myNeedTheirsOffer: [...c.evidence.myNeedTheirsOffer],
              theirNeedMyOffer: [...c.evidence.theirNeedMyOffer],
            },
            matchedTokens: c.matchedTokens,
            disclosed: disclosedRows(c.subject),
            named: identity.named,
          },
        })

        edges.push({
          id: `edge:reciprocal:${VIEWER_NODE_ID}->${id}`,
          source: VIEWER_NODE_ID,
          target: id,
          kind: 'reciprocal',
          label: edgeTokens(c.evidence),
          weight: c.matchedTokens,
        })
      })

      const unnamed = shown.filter((c) => !candidateIdentity(c.subject, c.userId).named).length
      if (unnamed > 0) {
        notes.push(`${unnamed} 位候选未授权任何可命名字段（如显示名）—— 图上用标识代替，不编造姓名。`)
      }

      // 门控损耗：让"为什么只有这些"可解释（只有原因码与计数，**不含对方内容**）。
      const gated = cl.gatedOut.reduce((sum, g) => sum + g.count, 0)
      if (cl.gatedOut.length > 0) {
        const parts = cl.gatedOut.map((g) => `${gateLabel(g.code)} ×${g.count}`).join('、')
        notes.push(`另有 ${gated} 条意图被硬门控排除：${parts}。`)
      }
      notes.push(`本任务下进入互补判定的有 ${cl.considered} 条（已过门控，含你自己）。`)
      notes.push(
        `本次投影使用的受众档位是 ${cl.profileAudience}（服务端自描述）—— ` +
          '只有授权到该档的档案字段才会出现在候选详情里。',
      )
    }
  }

  // ── 提案（纪律 3 同上；纪律 4/5：截断与隐私边界都要说） ──
  const pl = input.pipeline.data
  if (pl === null) {
    if (input.pipeline.error !== null) {
      notes.push(`提案来源不可用（${input.pipeline.error}）—— 不显示提案节点。`)
    }
  } else {
    const items = pl.items
    if (items.length === 0) {
      notes.push('本社群当前没有连接提案（这是真实结果，不是加载失败）。')
    } else {
      const shown = items.slice(0, FIELD_LIMITS.maxProposals)
      if (items.length > shown.length) {
        notes.push(`提案本页共 ${items.length} 条，图上只画了前 ${shown.length} 条 —— 图上的不是全量。`)
      }

      shown.forEach((row, i) => {
        const angle = FIELD_LAYOUT.START_ANGLE + (2 * Math.PI * i) / shown.length + Math.PI / shown.length
        const id = `prop:${row.proposalId}`
        // 提案的"强度"服务端没给 → 用固定深度 0.5 并**在图上置于外环**，不编造强弱。
        const depth = 0.5

        nodes.push({
          id,
          kind: 'proposal',
          label: row.missionTitle?.trim() || `提案 ${row.proposalId.slice(0, 8)}…`,
          depth,
          position: ringPosition(angle, FIELD_LAYOUT.PROPOSAL_R),
          proposal: {
            missionId: row.missionId,
            missionTitle: row.missionTitle,
            state: row.state,
            bucket: row.bucket,
            introduced: row.introduced,
            introducedAt: row.introducedAt,
            createdAt: row.createdAt,
            stage: row.stage,
            stalled: row.stalled,
            canIntroduce: row.canIntroduce,
            blockers: row.introduceBlockers.map((code) => ({ code, label: blockerLabel(code) })),
          },
        })

        edges.push({
          id: `edge:proposal:${VIEWER_NODE_ID}->${id}`,
          source: VIEWER_NODE_ID,
          target: id,
          kind: 'proposal',
          label: proposalStateLabel(row.state),
          // 服务端未给"这条提案与我关系的强度" ⇒ 恒 1，不用 matchedTokens 冒充。
          weight: 1,
        })
      })
    }

    if (pl.truncated) {
      notes.push(
        `提案视图被扫描窗口截断：本次只扫描了最近 ${pl.scanned} 条 —— ` +
          '「共 N 条」不是社群全量（AC-09：不许把估算当事实）。',
      )
    }

    const buckets = Object.entries(pl.summary)
      .filter(([k, v]) => k !== 'ALL' && v > 0)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')
    if (buckets.length > 0) notes.push(`窗口内分桶计数：${buckets}（不受当前过滤影响）。`)

    // 🔴 隐私边界（服务端设计如此）：提案投影不含双方身份 ⇒ 图上也**不能**把提案连到候选。
    if (items.length > 0) {
      notes.push(
        '提案节点走独立外环、不连向具体候选：服务端的运营投影刻意不含双方身份，' +
          '把它们连起来等于编造一条服务端没说过的关系。',
      )
    }
  }

  return { nodes, edges, notes }
}

/** 供组件层做"点开一个节点"用：按 id 取节点（避免组件里再遍历一遍）。 */
export function findFieldNode(graph: FieldGraph, id: string | null): FieldGraphNode | null {
  if (id === null) return null
  return graph.nodes.find((n) => n.id === id) ?? null
}
