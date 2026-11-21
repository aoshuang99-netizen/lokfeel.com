/**
 * V25.6 UX06 · /api/im/ai-consent —— 服务端签发 / 撤销 AI 处理授权
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POST 签发：登录用户对本人会话、指定用途/接收范围，服务端生成并落库一个
 *          consentRef；前端拿到后才能调 /api/im/ai-assist。
 * DELETE 撤销：只有授权人本人可撤销；撤销即时失效。
 *
 * 授权是"明确、有限、可撤回"的用户意图，不是客户端自称的字符串。
 * 私有聊天默认 processingLocation=local（不上云）；只有前端显式请求且
 * 本端点校验通过后，才可能签发 cloud 授权（仍受部署开关二次约束）。
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { safeRequestBody } from '@/lib/safe-json'
import {
  AI_CONSENT_PURPOSES,
  PROCESSING_LOCATIONS,
  issueAIProcessingConsent,
  revokeAIProcessingConsent,
  type AIConsentPurpose,
  type ProcessingLocation,
} from '@/lib/social-ai/ai-consent'

interface IssueBody {
  conversationId?: string
  purpose?: string
  recipientScope?: string
  processingLocation?: string
  modelScope?: string
  requestId?: string
  ttlMs?: number
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await safeRequestBody<IssueBody>(req)
  if (!body) {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 })
  }
  const { conversationId, purpose, recipientScope, processingLocation, modelScope, requestId, ttlMs } = body
  if (
    !conversationId ||
    !purpose ||
    !AI_CONSENT_PURPOSES.includes(purpose as AIConsentPurpose) ||
    !recipientScope
  ) {
    return NextResponse.json(
      { error: 'conversationId, valid purpose and recipientScope are required' },
      { status: 400 },
    )
  }
  const location: ProcessingLocation = PROCESSING_LOCATIONS.includes(
    processingLocation as ProcessingLocation,
  )
    ? (processingLocation as ProcessingLocation)
    : 'local' // 默认不上云——最小权限

  // 只接受有限 TTL（≤1 小时）；非法值回落到 15 分钟，防止客户端签发"永久"授权
  const safeTtl = typeof ttlMs === 'number' && ttlMs > 0 && ttlMs <= 60 * 60 * 1000 ? ttlMs : undefined

  const issued = await issueAIProcessingConsent({
    userId: session.user.id,
    conversationId,
    purpose: purpose as AIConsentPurpose,
    recipientScope,
    processingLocation: location,
    modelScope: modelScope ?? null,
    requestId,
    ttlMs: safeTtl,
  })
  if (!issued.ok) {
    const status = issued.reason === 'CONSENT_CONVERSATION_NOT_MEMBER' ? 403 : 400
    return NextResponse.json({ error: 'Consent not issued', reason: issued.reason }, { status })
  }
  return NextResponse.json(
    {
      consentRef: issued.consentRef,
      purpose,
      processingLocation: location,
      // 明确告知前端：这是可撤销的短期授权，不是永久许可
      revocable: true,
    },
    { status: 201 },
  )
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await safeRequestBody<{ consentRef?: string }>(req)
  const consentRef = body?.consentRef
  if (!consentRef) {
    return NextResponse.json({ error: 'consentRef is required' }, { status: 400 })
  }
  const revoked = await revokeAIProcessingConsent({ consentRef, userId: session.user.id })
  if (!revoked.ok) {
    return NextResponse.json(
      { error: 'Consent not revoked', reason: revoked.reason },
      { status: 404 },
    )
  }
  return NextResponse.json({ consentRef, revoked: true })
}
