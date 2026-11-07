/**
 * T07 · `PATCH /api/v1/members/[membershipId]` —— HTTP 层
 *
 * 覆盖的是**状态码契约**，不是业务规则本身（规则在 `member-roles.test.ts` 穷举）。
 * 这里要钉住的是容易被悄悄改坏的几处：
 *   - 能力关卡在 handler 之前（OPERATOR 的请求根本不该进到服务层）
 *   - 跨租户 → 404 而非 403（403 会泄露 id 存在）
 *   - 不变量拒绝 → 409，且带上稳定 `code`
 *   - 审计是旁路：写审计失败**不能**把已经成功的变更翻成 500
 *
 * ⚠️ 本层证不了路径形状（`params` 不参与真实匹配）。真实可达性由生产复验脚本覆盖。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockTx = {
  membership: {
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
}

jest.mock('@/lib/db', () => ({
  db: {
    // 交互事务：把回调直接跑在 mockTx 上，验证"判定与写入同一事务"这条结构。
    $transaction: jest.fn((fn: any) => fn(mockTx)),
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as memberRoute from '@/app/api/v1/members/[membershipId]/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const actorFindFirst = db.membership.findFirst as unknown as jest.Mock
const auditCreate = (db as any).tenantAuditEvent.create as jest.Mock
const transactionMock = db.$transaction as unknown as jest.Mock

const targetFindFirst = mockTx.membership.findFirst
const targetCount = mockTx.membership.count
const targetUpdate = mockTx.membership.update

const ORG = 'org_1'
const ME = 'u_me'
const TARGET = 'u_target'
const MS_ID = 'ms_target'

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER') {
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  actorFindFirst.mockResolvedValue({ id: 'ms_me', organizationId: ORG, role })
}

function patch(body?: unknown, raw?: string) {
  return new NextRequest(new URL(`http://localhost/api/v1/members/${MS_ID}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ membershipId: MS_ID }) }

const UPDATED_ROW = {
  id: MS_ID,
  userId: TARGET,
  role: 'OPERATOR',
  status: 'ACTIVE',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-07T00:00:00.000Z'),
  user: {
    name: null,
    email: 'target@example.com',
    image: null,
    isBot: false,
    profile: { displayName: '目标成员', avatar: null, city: null },
  },
}

function targetIs(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', status = 'ACTIVE') {
  targetFindFirst.mockResolvedValue({ id: MS_ID, userId: TARGET, role, status })
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  transactionMock.mockImplementation((fn: any) => fn(mockTx))
  targetCount.mockResolvedValue(2)
  targetUpdate.mockResolvedValue(UPDATED_ROW)
})

describe('PATCH /api/v1/members/[id] —— 鉴权', () => {
  it('匿名 → 401，且不开事务', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await memberRoute.PATCH(patch({ role: 'ADMIN' }), params)

    expect(res.status).toBe(401)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it.each(['OPERATOR', 'MEMBER'] as const)('%s 无 member.update_role → 403，且不开事务', async (role) => {
    asRole(role)
    const res = await memberRoute.PATCH(patch({ role: 'ADMIN' }), params)

    expect(res.status).toBe(403)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('ADMIN 可以进入服务层（正向对照，避免"全 403 也全绿"）', async () => {
    asRole('ADMIN')
    targetIs('MEMBER')
    const res = await memberRoute.PATCH(patch({ role: 'OPERATOR' }), params)

    expect(res.status).toBe(200)
    expect(transactionMock).toHaveBeenCalled()
  })
})

describe('PATCH /api/v1/members/[id] —— 参数与租户边界', () => {
  it('请求体不是 JSON → 400', async () => {
    asRole('ADMIN')
    const res = await memberRoute.PATCH(patch(undefined, '{not json'), params)
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('缺 role → 400', async () => {
    asRole('ADMIN')
    const res = await memberRoute.PATCH(patch({}), params)
    expect(res.status).toBe(400)
  })

  it('未知角色 → 400', async () => {
    asRole('ADMIN')
    const res = await memberRoute.PATCH(patch({ role: 'superuser' }), params)
    expect(res.status).toBe(400)
  })

  it('跨租户（目标查不到）→ 404，且不写库、不写审计', async () => {
    asRole('ADMIN')
    targetFindFirst.mockResolvedValue(null)
    const res = await memberRoute.PATCH(patch({ role: 'OPERATOR' }), params)

    expect(res.status).toBe(404)
    expect(targetUpdate).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v1/members/[id] —— 不变量', () => {
  it('降级最后一名管理员 → 409 LAST_ADMIN，且不写库', async () => {
    asRole('ADMIN')
    targetIs('ADMIN')
    targetCount.mockResolvedValue(1)

    const res = await memberRoute.PATCH(patch({ role: 'MEMBER' }), params)
    const json = (await res.json()) as any

    expect(res.status).toBe(409)
    expect(json.error?.details?.code ?? json.details?.code).toBe('LAST_ADMIN')
    expect(targetUpdate).not.toHaveBeenCalled()
  })

  it('改自己的角色 → 409 SELF_ROLE_CHANGE', async () => {
    asRole('ADMIN')
    targetFindFirst.mockResolvedValue({ id: MS_ID, userId: ME, role: 'ADMIN', status: 'ACTIVE' })

    const res = await memberRoute.PATCH(patch({ role: 'OPERATOR' }), params)
    expect(res.status).toBe(409)
    expect(targetUpdate).not.toHaveBeenCalled()
  })

  it('授予 OWNER → 403（所有权只能走 org.transfer）', async () => {
    asRole('OWNER')
    targetIs('ADMIN')

    const res = await memberRoute.PATCH(patch({ role: 'OWNER' }), params)
    expect(res.status).toBe(403)
    expect(targetUpdate).not.toHaveBeenCalled()
  })

  it('管理员数量为 2 时降级其中一名 → 200', async () => {
    asRole('ADMIN')
    targetIs('ADMIN')
    targetCount.mockResolvedValue(2)

    const res = await memberRoute.PATCH(patch({ role: 'OPERATOR' }), params)
    expect(res.status).toBe(200)
    expect(targetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'OPERATOR' } })
    )
  })
})

describe('PATCH /api/v1/members/[id] —— 成功路径的形状', () => {
  it('200 + 返回成员 DTO + 写一条 membership.role_changed 审计（不含 userId）', async () => {
    asRole('ADMIN')
    targetIs('MEMBER')

    const res = await memberRoute.PATCH(patch({ role: 'OPERATOR' }), params)
    const json = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.role).toBe('OPERATOR')
    expect(json.data.email).toBe('target@example.com')

    const auditArg = auditCreate.mock.calls[0][0]
    expect(auditArg.data.eventType).toBe('membership.role_changed')
    expect(auditArg.data.resourceId).toBe(MS_ID)
    // safeMetadata 落库时已序列化为 JSON 文本（writeTenantAudit 负责）。
    const metadata = JSON.parse(auditArg.data.safeMetadata)
    expect(metadata).toEqual({ from: 'MEMBER', to: 'OPERATOR' })
    expect(auditArg.data.safeMetadata).not.toContain(TARGET)
  })

  it('大小写宽松：admin → ADMIN 落库', async () => {
    asRole('OWNER')
    targetIs('OPERATOR')

    const res = await memberRoute.PATCH(patch({ role: 'admin' }), params)
    expect(res.status).toBe(200)
    expect(targetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'ADMIN' } })
    )
  })

  it('审计写入失败不回滚业务结果（旁路，不是闸门）', async () => {
    asRole('ADMIN')
    targetIs('MEMBER')
    auditCreate.mockRejectedValue(new Error('audit down'))

    const res = await memberRoute.PATCH(patch({ role: 'OPERATOR' }), params)
    expect(res.status).toBe(200)
  })
})
