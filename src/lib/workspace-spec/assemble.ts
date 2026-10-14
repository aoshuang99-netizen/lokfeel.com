/**
 * Living Connection OS · P1 收口 —— **真实数据装配**（纯函数，零 IO）
 *
 * 背景：P1 首版里 `consent` / `action` / `outcome` 三类节点**只有渲染分支**，
 * 没有真实数据来源（见 `DESIGN/04-changes-p1.md` §8）。本文件把那三类节点的
 * 数据来源接到**已交付的服务端真相**上：
 *
 *   consent ← `GET /api/v1/connections/proposals`（T05，`proposal.read`）
 *   action  ← `GET /api/v1/workflow/jobs`          （T06，`workflow.read`）
 *   outcome ← `GET /api/v1/outcomes`               （T08，`outcome.read`）
 *
 * 🔴 五条纪律（每一条都是"看起来能用"与"真的能用"的分界）：
 *
 *   1. **零 IO**：本文件只做"服务端载荷 → 节点"的纯映射。取数在调用方
 *      （`living-workspace.tsx` 用现有 `useApiGet`）。这样映射可被纯单测覆盖，
 *      也能被 E2E 脚本直接喂真实 HTTP 载荷（见 `scripts/qa/verify-p1-workspace-e2e.mts`）。
 *
 *   2. **不猜、不转义**：状态与档位**逐字**照搬服务端枚举 —— 契约里的取值域
 *      就是服务端枚举的镜像（`schema.ts` 有编译期漂移守卫）。这里**不做**任何
 *      "把 REJECTED 归成 PENDING"式的美化：那等于向用户隐瞒一次拒绝。
 *
 *   3. **来源不可用 ≠ 没有数据**。端点 403（非成员 / 能力不足）或读取失败时，
 *      **不产节点**（空节点会被渲染成"暂无…"，那是彻头彻尾的误导），
 *      只产出一条写明原因的 note。真正"查询成功但结果为空"才产空节点。
 *
 *   4. **不静默丢**。载荷里有本装配器不认识的形状 → **整节点拒绝**并说明原因，
 *      而不是跳过那条坏数据（跳过 = 少显示 ≠ 不显示，且没有任何痕迹）。
 *
 *   5. **截断必须可见**。超出节点/条目上限时产出一条 note，而不是悄悄少给几条。
 */

import {
  ACTION_JOB_STATUSES,
  AGENT_RISKS,
  AGENT_SKILLS,
  AGENT_STATES,
  CONSENT_STATES,
  OUTCOME_LEVELS,
  WorkspaceSpecSchema,
  type ActionNode,
  type AgentNode,
  type ConsentNode,
  type OutcomeNode,
  type WorkspaceNode,
  type WorkspaceSpec,
} from './schema'
import { z } from 'zod'

// ── 与契约同源的上限（改一处必须改两处，故在此显式声明并断言） ──────────────
/** `WorkspaceSpec.nodes` 的上限。 */
export const MAX_SPEC_NODES = 40
/** `nodes[].data.*` 数组的上限（consent.fields / action.jobs / outcome.outcomes）。 */
export const MAX_NODE_ITEMS = 50
/** `WorkspaceSpec.notes` 的上限。 */
export const MAX_SPEC_NOTES = 10
/** consent 需要"一条提案一个节点"，故另有节点数上限（避免一份社群状态吃掉整个画布）。 */
export const MAX_CONSENT_NODES = 12

/** 契约字段长度上限（`schema.ts` 的 identifier / shortText / longText）。 */
const MAX_LEN = { id: 64, short: 200, long: 500 } as const

function clip(raw: string, max: number): { value: string; clipped: boolean } {
  return raw.length <= max ? { value: raw, clipped: false } : { value: raw.slice(0, max), clipped: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 输入侧：**宽松**对象（服务端新增字段不该让整块失效），但读到的字段必须合法
// ─────────────────────────────────────────────────────────────────────────────
//
// 为什么不 `strictObject`：这是别人（服务端 DTO）的下发形状，加一个字段就
// 把整块渲染打断，代价远大于收益。但**我们真正读取的字段**一律严格 ——
// 类型不对就是类型不对，不能"当成 undefined 混过去"。

const ProposalLikeSchema = z.looseObject({
  id: z.string().min(1),
  state: z.enum(CONSENT_STATES),
  counterpart: z
    .looseObject({ subject: z.record(z.string(), z.unknown()).optional() })
    .optional(),
})

const JobLikeSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: z.enum(ACTION_JOB_STATUSES),
  attempts: z.number().int().min(0),
  lastError: z.string().nullable().optional(),
})

const OutcomeLikeSchema = z.looseObject({
  id: z.string().min(1),
  summary: z.string().min(1),
  verificationLevel: z.enum(OUTCOME_LEVELS),
  occurredAt: z.string().nullable().optional(),
})

/** 单个装配器的结果：要么给值（并自报有没有截断），要么给**具体**原因。 */
export type Assembly<T> =
  | { ok: true; value: T; clipped: boolean; dropped: number }
  | { ok: false; error: string }

/** 一个数据来源的三种状态。 */
export type Source<T = unknown> =
  | { ok: true; items: readonly T[] }
  | { ok: false; reason: string }

/** 首个 schema 问题拼成可读原因（含路径，便于定位是哪条数据）。 */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue?.path.length ? `字段 ${issue.path.join('.')}` : '顶层形状'
  return `${path} 不符合契约（${issue?.message ?? '未知'}）`
}

// ─────────────────────────────────────────────────────────────────────────────
// consent ← proposals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一条提案 → 一个 `consent` 节点。
 *
 * 为什么是"一提案一节点"：`consent` 的 `status` 是**单值**，而提案才是"双边同意"
 * 这个对象本身。把 N 条提案压成一个状态（例如"取最严重的一条"）会凭空发明一条
 * 产品规则，且会隐瞒其余提案的真实状态。
 */
export function assembleConsentNodes(items: readonly unknown[]): Assembly<ConsentNode[]> {
  const parsed = z.array(ProposalLikeSchema).safeParse(items)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const dropped = Math.max(0, parsed.data.length - MAX_CONSENT_NODES)
  const taken = parsed.data.slice(0, MAX_CONSENT_NODES)

  let clipped = false
  const nodes = taken.map((p) => {
    const idClip = clip(p.id, MAX_LEN.id - 'consent-'.length)
    clipped = clipped || idClip.clipped

    // 披露字段 = 对侧投影里**确实存在**的键（未授权字段的键根本不存在）。
    // 排序是刻意的：同一批数据恒得同一节点（可单测、无抖动）。
    const fieldKeys = [...new Set(Object.keys(p.counterpart?.subject ?? {}))].sort()
    const fields = fieldKeys.slice(0, MAX_NODE_ITEMS).map((k) => {
      const c = clip(k, MAX_LEN.short)
      clipped = clipped || c.clipped
      return c.value
    })
    if (fieldKeys.length > MAX_NODE_ITEMS) clipped = true

    return {
      id: `consent-${idClip.value}`,
      type: 'consent' as const,
      title: `同意状态 · 提案 ${p.id.slice(0, 8)}${p.id.length > 8 ? '…' : ''}`,
      data: { fields, status: p.state },
    }
  })

  return { ok: true, value: nodes, clipped, dropped }
}

// ─────────────────────────────────────────────────────────────────────────────
// action ← workflow jobs
// ─────────────────────────────────────────────────────────────────────────────

export function assembleActionNode(items: readonly unknown[]): Assembly<ActionNode> {
  const parsed = z.array(JobLikeSchema).safeParse(items)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const dropped = Math.max(0, parsed.data.length - MAX_NODE_ITEMS)
  let clipped = false

  const jobs = parsed.data.slice(0, MAX_NODE_ITEMS).map((j) => {
    const id = clip(j.id, MAX_LEN.id)
    const kind = clip(j.kind, MAX_LEN.short)
    clipped = clipped || id.clipped || kind.clipped

    // 契约把 `attempts` 钳在 [0, 1000]。超出即视为异常数据：钳制**并且**上报
    // （上报走 `clipped` → 一条 note），避免"悄悄少算了几次重试"。
    const attempts = Math.min(Math.max(j.attempts, 0), 1000)
    clipped = clipped || attempts !== j.attempts

    let lastError: string | undefined
    if (typeof j.lastError === 'string' && j.lastError.length > 0) {
      const e = clip(j.lastError, MAX_LEN.long)
      clipped = clipped || e.clipped
      lastError = e.value
    }

    return {
      id: id.value,
      kind: kind.value,
      status: j.status,
      attempts,
      ...(lastError !== undefined ? { lastError } : {}),
    }
  })

  return {
    ok: true,
    value: { id: 'action-tenant', type: 'action', title: '执行状态（本社群任务队列）', data: { jobs } },
    clipped,
    dropped,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// outcome ← outcomes
// ─────────────────────────────────────────────────────────────────────────────

export function assembleOutcomeNode(items: readonly unknown[]): Assembly<OutcomeNode> {
  const parsed = z.array(OutcomeLikeSchema).safeParse(items)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const dropped = Math.max(0, parsed.data.length - MAX_NODE_ITEMS)
  let clipped = false

  const outcomes = parsed.data.slice(0, MAX_NODE_ITEMS).map((o) => {
    const id = clip(o.id, MAX_LEN.id)
    const label = clip(o.summary, MAX_LEN.short)
    clipped = clipped || id.clipped || label.clipped

    const occurredAt = typeof o.occurredAt === 'string' && o.occurredAt.length > 0 ? o.occurredAt : undefined

    return {
      id: id.value,
      label: label.value,
      level: o.verificationLevel,
      ...(occurredAt !== undefined ? { occurredAt } : {}),
    }
  })

  return {
    ok: true,
    value: { id: 'outcome-tenant', type: 'outcome', title: '成果与验证档位（本社群）', data: { outcomes } },
    clipped,
    dropped,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// agent ← agents/runs（+ usage 的诚实块）
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 这一个装配器与上面三个有一处结构差别：它需要**两个**来源。
//    `runs` 本身来自 `/api/v1/agents/runs`，而 `provider`（真实模型调用是否开启）
//    来自 `/api/v1/agents/usage`。后者缺席时**不产节点** —— 因为缺了它，
//    "跑了 3 次花 0 分"就无法与"模型免费"区分，而这正是 T09 反复强调的诚实边界。
//    宁可不画这个节点，也不画一个说不出话的节点。

const AgentRunLikeSchema = z.looseObject({
  id: z.string().min(1),
  skill: z.enum(AGENT_SKILLS),
  status: z.enum(AGENT_STATES),
  risk: z.enum(AGENT_RISKS),
  requiresApproval: z.boolean(),
  goal: z.string().min(1),
  costMicroCents: z.number().int().min(0),
  callCount: z.number().int().min(0),
})

/** Agent 诚实块（与 `/agents/usage` 的 `provider` 同形状）。 */
export interface AgentProviderHonesty {
  realCallsEnabled: boolean
  reason: string
}

export function assembleAgentNode(
  items: readonly unknown[],
  provider: AgentProviderHonesty | null,
): Assembly<AgentNode> {
  if (!provider) {
    return {
      ok: false,
      error:
        '缺少 provider 诚实块（GET /api/v1/agents/usage 未取到）—— ' +
        '不产 agent 节点，因为无法说明"是否真的调用了模型"',
    }
  }

  const parsed = z.array(AgentRunLikeSchema).safeParse(items)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const dropped = Math.max(0, parsed.data.length - MAX_NODE_ITEMS)
  let clipped = false

  const providerReason = clip(provider.reason, MAX_LEN.short)
  clipped = clipped || providerReason.clipped

  const runs = parsed.data.slice(0, MAX_NODE_ITEMS).map((r) => {
    const id = clip(r.id, MAX_LEN.id)
    const goal = clip(r.goal, MAX_LEN.long)
    clipped = clipped || id.clipped || goal.clipped
    return {
      id: id.value,
      skill: r.skill,
      status: r.status,
      risk: r.risk,
      requiresApproval: r.requiresApproval,
      goal: goal.value,
      costMicroCents: r.costMicroCents,
      callCount: r.callCount,
    }
  })

  return {
    ok: true,
    value: {
      id: 'agent-tenant',
      type: 'agent',
      title: 'Agent 运行（本社群）',
      data: {
        runs: runs,
        provider: { realCallsEnabled: provider.realCallsEnabled, reason: providerReason.value },
      },
    },
    clipped,
    dropped,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 汇总装配
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantSources {
  /** 省略（`undefined`）= 本次刻意不取该来源：既不产节点也不产 note。 */
  proposals?: Source
  jobs?: Source
  outcomes?: Source
  /** Agent 运行列表（`/api/v1/agents/runs`）。 */
  agents?: Source
  /**
   * Agent 诚实块（`/api/v1/agents/usage` 的 `provider`）。
   * `null` / 省略 → agent 节点**不产出**（原因见上方 agent 段的注释）。
   */
  agentsProvider?: AgentProviderHonesty | null
}

export interface TenantAssembly {
  /** 只包含**来源成功**时产出的节点。 */
  nodes: WorkspaceNode[]
  /** 面向用户的说明：来源不可用 / 载荷不认识 / 发生截断。 */
  notes: string[]
}

/** 把"来源 + 装配结果"折进 notes 与 nodes（每个来源一条 note 上限，避免刷屏）。 */
function fold<T extends WorkspaceNode>(
  out: TenantAssembly,
  label: string,
  source: Source | undefined,
  run: (items: readonly unknown[]) => Assembly<T | T[]>,
): void {
  if (!source) return
  if (!source.ok) {
    out.notes.push(`${label}：未展示（${source.reason}）—— 不展示，也不展示成"空"。`)
    return
  }

  const result = run(source.items)
  if (!result.ok) {
    out.notes.push(`${label}：服务端载荷无法装配（${result.error}）—— 已阻止该节点，而非部分展示。`)
    return
  }

  const value = result.value
  const nodes = Array.isArray(value) ? value : [value]

  if (nodes.length === 0) {
    // 「查询成功但确实没有」也是一种**结论**，不该以"画布上什么都没有"呈现 ——
    // 那与"读不到 / 没权限"看起来一模一样。所以给一条明确的说明。
    out.notes.push(`${label}：查询成功，当前没有可展示的数据（不是"读不到"）。`)
    return
  }

  for (const n of nodes) out.nodes.push(n as WorkspaceNode)

  if (result.dropped > 0) out.notes.push(`${label}：服务端返回 ${source.items.length} 条，画布只展示前 ${source.items.length - result.dropped} 条。`)
  if (result.clipped) out.notes.push(`${label}：有字段超出展示长度上限，已按上限截断显示。`)
}

/**
 * 由四个真实来源装配出社群节点。
 *
 * 顺序即画布的生命周期顺序：同意 → 执行 → 成果 → Agent（P2 新增，排在最后：
 * Agent 产出的是"下一步建议"，不是已经发生的事）。
 */
export function assembleTenantNodes(sources: TenantSources): TenantAssembly {
  const out: TenantAssembly = { nodes: [], notes: [] }
  fold(out, '同意状态', sources.proposals, assembleConsentNodes)
  fold(out, '执行状态', sources.jobs, assembleActionNode)
  fold(out, '成果记录', sources.outcomes, assembleOutcomeNode)
  fold(out, 'Agent 运行', sources.agents, (items) =>
    assembleAgentNode(items, sources.agentsProvider ?? null),
  )
  return out
}

export type MergeResult = { ok: true; spec: WorkspaceSpec } | { ok: false; reason: string }

/**
 * 把社群节点并进编译出的 spec，并**再跑一次契约校验**。
 *
 * 之所以要再校验：合并是本模块唯一会"改 spec"的地方，而契约是最终执法点。
 * 校验失败 → 整块拒绝（返回原因），而不是渲染一个半成品画布。
 */
export function mergeTenantNodes(spec: WorkspaceSpec, assembly: TenantAssembly): MergeResult {
  const used = new Set(spec.nodes.map((n) => n.id))
  const fresh = assembly.nodes.filter((n) => !used.has(n.id))
  const room = Math.max(0, MAX_SPEC_NODES - spec.nodes.length)
  const taken = fresh.slice(0, room)

  const notes = [...spec.notes, ...assembly.notes]
  if (fresh.length > taken.length) {
    notes.push(`画布节点上限 ${MAX_SPEC_NODES} 个，已省略 ${fresh.length - taken.length} 个社群节点。`)
  }

  // notes 超出契约上限时**显式**说明被省略了多少条，而不是静默切片。
  const finalNotes =
    notes.length <= MAX_SPEC_NOTES
      ? notes
      : [...notes.slice(0, MAX_SPEC_NOTES - 1), `另有 ${notes.length - (MAX_SPEC_NOTES - 1)} 条说明因上限未显示。`]

  const parsed = WorkspaceSpecSchema.safeParse({ ...spec, nodes: [...spec.nodes, ...taken], notes: finalNotes })
  if (!parsed.success) {
    return {
      ok: false,
      reason: `合并社群节点后未通过契约校验：${firstIssue(parsed.error)}。已阻止渲染，避免展示不合规内容。`,
    }
  }
  return { ok: true, spec: parsed.data }
}

// ─────────────────────────────────────────────────────────────────────────────
// 草稿 → 创建 Mission 的请求体（**写路径**的诚实边界）
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 这里暴露了一个真实缺口：`compileWorkspaceSpec` 的产出**不等于**可创建体。
//    服务端 `parseMissionCreate` 要求：
//      goal ≥ 8、offer ≥ 1、successCriteria ≥ 5（三者都必填）
//    而草稿里的 `offer` 是可选的、`successCriteria` 是从文本抽出的数组（常为空）。
//    若"凑一个"默认值发出去，就是在**凭空发明用户没说的对价** ——
//    所以这里**不补默认值**，而是把缺什么原样报出来，由调用方禁用按钮并说明。

/** 与服务端 `LIMITS`（`src/lib/connection/mission-input.ts`）同源的下限。 */
export const MISSION_MIN = { goal: 8, offer: 1, successCriteria: 5 } as const

export interface MissionCreateBody {
  goal: string
  offer: string
  successCriteria: string
  constraints: string[]
  expiresAt?: string
}

export interface MissionDraft {
  /** 缺字段时恒为 `null` —— **不产**半成品请求体。 */
  body: MissionCreateBody | null
  /** 面向用户的缺口说明（空数组 = 可以创建）。 */
  missing: string[]
}

/** 从 spec 里取出创建 Mission 所需字段，并**如实**报出缺口。 */
export function missionDraftFromSpec(spec: WorkspaceSpec): MissionDraft {
  const intent = spec.nodes.find((n) => n.type === 'intent')
  if (!intent || intent.type !== 'intent') {
    return { body: null, missing: ['意图节点（当前工作区没有可创建的目标）'] }
  }

  const goal = intent.data.goal.trim()
  const offer = (intent.data.offer ?? '').trim()
  const successCriteria = intent.data.successCriteria.join('；').trim()

  const missing: string[] = []
  if (goal.length < MISSION_MIN.goal) missing.push(`目标描述（至少 ${MISSION_MIN.goal} 个字符）`)
  if (offer.length < MISSION_MIN.offer) missing.push('「可提供的对价」—— 描述里没写，创建任务需要它')
  if (successCriteria.length < MISSION_MIN.successCriteria) missing.push('可量化的成功判据 —— 描述里没给')

  if (missing.length > 0) return { body: null, missing }

  return {
    body: {
      goal,
      offer,
      successCriteria,
      constraints: intent.data.constraints,
      ...(intent.data.expiresAt ? { expiresAt: intent.data.expiresAt } : {}),
    },
    missing: [],
  }
}
