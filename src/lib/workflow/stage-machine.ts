/**
 * T06 · 介绍工作流阶段状态机（**纯函数，无 IO**）
 *
 * AC-14 要求端到端链路：创建 → 提案 → 双向同意 → 介绍 → 跟进 → 结果。
 * 本文件定义"现在走到哪一步"，以及"来一个事件之后应该到哪一步"。
 *
 * 与 `ConnectionProposalStatus`（T05）的关系 —— **不合并**：
 *   - 后者是**授权**状态机：谁同意了、谁拒绝了。介绍落地后它就冻结了。
 *   - 本文件是**流程**状态机：事情推进到哪里了。介绍之后还有协调、完成、记成果。
 * 一次授权可能对应多次流程推进，因此两者是正交的两个维度。
 *
 * **唯一不变式：阶段只前进，不回退。**
 *   这条不变式让"重复事件"天然幂等 —— 重放一个 `INTRODUCED` 事件不会把
 *   已经到 `COORDINATING` 的流程打回去。AC-17 的"无重复动作"在流程层面的落点。
 */

export type WorkflowStage =
  | 'PROPOSED' // 提案已创建，等待表态
  | 'CONSENT_PENDING' // 至少一方已表态但未双方同意
  | 'INTRODUCED' // 介绍已落地
  | 'COORDINATING' // 双方正在协调
  | 'ACTION_COMPLETED' // 连接行动已完成
  | 'OUTCOME_RECORDED' // 成果已记录（终态）

/** 阶段次序。**数组顺序即语义顺序**，比较用下标。 */
export const STAGE_ORDER: readonly WorkflowStage[] = [
  'PROPOSED',
  'CONSENT_PENDING',
  'INTRODUCED',
  'COORDINATING',
  'ACTION_COMPLETED',
  'OUTCOME_RECORDED',
] as const

export function stageIndex(stage: WorkflowStage): number {
  const i = STAGE_ORDER.indexOf(stage)
  // unknown → -1 会让比较静默错位，故收敛为 0（最保守的起点）并靠类型保证不走到这。
  return i < 0 ? 0 : i
}

export function isStageAdvance(from: WorkflowStage, to: WorkflowStage): boolean {
  return stageIndex(to) > stageIndex(from)
}

/** 终态：到达后不再接受任何推进事件。 */
export function isTerminalStage(stage: WorkflowStage): boolean {
  return stage === 'OUTCOME_RECORDED'
}

/** 人类可读的阶段名（用于运营视图）。 */
export const STAGE_LABELS: Record<WorkflowStage, string> = {
  PROPOSED: '已发起提案',
  CONSENT_PENDING: '等待双方同意',
  INTRODUCED: '已介绍',
  COORDINATING: '协调中',
  ACTION_COMPLETED: '行动已完成',
  OUTCOME_RECORDED: '成果已记录',
}

/**
 * 流程事件。注意与 `WorkflowJobKind` **不是一回事**：
 *   - `WorkflowJobKind` 是"要执行一个副作用"（发通知、跑介绍）；
 *   - `WorkflowEvent` 是"业务上发生了一件事"（可来自人，也可来自任务成功）。
 * 一个事件可能由多个任务促成，一个任务成功也可能不产生任何阶段推进。
 */
export type WorkflowEvent =
  | 'MUTUALLY_ACCEPTED' // 双方同意的瞬间（T05 的 MUTUALLY_ACCEPTED）
  | 'CONSENT_RECORDED' // 单方表态（仍待对方）
  | 'INTRODUCED' // 介绍落地（introducedAt 已写）
  | 'COORDINATION_STARTED' // 双方开始协调
  | 'ACTION_COMPLETED'
  | 'OUTCOME_RECORDED'

/**
 * 计算事件之后的阶段。
 *
 * 三条规则：
 *   1. **不倒退**：算出的目标若不在当前之后，保持当前（幂等）。
 *   2. **单方表态不停在 PROPOSED**：只要有表态就进 `CONSENT_PENDING`，
 *      让运营一眼看出"有人在等对方"，而不是"没人理"。
 *   3. `INTRODUCED` 之后不会退回 —— 介绍是已完成的事实（T05 R6 同一条取向）。
 */
export function applyEvent(current: WorkflowStage, event: WorkflowEvent): WorkflowStage {
  if (isTerminalStage(current)) return current

  const target: WorkflowStage = (() => {
    switch (event) {
      case 'CONSENT_RECORDED':
        return 'CONSENT_PENDING'
      case 'MUTUALLY_ACCEPTED':
        return 'CONSENT_PENDING'
      case 'INTRODUCED':
        return 'INTRODUCED'
      case 'COORDINATION_STARTED':
        return 'COORDINATING'
      case 'ACTION_COMPLETED':
        return 'ACTION_COMPLETED'
      case 'OUTCOME_RECORDED':
        return 'OUTCOME_RECORDED'
    }
  })()

  return isStageAdvance(current, target) ? target : current
}

/** 时间线条目（追加式；与 `ProposalDecision` 的"当前表态"取向相反 —— 流程需要可复盘）。 */
export interface TimelineEntry {
  stage: WorkflowStage
  /** ISO 时间串（落库为 JSON 文本，避免 Date 序列化歧义）。 */
  at: string
  /** 触发者 userId；系统触发为 null。 */
  by: string | null
  reason: string
}

/**
 * 追加时间线条目。
 *
 * ⚠️ **只有阶段真的发生变化时才追加**。否则"重复投递成功"会在时间线上堆出一串
 * 同一个阶段的条目，让复盘时看不出到底推进了几步（`applyEvent` 的幂等性
 * 已经保证阶段不变，这里是同一件事在留痕层的落点）。
 */
export function appendTimeline(
  existing: readonly TimelineEntry[] | null | undefined,
  entry: TimelineEntry
): TimelineEntry[] {
  const list = existing ? [...existing] : []
  const last = list[list.length - 1]
  if (last && last.stage === entry.stage) return list
  list.push(entry)
  return list
}
