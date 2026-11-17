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
  type MediaGrantClient,
} from '@/lib/im/consent-guard'

function mockClient(grant: { grantedLevel: string } | null, throwOnQuery = false): {
  client: MediaGrantClient
  findFirst: jest.Mock
} {
  const findFirst = jest.fn(async () => {
    if (throwOnQuery) throw new Error('db down')
    return grant
  })
  return { client: { consentGrant: { findFirst } } as unknown as MediaGrantClient, findFirst }
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

describe('checkMediaGrant · 档位比较与最小权限默认拒绝', () => {
  it('🔒 授权方向 receiver=granter / sender=grantee，且带 conversationId（不跨会话复用）', async () => {
    const { client, findFirst } = mockClient({ grantedLevel: 'L2_VOICE' })
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict.granted).toBe(true)

    const where = findFirst.mock.calls[0][0].where
    expect(where.granterId).toBe('u_receiver')
    expect(where.granteeId).toBe('u_sender')
    expect(where.conversationId).toBe('c1')
    expect(where.isRevoked).toBe(false)
    expect(where.consentType).toBe('MEDIA')
  })

  it('已授权档位 >= 请求档位 → GRANTED', async () => {
    const { client } = mockClient({ grantedLevel: 'L2_VOICE' })
    expect((await checkMediaGrant(PARAMS, client))).toMatchObject({
      granted: true,
      reason: 'GRANTED',
      effectiveLevel: 'L2_VOICE',
    })
  })

  it('🔒 负控：仅 L1 图片授权，请求 L2 语音 → 拒绝（档位不足）', async () => {
    const { client } = mockClient({ grantedLevel: 'L1_IMAGE' })
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict.granted).toBe(false)
    expect(verdict).toMatchObject({ reason: 'INSUFFICIENT_LEVEL', effectiveLevel: 'L1_IMAGE' })
  })

  it('🔒 负控：无任何 grant → NO_GRANT（默认拒绝）', async () => {
    const { client } = mockClient(null)
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict).toMatchObject({ granted: false, reason: 'NO_GRANT', effectiveLevel: null })
  })

  it('🔒 负控：查库异常 → fail closed，不因故障放行', async () => {
    const { client } = mockClient(null, true)
    const verdict = await checkMediaGrant(PARAMS, client)
    expect(verdict.granted).toBe(false)
    expect(verdict.reason).toBe('NO_GRANT')
  })

  it('过期/撤销由查询条件过滤（OR expiresAt + isRevoked:false）', async () => {
    const { client, findFirst } = mockClient({ grantedLevel: 'L2_VOICE' })
    await checkMediaGrant(PARAMS, client)
    const where = findFirst.mock.calls[0][0].where
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }])
  })
})
