/**
 * T08 · `/api/v1/outcomes*` —— HTTP 层
 *
 * 🔴 本文件钉住两条**安全边界**：
 *   1. `outcome.read` / `outcome.report` 是 **SELF_SERVICE**（全员）—— 所以列表与上报
 *      对 MEMBER 必须 200（这与 T07 的租户级视图相反，别"为了统一"把它们收紧）；
 *   2. `outcome.verify` 只在 **ADMIN_EXTRA** —— `OPERATOR → 403`，且**不得触碰 DB**
 *      （先拒绝再查，避免"查了但没写"的错觉）。负向断言专防这条被放松。
 */

jest.mock('@/lib/db', () => ({
  db: {
    connectionProposal: { findFirst: jest.fn() },
    outcome: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    outcomeVerification: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

jest.mock('@/lib/workflow/workflow', () => ({
  advanceIntroductionWorkflow: jest.fn(async () => ({ stage: 'ACTION_COMPLETED', changed: true })),
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as listRoute from '@/app/api/v1/outcomes/route'
import * as confirmRoute from '@/app/api/v1/outcomes/[outcomeId]/confirm/route'
import * as verifyRoute from '@/app/api/v1/outcomes/[outcomeId]/verify/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const propFindFirst = db.connectionProposal.findFirst as unknown as jest.Mock
const outcomeFindUnique = db.outcome.findUnique as unknown as jest.Mock
const outcomeFindFirst = db.outcome.findFirst as unknown as jest.Mock
const outcomeFindMany = db.outcome.findMany as unknown as jest.Mock
const outcomeCreate = db.outcome.create as unknown as jest.Mock
const outcomeUpdateMany = db.outcome.updateMany as unknown as jest.Mock
const verifFindFirst = db.outcomeVerification.findFirst as unknown as jest.Mock
const verifFindMany = db.outcomeVerification.findMany as unknown as jest.Mock

const ORG = 'org_1'
const REPORTER = 'u_reporter'
const COUNTERPARTY = 'u_counterparty'
const SUMMARY = '他们合作完成了一个项目'

const API = 'http://localhost/api/v1/outcomes'

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', userId = REPORTER) {
  requireAuthMock.mockResolvedValue({ user: { id: userId } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
}

const withId = (outcomeId: string) => ({ params: Promise.resolve({ outcomeId }) })

const PROPOSAL = {
  id: 'p_1',
  missionId: 'm_1',
  proposerId: REPORTER,
  candidateId: COUNTERPARTY,
  status: 'MUTUALLY_ACCEPTED',
  introducedAt: new Date('2026-10-01T00:00:00.000Z'),
}

const OUTCOME_ROW = {
  id: 'o_1',
  organizationId: ORG,
  proposalId: 'p_1',
  missionId: 'm_1',
  reporterId: REPORTER,
  counterpartyId: COUNTERPARTY,
  summary: SUMMARY,
  verificationLevel: 'SELF_REPORTED',
  occurredAt: new Date('2026-10-02T00:00:00.000Z'),
  createdAt: new Date('2026-10-02T01:00:00.000Z'),
}

beforeEach(() => {
  jest.clearAllMocks()
  propFindFirst.mockResolvedValue(PROPOSAL)
  outcomeFindUnique.mockResolvedValue(null)
  outcomeFindFirst.mockResolvedValue(OUTCOME_ROW)
  outcomeFindMany.mockResolvedValue([])
  outcomeCreate.mockResolvedValue({ id: 'o_1' })
  outcomeUpdateMany.mockResolvedValue({ count: 1 })
  verifFindFirst.mockResolvedValue(null)
  verifFindMany.mockResolvedValue([])
})

// ═══════════════════════════════════════════════════════════
describe('GET /api/v1/outcomes —— 鉴权', () => {
  it('匿名 → 401 且 JSON，且不查成果', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await listRoute.GET(req(API))

    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(outcomeFindMany).not.toHaveBeenCalled()
  })

  it('非本租户成员 → 403', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: REPORTER } })
    membershipFindFirst.mockResolvedValue(null)

    const res = await listRoute.GET(req(API))
    expect(res.status).toBe(403)
  })

  it('MEMBER → 200（`outcome.read` 是全员能力，别"为了统一"收紧它）', async () => {
    asRole('MEMBER')
    const res = await listRoute.GET(req(API))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/v1/outcomes —— 参数与响应', () => {
  it('未知 level → 400（不静默忽略 —— "筛选没生效"比"筛选报错"难发现）', async () => {
    asRole('MEMBER')
    const res = await listRoute.GET(req(`${API}?level=NOT_A_LEVEL`))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('level')
    expect(outcomeFindMany).not.toHaveBeenCalled()
  })

  it('?verified=1 透传到服务层（下推 VERIFIED_LEVELS）', async () => {
    asRole('MEMBER')
    const res = await listRoute.GET(req(`${API}?verified=1`))
    expect(res.status).toBe(200)
    expect(outcomeFindMany.mock.calls[0][0].where.verificationLevel).toEqual({
      in: ['COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'],
    })
  })

  it('响应含 unverifiedCount（仅自报条数）—— AC-15 的"分离"在界面上的数据源', async () => {
    asRole('MEMBER')
    outcomeFindMany.mockResolvedValue([OUTCOME_ROW])
    const res = await listRoute.GET(req(API))
    const body = await res.json()

    expect(body.data.count).toBe(1)
    expect(body.data.unverifiedCount).toBe(1)
    expect(body.data.items[0].verified).toBe(false)
  })

  it('500 不泄漏内部信息', async () => {
    asRole('MEMBER')
    outcomeFindMany.mockRejectedValue(new Error('SQLITE_ERROR: no such column: bogus'))
    const res = await listRoute.GET(req(API))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('bogus')
  })
})

// ═══════════════════════════════════════════════════════════
describe('POST /api/v1/outcomes —— 上报', () => {
  it('MEMBER（当事方）→ 201，且级别恒为 SELF_REPORTED', async () => {
    asRole('MEMBER')
    const res = await listRoute.POST(
      req(API, 'POST', { proposalId: 'p_1', summary: SUMMARY })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(outcomeCreate.mock.calls[0][0].data.verificationLevel).toBe('SELF_REPORTED')
    expect(body.data.verified).toBe(false)
  })

  it('🔴 请求体塞 verificationLevel 不会生效（级别派生，非入参）', async () => {
    asRole('MEMBER')
    await listRoute.POST(
      req(API, 'POST', {
        proposalId: 'p_1',
        summary: SUMMARY,
        verificationLevel: 'EXTERNALLY_VERIFIED',
      })
    )
    expect(outcomeCreate.mock.calls[0][0].data.verificationLevel).toBe('SELF_REPORTED')
  })

  it('非当事方 → 403', async () => {
    asRole('MEMBER', 'u_stranger')
    const res = await listRoute.POST(req(API, 'POST', { proposalId: 'p_1', summary: SUMMARY }))
    expect(res.status).toBe(403)
  })

  it('summary 太短 → 400', async () => {
    asRole('MEMBER')
    const res = await listRoute.POST(req(API, 'POST', { proposalId: 'p_1', summary: '短' }))
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════
describe('POST .../{id}/confirm —— 对手方确认', () => {
  it('对手方（MEMBER）→ 200，created: true', async () => {
    asRole('MEMBER', COUNTERPARTY)
    outcomeFindFirst.mockResolvedValue({ ...OUTCOME_ROW, verificationLevel: 'COUNTERPARTY_CONFIRMED' })
    verifFindMany.mockResolvedValue([
      { level: 'COUNTERPARTY_CONFIRMED', actorId: COUNTERPARTY, createdAt: new Date() },
    ])

    const res = await confirmRoute.POST(req(`${API}/o_1/confirm`, 'POST', {}), withId('o_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.created).toBe(true)
    expect(body.data.outcome.verified).toBe(true)
  })

  it('🔴 上报人自我确认 → 400（AC-15）', async () => {
    asRole('MEMBER', REPORTER)
    const res = await confirmRoute.POST(req(`${API}/o_1/confirm`, 'POST', {}), withId('o_1'))
    expect(res.status).toBe(400)
  })

  it('第三方 → 403', async () => {
    asRole('MEMBER', 'u_stranger')
    const res = await confirmRoute.POST(req(`${API}/o_1/confirm`, 'POST', {}), withId('o_1'))
    expect(res.status).toBe(403)
  })
})

// ═══════════════════════════════════════════════════════════
describe('POST .../{id}/verify —— 外部核验（仅 ADMIN+）', () => {
  it('🔴 OPERATOR → 403，且**不得**触碰 DB（先拒绝再查）', async () => {
    asRole('OPERATOR')
    const res = await verifyRoute.POST(req(`${API}/o_1/verify`, 'POST', {}), withId('o_1'))

    expect(res.status).toBe(403)
    expect(outcomeFindFirst).not.toHaveBeenCalled()
    expect(outcomeUpdateMany).not.toHaveBeenCalled()
  })

  it('MEMBER → 403', async () => {
    asRole('MEMBER')
    const res = await verifyRoute.POST(req(`${API}/o_1/verify`, 'POST', {}), withId('o_1'))
    expect(res.status).toBe(403)
  })

  it('ADMIN → 200，且不要求是当事方', async () => {
    asRole('ADMIN', 'u_admin')
    outcomeFindFirst.mockResolvedValue({ ...OUTCOME_ROW, verificationLevel: 'EXTERNALLY_VERIFIED' })
    verifFindMany.mockResolvedValue([
      { level: 'EXTERNALLY_VERIFIED', actorId: 'u_admin', createdAt: new Date() },
    ])

    const res = await verifyRoute.POST(
      req(`${API}/o_1/verify`, 'POST', { evidence: '合同编号 XYZ' }),
      withId('o_1')
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.created).toBe(true)
    expect(body.data.outcome.verificationLevel).toBe('EXTERNALLY_VERIFIED')
  })
})
