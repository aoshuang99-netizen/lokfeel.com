/**
 * Living Connection OS · P1 —— `WorkspaceSpec` 契约（唯一执法点）
 *
 * 依据：`docs/implementation/DESIGN/02-plan.md` P1「Intent-to-UI Compiler」，
 *       以及设计基准 §二「**禁止**让模型直接产 HTML/React 代码」。
 *
 * 设计要点（每一条都是可验证的安全属性）：
 *
 *   1. **白名单节点类型**：`NODE_TYPES` 是唯一允许出现在画布上的类型。
 *      `agent` 被**显式排除**（见 `RESERVED_NODE_TYPES`）—— T09 Agent Runtime 交付前
 *      产出 agent 节点就等于"生成虚假结果"（阻断标准 #6/#9）。
 *
 *   2. **严格对象（`z.strictObject`）**：任何未知字段一律**拒绝**，而不是静默丢弃。
 *      这样"模型想塞一个 `dangerouslySetInnerHTML` / `onClick` 字段"会在**校验层**失败，
 *      而不是被渲染层悄悄忽略。安全属性必须由**拒绝**保证，不能靠"渲染层碰巧没用"。
 *
 *   3. **节点数据必须自带依据**：`candidate.rationale` 为 `min(1)` 必填 ——
 *      对应 AC-13「匹配结果必须有来源/解释」，空理由无法通过校验。
 *
 *   4. **权限只是展示提示**：`availableActions[].capability` 仅用于 UI 提示，
 *      真正的授权在服务端路由的 `withTenant(capability)` 里**重新判定**（见
 *      `src/lib/tenancy/guard.ts`）。前端不得因渲染了一个按钮就认为动作合法。
 */

import { z } from 'zod'

// ⚠️ 只引入**类型**（`import type` 零运行时）。用途是对账上面的展示枚举与
//    服务端真实枚举是否逐字一致 —— 见下方「漂移守卫」。把服务层拖进客户端
//    bundle 是不允许的，所以这里绝不引入值。
import type { ProposalState } from '@/lib/connection'
import type { OutcomeVerificationLevel } from '@/lib/outcome'
import type { WorkflowJobStatus } from '@/lib/workflow'

/**
 * 契约版本。
 * 字段语义变更必须升版本，避免旧前端静默误读新 spec。
 *
 * `1.0 → 1.1`（P1 收口）：`consent.status` / `action.jobs[].status` /
 * `outcome.outcomes[].level` 三处取值域从**猜测值**改为**服务端真实枚举的镜像**
 * （见下方「漂移守卫」）。这是一次**语义修正**，不是新增字段 —— 旧前端若按 1.0
 * 的猜测值判断状态，会把这些节点当成非法数据，因此必须升版本。
 */
export const WORKSPACE_SPEC_VERSION = '1.1' as const

/** 可出现在画布上的节点类型（白名单）。 */
export const NODE_TYPES = ['intent', 'candidate', 'consent', 'action', 'outcome'] as const

/**
 * 已保留但**当前禁止产出**的节点类型。
 * `agent` 依赖 T09 Agent Runtime；P1 若产出该类型即为伪造能力。
 */
export const RESERVED_NODE_TYPES = ['agent'] as const

export type NodeType = (typeof NODE_TYPES)[number]
export type ReservedNodeType = (typeof RESERVED_NODE_TYPES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// 🟡 漂移守卫：展示枚举 = 服务端真实枚举的**镜像**
// ─────────────────────────────────────────────────────────────────────────────
//
// P1 首版把这三处枚举**按猜测**写成了展示值：
//   `PENDING/GRANTED/REVOKED` · `PENDING/RUNNING/RETRY/DEAD/DONE` · `…/EVIDENCE_BACKED`
// 而 T05/T06/T08 落地后的真实枚举**三处全不一致**（`RETRY`/`DONE`/`EVIDENCE_BACKED`
// 根本不存在，`REJECTED`/`EXPIRED`/`TAKEN_OVER`/`CANCELLED`/`EXTERNALLY_VERIFIED` 全缺）。
//
// 危险之处不在于"显示得不好看"，而在于**真实数据一到就会被契约拒绝** ——
// `z.strictObject` 会把整块渲染**阻止**。而那时页面上什么都不会报错，
// 只是永远空着：功能看起来在，实际上永远不可能有内容。所以这三处必须逐字对齐。
//
// 做法：镜像 + **编译期双向等价断言**。任一侧新增/删除取值 → `tsc` 立刻失败，
// 而不是等到线上某条数据触发拒绝。为什么不用 `import` 服务端常量：
// 那会把服务层（含 Prisma）拖进客户端 bundle；`import type` 是零运行时的。
//
// 顺带说明为何不"就地复用服务端类型"：展示契约要能**独立演化**（例如未来把
// 三档成果合成"已验证/未验证"两档），但**每次演化都必须是显式的** ——
// 断言会在那一刻提醒你"你正在偏离服务端取值域"，而不是让你悄悄漂走。

/** 提案的对外状态。与 `src/lib/connection` 的 `ProposalState` 逐字一致。 */
export const CONSENT_STATES = [
  'CONSENT_PENDING',
  'MUTUALLY_ACCEPTED',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
] as const
export type ConsentState = (typeof CONSENT_STATES)[number]

/** 工作流任务状态。与 `src/lib/workflow` 的 `WorkflowJobStatus` 逐字一致。 */
export const ACTION_JOB_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEAD',
  'TAKEN_OVER',
  'CANCELLED',
] as const
export type ActionJobStatus = (typeof ACTION_JOB_STATUSES)[number]

/** 成果验证档位。与 `src/lib/outcome` 的 `OutcomeVerificationLevel` 逐字一致。 */
export const OUTCOME_LEVELS = [
  'SELF_REPORTED',
  'COUNTERPARTY_CONFIRMED',
  'EXTERNALLY_VERIFIED',
] as const
export type OutcomeLevel = (typeof OUTCOME_LEVELS)[number]

/** 双向包含才算等价（单向 `extends` 只能抓住"少写了一个取值"）。 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** `AssertTrue<false>` 违反 `T extends true` → **编译失败**。这是守卫的牙齿。 */
type AssertTrue<T extends true> = T

export type _DriftGuardConsent = AssertTrue<Exact<ConsentState, ProposalState>>
export type _DriftGuardActionJob = AssertTrue<Exact<ActionJobStatus, WorkflowJobStatus>>
export type _DriftGuardOutcomeLevel = AssertTrue<Exact<OutcomeLevel, OutcomeVerificationLevel>>

/** 可解析的日期时间（不依赖 zod 的 `datetime()` 变体，避免版本间 API 漂移）。 */
const isoTemporal = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: '必须是可解析的 ISO 日期时间' })

const identifier = z.string().min(1).max(64)
const shortText = z.string().min(1).max(200)
const longText = z.string().min(1).max(500)

/** 所有节点共有的字段。`position` 由前端本地布局决定，**不落库**（见 DESIGN/01 §6-③）。 */
const nodeBase = {
  id: identifier,
  title: shortText,
  /** 本地布局坐标；缺省时由布局算法给定。 */
  position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).optional(),
  /** 用户可折叠；纯展示状态。 */
  collapsed: z.boolean().optional(),
}

/** intent —— 目标与成功判据。数据源：`/api/v1/intents`、`/missions/[id]/intents`。 */
export const IntentNodeSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('intent'),
  data: z.strictObject({
    goal: longText,
    offer: z.string().max(500).optional(),
    constraints: z.array(shortText).max(20).default([]),
    successCriteria: z.array(shortText).max(20).default([]),
    expiresAt: isoTemporal.optional(),
  }),
})

/** candidate —— 候选必须带 `rationale`（空理由无法通过校验，对应 AC-13）。 */
export const CandidateNodeSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('candidate'),
  data: z.strictObject({
    candidates: z
      .array(
        z.strictObject({
          id: identifier,
          label: shortText,
          /** 🔴 必填且非空：没有依据的候选不得出现在画布上。 */
          rationale: shortText,
          evidence: z.array(shortText).max(10).default([]),
        }),
      )
      .max(50),
  }),
})

/** consent —— 双边同意与披露字段。数据源：`proposals`。 */
export const ConsentNodeSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('consent'),
  data: z.strictObject({
    /** 我会看到/我已授权的披露字段名（装配层只放**服务端确实下发了的**键）。 */
    fields: z.array(shortText).max(50).default([]),
    /** 单方接受不得进入执行（AC-04/AC-05）——状态由服务端派生，前端不得自造。 */
    status: z.enum(CONSENT_STATES),
  }),
})

/** action —— 执行状态来自 outbox 真相，不由前端推测。数据源：`workflow/jobs`。 */
export const ActionNodeSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('action'),
  data: z.strictObject({
    jobs: z
      .array(
        z.strictObject({
          id: identifier,
          kind: shortText,
          status: z.enum(ACTION_JOB_STATUSES),
          attempts: z.number().int().min(0).max(1000),
          lastError: z.string().max(500).optional(),
        }),
      )
      .max(50),
  }),
})

/** outcome —— `verificationLevel` 是服务端派生值，前端不得自行推断。 */
export const OutcomeNodeSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('outcome'),
  data: z.strictObject({
    outcomes: z
      .array(
        z.strictObject({
          id: identifier,
          label: shortText,
          level: z.enum(OUTCOME_LEVELS),
          occurredAt: isoTemporal.optional(),
        }),
      )
      .max(50),
  }),
})

export const WorkspaceNodeSchema = z.discriminatedUnion('type', [
  IntentNodeSchema,
  CandidateNodeSchema,
  ConsentNodeSchema,
  ActionNodeSchema,
  OutcomeNodeSchema,
])

/**
 * 可供用户触发的动作。
 * `ready === false` 时**必须**给出 `reason`（与 `check:ui-invariants` R4 同源判据）。
 */
export const WorkspaceActionSchema = z
  .strictObject({
    key: identifier,
    label: shortText,
    /** 服务端能力名（仅作展示提示；真实判定在服务端重做）。 */
    capability: shortText,
    ready: z.boolean(),
    reason: z.string().max(300).optional(),
  })
  .refine((a) => a.ready || (a.reason !== undefined && a.reason.trim().length > 0), {
    message: 'ready=false 的动作必须写明 reason',
    path: ['reason'],
  })

export const WorkspaceSpecSchema = z.strictObject({
  version: z.literal(WORKSPACE_SPEC_VERSION),
  title: shortText,
  summary: z.string().max(500).optional(),
  nodes: z.array(WorkspaceNodeSchema).min(1).max(40),
  availableActions: z.array(WorkspaceActionSchema).max(20).default([]),
  /** 给用户看的说明（例如"这些字段是规则解析出的草稿"）。 */
  notes: z.array(z.string().max(300)).max(10).default([]),
})

export type WorkspaceSpec = z.infer<typeof WorkspaceSpecSchema>
export type WorkspaceNode = z.infer<typeof WorkspaceNodeSchema>
export type WorkspaceAction = z.infer<typeof WorkspaceActionSchema>
export type IntentNode = z.infer<typeof IntentNodeSchema>
export type CandidateNode = z.infer<typeof CandidateNodeSchema>
export type ConsentNode = z.infer<typeof ConsentNodeSchema>
export type ActionNode = z.infer<typeof ActionNodeSchema>
export type OutcomeNode = z.infer<typeof OutcomeNodeSchema>
