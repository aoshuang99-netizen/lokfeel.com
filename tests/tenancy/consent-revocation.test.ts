/**
 * V17 · 同意撤销（SEC-07）
 *
 * 背景：`isRevoked` 在本仓长期只读 —— 读取路径全部过滤 `isRevoked: false`，
 * `AuditAction` 里也预留 `consent_revoked`，但没有任何写入者。
 * 也就是"用户能授权、不能撤权"。本文件锁住新加的 DELETE 语义。
 *
 * 断言取向：重点不是"返回 200"，而是**只能撤自己的**。
 * 因此有一条最关键的负向断言：findMany 的 `granterId` 必须取自会话用户，
 * 若有人把它改成 targetId（= 允许撤销别人给我的授权），本条立刻红。
 */

jest.mock('@/lib/db', () => ({
  db: {
    consentGrant: { findMany: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    conversation: { updateMany: jest.fn(), update: jest.fn() },
    consentRequest: { findFirst: jest.fn(), update: jest.fn() },
  },
}))

jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn() }))

jest.mock('@/lib/im', () => ({
  auditLogger: { record: jest.fn() },
  pushToUser: jest.fn(),
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { auditLogger } from '@/lib/im'
import { DELETE } from '@/app/api/im/consent/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const findMany = db.consentGrant.findMany as unknown as jest.Mock
const updateMany = db.consentGrant.updateMany as unknown as jest.Mock
const convUpdateMany = db.conversation.updateMany as unknown as jest.Mock
const auditRecord = auditLogger.record as unknown as jest.Mock

const ME = 'u_granter'
const OTHER = 'u_grantee'

function del(query: string) {
  return DELETE(new NextRequest(new URL(`/api/im/consent${query}`, 'http://localhost'), { method: 'DELETE' }))
}

beforeEach(() => {
  jest.clearAllMocks()
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  updateMany.mockResolvedValue({ count: 1 })
  convUpdateMany.mockResolvedValue({ count: 1 })
  auditRecord.mockResolvedValue('audit_1')
})

describe('DELETE /api/im/consent', () => {
  it('缺 targetId → 400，且不触碰数据库', async () => {
    const res = await del('')
    expect(res.status).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('🔒 只能撤自己授出的：granterId 必须来自会话，不能来自 targetId', async () => {
    findMany.mockResolvedValue([{ id: 'g1', conversationId: 'c1' }])

    await del(`?targetId=${OTHER}`)

    const where = findMany.mock.calls[0][0].where
    expect(where.granterId).toBe(ME)
    expect(where.granteeId).toBe(OTHER)
    expect(where.isRevoked).toBe(false)

    // 写侧同样限定 granterId（双保险）
    const writeWhere = updateMany.mock.calls[0][0].where
    expect(writeWhere.granterId).toBe(ME)
  })

  it('撤销写入 isRevoked=true 且带 revokedAt', async () => {
    findMany.mockResolvedValue([{ id: 'g1', conversationId: 'c1' }])

    const res = await del(`?targetId=${OTHER}&consentType=MEDIA`)
    expect(res.status).toBe(200)

    const data = updateMany.mock.calls[0][0].data
    expect(data.isRevoked).toBe(true)
    expect(data.revokedAt).toBeInstanceOf(Date)
  })

  it('会话缓存回落 CONSENT_NONE（否则 UI 仍显示已授权）', async () => {
    findMany.mockResolvedValue([
      { id: 'g1', conversationId: 'c1' },
      { id: 'g2', conversationId: 'c1' },
      { id: 'g3', conversationId: 'c2' },
    ])

    await del(`?targetId=${OTHER}`)

    const where = convUpdateMany.mock.calls[0][0].where
    expect(where.id.in.sort()).toEqual(['c1', 'c2'])
    expect(convUpdateMany.mock.calls[0][0].data.cachedConsentState).toBe('CONSENT_NONE')
  })

  it('写审计 consent_revoked（类型早已预留，此前无人写入）', async () => {
    findMany.mockResolvedValue([{ id: 'g1', conversationId: 'c1' }])

    await del(`?targetId=${OTHER}`)

    const entry = auditRecord.mock.calls[0][0]
    expect(entry.action).toBe('consent_revoked')
    expect(entry.userId).toBe(ME)
    expect(entry.targetId).toBe(OTHER)
  })

  it('幂等：没有可撤记录时返回 revoked=0，不写库、不写审计', async () => {
    findMany.mockResolvedValue([])

    const res = await del(`?targetId=${OTHER}`)
    const body = (await res.json()) as { revoked: number }

    expect(res.status).toBe(200)
    expect(body.revoked).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
    expect(auditRecord).not.toHaveBeenCalled()
  })

  it('匿名 → 401（由 requireAuth 拒绝），不触碰数据库', async () => {
    const { UnauthorizedError } = jest.requireActual('@/lib/errors') as {
      UnauthorizedError: new (m: string) => Error
    }
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))

    const res = await del(`?targetId=${OTHER}`)
    expect(res.status).toBe(401)
    expect(findMany).not.toHaveBeenCalled()
  })
})
