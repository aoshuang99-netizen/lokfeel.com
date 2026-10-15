/**
 * T09 · Agent Runtime —— **执行计划**（纯函数 + 真相表）
 *
 * 🔴 这个文件回答一个问题：**「这条运行允许被执行吗？执行会发生什么？」**
 *    并且要求这个答案是**可核对的一处**，而不是散在路由/服务层里的 `if`。
 *
 * 与 `approval.ts` 的分工（两者是**串联**的两道门，不是重复）：
 *   - `approval.ts`      ：状态机 —— "这个**状态**允许迁移到 EXECUTED 吗？"
 *                         （`AWAITING_APPROVAL → EXECUTED` 的**边不存在**，这是 AC-08 的结构性保证）
 *   - `execution.ts`（本文件）：**执行计划** —— "这个**技能**注册了执行器吗？执行的效果是什么？
 *                         渠道是哪个？收件人怎么定？"
 *                         再加一道**纵深防御**：`requiresApproval` 的技能，库里必须**真的**
 *                         有一条 `APPROVED` 裁决（状态是列，列可以被人工改坏；裁决表是只增不改的事件）。
 *
 * ⚠️ 本文件**不含**任何"怎么执行"的代码：发起投递、写库、审计都在服务层
 *    （`src/lib/agents/executor.ts`）。内核只做**判据** —— 这样"能不能执行"可以被离线单测，
 *    而"执行做了什么"必须去服务层读代码/看证据。
 *
 * ── 本切片的效果（`RECEIPT`）：诚实边界 ──────────────────────────────────
 *   本切片落地的执行效果是**内部回执**：经 T06 的统一投递出口
 *   （`deliverNotification()`）给**发起人**发一条站内信。
 *   🔴 它**不是**"把介绍消息发给对手方"。原因不是偷懒，而是**没有收件人身份**：
 *      `AgentRun` 只存 `subjectLabel` / `counterpartLabel` 这类**标签**（刻意的，见 agent.prisma 文件头），
 *      而"把 A 介绍给谁"这件事必须在**创建时**就由服务端确定、并被**那次批准**覆盖 ——
 *      在执行时才由调用方传入收件人，等于允许"批准的是 A、发出去的是 B"。
 *   因此对外送达要等下一片（需要 target 身份 + T05 的 `discloseSubject()` 出口）。
 *   本文件把这个边界写成**类型与判据**，而不是写在注释里祈祷别人看到。
 */

import { canExecute } from './approval'
import { SKILL_KEYS, type SkillKey } from './skills'
import type { AgentRunStatus } from './types'

/**
 * 执行效果的种类。
 *
 * 🔴 **闭集字面量联合**（不是 `string`）：与 Prisma 的 `AgentExecutionKind` 逐字一致，
 *    由 `tests/agents/schema-drift.test.ts` 守着。多一个成员就必须同步枚举，
 *    否则写入会在**运行期**才炸。
 */
export const EXECUTION_KINDS = ['RECEIPT'] as const
export type ExecutionKind = (typeof EXECUTION_KINDS)[number]

/**
 * 执行渠道。**本切片只有 `IN_APP`**。
 *
 * 为什么不做 `EMAIL`：邮件要外部凭据（`RESEND_API_KEY`），且"发到对方邮箱"属**对外送达** ——
 * 与上面的诚实边界同一件事。渠道是闭集且与 `NotificationChannel` 的取值对齐
 * （`IN_APP` / `EMAIL`），将来加 `EMAIL` 时这里与 Prisma 枚举一起改。
 */
export const EXECUTION_CHANNELS = ['IN_APP'] as const
export type ExecutionChannel = (typeof EXECUTION_CHANNELS)[number]

export interface ExecutionPlan {
  skill: SkillKey
  kind: ExecutionKind
  channel: ExecutionChannel
  /**
   * 收件人**由服务端决定**，不接受调用方指定。
   *
   * `'REQUESTER'` = 发起人（`AgentRun.requestedBy`）。为什么是这个形状而不是一个 id：
   * 收件人一旦可以由请求体给出，"执行"就变成了"把已批准的产出送到任意地址"，
   * 而那次批准覆盖的**不是**那个地址 —— 审批会被降级成一个橡皮图章。
   */
  recipient: 'REQUESTER'
  /** 人话说明（会进 DTO 的 `execution.reason` 与审计元数据）。 */
  description: string
}

/**
 * 执行计划真相表（每个技能一条）。
 *
 * 🔴 显式写全 `Record<SkillKey, …>` 而不是"用到的才写"：新增一个技能时，
 *    编译器会**强制**在这里做一次决定（"它有执行器吗"），而不是默认没有执行器、
 *    然后在半年后有人问"为什么这个技能永远执行不了"。
 *
 * ⚠️ `description` 会被 UI **原样渲染**（它就是 DTO 的 `execution.reason`）——
 *    因此**不得**含 markdown 强调标记（`**`），否则界面上显示的是字面星号。
 *    由 `tests/agent/execution.test.ts` 与 `verify:p2:e2e` 两处守着。
 */
export const EXECUTION_PLANS: Readonly<Record<SkillKey, ExecutionPlan | null>> = {
  INTENT_EXTRACTION: {
    skill: 'INTENT_EXTRACTION',
    kind: 'RECEIPT',
    channel: 'IN_APP',
    recipient: 'REQUESTER',
    description:
      '把已确定的结构化产出（WorkspaceSpec）以站内信回执给发起人；不落任何业务数据（落成 Mission 属业务写入，不在本切片）。',
  },
  INTRO_DRAFT: {
    skill: 'INTRO_DRAFT',
    kind: 'RECEIPT',
    channel: 'IN_APP',
    recipient: 'REQUESTER',
    description:
      '把已人工批准的介绍草稿以站内信回执给发起人，供其走后续人工渠道送达；本切片不直接发给对手方（缺 target 身份 + T05 披露出口）。',
  },
  COORDINATION_ADVICE: {
    skill: 'COORDINATION_ADVICE',
    kind: 'RECEIPT',
    channel: 'IN_APP',
    recipient: 'REQUESTER',
    description: '把建议以站内信回执给发起人。',
  },
}

export function executionPlanOf(skill: SkillKey): ExecutionPlan | null {
  return EXECUTION_PLANS[skill]
}

/** 拒绝执行的**可判定**原因码（与自由文本分开：UI 与测试都要能据此分支）。 */
export const EXECUTION_REFUSAL_CODES = [
  /** 该技能没有注册执行器（产出只能留在系统里）。 */
  'NOT_REGISTERED',
  /** 状态机不允许（含"还在待批""已被驳回""已执行过"）。 */
  'STATUS_NOT_EXECUTABLE',
  /** 状态允许，但库里查不到一条 `APPROVED` 裁决 —— 纵深防御的那一道。 */
  'APPROVAL_REQUIRED',
] as const
export type ExecutionRefusalCode = (typeof EXECUTION_REFUSAL_CODES)[number]

export type ExecutionDecision =
  | { executable: true; plan: ExecutionPlan }
  | { executable: false; code: ExecutionRefusalCode; reason: string }

/**
 * 唯一的执行放行判据。
 *
 * ⚠️ 三个入参里有两个是**快照列**（`status` / `requiresApproval`），一个是**事件表**的读数
 * （`hasApprovedDecision`）。故意都传进来而不是在函数里查库 ——
 * 内核**无 IO**（A2），而且"这个函数只做纯判定"这件事本身就是它可被穷举测试的原因。
 */
export function planExecution(input: {
  skill: SkillKey
  status: AgentRunStatus
  requiresApproval: boolean
  /** 库里是否**真的**有一条 `decision = 'APPROVED'` 的裁决行。 */
  hasApprovedDecision: boolean
}): ExecutionDecision {
  const plan = EXECUTION_PLANS[input.skill]
  if (!plan) {
    return {
      executable: false,
      code: 'NOT_REGISTERED',
      reason: `技能 ${input.skill} 尚未注册执行器 —— 它只产出提案，没有任何落地动作。`,
    }
  }

  // ① 状态机（`approval.ts` 的真相表）：唯一判据，不在本文件复制一份。
  if (!canExecute(input.status, input.requiresApproval)) {
    return {
      executable: false,
      code: 'STATUS_NOT_EXECUTABLE',
      reason: refusalReasonFor(input.status, input.requiresApproval),
    }
  }

  // ② 纵深防御：状态说"可以执行了"，但状态是**列**（可被人工改坏 / 迁移脚本写错）。
  //    裁决表是**只增不改**的事件 —— 让它做第二个证人。
  if (input.requiresApproval && !input.hasApprovedDecision) {
    return {
      executable: false,
      code: 'APPROVAL_REQUIRED',
      reason:
        '状态允许执行，但库里查不到一条 APPROVED 裁决 —— 需要人工批准的执行必须有真实的裁决记录（不接受只有状态列）。',
    }
  }

  return { executable: true, plan }
}

/** 把"为什么状态不行"说清楚。措辞按**用户能不能据此行动**来分。 */
function refusalReasonFor(status: AgentRunStatus, requiresApproval: boolean): string {
  if (requiresApproval && status === 'AWAITING_APPROVAL') {
    return '需要人工批准后才能执行（当前状态：AWAITING_APPROVAL）'
  }
  if (status === 'AWAITING_APPROVAL') {
    return '当前状态（AWAITING_APPROVAL）不允许执行'
  }
  if (status === 'REJECTED') return '该运行已被驳回，不会被交付'
  if (status === 'EXECUTED') return '该运行已执行过（执行是终态，不会重复交付）'
  if (status === 'BLOCKED_QUOTA') return '该运行因额度不足未发起模型调用，没有可交付的产出'
  if (status === 'FAILED') return '该运行失败，没有可交付的产出'
  return `当前状态（${status}）不允许执行`
}

/**
 * 执行记录的幂等键。
 *
 * 传给 `deliverNotification()` 作为 `dedupeKey` —— 一次运行**只投递一次**。
 * 传的是 runId（不是"运行 + 时间"）：重试、并发、进程重启都不该让发起人收到第二条回执。
 */
export function agentExecutionDedupeKey(runId: string): string {
  return `agent-exec:${runId}`
}

/**
 * 真相表的**完整性**自检（供门禁与单测调用，不在运行期执行）。
 *
 * 返回"缺执行器"的技能清单。为什么留它：`Record<SkillKey, …>` 的穷举是**编译期**保证，
 * 而"计划里的 kind 确实是 `EXECUTION_KINDS` 之一""recipient 只能是 REQUESTER"
 * 这类**取值**约束编译期管不了 —— 那些由单测穷举断言。
 */
export function skillsWithoutExecutionPlan(): SkillKey[] {
  return SKILL_KEYS.filter((k) => EXECUTION_PLANS[k] === null)
}
