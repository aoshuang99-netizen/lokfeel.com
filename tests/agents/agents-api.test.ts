/**
 * T09 · Agent HTTP 端点测试（Slice 2）
 *
 * 钉住的东西：
 *   1. **能力口径**：`agent.run` = OPERATOR+（MEMBER 必须 403）、
 *      `agent.approve` = ADMIN+（**OPERATOR 也必须 403** —— 双人复核的制度保证）；
 *   2. **匿名 401**；
 *   3. **幂等键在 HTTP 层是硬要求**：缺 `Idempotency-Key` → 400；
 *      同键同体 → 200 + `replayed:true`；首次 → 201 + `replayed:false`；
 *   4. **审批状态机经 HTTP 依旧生效**：已裁决 → 409、状态不符 → 409；
 *   5. **未知查询参数 → 400**（不静默忽略，否则用户以为过滤生效了）。
 *
 * ⚠️ 与 billing 测试同一取向：内存假库驱动**整条**链路（含租户解析与幂等），
 *    断言响应体与库状态，而不是"某个函数被调用过"。
 */

jest.mock('@/lib/db', () => ({
  db: {
    agentRun: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    agentCall: { findMany: jest.fn() },
    agentApproval: { create: jest.fn() },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as runsRoute from '@/app/api/v1/agents/runs/route'
import * as runDetailRoute from '@/app/api/v1/agents/runs/[runId]/route'
import * as approveRoute from '@/app/api/v1/agents/runs/[runId]/approve/route'
import * as rejectRoute from '@/app/api/v1/agents/runs/[runId]/reject/route'
import * as usageRoute from '@/app/api/v1/agents/usage/route'

import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb, type FakeRunRow } from './_fake-db'

const requireAuthMock = requireAuth as unknown as jest.Mock

const ORG = 'org_1'
const BASE = 'http://localhost'

let fake: FakeAgentDb

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER'

function asRole(role: Role) {
  requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
  ;(db.membership as unknown as { findFirst: jest.Mock }).findFirst.mockResolvedValue({
    id: 'ms_1',
    organizationId: ORG,
    role,
  })
}

const getReq = (url: string) => new NextRequest(new URL(url, BASE), { method: 'GET' })
function postReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const paramsOf = (runId: string) => ({ params: Promise.resolve({ runId }) })

/** 直接植入一条 run（用于逐过"必须由模型产出才能到达"的状态）。 */
function seedRun(patch: Partial<FakeRunRow> = {}): FakeRunRow {
  const row: FakeRunRow = {
    id: patch.id ?? `run_${fake.runs.length + 1}`,
    organizationId: patch.organizationId ?? ORG,
    skill: patch.skill ?? 'INTRO_DRAFT',
    status: patch.status ?? 'AWAITING_APPROVAL',
    risk: patch.risk ?? 'HIGH',
    requiresApproval: patch.requiresApproval ?? true,
    requestedBy: patch.requestedBy ?? 'u_1',
    subjectLabel: patch.subjectLabel ?? null,
    goal: patch.goal ?? '对接渠道伙伴',
    proposalJson: patch.proposalJson ?? null,
    rawText: patch.rawText ?? null,
    reason: patch.reason ?? null,
    degradeCode: patch.degradeCode ?? null,
    providerKind: patch.providerKind ?? 'STUB',
    injectionSignals: patch.injectionSignals ?? null,
    costMicroCents: patch.costMicroCents ?? 0,
    dedupeKey: patch.dedupeKey ?? 'seed',
    requestHash: patch.requestHash ?? null,
    createdAt: patch.createdAt ?? new Date(),
    updatedAt: patch.updatedAt ?? new Date(),
  }
  fake.runs.push(row)
  return row
}

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
  asRole('ADMIN')
})

// ═══════════════════════════════════════════════════════════
describe('鉴权与能力口径', () => {
  it('匿名 GET /runs → 401，且不查业务库', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('no session'))
    const res = await runsRoute.GET(getReq('/api/v1/agents/runs'), undefined)
    expect(res.status).toBe(401)
    expect(db.agentRun.findMany).not.toHaveBeenCalled()
  })

  it('🔴 MEMBER 发起运行 → 403（agent.run 是 OPERATOR+）', async () => {
    asRole('MEMBER')
    const res = await runsRoute.POST(
      postReq('/api/v1/agents/runs', { skill: 'INTENT_EXTRACTION', input: { goal: 'x' } }, {
        'idempotency-key': 'k',
      }),
      undefined,
    )
    expect(res.status).toBe(403)
    expect(fake.runs).toHaveLength(0)
  })

  it('🔴 OPERATOR 能发起（200/201 类）但**不能批准** → 403（双人复核）', async () => {
    asRole('OPERATOR')
    const seeded = seedRun({ status: 'AWAITING_APPROVAL' })

    const approve = await approveRoute.POST(
      postReq(`/api/v1/agents/runs/${seeded.id}/approve`, {}),
      paramsOf(seeded.id),
    )
    expect(approve.status).toBe(403)
    expect(fake.approvals).toHaveLength(0)

    const reject = await rejectRoute.POST(
      postReq(`/api/v1/agents/runs/${seeded.id}/reject`, {}),
      paramsOf(seeded.id),
    )
    expect(reject.status).toBe(403)

    // 同一 OPERATOR 跑运行是允许的
    const run = await runsRoute.POST(
      postReq(
        '/api/v1/agents/runs',
        { skill: 'INTENT_EXTRACTION', input: { goal: '帮助我们在 30 天内对接 5 家渠道伙伴' } },
        { 'idempotency-key': 'op-run' },
      ),
      undefined,
    )
    expect([200, 201]).toContain(run.status)
  })

  it('MEMBER 读用量 / 读列表 → 403', async () => {
    asRole('MEMBER')
    expect((await usageRoute.GET(getReq('/api/v1/agents/usage'), undefined)).status).toBe(403)
    expect((await runsRoute.GET(getReq('/api/v1/agents/runs'), undefined)).status).toBe(403)
  })
})

// ═══════════════════════════════════════════════════════════
describe('POST /api/v1/agents/runs —— 发起与幂等', () => {
  const body = { skill: 'INTENT_EXTRACTION', input: { goal: '帮助我们在 30 天内对接 5 家渠道伙伴' } }

  it('缺 Idempotency-Key → 400', async () => {
    const res = await runsRoute.POST(postReq('/api/v1/agents/runs', body), undefined)
    expect(res.status).toBe(400)
    expect(fake.runs).toHaveLength(0)
  })

  it('首次 → 201 + replayed:false；同键同体重放 → 200 + replayed:true', async () => {
    const first = await runsRoute.POST(
      postReq('/api/v1/agents/runs', body, { 'idempotency-key': 'http-1' }),
      undefined,
    )
    expect(first.status).toBe(201)
    const firstJson = await first.json()
    expect(firstJson.success).toBe(true)
    expect(firstJson.data.replayed).toBe(false)
    // 本仓测试环境没有 OPENAI_API_KEY → 规则式兜底（明示降级，不假装成功）
    expect(firstJson.data.run.status).toBe('DEGRADED')

    const second = await runsRoute.POST(
      postReq('/api/v1/agents/runs', body, { 'idempotency-key': 'http-1' }),
      undefined,
    )
    expect(second.status).toBe(200)
    const secondJson = await second.json()
    expect(secondJson.data.replayed).toBe(true)
    expect(secondJson.data.run.id).toBe(firstJson.data.run.id)
    expect(fake.runs).toHaveLength(1)
  })

  it('未知 skill → 400', async () => {
    const res = await runsRoute.POST(
      postReq('/api/v1/agents/runs', { skill: 'NOPE', input: {} }, { 'idempotency-key': 'x' }),
      undefined,
    )
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════
describe('GET /api/v1/agents/runs —— 列表与过滤', () => {
  it('返回本租户运行 + filters；未知 status → 400', async () => {
    seedRun({ status: 'PROPOSED', risk: 'LOW', requiresApproval: false, skill: 'COORDINATION_ADVICE' })
    seedRun({ id: 'run_other', organizationId: 'org_2' })

    const ok = await runsRoute.GET(getReq('/api/v1/agents/runs'), undefined)
    expect(ok.status).toBe(200)
    const json = await ok.json()
    expect(json.data.items).toHaveLength(1)
    expect(json.data.items[0].status).toBe('PROPOSED')
    expect(json.data.filters.limit).toBeGreaterThan(0)

    const bad = await runsRoute.GET(getReq('/api/v1/agents/runs?status=NOPE'), undefined)
    expect(bad.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════
describe('GET /api/v1/agents/runs/{id} —— 详情', () => {
  it('存在 → 200；不存在 → 404', async () => {
    const seeded = seedRun()
    const ok = await runDetailRoute.GET(getReq(`/api/v1/agents/runs/${seeded.id}`), paramsOf(seeded.id))
    expect(ok.status).toBe(200)
    const json = await ok.json()
    expect(json.data.id).toBe(seeded.id)
    // DTO 投影边界：详情也不暴露 rawText
    expect(json.data).not.toHaveProperty('rawText')

    const missing = await runDetailRoute.GET(getReq('/api/v1/agents/runs/nope'), paramsOf('nope'))
    expect(missing.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════
describe('审批 HTTP 面', () => {
  it('AWAITING_APPROVAL → approve：200 且状态 APPROVED', async () => {
    const seeded = seedRun()
    const res = await approveRoute.POST(
      postReq(`/api/v1/agents/runs/${seeded.id}/approve`, { note: 'ok' }),
      paramsOf(seeded.id),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe('APPROVED')
    expect(json.data.approval.decision).toBe('APPROVED')
  })

  it('已裁决 → 再次 approve/reject 均 409', async () => {
    const seeded = seedRun()
    await approveRoute.POST(postReq(`/api/v1/agents/runs/${seeded.id}/approve`, {}), paramsOf(seeded.id))
    const again = await rejectRoute.POST(
      postReq(`/api/v1/agents/runs/${seeded.id}/reject`, {}),
      paramsOf(seeded.id),
    )
    expect(again.status).toBe(409)
  })

  it('🔴 状态真相表：PROPOSED 直接 approve → 409', async () => {
    const seeded = seedRun({ status: 'PROPOSED', requiresApproval: false, risk: 'LOW' })
    const res = await approveRoute.POST(
      postReq(`/api/v1/agents/runs/${seeded.id}/approve`, {}),
      paramsOf(seeded.id),
    )
    expect(res.status).toBe(409)
    expect(fake.approvals).toHaveLength(0)
  })

  it('跨租户裁决 → 404', async () => {
    const seeded = seedRun({ organizationId: 'org_2' })
    const res = await approveRoute.POST(
      postReq(`/api/v1/agents/runs/${seeded.id}/approve`, {}),
      paramsOf(seeded.id),
    )
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════
describe('GET /api/v1/agents/usage', () => {
  it('OPERATOR 可读；返回期次、总量与假设', async () => {
    asRole('OPERATOR')
    const res = await usageRoute.GET(getReq('/api/v1/agents/usage'), undefined)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.periodKey).toMatch(/^\d{4}-\d{2}$/)
    expect(json.data.assumptions.price).toBeDefined()
    expect(json.data.quota.maxMicroCents).toBeGreaterThan(0)
  })
})
