/**
 * V21 · C03 RED 测试 —— 服务端真实编排阶段事件（不是模型 token 流）
 *
 * 覆盖：
 *   - buildOrchestrationStages：至少 4 个阶段 QUOTA_CHECK / MODEL_CALL /
 *     SCHEMA_VALIDATE / PERSISTED，失败/降级路径追加 DEGRADED；
 *   - formatStageEventStream：SSE 帧格式（id / event: stage / data JSON），
 *     Last-Event-ID 断点续传（只回 seq > lastId），流末尾 event: done；
 *   - createAgentRun：编排关键点真的写出阶段事件（带 organizationId、seq 递增）；
 *   - 路由：text/event-stream、能力不足 403、跨租户 404、断点续传头、
 *     响应里明确"编排阶段事件，不是模型 token 流"。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    agentRun: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    agentCall: { findMany: jest.fn() },
    agentApproval: { create: jest.fn() },
    agentExecution: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    agentRunStageEvent: { createMany: jest.fn(), findMany: jest.fn() },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    organization: { findUnique: jest.fn() },
    notificationDelivery: { findUnique: jest.fn(), upsert: jest.fn() },
    notification: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    billingEvent: { findMany: jest.fn() },
    socialIntent: { findFirst: jest.fn(), findMany: jest.fn() },
    missionParticipation: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { NotFoundError } from '@/lib/errors'
import { createStubProvider, type ModelProvider } from '@/lib/agent'
import { createAgentRun } from '@/lib/agents'
import {
  buildOrchestrationStages,
  formatStageEventStream,
  getStageEvents,
  type OrchestrationFacts,
  type StageEventRow,
} from '@/lib/agents/stage-events'
import * as eventsRoute from '@/app/api/v1/agents/runs/[runId]/events/route'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ORG = 'org_1'
const ctx = (organizationId: string, role: TenantContext['role'] = 'ADMIN'): TenantContext => ({
  organizationId, userId: 'u_1', role, membershipId: 'ms_1',
})

const agentRunFindFirst = db.agentRun.findFirst as unknown as jest.Mock
const stageCreateMany = db.agentRunStageEvent.createMany as unknown as jest.Mock
const stageFindMany = db.agentRunStageEvent.findMany as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const requireAuthMock = requireAuth as unknown as jest.Mock

const baseFacts: OrchestrationFacts = {
  quotaChecked: true,
  quotaBlocked: false,
  providerKind: 'STUB',
  callCount: 1,
  schemaValid: true,
  status: 'PROPOSED',
  degradeCode: null,
  persistedRunId: 'run_1',
}

function stageRows(): StageEventRow[] {
  return [1, 2, 3, 4].map((seq) => ({
    id: `e_${seq}`,
    organizationId: ORG,
    runId: 'run_1',
    seq,
    stage: ['QUOTA_CHECK', 'MODEL_CALL', 'SCHEMA_VALIDATE', 'PERSISTED'][seq - 1],
    at: new Date('2026-11-15T00:00:00.000Z'),
    detail: JSON.stringify({ seq }),
  }))
}

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER') {
  requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

const params = (obj: Record<string, string>) => ({ params: Promise.resolve(obj) })

function get(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET', headers })
}

let fake: FakeAgentDb

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
  stageCreateMany.mockResolvedValue({ count: 4 })
})

// ═══════════════════════════════════════════════════════════════
describe('V21/C03 · buildOrchestrationStages（编排阶段，不是 token 流）', () => {
  it('正常路径 → 恰好 4 个阶段，seq 1..4', () => {
    const stages = buildOrchestrationStages(baseFacts)
    expect(stages.map((s) => s.stage)).toEqual(['QUOTA_CHECK', 'MODEL_CALL', 'SCHEMA_VALIDATE', 'PERSISTED'])
    expect(stages.map((s) => s.seq)).toEqual([1, 2, 3, 4])
  })

  it('detail 只陈述事实（providerKind / callCount / schemaValid / status）', () => {
    const stages = buildOrchestrationStages(baseFacts)
    expect(stages[1].detail).toMatchObject({ callCount: 1 })
    expect(stages[2].detail).toMatchObject({ schemaValid: true })
    expect(JSON.stringify(stages)).not.toContain('token')
  })

  it('DEGRADED / BLOCKED_QUOTA / FAILED 路径追加 DEGRADED 阶段', () => {
    for (const status of ['DEGRADED', 'BLOCKED_QUOTA', 'FAILED']) {
      const stages = buildOrchestrationStages({ ...baseFacts, status, degradeCode: 'OUTPUT_SCHEMA_INVALID' })
      expect(stages.map((s) => s.stage)).toContain('DEGRADED')
      expect(stages[stages.length - 1].stage).toBe('DEGRADED')
    }
  })
})

describe('V21/C03 · formatStageEventStream（SSE 帧 / 断点续传 / done）', () => {
  it('输出 id: / event: stage / data: JSON，按 seq 顺序', () => {
    const text = formatStageEventStream(stageRows(), 0)
    expect(text).toContain('id: 1')
    expect(text).toContain('event: stage')
    expect(text).toContain('id: 4')
    expect(text.indexOf('id: 1')).toBeLessThan(text.indexOf('id: 4'))
    expect(text).toContain('"stage":"QUOTA_CHECK"')
  })

  it('Last-Event-ID=2 → 只回 seq > 2', () => {
    const text = formatStageEventStream(stageRows(), 2)
    expect(text).not.toContain('id: 1')
    expect(text).not.toContain('id: 2')
    expect(text).toContain('id: 3')
    expect(text).toContain('id: 4')
  })

  it('流结束前发 event: done，并声明是编排阶段事件、不是 token 流', () => {
    const text = formatStageEventStream(stageRows(), 0)
    expect(text).toContain('event: done')
    expect(text).toContain('编排阶段事件')
    expect(text).toContain('不是模型 token 流')
    expect(text.indexOf('event: done')).toBeGreaterThan(text.indexOf('id: 4'))
  })
})

describe('V21/C03 · getStageEvents（服务层，租户谓词）', () => {
  it('查询带 organizationId，且按 seq 升序', async () => {
    agentRunFindFirst.mockResolvedValue({ id: 'run_1', organizationId: ORG })
    stageFindMany.mockResolvedValue(stageRows())
    await getStageEvents(ctx(ORG), 'run_1', 0)
    const args = stageFindMany.mock.calls[0][0]
    expect(args.where.organizationId).toBe(ORG)
    expect(args.where.runId).toBe('run_1')
    expect(args.orderBy).toEqual({ seq: 'asc' })
  })

  it('跨租户 run → 404', async () => {
    agentRunFindFirst.mockResolvedValue(null)
    await expect(getStageEvents(ctx(ORG), 'run_other', 0)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('V21/C03 · createAgentRun 真的写出编排阶段事件', () => {
  function adviceProvider(payload: unknown): ModelProvider {
    return createStubProvider(() => JSON.stringify(payload), { inputTokens: 100, outputTokens: 50 })
  }
  const validAdvice = { rationale: '双方都在做渠道对接', suggestions: ['先发一条介绍'], candidateIds: ['cand_1'] }

  it('成功运行 → 至少 4 个阶段事件，带 organizationId、seq 递增', async () => {
    await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: ['cand_1'] },
      idempotencyKey: 'k_stage_1',
      provider: { kind: 'ready', provider: adviceProvider(validAdvice) },
    })

    expect(stageCreateMany).toHaveBeenCalledTimes(1)
    const data = stageCreateMany.mock.calls[0][0].data as any[]
    expect(data.length).toBeGreaterThanOrEqual(4)
    expect(data.map((d) => d.seq)).toEqual(data.map((_, i) => i + 1))
    expect(data.every((d) => d.organizationId === ORG)).toBe(true)
    expect(data.map((d) => d.stage)).toEqual(
      expect.arrayContaining(['QUOTA_CHECK', 'MODEL_CALL', 'SCHEMA_VALIDATE', 'PERSISTED'])
    )
  })

  it('失败路径 → 含 DEGRADED 阶段', async () => {
    await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: ['cand_1'] },
      idempotencyKey: 'k_stage_2',
      provider: { kind: 'ready', provider: adviceProvider({ ...validAdvice, candidateIds: ['cand_x'] }) },
    })
    const data = stageCreateMany.mock.calls[0][0].data as any[]
    expect(data.map((d) => d.stage)).toContain('DEGRADED')
  })
})

describe('V21/C03 · GET /api/v1/agents/runs/[runId]/events（SSE）', () => {
  beforeEach(() => {
    stageFindMany.mockResolvedValue(stageRows())
  })

  it('Content-Type=text/event-stream，body 是 SSE 帧且含 done', async () => {
    asRole('OPERATOR')
    agentRunFindFirst.mockResolvedValue({ id: 'run_1', organizationId: ORG })
    const res = await (eventsRoute.GET as any)(
      get('/api/v1/agents/runs/run_1/events'),
      params({ runId: 'run_1' })
    )
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(text).toContain('event: stage')
    expect(text).toContain('event: done')
    expect(text).toContain('编排阶段事件')
    expect(text).toContain('不是模型 token 流')
  })

  it('Last-Event-ID: 2 → 只回 seq > 2 的事件', async () => {
    asRole('OPERATOR')
    agentRunFindFirst.mockResolvedValue({ id: 'run_1', organizationId: ORG })
    const res = await (eventsRoute.GET as any)(
      get('/api/v1/agents/runs/run_1/events', { 'Last-Event-ID': '2' }),
      params({ runId: 'run_1' })
    )
    const text = await res.text()
    expect(text).not.toContain('id: 1')
    expect(text).toContain('id: 3')
    expect(stageFindMany.mock.calls[0][0].where.seq).toEqual({ gt: 2 })
  })

  it('MEMBER 能力不足 → 403', async () => {
    asRole('MEMBER')
    const res = await (eventsRoute.GET as any)(
      get('/api/v1/agents/runs/run_1/events'),
      params({ runId: 'run_1' })
    )
    expect(res.status).toBe(403)
    expect(stageFindMany).not.toHaveBeenCalled()
  })

  it('跨租户 run → 404', async () => {
    asRole('OPERATOR')
    agentRunFindFirst.mockResolvedValue(null)
    const res = await (eventsRoute.GET as any)(
      get('/api/v1/agents/runs/run_other/events'),
      params({ runId: 'run_other' })
    )
    expect(res.status).toBe(404)
  })
})
