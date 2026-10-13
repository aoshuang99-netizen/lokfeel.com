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

/** 契约版本。字段语义变更必须升版本，避免旧前端静默误读新 spec。 */
export const WORKSPACE_SPEC_VERSION = '1.0' as const

/** 可出现在画布上的节点类型（白名单）。 */
export const NODE_TYPES = ['intent', 'candidate', 'consent', 'action', 'outcome'] as const

/**
 * 已保留但**当前禁止产出**的节点类型。
 * `agent` 依赖 T09 Agent Runtime；P1 若产出该类型即为伪造能力。
 */
export const RESERVED_NODE_TYPES = ['agent'] as const

export type NodeType = (typeof NODE_TYPES)[number]
export type ReservedNodeType = (typeof RESERVED_NODE_TYPES)[number]

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

/** consent —— 双边同意与逐字段披露。数据源：`proposals` + `intents/[id]/disclosure`。 */
export const ConsentNodeSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('consent'),
  data: z.strictObject({
    fields: z.array(shortText).max(50).default([]),
    /** 单方接受不得进入执行（AC-04/AC-05）——状态由服务端派生，前端不得自造。 */
    status: z.enum(['PENDING', 'GRANTED', 'REVOKED']),
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
          status: z.enum(['PENDING', 'RUNNING', 'RETRY', 'DEAD', 'DONE']),
          attempts: z.number().int().min(0).max(1000),
          lastError: z.string().max(500).optional(),
        }),
      )
      .max(50),
  }),
})

/** outcome —— `verification_level` 是服务端派生值，前端不得自行推断。 */
export const OutcomeNodeSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('outcome'),
  data: z.strictObject({
    outcomes: z
      .array(
        z.strictObject({
          id: identifier,
          label: shortText,
          level: z.enum(['SELF_REPORTED', 'COUNTERPARTY_CONFIRMED', 'EVIDENCE_BACKED']),
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
