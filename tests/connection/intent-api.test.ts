/**
 * T03 · Intent HTTP 层测试
 *
 * 与 `intents.test.ts`（服务层）的分工：
 *   - 服务层测「谓词 / 状态派生 / 投影」；
 *   - 本文件测**路由装配**：鉴权关卡、能力关卡、幂等键装配、以及
 *     **AC-03 的端到端泄露断言**（对组织者视图的响应体做字符串级扫描）。
 *
 * 直接调用路由导出的 handler（不启服务），可离线确定性地覆盖状态码全谱系。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    socialIntent: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    mission: { findFirst: jest.fn(), findUnique: jest.fn() },
    missionParticipation: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as intentsRoute from '@/app/api/v1/intents/route'
import * as intentDetailRoute from '@/app/api/v1/intents/[intentId]/route'
import * as intentStatusRoute from '@/app/api/v1/intents/[intentId]/status/route'
import * as intentDisclosureRoute from '@/app/api/v1/intents/[intentId]/disclosure/route'
import * as intentFieldsRoute from '@/app/api/v1/intents/fields/route'
import * as missionIntentsRoute from '@/app/api/v1/missions/[missionId]/intents/route'
import * as connectionsCandidatesRoute from '@/app/api/v1/connections/candidates/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const intentFindFirst = db.socialIntent.findFirst as unknown as jest.Mock
const intentFindUnique = db.socialIntent.findUnique as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock
const intentCount = db.socialIntent.count as unknown as jest.Mock
const intentCreate = db.socialIntent.create as unknown as jest.Mock
const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const partFindUnique = db.missionParticipation.findUnique as unknown as jest.Mock
const partFindMany = db.missionParticipation.findMany as unknown as jest.Mock
const userFindUnique = db.user.findUnique as unknown as jest.Mock
const userFindMany = db.user.findMany as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const idemFindUnique = db.idempotencyRecord.findUnique as unknown as jest.Mock
const idemCreate = db.idempotencyRecord.create as unknown as jest.Mock

const ORG = 'org_1'

function intentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i_1',
    organizationId: ORG,
    missionId: 'm_1',
    userId: 'u_1',
    need: '需要东南亚渠道',
    offer: '提供样品与培训',
    constraints: '["东南亚"]',
    disclosure: '{"displayName":"ORGANIZER"}',
    status: 'ACTIVE',
    expiresAt: null,
    withdrawnAt: null,
    importConsentAt: null,
    importedFields: null,
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    updatedAt: new Date('2026-10-05T00:00:00.000Z'),
    ...over,
  }
}

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', userId = 'u_1') {
  requireAuthMock.mockResolvedValue({ user: { id: userId } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

const baseBody = {
  missionId: 'm_1',
  need: '我需要东南亚的落地渠道',
  offer: '我可以提供样品与培训',
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

function patch(url: string, body: unknown) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = (obj: Record<string, string>) => ({ params: Promise.resolve(obj) })

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  intentCount.mockResolvedValue(0)
  intentFindMany.mockResolvedValue([])
  userFindMany.mockResolvedValue([])
})

describe('T03 · POST /api/v1/intents', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (intentsRoute.POST as any)(post('/api/v1/intents', baseBody, { 'Idempotency-Key': 'k1' }), undefined)
    expect(res.status).toBe(401)
    expect(intentCreate).not.toHaveBeenCalled()
  })

  it('MEMBER 具备 intent.manage（自助能力）→ 可创建', async () => {
    asRole('MEMBER')
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue({ status: 'INTERESTED' })
    intentFindUnique.mockResolvedValue(null)
    intentCreate.mockResolvedValue(intentRow())
    idemFindUnique.mockResolvedValue(null)
    idemCreate.mockResolvedValue({})

    const res = await (intentsRoute.POST as any)(
      post('/api/v1/intents', baseBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    expect(res.status).toBe(201)
    expect(intentCreate.mock.calls[0][0].data.organizationId).toBe(ORG)
  })

  it('缺失 Idempotency-Key → 400，且不触达 DB', async () => {
    asRole('MEMBER')
    const res = await (intentsRoute.POST as any)(post('/api/v1/intents', baseBody), undefined)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details).toEqual({ field: 'Idempotency-Key' })
    expect(intentCreate).not.toHaveBeenCalled()
  })

  it('输入不合法 → 400（need 太短）', async () => {
    asRole('MEMBER')
    const res = await (intentsRoute.POST as any)(
      post('/api/v1/intents', { ...baseBody, need: 'ab' }, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('need')
  })

  it('🔒 disclosure 里塞 email → 400（受保护字段不得经逐字段开关外泄）', async () => {
    asRole('MEMBER')
    const res = await (intentsRoute.POST as any)(
      post(
        '/api/v1/intents',
        { ...baseBody, disclosure: { email: 'COUNTERPARTY' } },
        { 'Idempotency-Key': 'k1' }
      ),
      undefined
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details).toMatchObject({ protectedField: 'email' })
    expect(intentCreate).not.toHaveBeenCalled()
  })

  it('🔒 同键重放 → 201 + Idempotent-Replayed 头，且不产生第二条', async () => {
    asRole('MEMBER')
    const { hashRequest, parseIntentCreate } = await import('@/lib/connection/intent-input')
    const { hashRequest: hash } = await import('@/lib/connection/idempotency')
    void hashRequest
    idemFindUnique.mockResolvedValue({
      requestHash: hash(parseIntentCreate(baseBody)),
      resourceId: 'i_1',
    })
    intentFindFirst.mockResolvedValue(intentRow())

    const res = await (intentsRoute.POST as any)(
      post('/api/v1/intents', baseBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('Idempotent-Replayed')).toBe('true')
    expect(intentCreate).not.toHaveBeenCalled()
  })

  it('同键异体 → 409', async () => {
    asRole('MEMBER')
    idemFindUnique.mockResolvedValue({ requestHash: 'other', resourceId: 'i_1' })
    const res = await (intentsRoute.POST as any)(
      post('/api/v1/intents', baseBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    expect(res.status).toBe(409)
  })
})

describe('T03 · GET /api/v1/intents', () => {
  it('只列自己的意图（where 带 userId）', async () => {
    asRole('MEMBER')
    intentCount.mockResolvedValue(1)
    intentFindMany.mockResolvedValue([intentRow()])

    const res = await (intentsRoute.GET as any)(get('/api/v1/intents'), undefined)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 })
    expect(intentFindMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG, userId: 'u_1' })
    // 披露表在**本人视角**下是补齐后的完整表（用于前端回显）
    expect(body.data[0].disclosure.email).toBe('SELF')
  })

  it('missionId 过滤透传', async () => {
    asRole('MEMBER')
    await (intentsRoute.GET as any)(get('/api/v1/intents?missionId=m_9'), undefined)
    expect(intentFindMany.mock.calls[0][0].where.missionId).toBe('m_9')
  })
})

describe('T03 · /api/v1/intents/[intentId]', () => {
  it('他人的意图 / 跨租户 → 404', async () => {
    asRole('MEMBER')
    intentFindFirst.mockResolvedValue(null)
    const res = await (intentDetailRoute.GET as any)(
      get('/api/v1/intents/i_other'),
      params({ intentId: 'i_other' })
    )
    expect(res.status).toBe(404)
  })

  it('PATCH 空 body → 400', async () => {
    asRole('MEMBER')
    const res = await (intentDetailRoute.PATCH as any)(
      patch('/api/v1/intents/i_1', {}),
      params({ intentId: 'i_1' })
    )
    expect(res.status).toBe(400)
  })

  it('PATCH 撤销后的意图 → 409', async () => {
    asRole('MEMBER')
    intentFindFirst.mockResolvedValue({ id: 'i_1', status: 'WITHDRAWN' })
    const res = await (intentDetailRoute.PATCH as any)(
      patch('/api/v1/intents/i_1', { need: '新的需求描述' }),
      params({ intentId: 'i_1' })
    )
    expect(res.status).toBe(409)
  })
})

describe('T03 · POST /api/v1/intents/[intentId]/status', () => {
  it('缺省 action=withdraw', async () => {
    asRole('MEMBER')
    intentFindFirst.mockResolvedValue(intentRow())
    ;(db.socialIntent.update as unknown as jest.Mock).mockResolvedValue(
      intentRow({ status: 'WITHDRAWN', withdrawnAt: new Date() })
    )
    const res = await (intentStatusRoute.POST as any)(
      post('/api/v1/intents/i_1/status'),
      params({ intentId: 'i_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.status).toBe('WITHDRAWN')
  })

  it('非法 action → 400', async () => {
    asRole('MEMBER')
    const res = await (intentStatusRoute.POST as any)(
      post('/api/v1/intents/i_1/status', { action: 'delete' }),
      params({ intentId: 'i_1' })
    )
    expect(res.status).toBe(400)
  })
})

describe('T03 · GET /api/v1/intents/[intentId]/disclosure', () => {
  it('返回三个受众视角的投影（由宽到窄），且不含受保护字段', async () => {
    asRole('MEMBER')
    // displayName 授权给「匹配后的对手方」，city 授权给「同任务的伙伴」
    intentFindFirst.mockResolvedValue(
      intentRow({ disclosure: '{"displayName":"COUNTERPARTY","city":"CANDIDATE"}' })
    )
    userFindUnique.mockResolvedValue({
      email: 'lin@example.com',
      profile: { displayName: '林晓', bio: '八年跨境', age: 32, city: '上海' },
    })

    const res = await (intentDisclosureRoute.GET as any)(
      get('/api/v1/intents/i_1/disclosure'),
      params({ intentId: 'i_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.preview.organizer.displayName).toBe('林晓')
    expect(body.data.preview.counterparty.displayName).toBe('林晓')

    // 🔴 候选视角**只**含授权给「同任务的伙伴」的字段：displayName 授权的是
    //    COUNTERPARTY（只给已配对对手方），因此候选看不到 —— 这正是档位方向的可观测形式。
    expect(Object.keys(body.data.preview.candidate).sort()).toEqual(['city'])
    expect(body.data.preview.candidate.city).toBe('上海')

    // 可见集合逐层包含：候选 ⊆ 对手方 ⊆ 组织者
    const keys = (o: object) => Object.keys(o)
    expect(keys(body.data.preview.candidate).every((k) => k in body.data.preview.counterparty)).toBe(true)
    expect(keys(body.data.preview.counterparty).every((k) => k in body.data.preview.organizer)).toBe(true)

    const json = JSON.stringify(body)
    expect(json).not.toContain('lin@example.com')
    // email 的**值**不出现；字段名会出现在 protectedFields 说明里（刻意给用户看的）
    for (const view of ['organizer', 'counterparty', 'candidate'] as const) {
      expect(Object.keys(body.data.preview[view])).not.toContain('email')
    }
    expect(body.data.summary.protectedFields.map((e: { key: string }) => e.key)).toContain('email')
  })
})

describe('T04 · GET /api/v1/connections/candidates', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (connectionsCandidatesRoute.GET as any)(get('/api/v1/connections/candidates?missionId=m_1'))
    expect(res.status).toBe(401)
  })

  it('缺 missionId → 400（不允许"给我全部候选"这种形状）', async () => {
    asRole('MEMBER')
    const res = await (connectionsCandidatesRoute.GET as any)(get('/api/v1/connections/candidates'))
    expect(res.status).toBe(400)
  })

  it('limit 非正整数 → 400', async () => {
    asRole('MEMBER')
    const res = await (connectionsCandidatesRoute.GET as any)(
      get('/api/v1/connections/candidates?missionId=m_1&limit=0')
    )
    expect(res.status).toBe(400)
  })

  it('MEMBER 自助可用 → 200，且响应自描述投影档位为 CANDIDATE', async () => {
    asRole('MEMBER')
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    intentFindFirst.mockResolvedValue(intentRow({ userId: 'u_1', need: 'need supply chain', offer: 'offer sourcing agent' }))
    intentFindMany.mockResolvedValue([
      intentRow({
        id: 'i_b',
        userId: 'u_b',
        need: 'need sourcing agent',
        offer: 'offer supply chain',
        disclosure: '{"displayName":"CANDIDATE","age":"COUNTERPARTY"}',
      }),
    ])
    partFindMany.mockResolvedValue([{ userId: 'u_1' }, { userId: 'u_b' }])
    userFindMany.mockResolvedValue([
      { id: 'u_b', email: 'leak@example.test', profile: { displayName: '林晓', age: 47 } },
    ])

    const res = await (connectionsCandidatesRoute.GET as any)(
      get('/api/v1/connections/candidates?missionId=m_1')
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.profileAudience).toBe('CANDIDATE')
    expect(body.data.candidates).toHaveLength(1)

    const subject = body.data.candidates[0].subject
    expect(subject.displayName).toBe('林晓')
    // 🔴 age 授权给 COUNTERPARTY → 候选看不到；键不存在而非 null
    expect(Object.prototype.hasOwnProperty.call(subject, 'age')).toBe(false)
    // 值级扫描：邮箱与年龄的值都不得出现
    const json = JSON.stringify(body)
    expect(json).not.toContain('leak@example.test')
    expect(json).not.toContain('47')
  })
})

describe('T03 · GET /api/v1/intents/fields', () => {
  it('下发字段目录 + 缺省口径 + 受保护字段 + 目录自检', async () => {
    asRole('MEMBER')
    const res = await (intentFieldsRoute.GET as any)(get('/api/v1/intents/fields'), undefined)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.missingFieldAudience).toBe('SELF')
    expect(body.data.protectedFields).toContain('email')
    expect(body.data.catalogProblems).toEqual([])
    expect(body.data.fields.length).toBeGreaterThan(10)
  })
})

describe('T03 · GET /api/v1/missions/[missionId]/intents（组织者视角）', () => {
  it('🔒 MEMBER 无 mission.read → 403（看不到别人的披露内容）', async () => {
    asRole('MEMBER')
    const res = await (missionIntentsRoute.GET as any)(
      get('/api/v1/missions/m_1/intents'),
      params({ missionId: 'm_1' })
    )
    expect(res.status).toBe(403)
    expect(intentFindMany).not.toHaveBeenCalled()
  })

  it('🔒 OPERATOR → 200，且响应体中**不出现**任何未授权字段名', async () => {
    asRole('OPERATOR')
    missionFindFirst.mockResolvedValue({ id: 'm_1' })
    intentCount.mockResolvedValue(2)
    intentFindMany.mockResolvedValue([
      intentRow({ disclosure: '{"displayName":"ORGANIZER","company":"ORGANIZER"}' }),
      intentRow({ id: 'i_2', userId: 'u_2', disclosure: '{"displayName":"SELF"}' }),
    ])
    userFindMany.mockResolvedValue([
      {
        id: 'u_1',
        email: 'a@example.com',
        profile: { displayName: '林晓', company: '启航贸易', age: 32, bio: '八年跨境', city: '上海' },
      },
      { id: 'u_2', email: 'b@example.com', profile: { displayName: '王强', age: 41, genderIdentity: '男' } },
    ])

    const res = await (missionIntentsRoute.GET as any)(
      get('/api/v1/missions/m_1/intents'),
      params({ missionId: 'm_1' })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data[0].subject).toEqual({ displayName: '林晓', company: '启航贸易' })
    expect(body.data[1].subject).toEqual({})

    const json = JSON.stringify(body)
    for (const forbidden of [
      '"email"',
      '"age"',
      '"bio"',
      '"city"',
      '"genderIdentity"',
      'a@example.com',
      'b@example.com',
      '"userId"',
      '"disclosure"',
    ]) {
      expect(json).not.toContain(forbidden)
    }
    // 意图正文（need/offer）是业务信息，组织者需要看到 —— 确保我们没过度遮蔽
    expect(json).toContain('需要东南亚渠道')
  })

  it('跨租户的任务 → 404', async () => {
    asRole('OPERATOR')
    missionFindFirst.mockResolvedValue(null)
    const res = await (missionIntentsRoute.GET as any)(
      get('/api/v1/missions/m_other/intents'),
      params({ missionId: 'm_other' })
    )
    expect(res.status).toBe(404)
  })
})
