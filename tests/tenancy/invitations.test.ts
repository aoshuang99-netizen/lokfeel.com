/**
 * T07 · 成员邀请 —— 判定、换票、接受
 *
 * 这组测试守的是"链接即凭据"这个模型里最容易漏的三处：
 *   1. 转发即越权 → 接受时必须校验**会话邮箱**与邀请邮箱一致；
 *   2. 重复邀请 → 旧票必须作废（否则两条链接同时可用，撤销就成了假动作）；
 *   3. 过期 → 必须真的拒绝，而不是"看起来过期但还能用"。
 */

jest.mock('@/lib/db', () => ({
  db: { $transaction: jest.fn(), membership: { findFirst: jest.fn() } },
}))

jest.mock('@/lib/tenancy/audit', () => ({
  writeTenantAudit: jest.fn().mockResolvedValue('audit-1'),
}))

jest.mock('@/lib/email', () => ({
  sendOrganizationInviteEmail: jest.fn().mockResolvedValue({ success: true }),
}))

import { db } from '@/lib/db'
import { sendOrganizationInviteEmail } from '@/lib/email'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import {
  acceptInvitation,
  createInvitation,
  generateInviteToken,
  hashInviteToken,
  inviteAcceptUrl,
  normalizeEmail,
  planInvite,
  toInvitationDto,
  type InviteInput,
} from '@/lib/tenancy/invitations'
import type { TenantContext } from '@/lib/tenancy/resolve'

const $transaction = db.$transaction as unknown as jest.Mock
const sendEmail = sendOrganizationInviteEmail as unknown as jest.Mock
const audit = writeTenantAudit as unknown as jest.Mock

const ctx: TenantContext = {
  organizationId: 'org-1',
  userId: 'actor-1',
  role: 'ADMIN',
  membershipId: 'ms-actor',
}

const baseInvite = (over: Partial<InviteInput> = {}): InviteInput => ({
  actorRole: 'ADMIN',
  email: 'new@example.com',
  role: 'MEMBER',
  existingMembershipStatus: null,
  ...over,
})

function wireTx(tx: Record<string, unknown>) {
  $transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx))
}

beforeEach(() => {
  jest.clearAllMocks()
  audit.mockResolvedValue('audit-1')
  sendEmail.mockResolvedValue({ success: true })
})

describe('planInvite · 纯判定', () => {
  it('ADMIN 邀请一个陌生邮箱 → 放行，默认 MEMBER', () => {
    expect(planInvite(baseInvite({ role: undefined }))).toEqual({
      ok: true,
      email: 'new@example.com',
      role: 'MEMBER',
    })
  })

  it('MEMBER 没有 member.invite → 403', () => {
    expect(planInvite(baseInvite({ actorRole: 'MEMBER' }))).toMatchObject({
      ok: false,
      status: 403,
      code: 'CAPABILITY_REQUIRED',
    })
  })

  it.each([['not-an-email'], ['a@b'], ['a b@c.com'], [''], [null], [42]])(
    '非法邮箱 %j → 400 INVALID_EMAIL',
    (email) => {
      expect(planInvite(baseInvite({ email }))).toMatchObject({ ok: false, code: 'INVALID_EMAIL' })
    },
  )

  it('非法角色 → 400', () => {
    expect(planInvite(baseInvite({ role: 'SUPERUSER' }))).toMatchObject({ ok: false, code: 'INVALID_ROLE' })
  })

  it('邀请成 OWNER → 403（所有权只能通过 org.transfer 转移）', () => {
    expect(planInvite(baseInvite({ role: 'OWNER' }))).toMatchObject({
      ok: false,
      status: 403,
      code: 'OWNER_GRANT_FORBIDDEN',
    })
  })

  it('已是 ACTIVE 成员 → 409 ALREADY_MEMBER', () => {
    expect(planInvite(baseInvite({ existingMembershipStatus: 'ACTIVE' }))).toMatchObject({
      ok: false,
      status: 409,
      code: 'ALREADY_MEMBER',
    })
  })

  it('负控：曾被移出（SUSPENDED）的人可以再次被邀请', () => {
    expect(planInvite(baseInvite({ existingMembershipStatus: 'SUSPENDED' })).ok).toBe(true)
  })

  it('邮箱统一小写并去空白', () => {
    expect(normalizeEmail('  New@Example.COM ')).toBe('new@example.com')
  })
})

describe('token · 生成与哈希', () => {
  it('token 足够长且两次不同', () => {
    const a = generateInviteToken()
    const b = generateInviteToken()
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).not.toBe(b)
  })

  it('哈希稳定、且不等于 token 本身（库里不存明文）', () => {
    const t = generateInviteToken()
    expect(hashInviteToken(t)).toBe(hashInviteToken(t))
    expect(hashInviteToken(t)).not.toBe(t)
    expect(hashInviteToken(t)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('接受链接带上 token', () => {
    expect(inviteAcceptUrl('abc')).toContain('/invitations/accept?token=abc')
  })
})

describe('createInvitation · 换票与发信', () => {
  it('重复邀请同一邮箱 → 旧 PENDING 被置 REVOKED，再建新票', async () => {
    ;(db.membership.findFirst as unknown as jest.Mock).mockResolvedValue(null)
    const tx = {
      organizationInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          id: 'inv-2',
          email: 'new@example.com',
          role: 'MEMBER',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 864e5),
          createdAt: new Date(),
          acceptedAt: null,
          revokedAt: null,
        }),
      },
    }
    wireTx(tx)

    const res = await createInvitation(ctx, { email: 'New@Example.com', role: 'MEMBER' })

    expect(tx.organizationInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', email: 'new@example.com', status: 'PENDING' },
        data: expect.objectContaining({ status: 'REVOKED' }),
      }),
    )
    expect(res.invitation.id).toBe('inv-2')
    expect(res.emailSent).toBe(true)
    expect(res.inviteUrl).toContain('token=')
  })

  it('邮件发送失败 → 邀请仍然成功，且如实返回 emailSent=false', async () => {
    ;(db.membership.findFirst as unknown as jest.Mock).mockResolvedValue(null)
    sendEmail.mockResolvedValue({ success: false, error: 'smtp down' })
    wireTx({
      organizationInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 'inv-3',
          email: 'new@example.com',
          role: 'MEMBER',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 864e5),
          createdAt: new Date(),
          acceptedAt: null,
          revokedAt: null,
        }),
      },
    })

    const res = await createInvitation(ctx, { email: 'new@example.com', role: 'MEMBER' })
    expect(res.emailSent).toBe(false)
    expect(res.emailError).toBe('smtp down')
    // 关键：不能因为发信失败就丢掉链接 —— 管理员还要用它手动传达。
    expect(res.inviteUrl).toContain('/invitations/accept?token=')
  })

  it('审计里不写完整邮箱（PII）', async () => {
    ;(db.membership.findFirst as unknown as jest.Mock).mockResolvedValue(null)
    wireTx({
      organizationInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 'inv-4',
          email: 'new@example.com',
          role: 'MEMBER',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 864e5),
          createdAt: new Date(),
          acceptedAt: null,
          revokedAt: null,
        }),
      },
    })
    await createInvitation(ctx, { email: 'new@example.com', role: 'MEMBER' })
    const meta = JSON.stringify(audit.mock.calls[0][0].safeMetadata)
    expect(meta).not.toContain('@')
    expect(audit.mock.calls[0][0].eventType).toBe('invitation.created')
  })
})

describe('acceptInvitation · 消费', () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    organizationId: 'org-1',
    email: 'new@example.com',
    role: 'MEMBER',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 864e5),
    ...over,
  })

  function txFor(invitation: unknown, membership: unknown = null) {
    return {
      organizationInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitation),
        update: jest.fn().mockResolvedValue({}),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue(membership),
        create: jest.fn().mockResolvedValue({ id: 'ms-new', role: 'MEMBER' }),
        update: jest.fn().mockResolvedValue({ id: 'ms-old', role: 'MEMBER' }),
      },
    }
  }

  it('token 不存在 → NotFound(INVALID_TOKEN)', async () => {
    wireTx(txFor(null))
    await expect(
      acceptInvitation({ userId: 'u1', userEmail: 'new@example.com', token: 'bad' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('已接受/已撤销 → Conflict NOT_PENDING', async () => {
    wireTx(txFor(pending({ status: 'ACCEPTED' })))
    await expect(
      acceptInvitation({ userId: 'u1', userEmail: 'new@example.com', token: 't' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('过期 → Conflict EXPIRED，并把状态惰性落库', async () => {
    const tx = txFor(pending({ expiresAt: new Date(Date.now() - 1000) }))
    wireTx(tx)
    await expect(
      acceptInvitation({ userId: 'u1', userEmail: 'new@example.com', token: 't' }),
    ).rejects.toMatchObject({ details: { code: 'EXPIRED' } })
    expect(tx.organizationInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    )
  })

  it('会话邮箱与邀请邮箱不一致 → 403 EMAIL_MISMATCH（防链接转发）', async () => {
    wireTx(txFor(pending()))
    await expect(
      acceptInvitation({ userId: 'u1', userEmail: 'attacker@evil.com', token: 't' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('已是 ACTIVE 成员 → 409 ALREADY_MEMBER', async () => {
    wireTx(txFor(pending(), { id: 'ms-old', status: 'ACTIVE' }))
    await expect(
      acceptInvitation({ userId: 'u1', userEmail: 'new@example.com', token: 't' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('成功（新成员）→ 建成员关系 + 邀请置 ACCEPTED + 审计', async () => {
    const tx = txFor(pending())
    wireTx(tx)
    const res = await acceptInvitation({ userId: 'u1', userEmail: 'New@Example.com', token: 't' })

    expect(tx.membership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', userId: 'u1', status: 'ACTIVE' }),
      }),
    )
    expect(tx.organizationInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCEPTED', acceptedBy: 'u1' }),
      }),
    )
    expect(res).toEqual({ organizationId: 'org-1', role: 'MEMBER', reactivated: false })
    expect(audit.mock.calls[0][0].eventType).toBe('invitation.accepted')
  })

  it('成功（曾被移出）→ 恢复同一条成员关系，不新建（否则撞唯一约束）', async () => {
    const tx = txFor(pending(), { id: 'ms-old', status: 'SUSPENDED' })
    wireTx(tx)
    const res = await acceptInvitation({ userId: 'u1', userEmail: 'new@example.com', token: 't' })

    expect(tx.membership.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ms-old' }, data: expect.objectContaining({ status: 'ACTIVE' }) }),
    )
    expect(tx.membership.create).not.toHaveBeenCalled()
    expect(res.reactivated).toBe(true)
  })
})

describe('toInvitationDto · 惰性过期', () => {
  it('PENDING 但已过期 → 展示为 EXPIRED', () => {
    const dto = toInvitationDto(
      {
        id: 'i',
        email: 'a@b.com',
        role: 'MEMBER',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        acceptedAt: null,
        revokedAt: null,
      },
      new Date(),
    )
    expect(dto.status).toBe('EXPIRED')
  })

  it('ACCEPTED 不会被过期判定改写（终态优先）', () => {
    const dto = toInvitationDto(
      {
        id: 'i',
        email: 'a@b.com',
        role: 'MEMBER',
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        acceptedAt: new Date(),
        revokedAt: null,
      },
      new Date(),
    )
    expect(dto.status).toBe('ACCEPTED')
  })
})
