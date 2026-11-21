/**
 * V25.6 UX06 · 服务端 AI 处理授权（consentRef 由服务端签发、持久化、查库校验）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 修补 V25.5 的 P0 缺口：旧版 /api/im/ai-assist 把客户端传来的 consentRef
 * 当作有效授权（仅非空字符串校验），任何人自称一个字符串即可宣称"已授权"。
 * 本模块把授权变成服务端事实：
 *   · 签发：只有登录用户、对本人会话，才能由服务端生成并落库一个 consentRef；
 *   · 校验：AI 处理前必须查库，逐项比对 userId / conversationId / purpose /
 *     recipientScope / modelScope / status / expiresAt / revokedAt；
 *   · 撤销：只有授权人本人可撤销；撤销后即时失效，不留宽限期。
 *
 * 与媒体 ConsentGrant 分离：媒体授权管"能否看图片/语音"，本表管"能否把原文
 * 送给远端模型、用于何种用途、送到哪个接收范围"。两者不互相替代。
 *
 * 纯函数 evaluateAIProcessingConsent 可穷举测试；verifyAIProcessingConsent
 * 则做真实查库，并复用同一纯函数，确保测试与运行时判定一致。
 */

import { prisma } from '@/lib/prisma'

/** 允许的 AI 处理用途——与 DraftProvenance.purpose 对齐。 */
export const AI_CONSENT_PURPOSES = ['translate', 'expression', 'reply_draft'] as const
export type AIConsentPurpose = (typeof AI_CONSENT_PURPOSES)[number]

/** 云端处理位置。private chat 默认 local（不上云），除非用户显式授权 cloud。 */
export const PROCESSING_LOCATIONS = ['local', 'cloud'] as const
export type ProcessingLocation = (typeof PROCESSING_LOCATIONS)[number]

/** 校验通过返回的规范化授权视图。 */
export interface ConsentView {
  id: string
  userId: string
  conversationId: string
  purpose: AIConsentPurpose
  recipientScope: string
  processingLocation: ProcessingLocation
  modelScope: string | null
  status: string
  expiresAt: number
  revokedAt: number | null
}

/** 失败原因枚举——用稳定的机器码，便于红队断言。 */
export type ConsentFailure =
  | 'CONSENT_NOT_FOUND'
  | 'CONSENT_OWNER_MISMATCH'
  | 'CONSENT_CONVERSATION_MISMATCH'
  | 'CONSENT_PURPOSE_MISMATCH'
  | 'CONSENT_SCOPE_MISMATCH'
  | 'CONSENT_MODEL_NOT_ALLOWED'
  | 'CONSENT_CLOUD_NOT_AUTHORIZED'
  | 'CONSENT_REVOKED'
  | 'CONSENT_EXPIRED'
  | 'CONSENT_BAD_INPUT'

export type ConsentVerdict =
  | { ok: true; consent: ConsentView }
  | { ok: false; reason: ConsentFailure }

/** 校验请求：调用方必须提供全部上下文，缺一即拒绝（fail closed）。 */
export interface VerifyInput {
  consentRef: string
  userId: string
  conversationId: string
  purpose: string
  recipientScope: string
  /** 实际要调用的 model id；授权限定了 modelScope 时必须匹配。 */
  modelId?: string
  /** 是否拟走云端处理；授权仅 local 时必须拒绝 cloud=true。 */
  wantsCloud?: boolean
  now?: number
}

const time = (v: Date | string | number | null | undefined): number | null => {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  const n = Date.parse(String(v))
  return Number.isFinite(n) ? n : null
}

const isPurpose = (v: string): v is AIConsentPurpose =>
  (AI_CONSENT_PURPOSES as readonly string[]).includes(v)
const isLocation = (v: string): v is ProcessingLocation =>
  (PROCESSING_LOCATIONS as readonly string[]).includes(v)

/**
 * 纯函数判定：给定一条落库授权记录与本次处理请求，返回是否容许。
 * 不查库、不联网、无副作用——用于穷举负例测试。
 */
export function evaluateAIProcessingConsent(
  record: ConsentView | null,
  input: VerifyInput,
): ConsentVerdict {
  const now = input.now ?? Date.now()

  // fail closed：任何必需上下文缺失或形状错误，直接拒绝
  if (
    !input.consentRef?.trim() ||
    !input.userId?.trim() ||
    !input.conversationId?.trim() ||
    !input.purpose?.trim() ||
    !input.recipientScope?.trim() ||
    !isPurpose(input.purpose)
  ) {
    return { ok: false, reason: 'CONSENT_BAD_INPUT' }
  }
  if (!record) return { ok: false, reason: 'CONSENT_NOT_FOUND' }
  if (record.id !== input.consentRef) return { ok: false, reason: 'CONSENT_NOT_FOUND' }

  // 归属：授权人必须是发起 AI 处理的同一用户（防拿他人 consentRef 复用）
  if (record.userId !== input.userId) return { ok: false, reason: 'CONSENT_OWNER_MISMATCH' }
  // 会话绑定：授权不可跨会话搬运
  if (record.conversationId !== input.conversationId) {
    return { ok: false, reason: 'CONSENT_CONVERSATION_MISMATCH' }
  }
  // 用途绑定：translate 的授权不能拿去做 expression
  if (record.purpose !== input.purpose) return { ok: false, reason: 'CONSENT_PURPOSE_MISMATCH' }
  // 接收范围绑定
  if (record.recipientScope !== input.recipientScope) {
    return { ok: false, reason: 'CONSENT_SCOPE_MISMATCH' }
  }
  // 状态：撤销优先于过期判定（撤销是显式意图，语义更强）
  if (record.status === 'REVOKED' || record.revokedAt !== null) {
    return { ok: false, reason: 'CONSENT_REVOKED' }
  }
  if (record.status === 'EXPIRED') return { ok: false, reason: 'CONSENT_EXPIRED' }
  if (record.status !== 'ACTIVE') return { ok: false, reason: 'CONSENT_NOT_FOUND' }
  if (record.expiresAt <= now) return { ok: false, reason: 'CONSENT_EXPIRED' }

  // 位置门禁：仅授权 local 处理时，不许把原文送云端
  const location = isLocation(record.processingLocation) ? record.processingLocation : 'local'
  if (input.wantsCloud === true && location !== 'cloud') {
    return { ok: false, reason: 'CONSENT_CLOUD_NOT_AUTHORIZED' }
  }
  // 模型门禁：授权限定了 modelScope 时，实际模型必须精确匹配
  if (record.modelScope && input.modelId && record.modelScope !== input.modelId) {
    return { ok: false, reason: 'CONSENT_MODEL_NOT_ALLOWED' }
  }

  return { ok: true, consent: { ...record, processingLocation: location } }
}

/** DB 行 → 规范化视图（时间统一转毫秒，避免 Date/string 混用导致比较失真）。 */
function toConsentView(row: {
  id: string
  userId: string
  conversationId: string
  purpose: string
  recipientScope: string
  processingLocation: string
  modelScope: string | null
  status: string
  grantedAt: Date | string
  expiresAt: Date | string
  revokedAt: Date | string | null
} | null): ConsentView | null {
  if (!row) return null // 查无记录 → 交 evaluate 判 CONSENT_NOT_FOUND（fail closed）
  const expiresAt = time(row.expiresAt)
  if (expiresAt === null) return null
  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    purpose: isPurpose(row.purpose) ? row.purpose : ('translate' as AIConsentPurpose),
    recipientScope: row.recipientScope,
    processingLocation: isLocation(row.processingLocation) ? row.processingLocation : 'local',
    modelScope: row.modelScope,
    status: row.status,
    expiresAt,
    revokedAt: time(row.revokedAt),
  }
}

/** 服务端签发：只有登录用户本人、对本人是成员的会话才能签发。 */
export async function issueAIProcessingConsent(params: {
  userId: string
  conversationId: string
  purpose: AIConsentPurpose
  recipientScope: string
  processingLocation: ProcessingLocation
  modelScope?: string | null
  requestId?: string
  ttlMs?: number
}): Promise<{ ok: true; consentRef: string } | { ok: false; reason: string }> {
  const { userId, conversationId, purpose, recipientScope, processingLocation } = params
  if (
    !userId?.trim() ||
    !conversationId?.trim() ||
    !recipientScope?.trim() ||
    !isPurpose(purpose) ||
    !isLocation(processingLocation)
  ) {
    return { ok: false, reason: 'CONSENT_BAD_INPUT' }
  }

  // 服务端校验会话成员身份——签发不是"填个字符串"，必须证明有权处理该会话
  const member = await prisma.conversation.findFirst({
    where: { id: conversationId, OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true },
  })
  if (!member) return { ok: false, reason: 'CONSENT_CONVERSATION_NOT_MEMBER' }

  const now = Date.now()
  const ttl = params.ttlMs && params.ttlMs > 0 ? params.ttlMs : 15 * 60 * 1000 // 默认 15 分钟
  const created = await prisma.aIProcessingConsent.create({
    data: {
      userId,
      conversationId,
      purpose,
      recipientScope,
      processingLocation,
      modelScope: params.modelScope ?? null,
      status: 'ACTIVE',
      requestId: params.requestId ?? null,
      grantedAt: new Date(now),
      expiresAt: new Date(now + ttl),
    },
    select: { id: true },
  })
  return { ok: true, consentRef: created.id }
}

/** 真实查库校验——与纯函数共用 evaluate，确保测试/运行时同判据。 */
export async function verifyAIProcessingConsent(
  input: VerifyInput,
): Promise<ConsentVerdict> {
  if (!input.consentRef?.trim()) return { ok: false, reason: 'CONSENT_BAD_INPUT' }
  let row: Awaited<ReturnType<typeof prisma.aIProcessingConsent.findUnique>> = null
  try {
    row = await prisma.aIProcessingConsent.findUnique({ where: { id: input.consentRef } })
  } catch {
    // 查库异常一律 fail closed，绝不"宽松放行"
    return { ok: false, reason: 'CONSENT_NOT_FOUND' }
  }
  return evaluateAIProcessingConsent(toConsentView(row), input)
}

/** 撤销：只有授权人本人可撤销；幂等，撤销后即时失效。 */
export async function revokeAIProcessingConsent(params: {
  consentRef: string
  userId: string
  now?: number
}): Promise<{ ok: boolean; reason?: string }> {
  const { consentRef, userId } = params
  if (!consentRef?.trim() || !userId?.trim()) return { ok: false, reason: 'CONSENT_BAD_INPUT' }
  const now = params.now ?? Date.now()
  const result = await prisma.aIProcessingConsent.updateMany({
    where: { id: consentRef, userId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(now) },
  })
  if (result.count === 0) return { ok: false, reason: 'CONSENT_NOT_FOUND_OR_NOT_OWNER' }
  return { ok: true }
}
