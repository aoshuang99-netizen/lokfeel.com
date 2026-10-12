/**
 * T07 · `GET /api/v1/connections/pipeline` —— HTTP 层
 *
 * 🔴 本文件钉住一条**容易被"顺手改坏"的安全边界**：
 *    该端点是**租户级**的（返回全社群提案），因此只能 gate 一个 OPERATOR+ 的能力
 *    （`workflow.read`）。`withTenant` 对数组是 **`some()`（任一满足）**，
 *    所以若有人为了"看起来更完整"写成 `['proposal.read', 'workflow.read']`，
 *    就会把端点**降级**成所有成员都能读全社群提案 —— 下面有一条负向断言专门防它。
 */

jest.mock('@/lib/db', () => ({
  db: {
    connectionProposal: { findMany: jest.fn(), count: jest.fn() },
    introductionWorkflow: { findMany: jest.fn() },
    mission: { findMany: jest.fn() },
    socialIntent: { findMany: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as pipelineRoute from '@/app/api/v1/connections/pipeline/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const propFindMany = db.connectionProposal.findMany as unknown as jest.Mock
const propCount = db.connectionProposal.count as unknown as jest.Mock
const wfFindMany = db.introductionWorkflow.findMany as unknown as jest.Mock
const missionFindMany = db.mission.findMany as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock

const ORG = 'org_1'
const ME = 'u_me'

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER') {
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

function get(url: string) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET' })
}

const API = 'http://localhost/api/v1/connections/pipeline'

beforeEach(() => {
  jest.clearAllMocks()
  propFindMany.mockResolvedValue([])
  propCount.mockResolvedValue(0)
  wfFindMany.mockResolvedValue([])
  missionFindMany.mockResolvedValue([])
  intentFindMany.mockResolvedValue([])
})

describe('GET /api/v1/connections/pipeline —— 鉴权', () => {
  it('匿名 → 401 且 JSON，且不查提案', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await pipelineRoute.GET(get(API))

    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(propFindMany).not.toHaveBeenCalled()
  })

  it('非本租户成员 → 403', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: ME } })
    membershipFindFirst.mockResolvedValue(null)

    const res = await pipelineRoute.GET(get(API))
    expect(res.status).toBe(403)
    expect(propFindMany).not.toHaveBeenCalled()
  })

  it('🔴 MEMBER → 403（租户级视图不能因为 proposal.read 是自助能力就被放进来）', async () => {
    asRole('MEMBER')
    const res = await pipelineRoute.GET(get(API))

    expect(res.status).toBe(403)
    expect(propFindMany).not.toHaveBeenCalled()
  })

  it('OPERATOR / ADMIN / OWNER → 200', async () => {
    for (const role of ['OPERATOR', 'ADMIN', 'OWNER'] as const) {
      asRole(role)
      const res = await pipelineRoute.GET(get(API))
      expect(res.status).toBe(200)
    }
  })
})

describe('GET /api/v1/connections/pipeline —— 参数与响应', () => {
  it('无参数 → 200，返回完整信封（items/total/scanned/truncated/summary）', async () => {
    asRole('OPERATOR')
    propFindMany.mockResolvedValue([
      {
        id: 'p_1',
        organizationId: ORG,
        missionId: 'm_1',
        proposerId: 'u_a',
        candidateId: 'u_b',
        status: 'CONSENT_PENDING',
        introducedAt: null,
        expiresAt: null,
        closedAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ])
    propCount.mockResolvedValue(1)

    const res = await pipelineRoute.GET(get(API))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].proposalId).toBe('p_1')
    expect(body.data.scanned).toBe(1)
    expect(body.data.truncated).toBe(false)
    expect(body.data.summary.PENDING_CONSENT).toBe(1)
  })

  it('未知 bucket → 400（不静默回退全量 —— "筛选没生效"比"筛选报错"难发现）', async () => {
    asRole('OPERATOR')
    const res = await pipelineRoute.GET(get(`${API}?bucket=NOT_A_BUCKET`))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('bucket')
    expect(propFindMany).not.toHaveBeenCalled()
  })

  it('合法 bucket（小写也算）→ 200', async () => {
    asRole('OPERATOR')
    const res = await pipelineRoute.GET(get(`${API}?bucket=introduced`))
    expect(res.status).toBe(200)
  })

  it('?stalled=1 被接受（派生过滤由服务层完成）', async () => {
    asRole('OPERATOR')
    const res = await pipelineRoute.GET(get(`${API}?stalled=1`))
    expect(res.status).toBe(200)
  })

  it('分页参数透传到服务层（page/pageSize）', async () => {
    asRole('OPERATOR')
    const res = await pipelineRoute.GET(get(`${API}?page=2&pageSize=5`))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.page).toBe(2)
    expect(body.data.pageSize).toBe(5)
  })

  it('500 不泄漏内部信息', async () => {
    asRole('OPERATOR')
    propFindMany.mockRejectedValue(new Error('SQLITE_ERROR: no such column: bogus'))

    const res = await pipelineRoute.GET(get(API))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('bogus')
  })
})
