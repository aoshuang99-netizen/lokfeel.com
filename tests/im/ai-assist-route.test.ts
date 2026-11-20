/**
 * V25.5 P0.5 · POST /api/im/ai-assist 路由测试
 *
 * 核心断言不是"返回 200"，而是**零副作用**：
 *   · 未登录 → 401，不查库不生成；
 *   · 非会话成员 → 404，不生成；
 *   · 生成草稿 → IMMessage.create 调用 0（零写库）、autoSent=false、messageWritten=false；
 *   · 云开关默认关闭 → 降级草稿，provider 未被解析/调用（远端调用 0）。
 */
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: jest.fn() },
    iMMessage: { create: jest.fn(), findFirst: jest.fn() },
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
const msgCreate = prisma.iMMessage.create as unknown as jest.Mock
const bodyMock = safeRequestBody as unknown as jest.Mock
const resolveProvider = resolveRuntimeProvider as unknown as jest.Mock

const BODY = {
  text: '很高兴认识你',
  purpose: 'translate',
  consentRef: 'consent_1',
  conversationId: 'conv_1',
  requestId: 'req_1',
}

function req() {
  return new NextRequest('https://app.lokfeel.test/api/im/ai-assist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(BODY),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: 'user_A' } })
  convFind.mockResolvedValue({ id: 'conv_1' })
  bodyMock.mockResolvedValue(BODY)
  // 默认关闭云端：即便环境误配，route 内的开关也会拦下（resolve 不应被调用）
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

  it('③ 合法请求 → 草稿返回，IMMessage.create 调用 0（零写库）', async () => {
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
    resolveProvider.mockReturnValue({ kind: 'ready', provider: { kind: 'stub', name: 'stub', complete: jest.fn() } })
    const res = await POST(req())
    const json = await res.json()
    expect(json.degraded).toBe(true)
    delete process.env.SOCIAL_AI_CLOUD_ASSIST_ENABLED
  })
})
