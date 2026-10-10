/**
 * T03 · 意图输入校验（**写路径的唯一收口**）
 *
 * 与 `mission-input.ts` 同一取向：把校验集中在纯函数里，路由层保持"薄"，
 * 未知字段**显式丢弃**（绝不因为客户端多塞了一个字段就写进库）。
 *
 * 三条与任务卡直接相关的规则：
 *   1. **用户主动授权**：`disclosure` 必须经 `normalizeDisclosure()`（AC-03），
 *      受保护字段（email 等）写进来即 400。
 *   2. **导入许可**：`importFromProfile` 必须伴随 `importConsent === true`，
 *      且只能导入目录里 `importable` 的字段（AC-12）。
 *   3. **有效期**：创建时必须在未来（否则一提交就是过期态）。
 */

import { ValidationError } from '@/lib/errors'
import { normalizeStringArray } from './json-codec'
import { normalizeDisclosure, type DisclosureMap } from './disclosure'
import { parseImportFields, type ImportPlan } from './intent-import'
import {
  asObject,
  fail,
  optionalDate,
  optionalString,
  requireTrue,
  requiredString,
} from './input-helpers'

// ── 字段长度约束（与 Reference 后端的 Field(...) 对齐）──
export const INTENT_LIMITS = {
  needMin: 4,
  needMax: 1000,
  offerMin: 1,
  offerMax: 500,
  missionIdMax: 64,
} as const

// ═══════════════════════════════════════════════════════════
// 创建
// ═══════════════════════════════════════════════════════════

export interface ParsedIntentCreate {
  missionId: string
  need: string
  offer: string
  constraints: string[]
  disclosure: DisclosureMap
  expiresAt: Date | null
  /** 档案导入计划（已校验，`rejected` 必为空）。 */
  importPlan: ImportPlan
  /** 用户是否就"导入档案字段"给出了显式同意。 */
  importConsentGiven: boolean
}

export function parseIntentCreate(body: unknown, now: Date = new Date()): ParsedIntentCreate {
  const b = asObject(body)

  const missionId = requiredString(b.missionId, 'missionId', 1, INTENT_LIMITS.missionIdMax)
  const need = requiredString(b.need, 'need', INTENT_LIMITS.needMin, INTENT_LIMITS.needMax)
  const offer = requiredString(b.offer, 'offer', INTENT_LIMITS.offerMin, INTENT_LIMITS.offerMax)

  // ── 档案导入：必须"三件齐全"，缺一件即 400 ──
  // 这三个字段是**一组**：开关、清单、同意缺一不可。允许"清单给了但开关没开"
  // 会让用户以为字段已导入，实际没有 —— 静默的语义丢失比报错危险得多。
  const wantsImport = b.importFromProfile === true
  const hasFields = b.importFields !== undefined && b.importFields !== null
  const hasConsent = b.importConsent !== undefined && b.importConsent !== null

  if (!wantsImport && (hasFields || hasConsent)) {
    fail('importFromProfile', 'importFields/importConsent require importFromProfile=true')
  }

  let importPlan: ImportPlan = { accepted: [], rejected: [], includesSensitive: false }
  let importConsentGiven = false

  if (wantsImport) {
    importPlan = parseImportFields(b.importFields)
    if (importPlan.accepted.length === 0) {
      fail('importFields', 'importFields must contain at least one importable field')
    }
    importConsentGiven = requireTrue(
      b.importConsent,
      'importConsent',
      'Importing profile fields requires explicit consent (importConsent=true)'
    )
  }

  return {
    missionId,
    need,
    offer,
    constraints: normalizeStringArray(b.constraints),
    disclosure: normalizeDisclosure(b.disclosure),
    expiresAt: optionalDate(b.expiresAt, 'expiresAt', { requireFuture: true, now }),
    importPlan,
    importConsentGiven,
  }
}

// ═══════════════════════════════════════════════════════════
// 更新（PATCH 语义：只改显式给出的字段）
// ═══════════════════════════════════════════════════════════

export interface ParsedIntentPatch {
  need?: string
  offer?: string
  constraints?: string[]
  /** **整体替换**（不是 merge）：不含某键即等于"取消该字段的授权"。 */
  disclosure?: DisclosureMap
  expiresAt?: Date | null
}

export function parseIntentPatch(body: unknown, now: Date = new Date()): ParsedIntentPatch {
  const b = asObject(body)
  const patch: ParsedIntentPatch = {}

  if ('need' in b) patch.need = requiredString(b.need, 'need', INTENT_LIMITS.needMin, INTENT_LIMITS.needMax)
  if ('offer' in b) {
    patch.offer = requiredString(b.offer, 'offer', INTENT_LIMITS.offerMin, INTENT_LIMITS.offerMax)
  }
  if ('constraints' in b) patch.constraints = normalizeStringArray(b.constraints)
  if ('disclosure' in b) patch.disclosure = normalizeDisclosure(b.disclosure)
  if ('expiresAt' in b) {
    // 更新允许把有效期改到过去（= 立即失效），与 T02 的 expiresAt 口径一致。
    patch.expiresAt = optionalDate(b.expiresAt, 'expiresAt', { now })
  }

  // 意图不可改挂载点：换 mission/换人都不行。给了就明确拒绝，
  // 而不是静默忽略（静默忽略会让调用方以为"改成功了"）。
  for (const forbidden of ['missionId', 'userId', 'status', 'importFields'] as const) {
    if (forbidden in b) {
      throw new ValidationError(`${forbidden} cannot be changed after creation`, {
        field: forbidden,
      })
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Patch must contain at least one updatable field')
  }
  return patch
}

// ═══════════════════════════════════════════════════════════
// 状态机动作
// ═══════════════════════════════════════════════════════════

export const INTENT_STATUS_ACTIONS = ['withdraw', 'reactivate'] as const
export type IntentStatusAction = (typeof INTENT_STATUS_ACTIONS)[number]

export function parseIntentStatusAction(value: unknown): IntentStatusAction {
  if (typeof value === 'string' && (INTENT_STATUS_ACTIONS as readonly string[]).includes(value)) {
    return value as IntentStatusAction
  }
  return fail('action', `action must be one of: ${INTENT_STATUS_ACTIONS.join(', ')}`)
}

/** 撤销原因（可选，仅本人可见）。 */
export function parseWithdrawReason(value: unknown): string | null {
  return optionalString(value, 'reason', 200)
}
