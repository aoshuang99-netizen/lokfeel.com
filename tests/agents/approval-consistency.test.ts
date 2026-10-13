/**
 * T09 · **审批一致性**（status 列 ↔ AgentApproval 表）
 *
 * 背景：`AgentRun.status` 是一列（不是派生值，理由见 prisma/schema/agent.prisma 文件头）。
 * 这就引入"第二个事实来源"的风险 —— status 说"已批准"，而裁决表里什么都没有。
 *
 * 本文件把三条不变量钉死，并在**多次混合操作之后**统一复验（而不是只测单步）：
 *   ① 终态（APPROVED / REJECTED）**必须**有且仅有一条对应裁决，且 decision 与 status 一致；
 *   ② 未决状态（PROPOSED / AWAITING_APPROVAL / DEGRADED）**必须没有**裁决行；
 *   ③ 冗余的 `AgentRun.costMicroCents` **必须**等于其 AgentCall 之和（写入非原子 → 需对账）。
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

import { db } from '@/lib/db'
import { createStubProvider } from '@/lib/agent'
import { createAgentRun, decideAgentRun } from '@/lib/agents'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ORG = 'org_1'
const ctx: TenantContext = { organizationId: ORG, userId: 'u_1', role: 'ADMIN', membershipId: 'ms_1' }

let fake: FakeAgentDb

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
})

/** 跨全部行复验三条不变量（供"混合操作之后"统一调用）。 */
function assertConsistent() {
  const runById = new Map(fake.runs.map((r) => [r.id, r]))

  for (const a of fake.approvals) {
    // ① 裁决必须挂到存在的运行上
    const run = runById.get(a.runId)
    if (!run) throw new Error(`裁决 ${a.id} 指向不存在的运行 ${a.runId}`)
    // ② 裁决的 decision 必须与运行 status 一致（APPROVED/REJECTED 一一对应）
    expect(run.status).toBe(a.decision)
  }

  const terminal = ['APPROVED', 'REJECTED']
  for (const r of fake.runs) {
    const approvals = fake.approvals.filter((a) => a.runId === r.id)
    if (terminal.includes(r.status)) {
      // 终态：有且仅有一条裁决
      if (approvals.length !== 1) {
        throw new Error(`终态 ${r.status} 的运行 ${r.id} 应有 1 条裁决，实际 ${approvals.length}`)
      }
      expect(approvals[0].decision).toBe(r.status)
    } else {
      // 未决：一条也不该有
      if (approvals.length !== 0) {
        throw new Error(`未决状态 ${r.status} 的运行 ${r.id} 不该有裁决`)
      }
    }
    // ③ 冗余成本列必须与调用明细之和一致
    const sum = fake.calls.filter((c) => c.runId === r.id).reduce((s, c) => s + c.microCents, 0)
    if (r.costMicroCents !== sum) {
      throw new Error(`运行 ${r.id} 的 costMicroCents(${r.costMicroCents}) ≠ 调用明细之和(${sum})`)
    }
  }
}

const adviceProvider = (payload: unknown) =>
  createStubProvider(() => JSON.stringify(payload), { inputTokens: 100, outputTokens: 50 })

const validAdvice = { rationale: 'r', suggestions: ['s'], candidateIds: [] }

async function makeIntroAwaiting(key: string) {
  const { run } = await createAgentRun(ctx, {
    skill: 'INTRO_DRAFT',
    input: { goal: '帮助我们在 30 天内对接 5 家渠道伙伴', subjectLabel: 'A', counterpartLabel: 'B', allowedFieldKeys: [] },
    idempotencyKey: key,
    provider: {
      kind: 'ready',
      provider: adviceProvider({ counterpartLabel: 'B', draftMessage: '你好', usedFieldKeys: [] }),
    },
  })
  return run
}

async function makeProposed(key: string) {
  const { run } = await createAgentRun(ctx, {
    skill: 'COORDINATION_ADVICE',
    input: { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: [] },
    idempotencyKey: key,
    provider: { kind: 'ready', provider: adviceProvider(validAdvice) },
  })
  return run
}

describe('T09 · 审批一致性', () => {
  it('单步：批准后 status 与裁决一致', async () => {
    const run = await makeIntroAwaiting('a')
    await decideAgentRun(ctx, run.id, 'APPROVED')
    assertConsistent()
  })

  it('单步：驳回后 status 与裁决一致', async () => {
    const run = await makeIntroAwaiting('b')
    await decideAgentRun(ctx, run.id, 'REJECTED', '不合适')
    assertConsistent()
  })

  it('🔴 混合操作之后统一复验（未决/已批/已驳/降级/失败 并存）', async () => {
    const approved = await makeIntroAwaiting('c1')
    const rejected = await makeIntroAwaiting('c2')
    await makeProposed('c3') // 未决
    await createAgentRun(ctx, {
      skill: 'INTENT_EXTRACTION',
      input: { goal: '帮助我们在 30 天内对接 5 家渠道伙伴' },
      idempotencyKey: 'c4',
      provider: { kind: 'unavailable', reason: 'x' }, // DEGRADED
    })
    await createAgentRun(ctx, {
      skill: 'COORDINATION_ADVICE',
      input: { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: ['cand_1'] },
      idempotencyKey: 'c5',
      provider: { kind: 'ready', provider: adviceProvider({ ...validAdvice, candidateIds: ['cand_x'] }) }, // FAILED
    })

    await decideAgentRun(ctx, approved.id, 'APPROVED')
    await decideAgentRun(ctx, rejected.id, 'REJECTED')

    expect(fake.runs).toHaveLength(5)
    expect(fake.approvals).toHaveLength(2)
    assertConsistent()
  })

  it('🔴 一致性断言本身是**有效**的（变异自证：人为破坏必被抓到）', async () => {
    const run = await makeIntroAwaiting('d')
    await decideAgentRun(ctx, run.id, 'APPROVED')
    // 变异 1：删掉裁决行 → 终态却没有裁决 → 必须失败
    const saved = fake.approvals.slice()
    fake.approvals = []
    expect(() => assertConsistent()).toThrow()
    // 变异 2：恢复裁决但改 decision 与 status 不符 → 必须失败
    fake.approvals = saved.map((a) => ({ ...a, decision: 'REJECTED' }))
    expect(() => assertConsistent()).toThrow()
    // 复原 → 通过
    fake.approvals = saved
    expect(() => assertConsistent()).not.toThrow()
  })
})
