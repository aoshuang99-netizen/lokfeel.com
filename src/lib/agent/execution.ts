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
 * ── 两道门的分工（Slice 6 起）──────────────────────────────────────────
 *   ① `planExecution()`          ：**动作**能不能发生（技能有执行器 / 状态机 / 真实裁决）
 *   ② `planOutboundDelivery()`   ：**送到目标**这一步能不能发生（目标身份 / 披露依据）
 *   两者都是纯函数、都只在放行方向做加法（② 只会让 ① 的放行**更严**），
 *   且都**不查库** —— 读数由服务层取好传进来。合成一个函数会让"网络/披露/权限"
 *   三类完全不同的失败被压成同一个现象，出问题时说不清该修哪一侧。
 *
 * ── Slice 6 的效果（对外送达）──────────────────────────────────────────
 *   `INTRO_DRAFT` 的执行计划从 `recipient: 'REQUESTER'` 改为 `'TARGET'`：
 *   产出以站内信送达**对手方**（创建时就固定、并被那次批准覆盖的那个身份）。
 *   🔴 送达的**通知体里没有任何档案字段** —— 这是 T06 立下的纪律
 *      （`notification-content.ts` 的文件头：通知只是"有事在等你"，
 *      披露的唯一出口是页面上的 `discloseSubject()` 投影）。
 *      因此 ② 守的不是"通知体里有没有敏感词"，而是**送达这件事本身的前提**：
 *      创建时存在对该受众非空的披露授权，且**执行时这份授权仍然覆盖创建时快照的那批字段**
 *      —— 即 T05「撤销即刻生效」在投递侧的落点。授权被撤销/收窄后仍以发起人的名义
 *      去敲门，等于用一次已失效的授权替人代言。
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
 * 执行渠道。**当前只有 `IN_APP`**。
 *
 * 为什么不做 `EMAIL`：邮件要外部凭据（`RESEND_API_KEY`），且"发到对方邮箱"属**对外送达** ——
 * 与上面的诚实边界同一件事。渠道是闭集且与 `NotificationChannel` 的取值对齐
 * （`IN_APP` / `EMAIL`），将来加 `EMAIL` 时这里与 Prisma 枚举一起改。
 */
export const EXECUTION_CHANNELS = ['IN_APP'] as const
export type ExecutionChannel = (typeof EXECUTION_CHANNELS)[number]

/**
 * 收件人的**类别**（不是 id）。
 *
 * 🔴 这是一个**闭集**，而不是一个"收件人字段"：
 *    `'REQUESTER'` = 发起人本人（内部回执，不涉及任何对外动作）；
 *    `'TARGET'`    = 创建时就固定下来的对手方（`AgentDeliveryTarget` 那一行）。
 *    两者都不是"调用方在执行时传进来的地址" —— 那会让"执行"退化成
 *    "把已批准的产出送到任意地址"，而那次批准覆盖的**不是**那个地址。
 *    ⇒ 收件人能不能由请求体指定，是一个**类型级**的决定，不是运行期的校验。
 */
export const EXECUTION_RECIPIENTS = ['REQUESTER', 'TARGET'] as const
export type ExecutionRecipient = (typeof EXECUTION_RECIPIENTS)[number]

export interface ExecutionPlan {
  skill: SkillKey
  kind: ExecutionKind
  channel: ExecutionChannel
  /**
   * 收件人**类别**（`EXECUTION_RECIPIENTS` 之一）。具体是谁由服务端决定：
   *   - `'REQUESTER'` → `AgentRun.requestedBy`
   *   - `'TARGET'`    → `AgentDeliveryTarget.targetUserId`（**创建时**落库，与运行同行）
   * 调用方在任何一步都不能指定"发给谁"。
   */
  recipient: ExecutionRecipient
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
    recipient: 'TARGET',
    description:
      '把已人工批准的介绍草稿送达创建时就固定的对手方（站内信）；通知体不含任何档案字段，档案内容仍只在连接页经披露投影展示。',
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

/**
 * **对外送达**被拒的原因码（第二道门，只对 `recipient === 'TARGET'` 的计划适用）。
 *
 * 与 `EXECUTION_REFUSAL_CODES` 分开列：前者是"这条运行能不能跑"，
 * 后者是"跑完之后这一步能不能送到目标"。混成一个闭集会让 DTO/UI 无法
 * 区分"还要等批准"与"授权已经撤回，需要重新发起" —— 那是两种不同的处置动作。
 */
export const OUTBOUND_REFUSAL_CODES = [
  /** 计划要求送达对手方，但这条运行**没有**目标身份（创建时没定，执行时也不补）。 */
  'NO_TARGET',
  /** 没有任何对该受众生效的披露授权（从未授权 / 已被撤销 / 已过期）—— 没有可送达的介绍内容。 */
  'DISCLOSURE_EMPTY',
  /** 授权仍在，但**已被收窄**：创建时快照里的字段不再全部可见。需要重新走一次创建与批准。 */
  'DISCLOSURE_NARROWED',
] as const
export type OutboundRefusalCode = (typeof OUTBOUND_REFUSAL_CODES)[number]

/** DTO 的 `execution.code` 取值域 = 两道门的并集（对外形状只有一个字段，故必须合并）。 */
export const EXECUTION_GATE_CODES = [
  ...EXECUTION_REFUSAL_CODES,
  ...OUTBOUND_REFUSAL_CODES,
] as const
export type ExecutionGateCode = (typeof EXECUTION_GATE_CODES)[number]

export type ExecutionDecision =
  | { executable: true; plan: ExecutionPlan }
  | { executable: false; code: ExecutionRefusalCode; reason: string }

export type OutboundDeliveryDecision =
  | { deliverable: true }
  | { deliverable: false; code: OutboundRefusalCode; reason: string }

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

/**
 * 第二道门：**这一步能不能送到目标**。
 *
 * 🔴 三个入参的性质：
 *   - `recipient`            ：来自执行计划（闭集，编译期就定死）；
 *   - `targetUserId`         ：**创建时**落库的对手方身份（`AgentDeliveryTarget`），不是调用方给的；
 *   - `authorizedFieldKeys`  ：**创建那一刻** T05 的读数（快照，落库）；
 *   - `visibleFieldKeys`     ：**执行这一刻** T05 的读数（实时）。
 *   后两个都由服务层取（要查库），内核只做比较 —— 于是"撤销即刻生效"这条规则
 *   在投递侧有一个**可离线穷举**的判据，而不是埋在 executor 的一个 if 里。
 *
 * ⚠️ `recipient === 'REQUESTER'` 时**恒**放行：内部回执不涉及任何对外动作，
 *    给它加披露闸门只会制造一个永远为真的条件（那是装饰，不是判据）。
 */
export function planOutboundDelivery(input: {
  recipient: ExecutionRecipient
  targetUserId: string | null
  /** 创建时快照的、对该受众可见的字段键（T05 `fieldsVisibleTo()` 的读数）。 */
  authorizedFieldKeys: readonly string[]
  /** 执行时**当前**对该受众可见的字段键（T05 的实时读数）。 */
  visibleFieldKeys: readonly string[]
}): OutboundDeliveryDecision {
  if (input.recipient === 'REQUESTER') return { deliverable: true }

  if (!input.targetUserId) {
    return {
      deliverable: false,
      code: 'NO_TARGET',
      reason:
        '这条运行计划送给对手方，但没有目标身份 —— 收件人必须在创建时由服务端固定（执行时不补，否则批准覆盖的就不是真正收到东西的那个人）。',
    }
  }

  if (input.authorizedFieldKeys.length === 0) {
    return {
      deliverable: false,
      code: 'DISCLOSURE_EMPTY',
      reason: '创建时对该受众没有任何披露授权 —— 这不是一次介绍，没有任何内容可送达。',
    }
  }

  if (input.visibleFieldKeys.length === 0) {
    return {
      deliverable: false,
      code: 'DISCLOSURE_EMPTY',
      reason:
        '披露授权已归零（意图被撤销或过期）—— 按「撤销即刻生效」，不再以此名义送达；要送达需重新发起一次运行并重新批准。',
    }
  }

  const visible = new Set(input.visibleFieldKeys)
  const narrowed = input.authorizedFieldKeys.filter((k) => !visible.has(k))
  if (narrowed.length > 0) {
    return {
      deliverable: false,
      code: 'DISCLOSURE_NARROWED',
      reason: `披露授权已被收窄：创建时授权的字段中，${narrowed.join('、')} 已不再对目标可见 —— 这次批准所覆盖的材料前提已经变了，需重新发起并重新批准。`,
    }
  }

  return { deliverable: true }
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
 * 传的是 runId（不是"运行 + 时间"）：重试、并发、进程重启都不该让收件人收到第二条回执。
 */
export function agentExecutionDedupeKey(runId: string): string {
  return `agent-exec:${runId}`
}

/**
 * 真相表的**完整性**自检（供门禁与单测调用，不在运行期执行）。
 *
 * 返回"缺执行器"的技能清单。为什么留它：`Record<SkillKey, …>` 的穷举是**编译期**保证，
 * 而"计划里的 kind 确实是 `EXECUTION_KINDS` 之一""recipient 确实是 `EXECUTION_RECIPIENTS` 之一"
 * 这类**取值**约束编译期管不了 —— 那些由单测穷举断言。
 */
export function skillsWithoutExecutionPlan(): SkillKey[] {
  return SKILL_KEYS.filter((k) => EXECUTION_PLANS[k] === null)
}
