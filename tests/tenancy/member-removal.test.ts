/**
 * T07 · 成员移除 —— 判定与写入
 *
 * 重点守两条，这两条恰好是最容易被"踢人"这个动作忽略的：
 *   1. **不能移除最后一名 ACTIVE 管理员**（移除比降级更容易踩到）；
 *   2. **软移出**：只把状态置 SUSPENDED，不删行 —— 审计要能对得上，
 *      且 `resolveTenant()` 只认 ACTIVE，所以下一次请求就 403。
 */

jest.mock('@/lib/db', () => ({
  db: { $transaction: jest.fn() },
}))

jest.mock('@/lib/tenancy/audit', () => ({
  writeTenantAudit: jest.fn().mockResolvedValue('audit-1'),
}))

import { db } from '@/lib/db'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { planMemberRemoval, removeMember, type MemberRemovalInput } from '@/lib/tenancy/member-removal'
import type { TenantContext } from '@/lib/tenancy/resolve'

const $transaction = db.$transaction as unknown as jest.Mock
const audit = writeTenantAudit as unknown as jest.Mock

const base = (over: Partial<MemberRemovalInput> = {}): MemberRemovalInput => ({
  actorRole: 'ADMIN',
  actorUserId: 'actor-1',
  target: { userId: 'u-target', role: 'MEMBER', status: 'ACTIVE' },
  activeAdminCount: 2,
  ...over,
})

const ctx: TenantContext = {
  organizationId: 'org-1',
  userId: 'actor-1',
  role: 'ADMIN',
  membershipId: 'ms-actor',
}

const row = {
  id: 'ms-target',
  userId: 'u-target',
  role: 'MEMBER',
  status: 'ACTIVE',
}

function wireTx(over: { target?: unknown; count?: number } = {}) {
  const tx = {
    membership: {
      findFirst: jest.fn().mockResolvedValue(over.target === undefined ? row : over.target),
      count: jest.fn().mockResolvedValue(over.count ?? 2),
      update: jest.fn().mockImplementation(async (args: { data: { status: string } }) => ({
        ...row,
        ...args.data,
        user: { id: 'u-target', email: 't@example.com', name: 'T', image: null },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    },
  }
  $transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx))
  return tx
}

beforeEach(() => {
  jest.clearAllMocks()
  audit.mockResolvedValue('audit-1')
})

describe('planMemberRemoval · 纯判定', () => {
  it('ADMIN 移除普通 MEMBER → 放行', () => {
    expect(planMemberRemoval(base())).toEqual({ ok: true, role: 'MEMBER' })
  })

  it('没有 member.remove → 403 CAPABILITY_REQUIRED', () => {
    const d = planMemberRemoval(base({ actorRole: 'MEMBER' }))
    expect(d).toMatchObject({ ok: false, status: 403, code: 'CAPABILITY_REQUIRED' })
  })

  it('移除自己 → 409 SELF_REMOVE（退出组织是另一个语义）', () => {
    const d = planMemberRemoval(base({ target: { userId: 'actor-1', role: 'MEMBER', status: 'ACTIVE' } }))
    expect(d).toMatchObject({ ok: false, status: 409, code: 'SELF_REMOVE' })
  })

  it('非 OWNER 移除 OWNER → 403 OWNER_PROTECTED', () => {
    const d = planMemberRemoval(base({ target: { userId: 'u-owner', role: 'OWNER', status: 'ACTIVE' } }))
    expect(d).toMatchObject({ ok: false, status: 403, code: 'OWNER_PROTECTED' })
  })

  it('OWNER 移除 OWNER → 放行（所有权链由 org.transfer 管，不在这里拦）', () => {
    const d = planMemberRemoval(
      base({ actorRole: 'OWNER', target: { userId: 'u-owner2', role: 'OWNER', status: 'ACTIVE' } }),
    )
    expect(d.ok).toBe(true)
  })

  it('目标已不是 ACTIVE → 400 NOT_ACTIVE（不谎报"移除成功"）', () => {
    const d = planMemberRemoval(base({ target: { userId: 'u-target', role: 'MEMBER', status: 'SUSPENDED' } }))
    expect(d).toMatchObject({ ok: false, status: 400, code: 'NOT_ACTIVE' })
  })

  it('移除最后一名 ACTIVE 管理员 → 409 LAST_ADMIN', () => {
    const d = planMemberRemoval(
      base({
        target: { userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE' },
        activeAdminCount: 1,
      }),
    )
    expect(d).toMatchObject({ ok: false, status: 409, code: 'LAST_ADMIN' })
  })

  it('负控：管理员数为 1 时**移除普通成员**必须放行（门禁不能宽到挡正常操作）', () => {
    const d = planMemberRemoval(base({ activeAdminCount: 1 }))
    expect(d.ok).toBe(true)
  })

  it('管理员数为 2 时可以移除其中一名管理员', () => {
    const d = planMemberRemoval(
      base({ target: { userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE' }, activeAdminCount: 2 }),
    )
    expect(d.ok).toBe(true)
  })
})

describe('removeMember · 写入', () => {
  it('软移出：只改 status=SUSPENDED，不动角色', async () => {
    const tx = wireTx()
    const dto = await removeMember(ctx, 'ms-target')

    expect(tx.membership.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ms-target' }, data: { status: 'SUSPENDED' } }),
    )
    expect(dto).toMatchObject({ membershipId: 'ms-target', status: 'SUSPENDED' })
  })

  it('写一条 membership.removed 审计，且元数据不含用户身份', async () => {
    wireTx()
    await removeMember(ctx, 'ms-target')

    expect(audit).toHaveBeenCalledTimes(1)
    const arg = audit.mock.calls[0][0]
    expect(arg.eventType).toBe('membership.removed')
    expect(arg.resourceId).toBe('ms-target')
    expect(JSON.stringify(arg.safeMetadata)).not.toContain('u-target')
    expect(JSON.stringify(arg.safeMetadata)).not.toContain('@')
  })

  it('跨租户的 membershipId → 404（不是 403，403 会泄露 id 存在）', async () => {
    wireTx({ target: null })
    await expect(removeMember(ctx, 'ms-other-org')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('事务内实时计数：count=1 且目标是管理员 → 409 LAST_ADMIN，不写库', async () => {
    const tx = wireTx({ target: { ...row, role: 'ADMIN' }, count: 1 })
    await expect(removeMember(ctx, 'ms-target')).rejects.toBeInstanceOf(ConflictError)
    expect(tx.membership.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('服务层独立校验能力（纵深防御：脚本可直接调服务函数）', async () => {
    wireTx()
    await expect(removeMember({ ...ctx, role: 'MEMBER' }, 'ms-target')).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('审计写失败不影响移除结果', async () => {
    wireTx()
    audit.mockRejectedValue(new Error('audit down'))
    await expect(removeMember(ctx, 'ms-target')).resolves.toMatchObject({ membershipId: 'ms-target' })
  })
})
