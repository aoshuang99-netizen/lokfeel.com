/**
 * P2 · Agent 区 —— 运行面板与用量装配器（纯函数，零 IO）
 *
 * 数据源：`GET /api/v1/agents/runs`（T09 运行列表，精简形状）
 *         `GET /api/v1/agents/usage`（T09 用量与额度，AC-20 的可核对面）
 *
 * 🔴 六条纪律：
 *
 *   1. **零 IO**。取数在容器组件里，本文件纯映射（可单测、可被 E2E 直接喂载荷）。
 *
 *   2. **状态机不在前端重写**。本区**不**给出 `canApprove` / `canReject` 这类
 *      前端推导的判据 —— 服务端 `decideAgentRun` 才是判据（已有裁决 → 409、
 *      状态不允许 → 409，并给出准确原因）。前端若自己判一遍，就会出现
 *      "按钮被错误禁用"（静默失效）或"按钮可用但必然失败"（误导）。
 *      因此 UI 总是渲染两个动作按钮，并写明"服务端会重新判定"。
 *
 *   3. **`execution.reason` 原样展示**。`available` 由服务端执行计划给出（不再恒 false），
 *      原因文案是"点了批准到底会发生什么"的唯一答案，**不得**被概括成"不可用"。
 *
 *   4. **`provider` 诚实块原样展示**。缺凭据时"跑了 3 次花 0 分"不是"模型免费"，
 *      而是"走的是规则式兜底" —— 这两个读数在界面上必须能区分。
 *
 *   5. **不展示 `rawText`**。它不在 DTO 里（服务端刻意不 select），所以本区
 *      也无从展示。可渲染的只有过了 zod 契约的 `proposal` —— 而 `proposal`
 *      是服务端定义的结构，本区不解读它的业务含义（那是各业务区的职责）。
 *
 *   6. **顺序必须确定**。运行列表按 `createdAt` 降序、同刻按 `id` 升序；
 *      "需要我关注"的档位**不重排**（重排会让"最新一条"的位置漂移），
 *      只打标记。
 */

import { z } from 'zod'
import { formatMicroCents as formatMicroCentsServer } from '@/lib/agent/cost'
import {
  LIVING_AGENT_DECISION_LABELS,
  LIVING_AGENT_ATTENTION_STATUSES,
  LIVING_AGENT_DEGRADE_LABELS,
  LIVING_AGENT_DEGRADE_REASONS,
  LIVING_AGENT_PROVIDER_KINDS,
  LIVING_AGENT_PROVIDER_LABELS,
  LIVING_AGENT_RISK_LABELS,
  LIVING_AGENT_RISK_LEVELS,
  LIVING_AGENT_SKILL_LABELS,
  LIVING_AGENT_SKILL_KEYS,
  LIVING_AGENT_STATUSES,
  LIVING_AGENT_STATUS_HINTS,
  LIVING_AGENT_STATUS_LABELS,
  type LivingAgentBoardModel,
  type LivingAgentDegradeReason,
  type LivingAgentProvider,
  type LivingAgentRisk,
  type LivingAgentRunRow,
  type LivingAgentSkill,
  type LivingAgentStatus,
  type LivingAgentUsageModel,
} from './types'

export type LivingAgentAssembly<T> = { ok: true; value: T } | { ok: false; error: string }

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue?.path.length ? `字段 ${issue.path.join('.')}` : '顶层形状'
  return `${path} 不符合契约（${issue?.message ?? '未知'}）`
}

/**
 * 微分 → 可读金额字符串。
 *
 * 🔴 **不重写格式化算术**：真正的换算直接复用纯内核 `@/lib/agent/cost.formatMicroCents`。
 *    注意是**单数** `@/lib/agent`（零 IO 内核）；复数 `@/lib/agents` 才是有 IO 的服务层，
 *    由门禁 R10 禁止客户端可达代码值导入。
 *
 *    为什么坚持复用而不是镜像一份：金额换算若在前后端各写一遍，就是
 *    "同一笔钱两个字符串" 的漂移起点 —— 而这正是 T08/T09 反复立的口径纪律
 *    （指标可复算、对账必须对得上）。这里没有任何理由再抄一次。
 *
 * ⚠️ 唯一的**本地表述**（不涉及算术）：四舍五入到 4 位小数后为 `0.0000` 时显示 `0 分`。
 *    `|micro| < 50` 恰好等价于"内核会输出 0.0000"（`49 → 0.0000`、`50 → 0.0001`）。
 *    零成本是「规则式兜底」路径下最常见的读数（`provider.kind = 'rules'`），
 *    4 个零只会变成噪音；且界面文案（agent-board 的诚实块「花费 0 分不代表模型免费」）
 *    依赖这个读法。这条分歧由 `tests/living/agents/board.test.ts` 显式钉住 ——
 *    免得日后有人"顺手改成与内核一致"，或反过来把 `0 分` 当 bug 修掉。
 */
export function formatMicroCents(micro: number): string {
  return Math.abs(micro) < 50 ? '0 分' : formatMicroCentsServer(micro)
}

// ═══════════════════════════════════════════════════════════
// 输入侧
// ═══════════════════════════════════════════════════════════

const ApprovalLike = z.looseObject({
  decision: z.enum(['APPROVED', 'REJECTED']),
  actorId: z.string().nullable(),
  deciderRole: z.string(),
  note: z.string().nullable(),
  decidedAt: z.string(),
})

const RunLike = z.looseObject({
  id: z.string().min(1),
  skill: z.enum(LIVING_AGENT_SKILL_KEYS),
  status: z.enum(LIVING_AGENT_STATUSES),
  risk: z.enum(LIVING_AGENT_RISK_LEVELS),
  requiresApproval: z.boolean(),
  requestedBy: z.string(),
  subjectLabel: z.string().nullable(),
  goal: z.string(),
  reason: z.string().nullable(),
  degradeCode: z.enum(LIVING_AGENT_DEGRADE_REASONS).nullable(),
  providerKind: z.enum(LIVING_AGENT_PROVIDER_KINDS),
  injectionFlagged: z.boolean(),
  costMicroCents: z.number(),
  approval: ApprovalLike.nullable(),
  execution: z.looseObject({ available: z.boolean(), reason: z.string() }),
  createdAt: z.string(),
  updatedAt: z.string(),
  callCount: z.number().int().min(0),
})

const RunsPayloadLike = z.looseObject({
  items: z.array(RunLike),
  count: z.number().int().min(0),
  filters: z.looseObject({
    status: z.enum(LIVING_AGENT_STATUSES).nullable(),
    skill: z.enum(LIVING_AGENT_SKILL_KEYS).nullable(),
    limit: z.number().int(),
  }),
})

const ProviderHonestyLike = z.looseObject({
  provider: z.string(),
  realCallsEnabled: z.boolean(),
  reason: z.string(),
})

const PriceLike = z.looseObject({
  inputMicroCentsPerK: z.number(),
  outputMicroCentsPerK: z.number(),
})

const UsageLike = z.looseObject({
  periodKey: z.string(),
  totals: z.looseObject({
    calls: z.number(),
    okCalls: z.number(),
    failedCalls: z.number(),
    highCostCalls: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    microCents: z.number(),
  }),
  bySkill: z.array(
    z.looseObject({ skill: z.string(), calls: z.number(), microCents: z.number() }),
  ),
  runs: z.looseObject({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
  }),
  quota: z.looseObject({
    maxMicroCents: z.number(),
    maxHighCostCalls: z.number(),
    usedMicroCents: z.number(),
    remainingMicroCents: z.number(),
    highCostCalls: z.number(),
  }),
  assumptions: z.looseObject({
    quota: z.string(),
    price: PriceLike,
    period: z.string(),
  }),
  provider: ProviderHonestyLike,
})

// ═══════════════════════════════════════════════════════════
// 运行面板
// ═══════════════════════════════════════════════════════════

export function assembleAgentBoard(payload: unknown): LivingAgentAssembly<LivingAgentBoardModel> {
  const parsed = RunsPayloadLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { items, count, filters } = parsed.data
  const notes: string[] = []

  if (count !== items.length) {
    notes.push(
      `载荷自洽性未通过：服务端称共 ${count} 条，实际下发 ${items.length} 条 —— 本页按实际下发的展示。`,
    )
  }
  if (filters.status !== null || filters.skill !== null) {
    notes.push(
      `本列表是过滤后的结果（${filters.status ? `状态 ${filters.status}` : ''}${filters.skill ? `${filters.status ? ' · ' : ''}技能 ${filters.skill}` : ''}），不代表本社群的全部运行。`,
    )
  }

  const runs: LivingAgentRunRow[] = [...items]
    .sort((a, b) => {
      const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt)
      return (Number.isNaN(diff) ? 0 : diff) || a.id.localeCompare(b.id)
    })
    .map((r) => {
      const status = r.status
      const degrade = r.degradeCode as LivingAgentDegradeReason | null
      return {
        id: r.id,
        skill: r.skill as LivingAgentSkill,
        skillLabel: LIVING_AGENT_SKILL_LABELS[r.skill],
        status,
        statusLabel: LIVING_AGENT_STATUS_LABELS[status],
        statusHint: LIVING_AGENT_STATUS_HINTS[status],
        needsAttention: LIVING_AGENT_ATTENTION_STATUSES.includes(status),
        risk: r.risk as LivingAgentRisk,
        riskLabel: LIVING_AGENT_RISK_LABELS[r.risk],
        requiresApproval: r.requiresApproval,
        requestedBy: r.requestedBy,
        subjectLabel: r.subjectLabel,
        goal: r.goal,
        reason: r.reason,
        degradeCode: degrade,
        degradeLabel: degrade ? LIVING_AGENT_DEGRADE_LABELS[degrade] : null,
        provider: r.providerKind as LivingAgentProvider,
        providerLabel: LIVING_AGENT_PROVIDER_LABELS[r.providerKind],
        injectionFlagged: r.injectionFlagged,
        costMicroCents: r.costMicroCents,
        costLabel: formatMicroCents(r.costMicroCents),
        callCount: r.callCount,
        approval: r.approval
          ? {
              decision: r.approval.decision,
              decisionLabel: LIVING_AGENT_DECISION_LABELS[r.approval.decision],
              deciderRole: r.approval.deciderRole,
              note: r.approval.note,
              decidedAt: r.approval.decidedAt,
            }
          : null,
        // 🔴 原样透传：`available` 与 `reason` 都由服务端给。
        execution: { available: r.execution.available, reason: r.execution.reason },
        createdAt: r.createdAt,
      }
    })

  if (runs.length === 0) {
    notes.push('本次查询成功，当前没有任何 Agent 运行记录（不是"读不到"）。')
  }

  return {
    ok: true,
    value: {
      runs,
      filters: {
        status: filters.status as LivingAgentStatus | null,
        skill: filters.skill as LivingAgentSkill | null,
        limit: filters.limit,
      },
      notes,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 用量与额度
// ═══════════════════════════════════════════════════════════

export function assembleAgentUsage(payload: unknown): LivingAgentAssembly<LivingAgentUsageModel> {
  const parsed = UsageLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const u = parsed.data
  const notes: string[] = []

  // 额度自洽性：used + remaining 应等于 max。不等 → 说出来（可能是额度被并发修改，
  // 也可能是服务端两处各算了一遍）。
  if (u.quota.usedMicroCents + u.quota.remainingMicroCents !== u.quota.maxMicroCents) {
    notes.push(
      `额度自洽性未通过：已用 ${formatMicroCents(u.quota.usedMicroCents)} + 剩余 ${formatMicroCents(u.quota.remainingMicroCents)} ` +
        `≠ 上限 ${formatMicroCents(u.quota.maxMicroCents)}。本页如实展示服务端下发值。`,
    )
  }

  const usedPercent =
    u.quota.maxMicroCents > 0
      ? Math.min(100, Math.round((u.quota.usedMicroCents / u.quota.maxMicroCents) * 100))
      : null

  // 🔴 诚实块：没有真实调用能力时**必须**说明，否则"花 0 分"会被读成"模型免费"。
  if (!u.provider.realCallsEnabled) {
    notes.push(`真实模型调用未启用：${u.provider.reason}`)
  }

  return {
    ok: true,
    value: {
      periodKey: u.periodKey,
      totals: {
        ...u.totals,
        costLabel: formatMicroCents(u.totals.microCents),
      },
      bySkill: [...u.bySkill]
        .sort((a, b) => b.calls - a.calls || a.skill.localeCompare(b.skill))
        .map((s) => ({
          skill: s.skill,
          skillLabel:
            LIVING_AGENT_SKILL_LABELS[s.skill as LivingAgentSkill] ?? s.skill,
          calls: s.calls,
          microCents: s.microCents,
          costLabel: formatMicroCents(s.microCents),
        })),
      runsByStatus: Object.entries(u.runs.byStatus)
        .map(([status, count]) => ({
          status,
          statusLabel:
            LIVING_AGENT_STATUS_LABELS[status as LivingAgentStatus] ?? status,
          count,
        }))
        .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
      quota: {
        maxMicroCents: u.quota.maxMicroCents,
        maxHighCostCalls: u.quota.maxHighCostCalls,
        usedMicroCents: u.quota.usedMicroCents,
        remainingMicroCents: u.quota.remainingMicroCents,
        highCostCalls: u.quota.highCostCalls,
        usedPercent,
        usedLabel: formatMicroCents(u.quota.usedMicroCents),
        maxLabel: formatMicroCents(u.quota.maxMicroCents),
      },
      provider: {
        provider: u.provider.provider,
        realCallsEnabled: u.provider.realCallsEnabled,
        reason: u.provider.reason,
      },
      assumptions: {
        quota: u.assumptions.quota,
        price: `输入 ${formatMicroCents(u.assumptions.price.inputMicroCentsPerK)} / 1K token；输出 ${formatMicroCents(u.assumptions.price.outputMicroCentsPerK)} / 1K token`,
        period: u.assumptions.period,
      },
      notes,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 动作
// ═══════════════════════════════════════════════════════════

export type LivingAgentDecision = 'approve' | 'reject'

/**
 * 裁决请求。
 *
 * 🔴 端点**不执行任何副作用**（没有注册执行器）：批准 = 状态迁移到 `APPROVED`。
 *    可选的 `note` 由**调用方**提供 —— 这里不代用户编造理由。
 */
export function agentDecisionRequest(
  runId: string,
  decision: LivingAgentDecision,
  note?: string,
): { url: string; body: Record<string, string> } {
  const body: Record<string, string> = {}
  if (typeof note === 'string' && note.trim().length > 0) body.note = note.trim()
  return { url: `/api/v1/agents/runs/${encodeURIComponent(runId)}/${decision}`, body }
}
