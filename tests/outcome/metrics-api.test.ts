/**
 * T08 · `GET /api/v1/outcomes/metrics` —— HTTP 层（AC-16）
 *
 * 🔴 本文件钉住三件事：
 *   1. **能力口径**：`outcome.read` 是 SELF_SERVICE（全员）→ MEMBER 必须 200；
 *      匿名 401、非成员 403 —— 且**拒绝之前不查库**。
 *   2. **租户谓词不可省**：每一次 `count()` 都必须带 `organizationId`
 *      （这是"跨租户读到别人的数"唯一的防线，写漏一处就是静默越权）。
 *   3. **已验证下推**：`outcome.count` 的 where 必须用
 *      `verificationLevel: { in: VERIFIED_LEVELS }` 而不是取回来再逐条判。
 */

jest.mock('@/lib/db', () => ({
  db: {
    connectionProposal: { count: jest.fn() },
    outcome: { count: jest.fn() },
    workflowJob: { count: jest.fn() },
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
import { VERIFIED_LEVELS } from '@/lib/outcome/verification'

import * as route from '@/app/api/v1/outcomes/metrics/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const proposalCount = db.connectionProposal.count as unknown as jest.Mock
const outcomeCount = db.outcome.count as unknown as jest.Mock
const jobCount = db.workflowJob.count as unknown as jest.Mock

const ORG = 'org_1'
const API = 'http://localhost/api/v1/outcomes/metrics'

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', userId = 'u_1') {
  requireAuthMock.mockResolvedValue({ user: { id: userId } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

const req = (url: string = API) => new NextRequest(new URL(url, 'http://localhost'), { method: 'GET' })

/** 让每个 count 返回不同的值，从而能识别"哪一次调用对应哪个计数"。 */
function stubCounts(values: number[] = [10, 4, 6, 3, 2, 1, 2, 1]) {
  const q = [...values]
  proposalCount.mockImplementation(async () => q.shift() ?? 0)
  outcomeCount.mockImplementation(async () => q.shift() ?? 0)
  jobCount.mockImplementation(async () => q.shift() ?? 0)
}

beforeEach(() => {
  jest.clearAllMocks()
  stubCounts()
})

// ═══════════════════════════════════════════════════════════
describe('鉴权边界', () => {
  it('匿名 → 401 且 JSON，且**不查库**', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await route.GET(req())

    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(proposalCount).not.toHaveBeenCalled()
    expect(outcomeCount).not.toHaveBeenCalled()
    expect(jobCount).not.toHaveBeenCalled()
  })

  it('非本租户成员 → 403 且不查库', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
    membershipFindFirst.mockResolvedValue(null)

    const res = await route.GET(req())
    expect(res.status).toBe(403)
    expect(proposalCount).not.toHaveBeenCalled()
  })

  it('MEMBER → 200（`outcome.read` 全员；别"为了统一"把它抬成 OPERATOR+）', async () => {
    asRole('MEMBER')
    const res = await route.GET(req())
    expect(res.status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════
describe('🔴 租户谓词（每一条 count 都不可省）', () => {
  it('全部 count 调用都带 organizationId，且无额外 where 时只有它', async () => {
    asRole('MEMBER')
    await route.GET(req())

    const calls = [
      ...proposalCount.mock.calls,
      ...outcomeCount.mock.calls,
      ...jobCount.mock.calls,
    ]
    expect(calls.length).toBe(8)
    for (const [args] of calls) {
      expect(args.where.organizationId).toBe(ORG)
    }
  })

  it('不能从查询串推断租户（换个 organizationId 参数不解决问题）', async () => {
    asRole('MEMBER')
    await route.GET(req(`${API}?organizationId=org_hacker`))
    for (const [args] of proposalCount.mock.calls) {
      expect(args.where.organizationId).toBe(ORG)
      expect(args.where.organizationId).not.toBe('org_hacker')
    }
  })
})

// ═══════════════════════════════════════════════════════════
describe('查询下推', () => {
  it('「已验证」用 verificationLevel IN VERIFIED_LEVELS 下推（不取回再逐条判）', async () => {
    asRole('MEMBER')
    await route.GET(req())

    const used = outcomeCount.mock.calls.map(([a]) => a.where.verificationLevel).filter(Boolean)
    expect(used).toHaveLength(1)
    expect(used[0]).toEqual({ in: [...VERIFIED_LEVELS] })
    expect(used[0].in).not.toContain('SELF_REPORTED')
  })

  it('「已介绍」按 introducedAt 判，不按 status（介绍后 status 冻结在 MUTUALLY_ACCEPTED）', async () => {
    asRole('MEMBER')
    await route.GET(req())

    const introCall = proposalCount.mock.calls.map(([a]) => a.where).find((w) => w.introducedAt)
    expect(introCall).toBeTruthy()
    expect(introCall.introducedAt).toEqual({ not: null })
    expect(introCall.status).toBeUndefined()
  })

  it('人工介入看 WorkflowJob 的 TAKEN_OVER / DEAD 两态', async () => {
    asRole('MEMBER')
    await route.GET(req())

    const statuses = jobCount.mock.calls.map(([a]) => a.where.status).sort()
    expect(statuses).toEqual(['DEAD', 'TAKEN_OVER'])
  })

  it('?missionId= 非空 → 透传到每一次 count', async () => {
    asRole('MEMBER')
    await route.GET(req(`${API}?missionId=mission_9`))

    for (const [args] of proposalCount.mock.calls) expect(args.where.missionId).toBe('mission_9')
    for (const [args] of outcomeCount.mock.calls) expect(args.where.missionId).toBe('mission_9')
    for (const [args] of jobCount.mock.calls) expect(args.where.missionId).toBe('mission_9')
  })

  it('?missionId= 空串视同缺省（无筛选），不 400', async () => {
    asRole('MEMBER')
    const res = await route.GET(req(`${API}?missionId=`))

    expect(res.status).toBe(200)
    for (const [args] of proposalCount.mock.calls) expect(args.where.missionId).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
describe('响应形状（对账脚本的输入契约）', () => {
  it('下发 funnel / workload / cost / basis 四块，且计数与 stub 一致', async () => {
    asRole('MEMBER')
    const res = await route.GET(req())
    const body = await res.json()
    const d = body.data

    expect(d.funnel.proposals).toBe(10)
    expect(d.funnel.consentPending).toBe(4)
    expect(d.funnel.mutuallyAccepted).toBe(6)
    expect(d.funnel.introduced).toBe(3)
    expect(d.funnel.outcomesReported).toBe(2)
    expect(d.funnel.outcomesVerified).toBe(1)
    expect(d.workload.takeovers).toBe(2)
    expect(d.workload.deadLettered).toBe(1)
    expect(d.workload.interventions).toBe(3)
    expect(typeof d.generatedAt).toBe('string')
  })

  it('cost.totalCostCents === 各 lineItem 之和（自洽）', async () => {
    asRole('MEMBER')
    const res = await route.GET(req())
    const { cost } = (await res.json()).data

    const sum = cost.lineItems.reduce((s: number, i: { costCents: number }) => s + i.costCents, 0)
    expect(cost.totalCostCents).toBe(sum)
    expect(cost.lineItems).toHaveLength(4)
  })

  it('basis 自描述：含 verifiedLevels 与 assumptions（对账脚本据此复算，不硬编码）', async () => {
    asRole('MEMBER')
    const res = await route.GET(req())
    const { basis } = (await res.json()).data

    expect(basis.scope).toBe('all-time')
    expect(basis.missionId).toBe(null)
    expect(basis.verifiedLevels).toEqual([...VERIFIED_LEVELS])
    expect(basis.assumptions.unitCostsCents.introduction).toBeGreaterThan(0)
    expect(basis.assumptions.minutesPerIntervention).toBeGreaterThan(0)
  })

  it('🔴 响应不含任何 userId / 关系字段（指标是聚合，不该泄漏"谁跟谁连接了"）', async () => {
    asRole('MEMBER')
    const res = await route.GET(req())
    const text = JSON.stringify(await res.json())

    for (const forbidden of ['reporterId', 'counterpartyId', 'actorId', 'proposalId', 'summary']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('500 不泄漏内部信息', async () => {
    asRole('MEMBER')
    proposalCount.mockRejectedValue(new Error('SQLITE_ERROR: no such column: bogus'))
    const res = await route.GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('bogus')
  })
})
