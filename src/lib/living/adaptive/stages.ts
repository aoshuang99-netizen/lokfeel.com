/**
 * Adaptive Dual World —— 阶段条的状态推导（纯函数，无 React、无 IO）
 *
 * 设计依据：`docs/v16/design/C_CONCEPT.md`「布局随 Mission 阶段变形」。
 *
 * 🔴 这里**不新建状态机**。四个阶段直接映射**现有**流水线（与
 *    `stage-machine.ts` 的 PROPOSED → CONSENT_PENDING → INTRODUCED →
 *    COORDINATING → ACTION_COMPLETED → OUTCOME_RECORDED 同一条链），
 *    每个阶段的数字都来自已经在用的三个真实端点：
 *      · 提案 / 同意 ← `GET /api/v1/connections/proposals`（ConsentProposalRow）
 *      · 执行        ← `GET /api/v1/agents/runs`（LivingAgentRunRow）
 *      · 成果        ← `GET /api/v1/outcomes/timeline`（ObservatoryTimeline.counts）
 *
 * 数据没就绪时 `count` 必须是 `null`（渲染成「—」），**不是 0**：
 * 0 是「真的没有」，null 是「读不到」—— 把两者混为一谈就是虚报。
 */

import type { ConsentProposalState } from '@/lib/living/consent/types'
import type { LivingAgentStatus } from '@/lib/living/agents/types'

/** 阶段键 —— 与现有流水线同名，不引入第二套词汇。 */
export const OS_STAGE_KEYS = ['proposal', 'consent', 'execution', 'outcome'] as const
export type OsStageKey = (typeof OS_STAGE_KEYS)[number]

export interface OsStageProposal {
  state: ConsentProposalState
  canIntroduce: boolean
}

export interface OsStageRun {
  status: LivingAgentStatus
  requiresApproval: boolean
}

/** 四个阶段各自的原始输入。`null` = 该端点还没读回来（不区分 loading / error）。 */
export interface OsStageInputs {
  proposals: readonly OsStageProposal[] | null
  runs: readonly OsStageRun[] | null
  outcomes: { total: number; unverified: number } | null
  /** 是否已经编译出可执行的 WorkspaceSpec（纯前端状态，不是服务端状态）。 */
  specReady: boolean
}

export interface OsStage {
  key: OsStageKey
  label: string
  /** 一句话说明这一阶段在等谁。 */
  hint: string
  /** 点击后聚焦到哪一屏（`NAV` 的 key）。 */
  view: string
  /** 真实计数；`null` = 该阶段的数据没读回来，不能显示成 0。 */
  count: number | null
  /** 是否**有待处理项**（可能是等我，也可能是等对方 —— 看 `hint`）。 */
  attention: boolean
  /** 计数口径（hover 与 aria-describedby 都读它，避免"这个 3 是什么"）。 */
  countHint: string
  /** 该阶段的数据是否已读回来（`ready=false` 与 `count=0` 是两件事）。 */
  ready: boolean
}

const STAGE_META: readonly {
  key: OsStageKey
  label: string
  hint: string
  view: string
  countHint: string
}[] = [
  {
    key: 'proposal',
    label: '提案',
    hint: '谁想认识谁、为什么 —— 提案尚未双方表态。',
    view: 'consent',
    countHint: '等待双方表态的提案数（/api/v1/connections/proposals · CONSENT_PENDING）',
  },
  {
    key: 'consent',
    label: '同意',
    hint: '双方已同意，等我决定是否正式介绍。',
    view: 'consent',
    countHint: '双方已同意、尚未介绍的提案数（MUTUALLY_ACCEPTED）',
  },
  {
    key: 'execution',
    label: '执行',
    hint: 'Agent 已产出方案，等我批准后才可能执行。',
    view: 'agents',
    countHint: '等待人工批准或已批准待执行的运行数（AWAITING_APPROVAL / APPROVED）',
  },
  {
    key: 'outcome',
    label: '成果',
    hint: '行动结果已记录，等对手方确认或外部核验。',
    view: 'outcomes',
    countHint: '未核验的成果条目数（/api/v1/outcomes/timeline · counts.unverified）',
  },
]

/**
 * 把三个端点的原始行折成四段阶段条。
 *
 * 纯函数：同样的输入必得同样的输出 —— 因此可以直接写单测，
 * 也保证「同一个数字不会因为渲染顺序不同而变化」。
 */
export function buildOsStages(inputs: OsStageInputs): OsStage[] {
  const { proposals, runs, outcomes, specReady } = inputs

  const pending = proposals === null ? null : proposals.filter((p) => p.state === 'CONSENT_PENDING').length
  const accepted = proposals === null ? null : proposals.filter((p) => p.state === 'MUTUALLY_ACCEPTED').length
  const toIntroduce = proposals === null ? null : proposals.filter((p) => p.canIntroduce).length

  const toApprove =
    runs === null
      ? null
      : runs.filter((r) => r.status === 'AWAITING_APPROVAL' || (r.requiresApproval && r.status === 'APPROVED'))
          .length
  const unverified = outcomes === null ? null : outcomes.unverified

  const counts: Record<OsStageKey, number | null> = {
    proposal: pending,
    consent: accepted,
    execution: toApprove,
    outcome: unverified,
  }

  const attention: Record<OsStageKey, boolean> = {
    // 有提案待表态 = 这一段还有事没结（不一定在等我 —— 也可能在等对手方）。
    proposal: pending !== null && pending > 0,
    // canIntroduce 由服务端算好：这一段确实在等我点"介绍"。
    consent: toIntroduce !== null && toIntroduce > 0,
    execution: toApprove !== null && toApprove > 0,
    outcome: unverified !== null && unverified > 0,
  }

  const ready: Record<OsStageKey, boolean> = {
    // 提案段「有数据」就算就绪（读到了空数组也是就绪）。
    proposal: pending !== null,
    consent: accepted !== null,
    execution: toApprove !== null,
    // 成果段：读过 timeline 就算就绪。
    outcome: outcomes !== null,
  }

  return STAGE_META.map((meta) => ({
    key: meta.key,
    label: meta.label,
    hint: meta.key === 'proposal' && !specReady ? `${meta.hint}（当前还没有编译出工作区）` : meta.hint,
    view: meta.view,
    count: counts[meta.key],
    attention: attention[meta.key],
    countHint: counts[meta.key] === null ? `${meta.countHint} —— 该端点尚未返回，因此不显示数字` : meta.countHint,
    ready: ready[meta.key],
  }))
}

/**
 * 当前应聚焦的阶段：
 *   1. 有任何一个阶段在等我 → 第一个待办阶段（这就是"自适应"的驱动源）；
 *   2. 否则 → 最后一个已就绪阶段（说明走到哪了）；
 *   3. 都还没就绪 → null（界面显示"尚未开始"，不编一个起点）。
 */
export function focusStage(stages: readonly OsStage[]): OsStageKey | null {
  const waiting = stages.find((s) => s.attention)
  if (waiting) return waiting.key
  const settled = [...stages].reverse().find((s) => s.ready)
  return settled ? settled.key : null
}

/** 供阶段条文案用：把「在等我」与「等对方」分开的说法。 */
export function stageStatusLabel(stage: OsStage, isFocused: boolean): string {
  if (!stage.ready) return '未就绪'
  if (stage.attention) return isFocused ? '在等你' : '待处理'
  if (stage.count === null) return '未就绪'
  return stage.count === 0 ? '无待办' : `${stage.count} 项`
}
