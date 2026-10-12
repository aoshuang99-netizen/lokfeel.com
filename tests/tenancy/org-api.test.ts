/**
 * T07 · `/api/v1/org` —— HTTP 层（能力关卡 + 参数校验 + 响应信封）
 *
 * ⚠️ 本层**证不了路径形状**。`/api/v1/org` 的真实可达性由生产复验脚本覆盖。
 *
 * 能力口径（`capabilities.ts`）：
 *   - `org.read`  在 `SELF_SERVICE`   → **所有成员**都有，MEMBER 也能 GET；
 *   - `org.update` 在 `OWNER_ONLY`    → 仅 OWNER，ADMIN 也**不能** PATCH。
 * 这两条正是设置屏"读公共、写专属"的权限基础，因此都要在这里钉住。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    organization: { findFirst: jest.fn(), update: jest.fn() },
    membership: { findFirst: jest.fn(), count: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as orgRoute from '@/app/api/v1/org/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const membershipCount = db.membership.count as unknown as jest.Mock
const orgFindFirst = db.organization.findFirst as unknown as jest.Mock
const orgUpdate = db.organization.update as unknown as jest.Mock
const auditCreate = (db as any).tenantAuditEvent.create as jest.Mock

const ORG = 'org_1'
const ME = 'u_me'

const ORG_ROW = {
  id: ORG,
  name: '种子社群',
  slug: 'seed-community',
  status: 'ACTIVE',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
}

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER') {
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

function get(url: string) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET' })
}

function patch(url: string, body?: unknown, raw?: string) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  membershipCount.mockResolvedValue(0)
  orgFindFirst.mockResolvedValue(ORG_ROW)
  orgUpdate.mockResolvedValue(ORG_ROW)
})

// ───────────────────────────────────────────────────────────
describe('GET /api/v1/org —— 读取（org.read，全员可读）', () => {
  it('匿名 → 401 且 JSON，且不查组织', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await orgRoute.GET(get('http://localhost/api/v1/org'))

    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(orgFindFirst).not.toHaveBeenCalled()
  })

  it('非本租户成员 → 403', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: ME } })
    membershipFindFirst.mockResolvedValue(null)

    const res = await orgRoute.GET(get('http://localhost/api/v1/org'))
    expect(res.status).toBe(403)
    expect(orgFindFirst).not.toHaveBeenCalled()
  })

  it('MEMBER 也能读（org.read 属自助能力），且 capabilities 里**没有** org.update', async () => {
    asRole('MEMBER')
    const res = await orgRoute.GET(get('http://localhost/api/v1/org'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.organization.slug).toBe('seed-community')
    expect(body.data.myRole).toBe('MEMBER')
    expect(body.data.capabilities).toContain('org.read')
    expect(body.data.capabilities).not.toContain('org.update')
  })

  it('OWNER 的 capabilities 含 org.update（设置屏据此渲染表单）', async () => {
    asRole('OWNER')
    const res = await orgRoute.GET(get('http://localhost/api/v1/org'))
    const body = await res.json()
    expect(body.data.capabilities).toContain('org.update')
  })
})

// ───────────────────────────────────────────────────────────
describe('PATCH /api/v1/org —— 写入（org.update，仅 OWNER）', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', { name: 'x' }))
    expect(res.status).toBe(401)
    expect(orgUpdate).not.toHaveBeenCalled()
  })

  it('ADMIN → 403（org.update 不在 ADMIN_EXTRA 里，改档案是所有者专属）', async () => {
    asRole('ADMIN')
    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', { name: 'x' }))

    expect(res.status).toBe(403)
    expect(orgUpdate).not.toHaveBeenCalled()
  })

  it('OPERATOR 与 MEMBER → 403', async () => {
    for (const role of ['OPERATOR', 'MEMBER'] as const) {
      asRole(role)
      const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', { name: 'x' }))
      expect(res.status).toBe(403)
    }
    expect(orgUpdate).not.toHaveBeenCalled()
  })

  it('OWNER + 合法 name → 200，返回更新后的组织', async () => {
    asRole('OWNER')
    orgUpdate.mockResolvedValue({ ...ORG_ROW, name: '新社群名' })

    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', { name: '新社群名' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.organization.name).toBe('新社群名')
    expect(orgUpdate.mock.calls[0][0].where).toEqual({ id: ORG })
  })

  it('非法 slug → 400（不是静默忽略）', async () => {
    asRole('OWNER')
    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', { slug: 'Bad Slug' }))
    expect(res.status).toBe(400)
    expect(orgUpdate).not.toHaveBeenCalled()
  })

  it('空对象 → 400（"成功但没改"是坏契约）', async () => {
    asRole('OWNER')
    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', {}))
    expect(res.status).toBe(400)
  })

  it('非法 JSON → 400（不冒 500）', async () => {
    asRole('OWNER')
    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', undefined, '{not json'))
    expect(res.status).toBe(400)
  })

  it('slug 冲突 → 409 且指明字段', async () => {
    asRole('OWNER')
    orgFindFirst.mockResolvedValue({ id: 'org_other' })

    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', { slug: 'taken' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.details.field).toBe('slug')
  })

  it('500 不泄漏内部信息（DB 挂了 → 通用文案）', async () => {
    asRole('OWNER')
    orgUpdate.mockRejectedValue(new Error('SQLITE_BUSY at line 42 of connection.prisma'))

    const res = await orgRoute.PATCH(patch('http://localhost/api/v1/org', { name: 'x' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('SQLITE_BUSY')
  })
})
