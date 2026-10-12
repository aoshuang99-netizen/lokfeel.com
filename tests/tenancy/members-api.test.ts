/**
 * T07 · `GET /api/v1/members` —— HTTP 层（能力关卡 + 参数校验 + 响应信封）
 *
 * 与 `tests/workflow/workflow-api.test.ts` 同一取向：直接 import 路由导出的 handler，
 * 不启服务，离线确定性地覆盖状态码全谱系。
 *
 * ⚠️ 本层**证不了路径形状**（`params`/URL 不参与真实路由匹配）。`/api/v1/members`
 *    的真实可达性由生产复验脚本 `verify-t07-prod.mjs` 与 E2E 覆盖。
 *
 * 能力口径（`capabilities.ts`）：
 *   - `member.read` 在 `OPERATOR_EXTRA` → OPERATOR / ADMIN / OWNER 有，**MEMBER 没有**
 *   - 因此 MEMBER 访问必须是 403 —— 这是"成员目录不是人人都能翻"的边界。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    membership: { findFirst: jest.fn(), count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as membersRoute from '@/app/api/v1/members/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const membershipCount = db.membership.count as unknown as jest.Mock
const membershipFindMany = db.membership.findMany as unknown as jest.Mock
const auditCreate = (db as any).tenantAuditEvent.create as jest.Mock

const ORG = 'org_1'
const ME = 'u_me'

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER') {
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

function get(url: string) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET' })
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  membershipCount.mockResolvedValue(0)
  membershipFindMany.mockResolvedValue([])
})

describe('GET /api/v1/members —— 鉴权', () => {
  it('匿名（requireAuth 抛 401）→ 401 且 JSON', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await membersRoute.GET(get('http://localhost/api/v1/members'))

    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(membershipFindMany).not.toHaveBeenCalled()
  })

  it('非本租户成员（membership 查不到）→ 403', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: ME } })
    membershipFindFirst.mockResolvedValue(null)

    const res = await membersRoute.GET(get('http://localhost/api/v1/members'))
    expect(res.status).toBe(403)
    expect(membershipFindMany).not.toHaveBeenCalled()
  })

  it('MEMBER 角色 → 403（member.read 不在自助能力集里）', async () => {
    asRole('MEMBER')
    const res = await membersRoute.GET(get('http://localhost/api/v1/members'))

    expect(res.status).toBe(403)
    expect(membershipFindMany).not.toHaveBeenCalled()
    // 能力拒绝必须留下审计（T01 的 fail-closed 约定）。
    expect(auditCreate).toHaveBeenCalled()
  })

  it('OPERATOR → 200（member.read 属 OPERATOR_EXTRA）', async () => {
    asRole('OPERATOR')
    const res = await membersRoute.GET(get('http://localhost/api/v1/members'))
    expect(res.status).toBe(200)
  })

  it('ADMIN / OWNER → 200', async () => {
    for (const role of ['ADMIN', 'OWNER'] as const) {
      jest.clearAllMocks()
      auditCreate.mockResolvedValue({})
      membershipCount.mockResolvedValue(0)
      membershipFindMany.mockResolvedValue([])
      asRole(role)
      const res = await membersRoute.GET(get('http://localhost/api/v1/members'))
      expect(res.status).toBe(200)
    }
  })
})

describe('GET /api/v1/members —— 参数与信封', () => {
  beforeEach(() => asRole('ADMIN'))

  it('返回 { success, data[], meta{page,pageSize,total,totalPages} }', async () => {
    membershipCount.mockResolvedValue(3)
    membershipFindMany.mockResolvedValue([
      {
        id: 'ms_1',
        userId: 'u_1',
        role: 'OWNER',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        user: { name: 'Ann', email: 'ann@x.com', image: null, isBot: false, profile: null },
      },
    ])

    const res = await membersRoute.GET(get('http://localhost/api/v1/members'))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data[0]).toMatchObject({ displayName: 'Ann', email: 'ann@x.com', role: 'OWNER' })
    expect(body.meta).toMatchObject({ page: 1, pageSize: 20, total: 3, totalPages: 1 })
  })

  it('查询谓词强制带本租户 id（不信任任何客户端传入的组织 id）', async () => {
    await membersRoute.GET(
      get('http://localhost/api/v1/members?organizationId=org_attacker&role=ADMIN')
    )
    expect(membershipFindMany.mock.calls[0][0].where.organizationId).toBe(ORG)
  })

  it('非法 role / status 被忽略而不是 400（与 /api/v1/missions 的 status 口径一致）', async () => {
    const res = await membersRoute.GET(
      get('http://localhost/api/v1/members?role=SUPERUSER&status=PENDING')
    )
    expect(res.status).toBe(200)
    const where = membershipFindMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('role')
    expect(where).not.toHaveProperty('status')
  })

  it('pageSize 由 parsePagination 收敛（超过上限被夹住，不是照单全收）', async () => {
    await membersRoute.GET(get('http://localhost/api/v1/members?pageSize=9999'))
    const take = membershipFindMany.mock.calls[0][0].take
    expect(take).toBeLessThanOrEqual(100)
  })

  it('opaque DB 错误 → 500（不把内部信息透给调用方）', async () => {
    membershipFindMany.mockRejectedValue(new Error('SQLITE_ERROR: no such table'))
    const res = await membersRoute.GET(get('http://localhost/api/v1/members'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('no such table')
  })
})
