/**
 * T01 · 跨租户隔离负测（AC-01 / AC-02）
 *
 * 覆盖四类必须 100% 被拒的情形：
 *   1. 匿名（无会话）
 *   2. 会话失效（过期 token / 密码已改 → requireAuth 抛 401）
 *   3. 越权（角色能力不足）
 *   4. 跨租户（访问自己不属于的租户）
 *
 * 隔离原则（contracts/schema.sql:64）：「绝不信任客户端传入的 organization_id」
 * 在实现上等价于 —— **传入的 id 只作选择器，授权必须回查 memberships**。
 * 下面「查询必须同时以 userId 与 organizationId 为谓词」这条断言，
 * 就是钉死该原则的防回归锁。
 */

jest.mock('@/lib/db', () => ({
  db: {
    membership: { findFirst: jest.fn(), findMany: jest.fn() },
    tenantAuditEvent: { create: jest.fn(), findMany: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({
  requireAuth: jest.fn(),
}))

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import {
  resolveTenant,
  resolveTenantForUser,
  listTenants,
  isMemberOf,
} from '@/lib/tenancy/resolve'
import { assertCapability, hasCapability } from '@/lib/tenancy/guard'
import { UnauthorizedError, ForbiddenError } from '@/lib/errors'

const mFindFirst = db.membership.findFirst as unknown as jest.Mock
const mFindMany = db.membership.findMany as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const requireAuthMock = requireAuth as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
})

describe('T01 · 跨租户隔离', () => {
  describe('AC-01 — 身份校验（匿名 / 会话失效）', () => {
    it('匿名请求 → 401，且不触达租户查询', async () => {
      requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))

      await expect(resolveTenant()).rejects.toBeInstanceOf(UnauthorizedError)
      expect(mFindFirst).not.toHaveBeenCalled()
    })

    it('会话失效（过期 token / 密码已改）→ 401，且不触达租户查询', async () => {
      requireAuthMock.mockRejectedValue(
        new UnauthorizedError('Session expired. Please sign in again.')
      )

      await expect(resolveTenant()).rejects.toBeInstanceOf(UnauthorizedError)
      expect(mFindFirst).not.toHaveBeenCalled()
    })

    it('游客会话 → 401（由 requireAuth 拒绝）', async () => {
      requireAuthMock.mockRejectedValue(
        new UnauthorizedError('Guest sessions cannot perform this action. Please log in.')
      )

      await expect(resolveTenant()).rejects.toBeInstanceOf(UnauthorizedError)
    })
  })

  describe('AC-02 — 跨租户（访问不属于自己的租户）', () => {
    it('指定他人租户 → 403，并写 access_denied 审计', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_attacker' } })
      mFindFirst.mockResolvedValue(null) // 回查不到成员关系

      await expect(
        resolveTenant({ organizationId: 'org_victim' })
      ).rejects.toBeInstanceOf(ForbiddenError)

      expect(auditCreate).toHaveBeenCalledTimes(1)
      const row = auditCreate.mock.calls[0][0].data
      expect(row.eventType).toBe('tenant.access_denied')
      expect(row.organizationId).toBe('org_victim')
      expect(row.actorId).toBe('u_attacker')
    })

    it('🔒 防回归：查询必须同时以 userId 与 organizationId 为谓词', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
      mFindFirst.mockResolvedValue(null)

      await expect(
        resolveTenant({ organizationId: 'org_B' })
      ).rejects.toBeInstanceOf(ForbiddenError)

      const where = mFindFirst.mock.calls[0][0].where
      // 若有人把 userId 从 where 里去掉，就退化成「只按 orgId 查」——
      // 那意味着任何登录用户都能读任意租户。此断言即为此而设。
      expect(where.userId).toBe('u_1')
      expect(where.organizationId).toBe('org_B')
      expect(where.status).toBe('ACTIVE')
      expect(where.organization).toEqual({ status: 'ACTIVE' })
    })

    it('未指定租户时不得引入 organizationId 谓词（走默认租户）', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
      mFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: 'org_1', role: 'MEMBER' })

      await resolveTenant()

      const args = mFindFirst.mock.calls[0][0]
      expect(args.where.organizationId).toBeUndefined()
      expect(args.orderBy).toEqual({ createdAt: 'asc' })
    })
  })

  describe('租户边界 — 停用 / 无成员 / 脏角色', () => {
    it('用户不属于任何租户 → 403', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_orphan' } })
      mFindFirst.mockResolvedValue(null)

      await expect(resolveTenant()).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('租户被停用 → 403（where 已限定 organization.status=ACTIVE，DB 返回 null 即停用）', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
      mFindFirst.mockResolvedValue(null)

      await expect(
        resolveTenant({ organizationId: 'org_suspended' })
      ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('成员被停用 → 403（where 已限定 membership.status=ACTIVE）', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
      mFindFirst.mockResolvedValue(null)

      await expect(resolveTenant()).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('DB 出现矩阵未定义的角色 → 403（fail-closed，不猜测意图）', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
      mFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: 'org_1', role: 'SUPERADMIN' })

      await expect(resolveTenant()).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('无租户的 403 不写审计（避免正常场景刷屏）', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_orphan' } })
      mFindFirst.mockResolvedValue(null)

      await expect(resolveTenant()).rejects.toBeInstanceOf(ForbiddenError)
      expect(auditCreate).not.toHaveBeenCalled()
    })
  })

  describe('成功路径', () => {
    it('合法 ACTIVE 成员 → 返回已授权上下文', async () => {
      requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
      mFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: 'org_1', role: 'OPERATOR' })

      const ctx = await resolveTenant()

      expect(ctx).toEqual({
        organizationId: 'org_1',
        userId: 'u_1',
        role: 'OPERATOR',
        membershipId: 'ms_1',
      })
    })

    it('resolveTenantForUser 不经过会话校验（供脚本/迁移使用）', async () => {
      mFindFirst.mockResolvedValue({ id: 'ms_9', organizationId: 'org_9', role: 'OWNER' })

      const ctx = await resolveTenantForUser('u_9')

      expect(ctx.role).toBe('OWNER')
      expect(requireAuthMock).not.toHaveBeenCalled()
    })
  })

  describe('越权 — 角色能力不足', () => {
    it('MEMBER 执行 member.invite → 抛 403', () => {
      const ctx = { organizationId: 'o', userId: 'u', role: 'MEMBER' as const, membershipId: 'm' }
      expect(hasCapability(ctx, 'member.invite')).toBe(false)
      expect(() => assertCapability(ctx, 'member.invite')).toThrow(ForbiddenError)
    })

    it('OPERATOR 执行 org.delete → 抛 403', () => {
      const ctx = { organizationId: 'o', userId: 'u', role: 'OPERATOR' as const, membershipId: 'm' }
      expect(() => assertCapability(ctx, 'org.delete')).toThrow(ForbiddenError)
    })

    it('ADMIN 执行 org.transfer → 抛 403', () => {
      const ctx = { organizationId: 'o', userId: 'u', role: 'ADMIN' as const, membershipId: 'm' }
      expect(() => assertCapability(ctx, 'org.transfer')).toThrow(ForbiddenError)
    })

    it('OPERATOR 不能核验结果（计费归因属管理员权限）', () => {
      const ctx = { organizationId: 'o', userId: 'u', role: 'OPERATOR' as const, membershipId: 'm' }
      expect(() => assertCapability(ctx, 'outcome.verify')).toThrow(ForbiddenError)
    })

    it('OWNER 执行 org.delete → 放行', () => {
      const ctx = { organizationId: 'o', userId: 'u', role: 'OWNER' as const, membershipId: 'm' }
      expect(() => assertCapability(ctx, 'org.delete')).not.toThrow()
    })

    it('MEMBER 执行 mission.create → 抛 403', () => {
      const ctx = { organizationId: 'o', userId: 'u', role: 'MEMBER' as const, membershipId: 'm' }
      expect(() => assertCapability(ctx, 'mission.create')).toThrow(ForbiddenError)
    })
  })

  describe('listTenants / isMemberOf', () => {
    it('listTenants 过滤掉未知角色（不把脏数据带给前端）', async () => {
      mFindMany.mockResolvedValue([
        { organizationId: 'org_1', role: 'OWNER', organization: { name: 'A', slug: 'a' } },
        { organizationId: 'org_2', role: 'SUPERADMIN', organization: { name: 'B', slug: 'b' } },
      ])

      const list = await listTenants('u_1')

      expect(list).toHaveLength(1)
      expect(list[0]).toEqual({ organizationId: 'org_1', name: 'A', slug: 'a', role: 'OWNER' })
    })

    it('isMemberOf 命中时为 true，未命中为 false', async () => {
      mFindFirst.mockResolvedValueOnce({ id: 'ms_1' })
      await expect(isMemberOf('u_1', 'org_1')).resolves.toBe(true)

      mFindFirst.mockResolvedValueOnce(null)
      await expect(isMemberOf('u_1', 'org_2')).resolves.toBe(false)
    })
  })
})
