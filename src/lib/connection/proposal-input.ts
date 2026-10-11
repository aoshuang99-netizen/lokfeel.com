/**
 * T05 · 提案相关的输入校验
 *
 * 与 T02/T03 同一套原语（`input-helpers.ts`）：失败一律抛 `ValidationError`（400）
 * 并带 `details.field`，前端可直接把错误定位到具体输入框。
 *
 * ⚠️ 契约里 `decision` 的取值是**小写**（`enum: [accept, reject]`），
 * 而本仓 DB 存的是大写枚举（`ProposalDecisionKind`）。转换**只在这一层**发生 ——
 * 让它散到服务层去，就会出现"某个调用点忘了转、于是写进一个 DB 认不出的值"
 * （libSQL 的 TEXT 列没有 CHECK 约束，写错不报错，只会静默存进去）。
 */

import { ValidationError } from '@/lib/errors'
import { PROPOSAL_LIMITS } from './proposals'
import {
  asObject,
  fail,
  optionalDate,
  optionalString,
  requiredString,
} from './input-helpers'

/** 契约允许的表态动作（小写）。 */
export const PROPOSAL_ACTIONS = ['accept', 'reject'] as const
export type ProposalDecisionAction = (typeof PROPOSAL_ACTIONS)[number]

export interface ParsedProposalCreate {
  missionId: string
  candidateId: string
  rationale: string
  expiresAt: Date | null
}

/**
 * 解析 `POST /connections/proposals` 的请求体。
 *
 * `expiresAt` 要求是**未来**时间：创建一个"落地即过期"的提案没有意义，
 * 而且会立刻在列表里显示为 `EXPIRED`，看起来像系统故障。
 */
export function parseProposalCreate(body: unknown): ParsedProposalCreate {
  const obj = asObject(body)
  const missionId = requiredString(obj.missionId, 'missionId', 1, 200)
  const candidateId = requiredString(obj.candidateId, 'candidateId', 1, 200)
  const rationale = requiredString(
    obj.rationale,
    'rationale',
    PROPOSAL_LIMITS.rationaleMin,
    PROPOSAL_LIMITS.rationaleMax
  )
  const expiresAt = optionalDate(obj.expiresAt, 'expiresAt', { requireFuture: true })
  return { missionId, candidateId, rationale, expiresAt }
}

/**
 * 解析 `POST /connections/{id}/consent`。
 *
 * **严格等值**（不做 `trim`、不做大小写归一）：`"Accept"` / `" accept"` 一律 400。
 * 同意类的输入不接受模糊 —— 一个被"顺手纠正"的值意味着调用方与本文档的
 * 理解已经不一致，此时报错比猜测安全。
 */
export function parseConsentDecision(body: unknown): 'ACCEPT' | 'REJECT' {
  const obj = asObject(body)
  const raw = obj.decision
  if (raw === 'accept') return 'ACCEPT'
  if (raw === 'reject') return 'REJECT'
  return fail('decision', `decision must be one of: ${PROPOSAL_ACTIONS.join(', ')}`)
}

/** 解析撤销请求的可选说明。缺省/空白 → null。 */
export function parseRevokeNote(body: unknown): string | null {
  if (body === undefined || body === null) return null
  // 允许空 body（撤销只有一个动作，没有必填字段）。
  let obj: Record<string, unknown>
  try {
    obj = asObject(body)
  } catch {
    throw new ValidationError('Request body must be a JSON object')
  }
  return optionalString(obj.note, 'note', PROPOSAL_LIMITS.noteMax)
}
