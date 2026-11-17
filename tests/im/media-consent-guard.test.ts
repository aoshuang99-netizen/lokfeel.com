/**
 * V25.1 · V25-09 / M04 —— 媒体授权守卫负向测试
 *
 * 钉住三件曾真实缺失的事：
 *  1. 授权方向必须是 receiver(granter) → sender(grantee)，不能反；
 *  2. 档位必须比较（L1 授权不能发 L2 语音），查不到/异常一律默认拒绝；
 *  3. 授权不跨会话复用（conversationId 必须进 where）。
 */

import {
  checkMediaGrant,
  requiredLevelForMessageType,
  resolveRequiredMediaLevel,
  sniffContentMediaLevel,
  type MediaGrantClient,
  shouldRedactIncomingMedia,
  MEDIA_REDACTED_PLACEHOLDER,
} from '@/lib/im/consent-guard'

function mockClient(grants: Array<{ grantedLevel: string }>, throwOnQuery = false): {
  client: MediaGrantClient
  findMany: jest.Mock
} {
  const findMany = jest.fn(async () => {
    if (throwOnQuery) throw new Error('db down')
    return grants
  })
  return { client: { consentGrant: { findMany } } as unknown as MediaGrantClient, findMany }
}

const PARAMS = {
  receiverId: 'u_receiver',
  senderId: 'u_sender',
  conversationId: 'c1',
  requiredLevel: 'L2_VOICE' as const,
}

describe('requiredLevelForMessageType', () => {
  it('IMAGE→L1 / VOICE→L2 / TEXT→null（文本不需媒体授权）', () => {
    expect(requiredLevelForMessageType('IMAGE')).toBe('L1_IMAGE')
    expect(requiredLevelForMessageType('VOICE')).toBe('L2_VOICE')
    expect(requiredLevelForMessageType('TEXT')).toBeNull()
    expect(requiredLevelForMessageType('SYSTEM')).toBeNull()
  })
})

describe('resolveRequiredMediaLevel · 防伪装 TEXT / 伪造 MIME', () => {
  it('声明 TEXT 但 payload 是 data:image/* ⇒ 仍要求 L1_IMAGE（伪装绕过被堵）', () => {
    expect(resolveRequiredMediaLevel('TEXT', 'data:image/jpeg;base64,AAAA')).toBe('L1_IMAGE')
    expect(resolveRequiredMediaLevel('TEXT', '  data:image/png;base64,AAAA')).toBe('L1_IMAGE')
  })

  it('声明 TEXT 但 payload 是 data:audio/* ⇒ 要求 L2_VOICE', () => {
    expect(resolveRequiredMediaLevel('TEXT', 'data:audio/webm;base64,AAAA')).toBe('L2_VOICE')
  })

  it('声明与内容不一致时取较高档位（IMAGE 声明 + audio 内容 ⇒ L2）', () => {
    expect(resolveRequiredMediaLevel('IMAGE', 'data:audio/webm;base64,AAAA')).toBe('L2_VOICE')
  })

  it('纯文本与正文里引用 data URI 文字不误判', () => {
    expect(resolveRequiredMediaLevel('TEXT', 'hello world')).toBeNull()
    expect(resolveRequiredMediaLevel('TEXT', '请看这段 data:image/png 说明文字')).toBeNull()
    expect(resolveRequiredMediaLevel('VOICE', 'voice-ref-id')).toBe('L2_VOICE')
  })

  it('非字符串 payload 不嗅探（防畸形 body）', () => {
    expect(sniffContentMediaLevel(null)).toBeNull()
    expect(sniffContentMediaLevel({ url: 'x' })).toBeNull()
  })
})

describe('checkMediaGrant · 档位比较与最小权限默认拒绝', () => {
  it('🔒 授权方向 receiver=granter / sender=grantee，且带 conversationId（不跨会话复用）', async () => {
    const { client, findMany } = mockClient([{ grantedLevel: 'L2_VOICE' }])
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict.granted).toBe(true)

    const where = findMany.mock.calls[0][0].where
    expect(where.granterId).toBe('u_receiver')
    expect(where.granteeId).toBe('u_sender')
    expect(where.conversationId).toBe('c1')
    expect(where.isRevoked).toBe(false)
    expect(where.consentType).toBe('MEDIA')
  })

  it('已授权档位 >= 请求档位 → GRANTED', async () => {
    const { client } = mockClient([{ grantedLevel: 'L2_VOICE' }])
    expect((await checkMediaGrant(PARAMS, client))).toMatchObject({
      granted: true,
      reason: 'GRANTED',
      effectiveLevel: 'L2_VOICE',
    })
  })

  it('🔒 负控：仅 L1 图片授权，请求 L2 语音 → 拒绝（档位不足）', async () => {
    const { client } = mockClient([{ grantedLevel: 'L1_IMAGE' }])
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict.granted).toBe(false)
    expect(verdict).toMatchObject({ reason: 'INSUFFICIENT_LEVEL', effectiveLevel: 'L1_IMAGE' })
  })

  it('🔒 多条 grant 并存时取最高档（L1+L2 不能因 findFirst 命中 L1 而误拒 VOICE）', async () => {
    const { client } = mockClient([{ grantedLevel: 'L1_IMAGE' }, { grantedLevel: 'L2_VOICE' }])
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict).toMatchObject({ granted: true, effectiveLevel: 'L2_VOICE', reason: 'GRANTED' })
  })

  it('🔒 负控：无任何 grant → NO_GRANT（默认拒绝）', async () => {
    const { client } = mockClient([])
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict).toMatchObject({ granted: false, reason: 'NO_GRANT', effectiveLevel: null })
  })

  it('🔒 负控：查库异常 → fail closed，不因故障放行', async () => {
    const { client } = mockClient([], true)
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict.granted).toBe(false)
    expect(verdict.reason).toBe('NO_GRANT')
  })

  it('过期/撤销由查询条件过滤（OR expiresAt + isRevoked:false）', async () => {
    const { client, findMany } = mockClient([{ grantedLevel: 'L2_VOICE' }])
    await checkMediaGrant(PARAMS, client)
    const where = findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }])
  })
})

describe('shouldRedactIncomingMedia · V25-10 读取侧脱敏', () => {
  it('TEXT/L0 消息不脱敏', async () => {
    expect(await shouldRedactIncomingMedia({ senderId: 'other', mediaLevel: 'L0_TEXT' }, 'me', 'c1')).toBe(false)
    expect(await shouldRedactIncomingMedia({ senderId: 'other', mediaLevel: null }, 'me', 'c1')).toBe(false)
  })

  it('自己发的媒体不脱敏（发送方对自己内容始终可见）', async () => {
    expect(await shouldRedactIncomingMedia({ senderId: 'me', mediaLevel: 'L1_IMAGE' }, 'me', 'c1')).toBe(false)
  })

  it('🔒 对方媒体 + 无有效授权 ⇒ 脱敏', async () => {
    const { client } = mockClient([])
    expect(await shouldRedactIncomingMedia({ senderId: 'other', mediaLevel: 'L1_IMAGE' }, 'me', 'c1', client)).toBe(true)
  })

  it('🔒 对方媒体 + 已授权 ⇒ 不脱敏；授权方向是 viewer=granter/sender=grantee', async () => {
    const { client, findMany } = mockClient([{ grantedLevel: 'L1_IMAGE' }])
    expect(await shouldRedactIncomingMedia({ senderId: 'other', mediaLevel: 'L1_IMAGE' }, 'me', 'c1', client)).toBe(false)
    const where = findMany.mock.calls[0][0].where
    expect(where.granterId).toBe('me')
    expect(where.granteeId).toBe('other')
  })

  it('🔒 查询异常 ⇒ fail closed 脱敏', async () => {
    const { client } = mockClient([], true)
    expect(await shouldRedactIncomingMedia({ senderId: 'other', mediaLevel: 'L2_VOICE' }, 'me', 'c1', client)).toBe(true)
  })

  it('占位符不泄露 base64 原文', () => {
    expect(MEDIA_REDACTED_PLACEHOLDER).not.toMatch(/data:|base64|image|audio/i)
  })
})
