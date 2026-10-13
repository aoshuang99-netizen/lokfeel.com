/**
 * T09 · Agent Runtime —— 人工批准状态机（**纯函数 + 真相表**）
 *
 * 🔴 这是 AC-08「Prompt 注入**不能绕过审批**」的结构性保证。
 *
 * 关键在于**边不存在**，而不是"提示词里写了不许"：
 *   - `AWAITING_APPROVAL` → `EXECUTED` 这条边**不存在**；
 *   - 于是无论模型说什么，执行都绕不过一次真实的 `approve` 调用。
 *
 * 写法沿用 T04/T08 立下的纪律：
 *   ① 先写**真相表**（把最关键那几格显式写出，而不是靠读 `if` 反推）；
 *   ② 加**次序不变量**断言；③ 配**变异自证**（把边改错必须变红）。
 */

import { AGENT_RUN_STATUSES, type AgentRunStatus } from './types'

/**
 * 迁移真相表（`from → 允许到达的 to`）。
 *
 * 显式写出**关键否定**（用注释标出），因为"少写一条边"和"写错"在代码里长得一样，
 * 而两者的后果完全不同：少写 = 功能不可用（会被发现），多写 = 审批被绕过（静默）。
 */
export const APPROVAL_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  // 非高风险技能：PROPOSED 可直接 EXECUTED（**它本来就不需要批准**）。
  // 🔴 但 PROPOSED → APPROVED 是禁止的：没有任何东西处于"待批"。
  PROPOSED: ['EXECUTED', 'AWAITING_APPROVAL', 'FAILED', 'BLOCKED_QUOTA'],
  // 🔴 这里**没有** EXECUTED —— 这就是"注入不能绕过审批"。
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'FAILED', 'BLOCKED_QUOTA'],
  APPROVED: ['EXECUTED', 'FAILED', 'BLOCKED_QUOTA'],
  REJECTED: [],
  EXECUTED: [],
  // 降级结果同样是"提案"，仍要走批准（降级**不能**降低门槛）。
  DEGRADED: ['EXECUTED', 'AWAITING_APPROVAL', 'REJECTED', 'FAILED', 'BLOCKED_QUOTA'],
  BLOCKED_QUOTA: [],
  FAILED: [],
}

export function nextStatuses(from: AgentRunStatus): readonly AgentRunStatus[] {
  return APPROVAL_TRANSITIONS[from] ?? []
}

export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return nextStatuses(from).includes(to)
}

/**
 * 是否允许执行副作用。
 *
 * 这是**唯一**的执行放行判据（`runtime.ts` 与未来的 API 层都必须调它）：
 *   - `requiresApproval: true` → 只能从 `APPROVED` 执行；
 *   - `requiresApproval: false` → 只能从 `PROPOSED` / `DEGRADED` 执行。
 */
export function canExecute(status: AgentRunStatus, requiresApproval: boolean): boolean {
  if (!canTransition(status, 'EXECUTED')) return false
  return requiresApproval ? status === 'APPROVED' : status === 'PROPOSED' || status === 'DEGRADED'
}

/** 终态（不再接受任何迁移）。 */
export const TERMINAL_STATUSES: readonly AgentRunStatus[] = AGENT_RUN_STATUSES.filter(
  (s) => APPROVAL_TRANSITIONS[s].length === 0,
)

export class AgentTransitionError extends Error {
  constructor(
    readonly from: AgentRunStatus,
    readonly to: AgentRunStatus,
    message?: string,
  ) {
    super(message ?? `非法的 Agent 状态迁移：${from} → ${to}`)
    this.name = 'AgentTransitionError'
  }
}

/**
 * 迁移并校验。**必须在写入任何副作用之前调用** —— 抛错即代表"这一步不该发生"。
 */
export function assertTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!canTransition(from, to)) {
    throw new AgentTransitionError(from, to)
  }
}

/** 执行前校验（把"需要批准"这件事也纳入判据，而不只看状态名）。 */
export function assertExecutable(from: AgentRunStatus, requiresApproval: boolean): void {
  if (!canExecute(from, requiresApproval)) {
    throw new AgentTransitionError(
      from,
      'EXECUTED',
      requiresApproval
        ? `状态 ${from} 不允许执行：该动作需要人工批准（必须为 APPROVED）。`
        : `状态 ${from} 不允许执行。`,
    )
  }
}

/** 某个状态是否"已终结"，用于 UI 判断还能不能操作。 */
export function isTerminal(status: AgentRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
