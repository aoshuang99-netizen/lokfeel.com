/**
 * V25.5 P0.5 + V25.6 UX06 · POST /api/im/ai-assist 路由测试
 *
 * 核心断言不是"返回 200"，而是：
 *   · 未登录 → 401，不查库不生成；
 *   · 非会话成员 → 404，不生成；
 *   · 【UX06 新增】consentRef 必须服务端查库有效 → 伪造/撤销/过期/跨用户一律 403；
 *   · 生成草稿 → IMMessage.create 调用 0（零写库）、autoSent=false；
 *   · 云开关默认关闭 → 降级草稿，provider 未被解析（远端调用 0）。
 */
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: jest.fn() },
    iMMessage: { create: jest.fn(), findFirst: jest.fn() },
    // V25.6：服务端授权查库 delegate
    aIProcessingConsent: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  },
}))
jest.mock('@/lib/safe-json', () => ({ safeRequestBody: jest.fn() }))
jest.mock('@/lib/agents/provider-runtime', () => ({ resolveRuntimeProvider: jest.fn() }))

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeRequestBody } from '@/lib/safe-json'
import { resolveRuntimeProvider } from '@/lib/agents/provider-runtime'
import { POST } from '@/app/api/im/ai-assist/route'

const authMock = auth as unknown as jest.Mock
const convFind = prisma.conversation.findFirst as unknown as jest.Mock
const consentFind = (prisma as any).aIProcessingConsent.findUnique as jest.Mock
const msgCreate = prisma.iMMessage.create as unknown as jest.Mock
const bodyMock = safeRequestBody as unknown as jest.Mock
const resolveProvider = resolveRuntimeProvider as unknown as jest.Mock

const BODY = {
  text: '很高兴认识你',
  purpose: 'translate',
  consentRef: 'consent_server_issued_1',
  conversationId: 'conv_1',
  requestId: 'req_1',
  recipientScope: 'conv_1',
}

function req() {
  return new NextRequest('https://app.lokfeel.test/api/im/ai-assist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(BODY),
  })
}

/** 一条"服务端签发、有效、local 授权"的记录（默认不上云，避免触发模型调用）。 */
const VALID_GRANT = {
  id: 'consent_server_issued_1',
  userId: 'user_A',
  conversationId: 'conv_1',
  purpose: 'translate',
  recipientScope: 'conv_1',
  processingLocation: 'local',
  modelScope: null,
  status: 'ACTIVE',
  grantedAt: new Date(Date.now() - 1000),
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  revokedAt: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: 'user_A' } })
  convFind.mockResolvedValue({ id: 'conv_1' })
  consentFind.mockResolvedValue(VALID_GRANT)
  bodyMock.mockResolvedValue(BODY)
  delete process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED
  resolveProvider.mockReturnValue({ kind: 'unavailable', reason: 'no creds' })
})

describe('P0.5 ai-assist 路由 · 零外发与授权门槛', () => {
  it('① 未登录 → 401，零查库零写库', async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(convFind).not.toHaveBeenCalled()
    expect(msgCreate).not.toHaveBeenCalled()
  })

  it('② 非会话成员 → 404，不生成草稿', async () => {
    convFind.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(404)
    expect(msgCreate).not.toHaveBeenCalled()
  })

  it('③ 合法授权 → 草稿返回，IMMessage.create 调用 0（零写库）', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.autoSent).toBe(false)
    expect(json.messageWritten).toBe(false)
    expect(json.draft.origin).toBe('AI_PRIVATE_DRAFT')
    expect(msgCreate).not.toHaveBeenCalled()
  })

  it('④ 云开关默认关闭 → 降级草稿，resolveRuntimeProvider 未被调用（远端调用 0）', async () => {
    const res = await POST(req())
    const json = await res.json()
    expect(json.degraded).toBe(true)
    expect(resolveProvider).not.toHaveBeenCalled()
  })

  it('⑤ 无 consentRef → 400', async () => {
    bodyMock.mockResolvedValue({ ...BODY, consentRef: undefined })
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(msgCreate).not.toHaveBeenCalled()
  })

  it('⑥ 不支持的 purpose → 400', async () => {
    bodyMock.mockResolvedValue({ ...BODY, purpose: 'send_auto' })
    const res = await POST(req())
    expect(res.status).toBe(400)
  })

  it('⑦ 云开关开启但 provider=stub → 仍降级（不注入契约不符的 stub）', async () => {
    process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED = '1'
    // local 授权 + wantsCloud=true 会被授权门禁挡下（403），改用 cloud 授权测 stub 降级
    consentFind.mockResolvedValue({ ...VALID_GRANT, processingLocation: 'cloud' })
    resolveProvider.mockReturnValue({ kind: 'ready', provider: { kind: 'stub', name: 'stub', complete: jest.fn() } })
    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.degraded).toBe(true)
    delete process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED
  })
})

describe('UX06 服务端授权查库 · 客户端字符串不再被采信', () => {
  it('⑧ 伪造 consentRef（查无记录）→ 403，且不生成草稿', async () => {
    consentFind.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.reason).toBe('CONSENT_NOT_FOUND')
    expect(msgCreate).not.toHaveBeenCalled()
  })

  it('⑨ 他人授权（owner 不符）→ 403 CONSENT_OWNER_MISMATCH', async () => {
    consentFind.mockResolvedValue({ ...VALID_GRANT, userId: 'user_B' })
    const res = await POST(req())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.reason).toBe('CONSENT_OWNER_MISMATCH')
  })

  it('⑩ 已撤销授权 → 403 CONSENT_REVOKED', async () => {
    consentFind.mockResolvedValue({ ...VALID_GRANT, status: 'REVOKED', revokedAt: new Date() })
    const res = await POST(req())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.reason).toBe('CONSENT_REVOKED')
  })

  it('⑪ 过期授权 → 403 CONSENT_EXPIRED', async () => {
    consentFind.mockResolvedValue({ ...VALID_GRANT, expiresAt: new Date(Date.now() - 1000) })
    const res = await POST(req())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.reason).toBe('CONSENT_EXPIRED')
  })

  it('⑫ 用途不符 → 403 CONSENT_PURPOSE_MISMATCH', async () => {
    consentFind.mockResolvedValue({ ...VALID_GRANT, purpose: 'expression' })
    const res = await POST(req())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.reason).toBe('CONSENT_PURPOSE_MISMATCH')
  })

  it('⑬ local 授权 + 云开关误开 → 403 CONSENT_CLOUD_NOT_AUTHORIZED，provider 不被解析', async () => {
    process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED = '1'
    consentFind.mockResolvedValue({ ...VALID_GRANT, processingLocation: 'local' })
    const res = await POST(req())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.reason).toBe('CONSENT_CLOUD_NOT_AUTHORIZED')
    expect(resolveProvider).not.toHaveBeenCalled()
    delete process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED
  })
})
