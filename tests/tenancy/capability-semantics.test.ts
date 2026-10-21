/**
 * V17 · 能力集合语义（WB17-01 / SEC-06）
 *
 * 为什么单独一个文件：`withTenant` 曾把「数组」按 `some()`（任一满足）判定，
 * 而调用方写数组时想表达的通常是「两个都要」。这就是 PRD 里说的
 * **「混入弱能力 ⇒ 静默降级」** —— 它不报错、不告警，只是把门开得比预期大。
 *
 * 本文件把三种语义钉死，并加一条**变异可证伪**的单调性断言：
 *   - `withTenant(cap)`      → 单能力（类型层禁数组，运行时兜底）
 *   - `withTenantAll([...])` → 合取，缺一即 403
 *   - `withTenantAny([...])` → 析取，仅用于入口等价
 *
 * 这些断言的价值在**反向**：如果有人把 `every` 改回 `some`，第二条用例会立刻红。
 */

jest.mock('@/lib/db', () => ({
  db: {
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import {
  ROLE_CAPABILITIES,
  TENANT_CAPABILITIES,
  type TenantCapability,
  type TenantRole,
} from '@/lib/tenancy/capabilities'
import { withTenant, withTenantAll, withTenantAny } from '@/lib/tenancy/guard'

const requireAuthMock = requireAuth as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock

const ORG = 'org_A'
const ME = 'u_me'

function asRole(role: TenantRole) {
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

function request() {
  return new NextRequest(new URL('/api/v1/probe', 'http://localhost'), { method: 'GET' })
}

async function run(
  wrapper: ReturnType<typeof withTenant>,
  body: (role: string) => NextResponse = (role) => NextResponse.json({ ok: true, role })
) {
  const handler = wrapper(async (_req, tenant) => body(tenant.role))
  return handler(request())
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
})

describe('能力矩阵的结构性不变量', () => {
  it('前置非空：能力表与每个角色都不是空集（空集会让下面的断言恒真）', () => {
    expect(TENANT_CAPABILITIES.length).toBeGreaterThan(20)
    for (const role of ['MEMBER', 'OPERATOR', 'ADMIN', 'OWNER'] as TenantRole[]) {
      expect(ROLE_CAPABILITIES[role].size).toBeGreaterThan(0)
    }
  })

  it('能力名不得越界：角色表里出现的每个能力都必须在 TENANT_CAPABILITIES 里', () => {
    const declared = new Set<string>(TENANT_CAPABILITIES)
    for (const role of ['MEMBER', 'OPERATOR', 'ADMIN', 'OWNER'] as TenantRole[]) {
      for (const cap of ROLE_CAPABILITIES[role]) {
        expect(declared.has(cap)).toBe(true)
      }
    }
  })

  it('角色能力单调：MEMBER ⊆ OPERATOR ⊆ ADMIN ⊆ OWNER', () => {
    const order: TenantRole[] = ['MEMBER', 'OPERATOR', 'ADMIN', 'OWNER']
    for (let i = 0; i < order.length - 1; i += 1) {
      const lower = ROLE_CAPABILITIES[order[i]]
      const higher = ROLE_CAPABILITIES[order[i + 1]]
      for (const cap of TENANT_CAPABILITIES) {
        if (lower.has(cap)) {
          // 高角色缺低角色的能力 = 权限模型出现断层，属于必须人工复核的结构缺陷
          expect({ role: order[i + 1], cap, granted: higher.has(cap) }).toEqual({
            role: order[i + 1],
            cap,
            granted: true,
          })
        }
      }
    }
  })

  it('权限分层不被抹平：能跑 Agent 的角色不能同时批准（AC-08 制度层）', () => {
    expect(ROLE_CAPABILITIES.OPERATOR.has('agent.run')).toBe(true)
    expect(ROLE_CAPABILITIES.OPERATOR.has('agent.approve')).toBe(false)
    expect(ROLE_CAPABILITIES.ADMIN.has('agent.approve')).toBe(true)
  })
})

describe('withTenant —— 单能力', () => {
  it('具备能力 → 放行', async () => {
    asRole('MEMBER')
    const res = await run(withTenant('org.read'))
    expect(res.status).toBe(200)
  })

  it('不具备能力 → 403，并写 capability_denied 审计', async () => {
    asRole('MEMBER')
    const res = await run(withTenant('member.invite'))
    expect(res.status).toBe(403)
    const row = auditCreate.mock.calls[0][0].data
    expect(row.eventType).toBe('tenant.capability_denied')
    // ⚠️ `writeTenantAudit` 把 safeMetadata **序列化成 JSON 文本**再落库，
    //    所以断言的是**持久化后的形态**（合规读者真正看到的东西），而不是调用时的对象。
    expect(JSON.parse(row.safeMetadata).mode).toBe('all')
  })

  it('🔒 传数组给 withTenant → 立刻抛 TypeError（不得退化成"任一满足"）', () => {
    const misuse = ['org.read', 'member.invite'] as unknown as TenantCapability
    expect(() => withTenant(misuse)).toThrow(TypeError)
    expect(() => withTenant('' as TenantCapability)).toThrow(TypeError)
  })
})

describe('withTenantAll —— 合取（本文件的核心回归锁）', () => {
  it('两个能力都有 → 放行（ADMIN 同时具备 member.read 与 member.invite）', async () => {
    asRole('ADMIN')
    const res = await run(withTenantAll(['member.read', 'member.invite']))
    expect(res.status).toBe(200)
  })

  it('🔴 混入弱能力不得降级：MEMBER 有 org.read 但无 mission.update → 403', async () => {
    asRole('MEMBER')
    const res = await run(withTenantAll(['org.read', 'mission.update']))
    expect(res.status).toBe(403)
  })

  it('🔴 变异对照：同一组能力换成 withTenantAny 就放行（证明上面的 403 来自合取语义）', async () => {
    asRole('MEMBER')
    const res = await run(withTenantAny(['org.read', 'mission.update']))
    expect(res.status).toBe(200)
  })

  it('空集合 → 构造期抛错（every([]) 恒真会把门开到最大）', () => {
    expect(() => withTenantAll([])).toThrow(TypeError)
    expect(() => withTenantAny([])).toThrow(TypeError)
  })
})

describe('withTenantAny —— 析取', () => {
  it('只具备其一 → 放行', async () => {
    asRole('OPERATOR')
    const res = await run(withTenantAny(['workflow.read', 'workflow.manage']))
    expect(res.status).toBe(200)
  })

  it('一个都不具备 → 403，错误信息用 or 连接', async () => {
    asRole('MEMBER')
    const res = await run(withTenantAny(['workflow.read', 'workflow.manage']))
    expect(res.status).toBe(403)
    // 信封是 `{ success, data, error: { code, message } }` —— message 在 error 里面，
    // 不是 `error` 本身（早期断言把它当字符串，于是 toContain 在对象上必失败）。
    const payload = (await res.json()) as { error?: { code?: string; message?: string } }
    expect(payload.error?.code).toBe('PERMISSION_DENIED')
    expect(payload.error?.message).toContain(' or ')
  })
})
