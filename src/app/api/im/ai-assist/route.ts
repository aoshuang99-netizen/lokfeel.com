/**
 * V25.5 P0.5 · POST /api/im/ai-assist —— 私人 AI 沟通草稿生成（**零外发、零写库**）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 闭环定位：这是"翻译/建议"那一步。它只返回草稿给前端审阅，**绝不**：
 *   · 写 IMMessage（数据库消息写增量恒 0）；
 *   · 调用 /api/im/send 或任何对外投递；
 *   · 在未获授权时调用远端模型。
 *
 * 用户点"发送"后，前端把草稿文本作为 content 调现有 `/api/im/send` —— 那条链路
 * 的鉴权、媒体门禁、幂等、Pusher 全都不变。AI 草稿不是真人消息，只有用户主动
 * 发送才升级为 HUMAN_SENT（见 private-draft.ts 的 SendAuthorization）。
 *
 * ── V25.6 UX06 服务端处理授权（硬门槛）────────────────────────────
 *   V25.5 把客户端传来的 consentRef 当字符串采信 = P0 缺口。现在：
 *   1. consentRef 必须是服务端 /api/im/ai-consent 签发并落库的记录 id；
 *   2. 每次请求查库校验 userId / conversationId / purpose / recipientScope /
 *      status / expiresAt / 位置 / 模型范围——任一不符 → 403，不生成草稿；
 *   3. 云端处理需授权里 processingLocation=cloud；否则即使云开关开了也拒绝上云。
 *   默认云开关关闭 ⇒ provider=null ⇒ 仅当授权为 local 时返回降级草稿。
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeRequestBody } from '@/lib/safe-json'
import { assistPrivateMessage } from '@/lib/social-ai/message-assist'
import { verifyAIProcessingConsent } from '@/lib/social-ai/ai-consent'
import type { ModelProvider } from '@/lib/agent/provider'
import { resolveRuntimeProvider } from '@/lib/agents/provider-runtime'

interface AssistBody {
  text?: string
  purpose?: string
  consentRef?: string
  conversationId?: string
  requestId?: string
  recipientScope?: string
}

/** 仅在显式授权 + 非 stub provider 时返回真实 provider；否则 null（降级）。 */
function resolveAssistProvider(): ModelProvider | null {
  if (process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED !== '1') return null
  const resolution = resolveRuntimeProvider(process.env)
  if (resolution.kind !== 'ready') return null
  // stub 是沙箱 WorkspaceSpec provider，不满足本技能契约 —— 不注入。
  if (resolution.provider.kind === 'stub') return null
  return resolution.provider
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const body = await safeRequestBody<AssistBody>(req)
  if (!body) {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 })
  }

  const { text, purpose, consentRef, conversationId, requestId, recipientScope } = body
  if (!text || !purpose || !consentRef || !conversationId || !requestId) {
    return NextResponse.json(
      { error: 'text, purpose, consentRef, conversationId and requestId are required' },
      { status: 400 },
    )
  }
  if (purpose !== 'translate' && purpose !== 'expression') {
    return NextResponse.json({ error: 'unsupported purpose' }, { status: 400 })
  }

  // 服务端校验：用户必须是该会话成员（防越权拿别人的聊天上下文做 AI 输入）。
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  // ── V25.6 UX06：服务端处理授权查库校验（客户端 consentRef 不再被采信）──
  // 先判定云开关是否"意图上云"：只有显式开启且 provider 可用时 wantsCloud=true。
  // 校验会把 wantsCloud 与授权里的 processingLocation 做门禁比对：授权 local 时，
  // 即使云开关被误开，也拒绝把原文送云端（CONSENT_CLOUD_NOT_AUTHORIZED）。
  const cloudEnabled = process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED === '1'
  const effectiveRecipientScope = recipientScope || conversationId
  const consent = await verifyAIProcessingConsent({
    consentRef,
    userId,
    conversationId,
    purpose,
    recipientScope: effectiveRecipientScope,
    // 模型范围在下方拿到真实 provider 后二次复核
    wantsCloud: cloudEnabled,
  })
  if (!consent.ok) {
    // 伪造 / 撤销 / 过期 / 跨用户 / 跨会话 / 用途不符一律 403，且不生成任何草稿
    return NextResponse.json(
      { error: 'AI processing consent invalid', reason: consent.reason },
      { status: 403 },
    )
  }

  const provider = resolveAssistProvider()
  // 二次门禁：若实际注入了真实 provider，复核授权是否限定了模型范围。
  if (provider) {
    const modelCheck = await verifyAIProcessingConsent({
      consentRef,
      userId,
      conversationId,
      purpose,
      recipientScope: effectiveRecipientScope,
      modelId: provider.name,
      wantsCloud: true,
    })
    if (!modelCheck.ok) {
      return NextResponse.json(
        { error: 'AI processing consent invalid', reason: modelCheck.reason },
        { status: 403 },
      )
    }
  }

  const result = await assistPrivateMessage(
    {
      text,
      purpose,
      consentRef,
      recipientScope: effectiveRecipientScope,
      inputDataScope: 'user_authored_text',
      requestId,
      modelId: provider?.name || 'local-degraded',
    },
    provider,
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, issues: result.issues ?? [] }, { status: 422 })
  }

  // 只返回草稿；不写库、不外发。前端审阅后自行决定是否发送。
  return NextResponse.json({
    draft: result.draft,
    suggestion: result.suggestion,
    degraded: result.degraded,
    injectionSignals: result.injectionSignals,
    // 明确告知前端：这只是草稿，发送需用户主动调用 /api/im/send
    autoSent: false,
    messageWritten: false,
  })
}
