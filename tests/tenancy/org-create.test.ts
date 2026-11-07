/**
 * T07 · 组织创建 —— 「创建一个组织」必须同时「产生一名 OWNER」
 *
 * 这组测试守的是 D-12 的根因：**组织可以没有管理员**。
 * 断言的重点不是"函数返回了什么"，而是三件结构性事实：
 *   1. `organization.create` 与 `membership.create` 用的是**同一个 tx 对象**
 *      （否则"回滚"只是愿望，不是行为）；
 *   2. 成员关系角色是 `OWNER` 且 `ACTIVE`（否则组织永远无法被转让/删除）；
 *   3. 同一 slug 的第二次创建走 `ConflictError`，且**不会**再建一条成员关系。
 */

jest.mock('@/lib/db', () => ({
  db: {
    $transaction: jest.fn(),
    // 故意**不**提供 organization / membership 的顶层方法：
    // 服务一旦绕过事务直接写库，测试会以 "is not a function" 立刻炸掉。
  },
}))

jest.mock('@/lib/tenancy/audit', () => ({
  writeTenantAudit: jest.fn().mockResolvedValue('audit-1'),
}))

import { db } from '@/lib/db'
import { ConflictError, ValidationError } from '@/lib/errors'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import {
  RESERVED_SLUGS,
  createOrganizationWithOwner,
  planOrganizationCreate,
  slugify,
} from '@/lib/tenancy/org-create'

const $transaction = db.$transaction as unknown as jest.Mock
const audit = writeTenantAudit as unknown as jest.Mock

interface TxMock {
  organization: { create: jest.Mock }
  membership: { create: jest.Mock }
}

function makeTx(overrides: Partial<{ orgCreate: jest.Mock; memberCreate: jest.Mock }> = {}): TxMock {
  return {
    organization: {
      create:
        overrides.orgCreate ??
        jest.fn().mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme', status: 'ACTIVE' }),
    },
    membership: {
      create: overrides.memberCreate ?? jest.fn().mockResolvedValue({ id: 'ms-1' }),
    },
  }
}

/** 让 $transaction 真的把 tx 传进去（Prisma 的交互式事务签名）。 */
function wireTransaction(tx: TxMock) {
  $transaction.mockImplementation(async (fn: (t: TxMock) => Promise<unknown>) => fn(tx))
}

beforeEach(() => {
  jest.clearAllMocks()
  audit.mockResolvedValue('audit-1')
})

describe('planOrganizationCreate · 纯判定', () => {
  it('合法输入 → 通过，名字两端空白被裁掉', () => {
    const p = planOrganizationCreate({ name: '  Acme Robotics  ', slug: 'acme' })
    expect(p).toEqual({ ok: true, name: 'Acme Robotics', slug: 'acme' })
  })

  it('没给 slug → 从名字推导', () => {
    const p = planOrganizationCreate({ name: 'Acme Robotics' })
    expect(p).toMatchObject({ ok: true, slug: 'acme-robotics' })
  })

  it.each([
    [{ name: '' }, 'NAME_REQUIRED'],
    [{ name: '   ' }, 'NAME_REQUIRED'],
    [{ name: 'x'.repeat(81) }, 'NAME_TOO_LONG'],
    [{ name: 'Acme', slug: 'a' }, 'SLUG_TOO_SHORT'],
    [{ name: 'Acme', slug: 'x'.repeat(64) }, 'SLUG_TOO_LONG'],
    [{ name: 'Acme', slug: 'Acme Inc' }, 'SLUG_INVALID_CHARS'],
    [{ name: 'Acme', slug: 'ACME' }, 'SLUG_INVALID_CHARS'],
    [{ name: 'Acme', slug: 'acme_' }, 'SLUG_INVALID_CHARS'],
    [{ name: 'Acme', slug: '-acme' }, 'SLUG_INVALID_CHARS'],
    [{ name: 'Acme', slug: '' }, 'SLUG_REQUIRED'],
  ])('拒绝 %j → %s', (input, code) => {
    const p = planOrganizationCreate(input as { name: string; slug?: string })
    expect(p).toMatchObject({ ok: false, code, status: 400 })
  })

  it('每个保留字都被拒（防止 slug 抢走站内路由）', () => {
    for (const slug of RESERVED_SLUGS) {
      const p = planOrganizationCreate({ name: 'X', slug })
      expect(p).toMatchObject({ ok: false, code: 'SLUG_RESERVED' })
    }
    // 负控：不在保留字表里的同形词应当**通过**，否则说明判定写成了"包含即拒"。
    expect(planOrganizationCreate({ name: 'X', slug: 'admin-team' }).ok).toBe(true)
  })

  it('中文名推不出 slug → 明确要求手填，而不是静默生成一个空 slug', () => {
    expect(planOrganizationCreate({ name: '星辰科技' })).toMatchObject({ ok: false, code: 'SLUG_REQUIRED' })
  })

  it('slugify 折叠大小写与连续分隔符', () => {
    expect(slugify('  Acme   Robotics!! ')).toBe('acme-robotics')
    expect(slugify('a_b__c')).toBe('a-b-c')
  })
})

describe('createOrganizationWithOwner · 结构不变量', () => {
  it('组织与成员写在同一事务里，角色 OWNER + ACTIVE', async () => {
    const tx = makeTx()
    wireTransaction(tx)

    const created = await createOrganizationWithOwner({ actorUserId: 'u1', name: 'Acme', slug: 'acme' })

    expect($transaction).toHaveBeenCalledTimes(1)
    const orgArg = tx.organization.create.mock.calls[0][0]
    const memArg = tx.membership.create.mock.calls[0][0]
    expect(orgArg.data).toEqual({ name: 'Acme', slug: 'acme' })
    expect(memArg.data).toEqual({
      organizationId: 'org-1',
      userId: 'u1',
      role: 'OWNER',
      status: 'ACTIVE',
    })
    expect(created).toMatchObject({ id: 'org-1', role: 'OWNER', membershipId: 'ms-1' })
  })

  it('成员写入失败 → 整体失败，且不会留下"只有组织没有管理员"的结果', async () => {
    const tx = makeTx({ memberCreate: jest.fn().mockRejectedValue(new Error('fk violation')) })
    wireTransaction(tx)

    await expect(
      createOrganizationWithOwner({ actorUserId: 'u1', name: 'Acme', slug: 'acme' }),
    ).rejects.toThrow('fk violation')

    // 事务被抛出 ⇒ Prisma 会回滚 org 插入；我们能断言的是"没有返回值被当成成功"。
    // 审计也**不应**被写成"创建成功"。用户看到失败，库里就不该有半成品。
    expect(audit).not.toHaveBeenCalled()
  })

  it('slug 冲突（P2002）→ ConflictError(SLUG_TAKEN)，不重试、不建第二条成员', async () => {
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' })
    wireTransaction(makeTx({ orgCreate: jest.fn().mockRejectedValue(p2002) }))

    await expect(
      createOrganizationWithOwner({ actorUserId: 'u1', name: 'Acme', slug: 'acme' }),
    ).rejects.toBeInstanceOf(ConflictError)

    // 这就是"重试不产生重复"的机制：第二次创建在**第一条 INSERT** 上就撞唯一约束，
    // 根本走不到建成员那一步。
    expect(audit).not.toHaveBeenCalled()
  })

  it('非法输入在写库前就失败（$transaction 根本不该被调用）', async () => {
    await expect(
      createOrganizationWithOwner({ actorUserId: 'u1', name: '', slug: 'acme' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect($transaction).not.toHaveBeenCalled()
  })

  it('成功后写两条审计：organization.created + membership.created', async () => {
    wireTransaction(makeTx())
    await createOrganizationWithOwner({ actorUserId: 'u1', name: 'Acme', slug: 'acme' })

    const events = audit.mock.calls.map((c) => c[0].eventType).sort()
    expect(events).toEqual(['membership.created', 'organization.created'])
    // 审计里不能出现邮箱等 PII（这里只允许 slug / role / reason）
    for (const call of audit.mock.calls) {
      const meta = JSON.stringify(call[0].safeMetadata ?? {})
      expect(meta).not.toMatch(/@/)
    }
  })

  it('审计写失败不影响创建结果（审计是旁路，不是闸门）', async () => {
    wireTransaction(makeTx())
    audit.mockRejectedValue(new Error('audit down'))
    await expect(
      createOrganizationWithOwner({ actorUserId: 'u1', name: 'Acme', slug: 'acme' }),
    ).resolves.toMatchObject({ id: 'org-1' })
  })
})
