/**
 * V25.1 · V25-09 / M04 —— /api/im/send 媒体授权执行点集成负向测试
 *
 * 核心断言不是"返回 403"，而是**未授权时零副作用**：
 *   prisma.$transaction（DB 写）、pusher.trigger（推送）、handleBotReply（机器人）全部不得调用。
 * 这正是硬门禁"未授权媒体 403 且 DB/队列/推送零写"的可执行证据。
 */

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: jest.fn() },
    iMMessage: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/safe-json', () => ({ safeRequestBody: jest.fn() }))
jest.mock('@/lib/im/bot-reply', () => ({ handleBotReply: jest.fn() }))
jest.mock('@/lib/im/message-guards', () => ({ checkSendPermission: jest.fn() }))
jest.mock('@/lib/im/consent-guard', () => ({
  checkMediaGrant: jest.fn(),
  requiredLevelForMessageType: jest.fn((t: string) =>
    t === 'IMAGE' ? 'L1_IMAGE' : t === 'VOICE' ? 'L2_VOICE' : null,
  ),
}))
jest.mock('@/lib/pusher', () => ({ getPusherServer: jest.fn() }))

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeRequestBody } from '@/lib/safe-json'
import { handleBotReply } from '@/lib/im/bot-reply'
import { checkSendPermission } from '@/lib/im/message-guards'
import { checkMediaGrant } from '@/lib/im/consent-guard'
import { getPusherServer } from '@/lib/pusher'
import { POST } from '@/app/api/im/send/route'

const authMock = auth as unknown as jest.Mock
const safeBodyMock = safeRequestBody as unknown as jest.Mock
const convFind = prisma.conversation.findFirst as unknown as jest.Mock
const msgFind = prisma.iMMessage.findFirst as unknown as jest.Mock
const transaction = prisma.$transaction as unknown as jest.Mock
const sendPerm = checkSendPermission as unknown as jest.Mock
const mediaGrant = checkMediaGrant as unknown as jest.Mock
const botReply = handleBotReply as unknown as jest.Mock
const pusherServer = getPusherServer as unknown as jest.Mock

function send() {
  // route 内部用 safeRequestBody(req)，各用例通过 mock 它来注入 body
  return POST(new NextRequest(new URL('/api/im/send', 'http://localhost'), { method: 'POST' }))
}

beforeEach(() => {
  jest.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: 'u_sender' } })
  safeBodyMock.mockImplementation(async () => ({
    conversationId: 'c1',
    content: 'hello',
    msgType: 'TEXT',
  }))
  convFind.mockResolvedValue({ id: 'c1', userAId: 'u_sender', userBId: 'u_receiver', chatRoomId: null })
  msgFind.mockResolvedValue(null)
  sendPerm.mockResolvedValue({ ok: true })
  mediaGrant.mockResolvedValue({ granted: true, reason: 'GRANTED' })
  transaction.mockResolvedValue({
    id: 'm1',
    payload: 'hello',
    msgType: 'TEXT',
    clientMsgId: null,
    createdAt: new Date(),
    seq: 1,
    sender: { id: 'u_sender', name: 'A', profile: null },
  })
  pusherServer.mockReturnValue(null)
  botReply.mockResolvedValue(undefined)
})

describe('POST /api/im/send · 媒体授权执行点', () => {
  it('🔒 IMAGE 未授权 → 403 且 DB 事务 / 推送 / bot 零调用', async () => {
    safeBodyMock.mockImplementation(async () => ({
      conversationId: 'c1',
      content: 'data:image/png;base64,...',
      msgType: 'IMAGE',
    }))
    mediaGrant.mockResolvedValue({ granted: false, reason: 'NO_GRANT', effectiveLevel: null })

    const res = await send()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('MEDIA_CONSENT_REQUIRED')

    // 零副作用断言（这才是门禁的实质）
    expect(transaction).not.toHaveBeenCalled()
    expect(botReply).not.toHaveBeenCalled()
    expect(pusherServer).not.toHaveBeenCalled()
  })

  it('🔒 VOICE 仅 L1 授权 → 403 且零写；requiredLevel=L2_VOICE', async () => {
    safeBodyMock.mockImplementation(async () => ({
      conversationId: 'c1',
      content: 'voice-ref',
      msgType: 'VOICE',
    }))
    mediaGrant.mockResolvedValue({
      granted: false,
      reason: 'INSUFFICIENT_LEVEL',
      effectiveLevel: 'L1_IMAGE',
    })

    const res = await send()
    expect(res.status).toBe(403)
    expect(mediaGrant.mock.calls[0][0]).toMatchObject({
      receiverId: 'u_receiver',
      senderId: 'u_sender',
      conversationId: 'c1',
      requiredLevel: 'L2_VOICE',
    })
    expect(transaction).not.toHaveBeenCalled()
    expect(botReply).not.toHaveBeenCalled()
  })

  it('TEXT 消息不受媒体门禁影响 → 200（基础通信能力不误伤）', async () => {
    const res = await send()
    expect(res.status).toBe(200)
    expect(mediaGrant).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('已授权的 IMAGE → 200，正常走事务', async () => {
    safeBodyMock.mockImplementation(async () => ({
      conversationId: 'c1',
      content: 'data:image/png;base64,...',
      msgType: 'IMAGE',
    }))
    const res = await send()
    expect(res.status).toBe(200)
    expect(mediaGrant).toHaveBeenCalledTimes(1)
    expect(transaction).toHaveBeenCalledTimes(1)
  })
})
