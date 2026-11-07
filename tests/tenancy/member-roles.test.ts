/**
 * T07 · 成员角色变更的**纯判定**（`planRoleChange`）
 *
 * 为什么这一层值钱：角色变更是"能把一个组织锁死"的唯一入口。
 * 把它写成纯函数，就能把每个拒绝原因**逐条穷举**，而不是靠跑一遍数据库碰运气。
 *
 * 每条正向用例都有一个对应的负向用例（同一输入改一个字段就翻转结论），
 * 否则「允许」可能只是因为那条判断根本没被执行到。
 */

import {
  ADMIN_EQUIVALENT_ROLES,
  isAdminEquivalent,
  parseMemberRolePatch,
  planRoleChange,
  type RoleChangeInput,
} from '@/lib/tenancy/member-roles'
import type { TenantRole } from '@/lib/tenancy/capabilities'

const ACTOR = 'u_actor'
const TARGET = 'u_target'

function input(over: Partial<RoleChangeInput> = {}): RoleChangeInput {
  return {
    actorRole: 'OWNER',
    actorUserId: ACTOR,
    target: { userId: TARGET, role: 'MEMBER', status: 'ACTIVE' },
    nextRole: 'OPERATOR',
    activeAdminCount: 2,
    ...over,
  }
}

function rejection(over: Partial<RoleChangeInput>) {
  const decision = planRoleChange(input(over))
  if (decision.ok) throw new Error(`expected rejection, got ok (${over.nextRole})`)
  return decision
}

describe('planRoleChange · 能力关卡', () => {
  it.each<TenantRole>(['MEMBER', 'OPERATOR'])('%s 一律 403 CAPABILITY_REQUIRED', (actorRole) => {
    const r = rejection({ actorRole })
    expect(r.status).toBe(403)
    expect(r.code).toBe('CAPABILITY_REQUIRED')
  })

  it.each<TenantRole>(['ADMIN', 'OWNER'])('%s 具备 member.update_role（正向对照）', (actorRole) => {
    const d = planRoleChange(input({ actorRole }))
    expect(d.ok).toBe(true)
  })
})

describe('planRoleChange · 取值与空操作', () => {
  it('非法角色 → 400 INVALID_ROLE', () => {
    const r = rejection({ nextRole: 'SUPERADMIN' as TenantRole })
    expect(r.status).toBe(400)
    expect(r.code).toBe('INVALID_ROLE')
  })

  it('新旧角色相同 → 400 NO_CHANGE（不能"成功但没改"）', () => {
    const r = rejection({ nextRole: 'MEMBER' })
    expect(r.status).toBe(400)
    expect(r.code).toBe('NO_CHANGE')
  })

  it('改成别的合法角色 → 放行（NO_CHANGE 的负向对照）', () => {
    const d = planRoleChange(
      input({
        target: { userId: TARGET, role: 'OPERATOR', status: 'ACTIVE' },
        nextRole: 'MEMBER',
      })
    )
    expect(d.ok).toBe(true)
  })
})

describe('planRoleChange · OWNER 保护', () => {
  it('ADMIN 改动 OWNER 的角色 → 403 OWNER_PROTECTED', () => {
    const r = rejection({
      actorRole: 'ADMIN',
      target: { userId: TARGET, role: 'OWNER', status: 'ACTIVE' },
      nextRole: 'ADMIN',
    })
    expect(r.status).toBe(403)
    expect(r.code).toBe('OWNER_PROTECTED')
  })

  it('OWNER 改动自己的角色会先撞上 SELF_ROLE_CHANGE（不是 OWNER_PROTECTED）', () => {
    const r = rejection({
      actorRole: 'OWNER',
      actorUserId: TARGET,
      target: { userId: TARGET, role: 'OWNER', status: 'ACTIVE' },
      nextRole: 'ADMIN',
    })
    expect(r.code).toBe('SELF_ROLE_CHANGE')
  })

  it.each<TenantRole>(['OWNER', 'ADMIN'])('%s 都不能通过 PATCH 授予 OWNER', (actorRole) => {
    const r = rejection({
      actorRole,
      target: { userId: TARGET, role: 'ADMIN', status: 'ACTIVE' },
      nextRole: 'OWNER',
    })
    expect(r.status).toBe(403)
    expect(r.code).toBe('OWNER_GRANT_FORBIDDEN')
  })
})

describe('planRoleChange · 自我修改', () => {
  it('改自己的角色 → 409 SELF_ROLE_CHANGE（含自我提权）', () => {
    const r = rejection({
      actorRole: 'ADMIN',
      actorUserId: TARGET,
      target: { userId: TARGET, role: 'ADMIN', status: 'ACTIVE' },
      nextRole: 'OPERATOR',
    })
    expect(r.status).toBe(409)
    expect(r.code).toBe('SELF_ROLE_CHANGE')
  })

  it('同样输入、只因 actor 是别人 → 放行（自我修改的负向对照）', () => {
    const d = planRoleChange(
      input({
        actorRole: 'ADMIN',
        actorUserId: ACTOR,
        target: { userId: TARGET, role: 'ADMIN', status: 'ACTIVE' },
        nextRole: 'OPERATOR',
        activeAdminCount: 2,
      })
    )
    expect(d.ok).toBe(true)
  })
})

describe('planRoleChange · LAST_ADMIN（这条是 D-12 的正题）', () => {
  it('把最后一名管理员降级 → 409 LAST_ADMIN', () => {
    const r = rejection({
      actorRole: 'ADMIN',
      target: { userId: TARGET, role: 'ADMIN', status: 'ACTIVE' },
      nextRole: 'OPERATOR',
      activeAdminCount: 1,
    })
    expect(r.status).toBe(409)
    expect(r.code).toBe('LAST_ADMIN')
  })

  it('管理员数量为 2 时同样的降级 → 放行（负向对照）', () => {
    const d = planRoleChange(
      input({
        actorRole: 'ADMIN',
        target: { userId: TARGET, role: 'ADMIN', status: 'ACTIVE' },
        nextRole: 'OPERATOR',
        activeAdminCount: 2,
      })
    )
    expect(d.ok).toBe(true)
  })

  it('目标不是管理员时，管理员只剩 1 也不拦（negative control）', () => {
    const d = planRoleChange(
      input({
        target: { userId: TARGET, role: 'OPERATOR', status: 'ACTIVE' },
        nextRole: 'MEMBER',
        activeAdminCount: 1,
      })
    )
    expect(d.ok).toBe(true)
  })

  it('目标不是 ACTIVE（INVITED/SUSPENDED）时不占用管理员配额', () => {
    const d = planRoleChange(
      input({
        target: { userId: TARGET, role: 'ADMIN', status: 'SUSPENDED' },
        nextRole: 'MEMBER',
        activeAdminCount: 1,
      })
    )
    expect(d.ok).toBe(true)
  })

  it('把最后一名管理员**提级**为 OWNER 也被拦（授予 OWNER 走 org.transfer）', () => {
    const r = rejection({
      actorRole: 'ADMIN',
      target: { userId: TARGET, role: 'ADMIN', status: 'ACTIVE' },
      nextRole: 'OWNER',
      activeAdminCount: 1,
    })
    expect(r.code).toBe('OWNER_GRANT_FORBIDDEN')
  })
})

describe('isAdminEquivalent / ADMIN_EQUIVALENT_ROLES', () => {
  it('OWNER 与 ADMIN 等价，其余不等价', () => {
    expect(ADMIN_EQUIVALENT_ROLES).toEqual(['OWNER', 'ADMIN'])
    expect(isAdminEquivalent('OWNER')).toBe(true)
    expect(isAdminEquivalent('ADMIN')).toBe(true)
    expect(isAdminEquivalent('OPERATOR')).toBe(false)
    expect(isAdminEquivalent('MEMBER')).toBe(false)
    expect(isAdminEquivalent(null)).toBe(false)
  })
})

describe('parseMemberRolePatch', () => {
  it('大小写宽松：admin → ADMIN', () => {
    expect(parseMemberRolePatch({ role: 'admin' }).role).toBe('ADMIN')
    expect(parseMemberRolePatch({ role: '  Owner  ' }).role).toBe('OWNER')
  })

  it('缺 role → 400', () => {
    expect(() => parseMemberRolePatch({})).toThrow(/role is required/)
  })

  it('role 非字符串 → 400', () => {
    expect(() => parseMemberRolePatch({ role: 3 })).toThrow(/must be a string/)
  })

  it('未知角色 → 400（不做静默跳过）', () => {
    expect(() => parseMemberRolePatch({ role: 'superuser' })).toThrow(/must be one of/)
  })

  it('非法请求体形状 → 400', () => {
    expect(() => parseMemberRolePatch(null)).toThrow(/JSON object/)
    expect(() => parseMemberRolePatch([])).toThrow(/JSON object/)
    expect(() => parseMemberRolePatch('ADMIN')).toThrow(/JSON object/)
  })

  it('未知键忽略（向前兼容）', () => {
    expect(parseMemberRolePatch({ role: 'member', note: 'x' }).role).toBe('MEMBER')
  })
})

describe('planRoleChange · 判定顺序不能靠巧合成立', () => {
  it('无能力 + 自我修改 同时成立时，先报能力（403 优先于 409）', () => {
    const r = rejection({
      actorRole: 'MEMBER',
      actorUserId: TARGET,
      target: { userId: TARGET, role: 'MEMBER', status: 'ACTIVE' },
      nextRole: 'ADMIN',
    })
    expect(r.code).toBe('CAPABILITY_REQUIRED')
  })

  it('OWNER 保护优先于"授予 OWNER"（ADMIN 改 OWNER 的报因是保护，不是授予）', () => {
    const r = rejection({
      actorRole: 'ADMIN',
      target: { userId: TARGET, role: 'OWNER', status: 'ACTIVE' },
      nextRole: 'OWNER',
    })
    expect(r.code).toBe('NO_CHANGE')
  })
})
