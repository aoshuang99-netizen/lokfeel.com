/**
 * T06 · 工作流运营 API —— HTTP 层（能力关卡 + 状态码 + 参数校验）
 *
 * 与 T05 的 `proposals-api.test.ts` 同一取向：直接 import 路由导出的 handler，
 * 不启服务，可离线确定性地覆盖状态码全谱系。
 *
 * ⚠️ 本层**证不了路径形状**（`params` 由测试构造、URL 不参与路由匹配）：
 *    `/workflow/jobs/{jobId}/takeover` 的真实段数只有 **E2E** 能证。
 *    下面的 describe 名按真实路径书写，以免后人照错形状再踩一次。
 *
 * 能力矩阵（`capabilities.ts`）：
 *   - `workflow.read`   → OPERATOR / ADMIN / OWNER（MEMBER 无）
 *   - `workflow.manage` → ADMIN / OWNER（OPERATOR 无）
 * 因此"接管/重试"用 OPERATOR 会 403 —— 这是刻意取严（消息是否出街是管理动作）。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: { membership: { findFirst: jest.fn() } },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

jest.mock('@/lib/workflow', () => ({
  listWorkflowJobs: jest.fn(),
  getWorkflowOverview: jest.fn(),
  takeOverJob: jest.fn(),
  requeueJobManually: jest.fn(),
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { ConflictError, NotFoundError, UnauthorizedError } from '@/lib/errors'
import { getWorkflowOverview, listWorkflowJobs, requeueJobManually, takeOverJob } from '@/lib/workflow'

import * as jobsRoute from '@/app/api/v1/workflow/jobs/route'
import * as overviewRoute from '@/app/api/v1/workflow/overview/route'
import * as takeoverRoute from '@/app/api/v1/workflow/jobs/[jobId]/takeover/route'
import * as requeueRoute from '@/app/api/v1/workflow/jobs/[jobId]/requeue/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const listJobsMock = listWorkflowJobs as unknown as jest.Mock
const overviewMock = getWorkflowOverview as unknown as jest.Mock
const takeOverMock = takeOverJob as unknown as jest.Mock
const requeueMock = requeueJobManually as unknown as jest.Mock

const ORG = 'org_1'
const ME = 'u_me'

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER') {
  requireAuthMock.mockResolvedValue({ user: { id: ME } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

function get(url: string) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET' })
}

function post(url: string, body?: unknown) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = (obj: Record<string, string>) => ({ params: Promise.resolve(obj) })

beforeEach(() => {
  jest.clearAllMocks()
  listJobsMock.mockResolvedValue([])
  overviewMock.mockResolvedValue({
    counts: {},
    needsAttention: [],
    stalled: [],
    deliveries: { sent: 0, captured: 0, failed: 0, pending: 0 },
  })
})

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/workflow/jobs
// ═══════════════════════════════════════════════════════════════

describe('T06 · GET /api/v1/workflow/jobs', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (jobsRoute.GET as any)(get('/api/v1/workflow/jobs'), undefined)
    expect(res.status).toBe(401)
    expect(listJobsMock).not.toHaveBeenCalled()
  })

  it('🔒 MEMBER 无 workflow.read → 403', async () => {
    asRole('MEMBER')
    const res = await (jobsRoute.GET as any)(get('/api/v1/workflow/jobs'), undefined)
    expect(res.status).toBe(403)
    expect(listJobsMock).not.toHaveBeenCalled()
  })

  it('OPERATOR → 200，且租户由会话决定', async () => {
    asRole('OPERATOR')
    listJobsMock.mockResolvedValue([{ id: 'j_1', status: 'PENDING' }])
    const res = await (jobsRoute.GET as any)(get('/api/v1/workflow/jobs'), undefined)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.jobs).toHaveLength(1)
    expect(listJobsMock.mock.calls[0][0]).toBe(ORG)
  })

  it('?status=DEAD,TAKEN_OVER → 透传为状态数组', async () => {
    asRole('OPERATOR')
    await (jobsRoute.GET as any)(get('/api/v1/workflow/jobs?status=dead,taken_over'), undefined)
    expect(listJobsMock.mock.calls[0][1].statuses).toEqual(['DEAD', 'TAKEN_OVER'])
  })

  it('未知 status → 400（不静默忽略拼错值）', async () => {
    asRole('OPERATOR')
    const res = await (jobsRoute.GET as any)(get('/api/v1/workflow/jobs?status=NOPE'), undefined)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('status')
    expect(listJobsMock).not.toHaveBeenCalled()
  })

  it('limit=0 → 400', async () => {
    asRole('OPERATOR')
    const res = await (jobsRoute.GET as any)(get('/api/v1/workflow/jobs?limit=0'), undefined)
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/workflow/overview
// ═══════════════════════════════════════════════════════════════

describe('T06 · GET /api/v1/workflow/overview', () => {
  it('🔒 MEMBER → 403', async () => {
    asRole('MEMBER')
    const res = await (overviewRoute.GET as any)(get('/api/v1/workflow/overview'), undefined)
    expect(res.status).toBe(403)
  })

  it('OPERATOR → 200，且 captured 与 sent **分开**返回（AC-09 诚实）', async () => {
    asRole('OPERATOR')
    overviewMock.mockResolvedValue({
      counts: { PENDING: 2, DEAD: 1 },
      needsAttention: [],
      stalled: [],
      deliveries: { sent: 3, captured: 5, failed: 1, pending: 0 },
    })
    const res = await (overviewRoute.GET as any)(get('/api/v1/workflow/overview'), undefined)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deliveries.sent).toBe(3)
    expect(body.data.deliveries.captured).toBe(5) // 未被并进 sent
    expect(overviewMock.mock.calls[0][0]).toBe(ORG)
  })
})

// ═══════════════════════════════════════════════════════════════
// POST /api/v1/workflow/jobs/{jobId}/takeover
// ═══════════════════════════════════════════════════════════════

describe('T06 · POST /api/v1/workflow/jobs/{jobId}/takeover', () => {
  it('🔒 OPERATOR 无 workflow.manage → 403（接管是管理动作）', async () => {
    asRole('OPERATOR')
    const res = await (takeoverRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/takeover'),
      params({ jobId: 'j_1' })
    )
    expect(res.status).toBe(403)
    expect(takeOverMock).not.toHaveBeenCalled()
  })

  it('ADMIN → 200 已接管', async () => {
    asRole('ADMIN')
    takeOverMock.mockResolvedValue(undefined)
    const res = await (takeoverRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/takeover', { note: '先别发' }),
      params({ jobId: 'j_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ jobId: 'j_1', status: 'TAKEN_OVER' })
    // 备注被透传（且已 trim）
    expect(takeOverMock.mock.calls[0][2]).toBe('先别发')
  })

  it('空 body 合法（接管不需要理由）', async () => {
    asRole('ADMIN')
    const res = await (takeoverRoute.POST as any)(
      new NextRequest(new URL('/api/v1/workflow/jobs/j_1/takeover', 'http://localhost'), {
        method: 'POST',
      }),
      params({ jobId: 'j_1' })
    )
    expect(res.status).toBe(200)
    expect(takeOverMock.mock.calls[0][2]).toBeNull()
  })

  it('note 超长 → 400', async () => {
    asRole('ADMIN')
    const res = await (takeoverRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/takeover', { note: 'x'.repeat(600) }),
      params({ jobId: 'j_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('note')
  })

  it('note 非字符串 → 400', async () => {
    asRole('ADMIN')
    const res = await (takeoverRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/takeover', { note: 123 }),
      params({ jobId: 'j_1' })
    )
    expect(res.status).toBe(400)
  })

  it('任务不存在（NotFoundError）→ 404', async () => {
    asRole('ADMIN')
    takeOverMock.mockRejectedValue(new NotFoundError('Workflow job not found'))
    const res = await (takeoverRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_x/takeover'),
      params({ jobId: 'j_x' })
    )
    expect(res.status).toBe(404)
  })

  it('已终态（ConflictError）→ 409', async () => {
    asRole('ADMIN')
    takeOverMock.mockRejectedValue(new ConflictError('already terminal'))
    const res = await (takeoverRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/takeover'),
      params({ jobId: 'j_1' })
    )
    expect(res.status).toBe(409)
  })

  it('参数缺 jobId → 404（不是 400：路径段缺了=资源不存在）', async () => {
    asRole('ADMIN')
    const res = await (takeoverRoute.POST as any)(
      post('/api/v1/workflow/jobs//takeover'),
      params({})
    )
    expect(res.status).toBe(404)
    expect(takeOverMock).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════
// POST /api/v1/workflow/jobs/{jobId}/requeue
// ═══════════════════════════════════════════════════════════════

describe('T06 · POST /api/v1/workflow/jobs/{jobId}/requeue', () => {
  it('🔒 OPERATOR → 403', async () => {
    asRole('OPERATOR')
    const res = await (requeueRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/requeue'),
      params({ jobId: 'j_1' })
    )
    expect(res.status).toBe(403)
  })

  it('ADMIN → 200 已重新入队', async () => {
    asRole('ADMIN')
    requeueMock.mockResolvedValue(undefined)
    const res = await (requeueRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/requeue'),
      params({ jobId: 'j_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ jobId: 'j_1', status: 'PENDING' })
    expect(requeueMock.mock.calls[0][1]).toBe('j_1')
  })

  it('不可重置状态（ConflictError）→ 409', async () => {
    asRole('ADMIN')
    requeueMock.mockRejectedValue(new ConflictError('not requeueable'))
    const res = await (requeueRoute.POST as any)(
      post('/api/v1/workflow/jobs/j_1/requeue'),
      params({ jobId: 'j_1' })
    )
    expect(res.status).toBe(409)
  })
})
