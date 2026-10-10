/**
 * T02 · Mission HTTP 层测试（AC-11 的核心证据）
 *
 * 与 `missions.test.ts`（服务层）的分工：
 *   - 服务层测「谓词/状态机/投影」；
 *   - 本文件测**路由装配**：鉴权关卡、能力关卡、幂等键装配、匿名面防护、限流。
 *     这类缺陷只会在"把服务接进 HTTP"时出现（例如忘了把 Idempotency-Key 接上），
 *     服务层单测永远发现不了。
 *
 * 直接调用路由导出的 handler（不启服务），因此可离线、可确定性地覆盖
 * 401 / 403 / 404 / 409 / 429 全谱系。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    mission: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    missionParticipation: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

// 限流器在两个路由模块的**模块作用域**被创建，因此必须用"全局开关"控制，
// 不能在测试里替换返回值（那时限流器已经建好了）。
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn(
    () => async () =>
      (globalThis as unknown as { __allowRateLimit?: boolean }).__allowRateLimit === false
        ? { success: false, remaining: 0, resetAt: Date.now() + 60_000 }
        : { success: true, remaining: 5, resetAt: Date.now() + 60_000 }
  ),
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { ConflictError, UnauthorizedError } from '@/lib/errors'

import * as missionsRoute from '@/app/api/v1/missions/route'
import * as missionDetailRoute from '@/app/api/v1/missions/[missionId]/route'
import * as missionPauseRoute from '@/app/api/v1/missions/[missionId]/pause/route'
import * as publicPreviewRoute from '@/app/api/v1/public/missions/[token]/route'
import * as publicJoinRoute from '@/app/api/v1/public/missions/[token]/join/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const missionFindUnique = db.mission.findUnique as unknown as jest.Mock
const missionFindMany = db.mission.findMany as unknown as jest.Mock
const missionCount = db.mission.count as unknown as jest.Mock
const missionCreate = db.mission.create as unknown as jest.Mock
const missionUpdate = db.mission.update as unknown as jest.Mock
const partCount = db.missionParticipation.count as unknown as jest.Mock
const partGroupBy = db.missionParticipation.groupBy as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const idemFindUnique = db.idempotencyRecord.findUnique as unknown as jest.Mock
const idemCreate = db.idempotencyRecord.create as unknown as jest.Mock

const ORG = 'org_1'
const TOKEN = 'tok_abcdefghijklmnopqrstuv'

function missionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm_1',
    organizationId: ORG,
    ownerId: 'u_1',
    title: '渠道合作',
    goal: '在 3 个月内找到 2 家东南亚分销伙伴',
    offer: '样品 + 培训',
    constraints: '["东南亚"]',
    successCriteria: '签署试销协议',
    status: 'ACTIVE',
    shareToken: TOKEN,
    publicPreview: true,
    maxParticipants: null,
    expiresAt: null,
    publishedAt: new Date('2026-10-01T00:00:00.000Z'),
    closedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  }
}

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', userId = 'u_1') {
  requireAuthMock.mockResolvedValue({ user: { id: userId } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

const createBody = {
  goal: '在 3 个月内找到 2 家东南亚分销伙伴',
  offer: '样品 + 培训',
  successCriteria: '签署试销协议',
}

function post(url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function get(url: string) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET' })
}

const params = (obj: Record<string, string>) => ({ params: Promise.resolve(obj) })

beforeEach(() => {
  jest.clearAllMocks()
  ;(globalThis as unknown as { __allowRateLimit?: boolean }).__allowRateLimit = true
  auditCreate.mockResolvedValue({})
  partCount.mockResolvedValue(0)
  partGroupBy.mockResolvedValue([])
})

describe('T02 · /api/v1/missions', () => {
  describe('POST —— 创建（Idempotency-Key 必需）', () => {
    it('匿名 → 401', async () => {
      requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
      const res = await (missionsRoute.POST as any)(post('/api/v1/missions', createBody), undefined)
      expect(res.status).toBe(401)
    })

    it('MEMBER 无 mission.create 能力 → 403，且写能力拒绝审计', async () => {
      asRole('MEMBER')
      const res = await (missionsRoute.POST as any)(
        post('/api/v1/missions', createBody, { 'Idempotency-Key': 'k1' }),
        undefined
      )
      expect(res.status).toBe(403)
      expect(missionCreate).not.toHaveBeenCalled()
      expect(auditCreate).toHaveBeenCalled()
    })

    it('缺失 Idempotency-Key → 400（不静默退化为非幂等）', async () => {
      asRole('OPERATOR')
      const res = await (missionsRoute.POST as any)(post('/api/v1/missions', createBody), undefined)
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body.error.details).toEqual({ field: 'Idempotency-Key' })
      expect(missionCreate).not.toHaveBeenCalled()
    })

    it('输入不合法 → 400（附字段名）', async () => {
      asRole('OPERATOR')
      const res = await (missionsRoute.POST as any)(
        post('/api/v1/missions', { goal: '短', offer: 'x', successCriteria: 'y' }, { 'Idempotency-Key': 'k1' }),
        undefined
      )
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body.error.details.field).toBe('goal')
    })

    it('首次创建 → 201，且 organizationId 来自会话而非请求体', async () => {
      asRole('OPERATOR')
      idemFindUnique.mockResolvedValue(null)
      missionCreate.mockResolvedValue(missionRow({ status: 'DRAFT', publishedAt: null }))
      idemCreate.mockResolvedValue({})

      const res = await (missionsRoute.POST as any)(
        post(
          '/api/v1/missions',
          { ...createBody, organizationId: 'org_attacker', ownerId: 'u_attacker' },
          { 'Idempotency-Key': 'k1' }
        ),
        undefined
      )
      const body = await res.json()
      expect(res.status).toBe(201)
      expect(body.data.id).toBe('m_1')
      expect(res.headers.get('Idempotent-Replayed')).toBeNull()

      const data = missionCreate.mock.calls[0][0].data
      expect(data.organizationId).toBe(ORG)
      expect(data.ownerId).toBe('u_1')
    })

    it('🔒 同键重放 → 返回首次结果 + Idempotent-Replayed 头，且不产生第二条', async () => {
      asRole('OPERATOR')
      // 指纹必须与"首次请求"一致 —— 用同一套校验函数算出真实指纹。
      const { hashRequest, parseMissionCreate } = await import('@/lib/connection')
      idemFindUnique.mockResolvedValue({
        requestHash: hashRequest(parseMissionCreate(createBody)),
        resourceId: 'm_1',
      })
      missionFindFirst.mockResolvedValue(missionRow())

      const res = await (missionsRoute.POST as any)(
        post('/api/v1/missions', createBody, { 'Idempotency-Key': 'k1' }),
        undefined
      )
      const body = await res.json()
      expect(res.status).toBe(201)
      expect(res.headers.get('Idempotent-Replayed')).toBe('true')
      expect(body.data.id).toBe('m_1')
      expect(missionCreate).not.toHaveBeenCalled()
    })

    it('同键异体 → 409', async () => {
      asRole('OPERATOR')
      idemFindUnique.mockResolvedValue({ requestHash: 'some-other-hash', resourceId: 'm_1' })

      const res = await (missionsRoute.POST as any)(
        post('/api/v1/missions', createBody, { 'Idempotency-Key': 'k1' }),
        undefined
      )
      expect(res.status).toBe(409)
    })
  })

  describe('GET —— 列表', () => {
    it('匿名 → 401', async () => {
      requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
      const res = await (missionsRoute.GET as any)(get('/api/v1/missions'), undefined)
      expect(res.status).toBe(401)
    })

    it('OPERATOR → 200，分页元数据齐全，查询限定本租户', async () => {
      asRole('OPERATOR')
      missionCount.mockResolvedValue(1)
      missionFindMany.mockResolvedValue([missionRow()])
      partGroupBy.mockResolvedValue([{ missionId: 'm_1', _count: { _all: 2 } }])

      const res = await (missionsRoute.GET as any)(get('/api/v1/missions'), undefined)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 })
      expect(body.data[0].participantCount).toBe(2)
      expect(missionFindMany.mock.calls[0][0].where.organizationId).toBe(ORG)
    })

    it('非法的 status 过滤值被忽略（不抛错、不注入）', async () => {
      asRole('OPERATOR')
      missionCount.mockResolvedValue(0)
      missionFindMany.mockResolvedValue([])

      const res = await (missionsRoute.GET as any)(
        get('/api/v1/missions?status=ACTIVE%27%20OR%201=1'),
        undefined
      )
      expect(res.status).toBe(200)
      expect(missionFindMany.mock.calls[0][0].where).toEqual({ organizationId: ORG })
    })
  })

  describe('GET /[missionId] 与 PATCH', () => {
    it('跨租户读取 → 404（不是 403：不泄露"该 id 存在"）', async () => {
      asRole('OPERATOR')
      missionFindFirst.mockResolvedValue(null)
      const res = await (missionDetailRoute.GET as any)(
        get('/api/v1/missions/m_other'),
        params({ missionId: 'm_other' })
      )
      expect(res.status).toBe(404)
    })

    it('MEMBER 不可读租户级列表（能力矩阵使然）→ 403', async () => {
      asRole('MEMBER')
      const res = await (missionDetailRoute.GET as any)(
        get('/api/v1/missions/m_1'),
        params({ missionId: 'm_1' })
      )
      expect(res.status).toBe(403)
    })

    it('PATCH 空 body → 400（至少一个可改字段）', async () => {
      asRole('OPERATOR')
      const res = await (missionDetailRoute.PATCH as any)(
        new NextRequest(new URL('/api/v1/missions/m_1', 'http://localhost'), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
        params({ missionId: 'm_1' })
      )
      expect(res.status).toBe(400)
    })
  })

  describe('POST /[missionId]/pause —— 状态迁移', () => {
    it('缺省 action=pause', async () => {
      asRole('OPERATOR')
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', publishedAt: new Date() })
      missionUpdate.mockResolvedValue(missionRow({ status: 'PAUSED' }))

      const res = await (missionPauseRoute.POST as any)(
        post('/api/v1/missions/m_1/pause'),
        params({ missionId: 'm_1' })
      )
      expect(res.status).toBe(200)
      expect(missionUpdate.mock.calls[0][0].data.status).toBe('PAUSED')
    })

    it('非法迁移 → 409（CLOSED 不能再 pause）', async () => {
      asRole('OPERATOR')
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'CLOSED', publishedAt: new Date() })

      const res = await (missionPauseRoute.POST as any)(
        post('/api/v1/missions/m_1/pause'),
        params({ missionId: 'm_1' })
      )
      expect(res.status).toBe(409)
      expect(missionUpdate).not.toHaveBeenCalled()
    })

    it('非法 action → 400', async () => {
      asRole('OPERATOR')
      const res = await (missionPauseRoute.POST as any)(
        post('/api/v1/missions/m_1/pause', { action: 'delete' }),
        params({ missionId: 'm_1' })
      )
      expect(res.status).toBe(400)
    })
  })
})

describe('T02 · /api/v1/public/missions/[token]（匿名可达面）', () => {
  it('令牌形状非法 → 404，且**不触达 DB**', async () => {
    const res = await (publicPreviewRoute.GET as any)(get('/api/v1/public/missions/x'), params({ token: 'x' }))
    expect(res.status).toBe(404)
    expect(missionFindUnique).not.toHaveBeenCalled()
  })

  it('匿名可预览 → 200 + 最小披露投影 + no-store', async () => {
    missionFindUnique.mockResolvedValue({
      ...missionRow(),
      organization: { name: '跨境社群', status: 'ACTIVE' },
    })

    const res = await (publicPreviewRoute.GET as any)(
      get(`/api/v1/public/missions/${TOKEN}`),
      params({ token: TOKEN })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(body.data.mission.title).toBe('渠道合作')
    expect(body.data.viewer).toBeNull()

    const json = JSON.stringify(body)
    for (const field of ['id', 'organizationId', 'ownerId', 'shareToken', 'constraints']) {
      expect(json).not.toContain(`"${field}"`)
    }
    // 无候选时不伪造
    expect(body.data.mission.candidates).toEqual([])
    expect(body.data.mission.candidatesAvailable).toBe(false)
  })

  it('草稿 → 404（不泄露未发布任务）', async () => {
    missionFindUnique.mockResolvedValue({
      ...missionRow({ status: 'DRAFT' }),
      organization: { name: 'C', status: 'ACTIVE' },
    })
    const res = await (publicPreviewRoute.GET as any)(
      get(`/api/v1/public/missions/${TOKEN}`),
      params({ token: TOKEN })
    )
    expect(res.status).toBe(404)
  })

  it('限流命中 → 429 + Retry-After', async () => {
    ;(globalThis as unknown as { __allowRateLimit?: boolean }).__allowRateLimit = false
    const res = await (publicPreviewRoute.GET as any)(
      get(`/api/v1/public/missions/${TOKEN}`),
      params({ token: TOKEN })
    )
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(missionFindUnique).not.toHaveBeenCalled()
  })
})

describe('T02 · /api/v1/public/missions/[token]/join（敏感动作需身份验证）', () => {
  it('🔒 匿名加入 → 401（可预览但不可加入）', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (publicJoinRoute.POST as any)(
      post(`/api/v1/public/missions/${TOKEN}/join`, {}),
      params({ token: TOKEN })
    )
    expect(res.status).toBe(401)
    expect(db.missionParticipation.upsert).not.toHaveBeenCalled()
  })

  it('令牌形状非法 → 404', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
    const res = await (publicJoinRoute.POST as any)(
      post('/api/v1/public/missions/x/join', {}),
      params({ token: 'x' })
    )
    expect(res.status).toBe(404)
  })

  it('登录但非本租户成员 → 403（授权在服务层用 DB 行的 organizationId 回查）', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u_outsider' } })
    missionFindUnique.mockResolvedValue({
      id: 'm_1',
      organizationId: ORG,
      status: 'ACTIVE',
      expiresAt: null,
      maxParticipants: null,
    })
    membershipFindFirst.mockResolvedValue(null)

    const res = await (publicJoinRoute.POST as any)(
      post(`/api/v1/public/missions/${TOKEN}/join`, {}),
      params({ token: TOKEN })
    )
    expect(res.status).toBe(403)
  })

  it('合法成员 → 200，返回 joined 状态', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
    missionFindUnique.mockResolvedValue({
      id: 'm_1',
      organizationId: ORG,
      status: 'ACTIVE',
      expiresAt: null,
      maxParticipants: null,
    })
    membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
    partCount.mockResolvedValue(0)
    ;(db.missionParticipation.findUnique as unknown as jest.Mock).mockResolvedValue(null)
    ;(db.missionParticipation.upsert as unknown as jest.Mock).mockResolvedValue({ id: 'p_1' })

    const res = await (publicJoinRoute.POST as any)(
      post(`/api/v1/public/missions/${TOKEN}/join`, { note: '想合作' }),
      params({ token: TOKEN })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      missionId: 'm_1',
      participationId: 'p_1',
      status: 'INTERESTED',
      alreadyJoined: false,
    })
  })

  it('已满 → 409', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
    missionFindUnique.mockResolvedValue({
      id: 'm_1',
      organizationId: ORG,
      status: 'ACTIVE',
      expiresAt: null,
      maxParticipants: 1,
    })
    membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
    partCount.mockResolvedValue(1)
    ;(db.missionParticipation.findUnique as unknown as jest.Mock).mockResolvedValue(null)

    const res = await (publicJoinRoute.POST as any)(
      post(`/api/v1/public/missions/${TOKEN}/join`, {}),
      params({ token: TOKEN })
    )
    expect(res.status).toBe(409)
  })

  it('ConflictError 的 JSON 信封与其它错误一致', async () => {
    const { errorResponse } = await import('@/lib/api-response')
    const res = errorResponse(new ConflictError('boom'))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('CONFLICT')
  })
})
