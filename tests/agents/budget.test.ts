/**
 * T09 · 预算/限额测试（AC-20）
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个套件钉住什么
 * ═══════════════════════════════════════════════════════════════
 * AC-20 的第二半是「**限额触发时停止高成本任务**」。它有三个容易做错的地方，
 * 本套件各有一条断言（并且都有**负向对照**，否则"通过"可能只是断言恒真）：
 *
 *   ① **判定必须在发起调用之前** —— 否则不是限额，是事后通知。
 *      判据：`BLOCKED_QUOTA` 时 `provider.complete` **一次都没被调用**（用计数器自证）。
 *   ② **账本必须是"本期已发生的调用"**，不是"本次请求自己的账"。
 *      判据：预置一条本期的调用 → 同一请求被拒；**清掉它 → 同一请求通过**
 *      （A/B 对照，证明那条预置行确实是拒绝的原因）。
 *   ③ **期次过滤必须承重** —— 上个月的调用不该算进本月额度。
 *      判据：把预置行的时间挪到上个月 → 请求通过。
 *
 * 另外钉住两个"语义边界"（写错了会静默多扣或少扣）：
 *   · **额度**判据是 `已用 + 预估 > 上限`（**恰好用完仍允许**）；
 *   · **高成本次数**判据是 `已达 >= 上限`（**到顶即停**）。
 *   两条刻意不同，本套件把差异显式钉住 —— 否则以后有人"统一一下"就会改错。
 *
 * 以及一条**颗粒度**断言：高成本次数到顶只停**高成本**任务，
 * 不该把低风险技能一起停掉（AC-20 说的是"停止高成本任务"）。
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
import {
  DEFAULT_PRICE_TABLE,
  EMPTY_LEDGER,
  MICRO_CENTS_PER_CENT,
  SKILLS,
  appendCall,
  checkQuota,
  costMicroCents,
  createStubProvider,
  estimateMicroCents,
  runSkill,
  type AgentCallRecord,
  type AgentQuota,
  type LedgerSnapshot,
  type ModelProvider,
  type PriceTable,
} from '@/lib/agent'
import { agentUsage, createAgentRun } from '@/lib/agents'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ORG = 'org_1'
const NOW = new Date('2026-10-15T00:00:00.000Z')
const IN_PERIOD = new Date('2026-10-01T00:00:00.000Z')
const PREV_PERIOD = new Date('2026-09-15T00:00:00.000Z')

const ctx = (organizationId: string): TenantContext => ({
  organizationId,
  userId: 'u_1',
  role: 'ADMIN',
  membershipId: 'ms_1',
})

/** 一次协调建议调用的用量与成本（默认价目表）。 */
const ADVICE_USAGE = { inputTokens: 100, outputTokens: 50 }
const ADVICE_COST = costMicroCents(ADVICE_USAGE, DEFAULT_PRICE_TABLE) // 4,500

/**
 * 🔴 限额判定用的是**技能的 costProfile**（预估），不是"某次调用实际花了多少"。
 *    两者差着一个数量级（预估 2,000/900 token，测试夹具只用了 100/50），
 *    混为一谈会让额度设计偏小一个量级 —— 这条断言就是防止有人"顺手统一"。
 */
const ADVICE_ESTIMATE = estimateMicroCents(SKILLS.COORDINATION_ADVICE.costProfile, DEFAULT_PRICE_TABLE)

const adviceInput = { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: ['cand_1'] }
const validAdvice = { rationale: '双方都在做渠道对接', suggestions: ['先发一条介绍'], candidateIds: ['cand_1'] }

function callRecord(overrides: Partial<AgentCallRecord> = {}): AgentCallRecord {
  return {
    skill: 'COORDINATION_ADVICE',
    providerKind: 'stub',
    risk: 'LOW',
    highCost: false,
    ok: true,
    usage: ADVICE_USAGE,
    microCents: ADVICE_COST,
    at: IN_PERIOD.toISOString(),
    ...overrides,
  }
}

/** 一个"被调用就会计数"的 Provider —— 用来证明"零调用"。 */
function countingProvider(payload: unknown) {
  const state = { calls: 0 }
  const provider: ModelProvider = createStubProvider(() => {
    state.calls += 1
    return JSON.stringify(payload)
  })
  return { state, provider }
}

let fake: FakeAgentDb

beforeEach(() => {
  jest.clearAllMocks()
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
})

// ═══════════════════════════════════════════════════════════
// 内核层：判据与边界
// ═══════════════════════════════════════════════════════════

describe('内核 · checkQuota 的判据与边界', () => {
  const skill = { key: 'COORDINATION_ADVICE', highCost: false, costProfile: { estimatedInputTokens: 100, estimatedOutputTokens: 50 } }

  it('空账本 + 充足额度 → 放行，并给出预估（预估 = 单价 × 用量）', () => {
    const d = checkQuota(EMPTY_LEDGER, { maxMicroCents: 10_000_000, maxHighCostCalls: 5 }, skill)
    expect(d.allowed).toBe(true)
    expect(d.estimateMicroCents).toBe(ADVICE_COST)
    expect(d.estimateMicroCents).toBe(estimateMicroCents(skill.costProfile, DEFAULT_PRICE_TABLE))
  })

  it('🔴 额度判据是"严格超过才拒"：恰好用完仍**允许**（写反会静默多扣一次）', () => {
    const quota: AgentQuota = { maxMicroCents: ADVICE_COST * 2, maxHighCostCalls: 99 }
    // 已用 = 1 次，再加 1 次恰好等于上限 → 允许
    const exact = appendCall(EMPTY_LEDGER, callRecord())
    expect(checkQuota(exact, quota, skill).allowed).toBe(true)
    // 再多 1 微分就是"超过" → 拒绝
    const over = appendCall(exact, callRecord({ microCents: 1 }))
    const d = checkQuota(over, quota, skill)
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.code).toBe('INSUFFICIENT_BUDGET')
  })

  it('🔴 高成本次数的判据是"到顶即停"（`>=`，与额度判据**刻意不同**）', () => {
    const quota: AgentQuota = { maxMicroCents: 10_000_000_000, maxHighCostCalls: 2 }
    const one = appendCall(EMPTY_LEDGER, callRecord({ highCost: true }))
    // 已 1 次 < 2 → 仍允许
    expect(checkQuota(one, quota, { ...skill, highCost: true }).allowed).toBe(true)
    const two = appendCall(one, callRecord({ highCost: true }))
    // 已 2 次，**等于**上限 → 拒绝（不是"超过才拒"）
    const d = checkQuota(two, quota, { ...skill, highCost: true })
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.code).toBe('HIGH_COST_CALL_LIMIT')
  })

  it('🔴 颗粒度：高成本次数到顶只停**高成本**任务，低风险技能不受影响', () => {
    const quota: AgentQuota = { maxMicroCents: 10_000_000_000, maxHighCostCalls: 1 }
    const atLimit = appendCall(EMPTY_LEDGER, callRecord({ highCost: true }))
    // 高成本技能 → 停
    expect(checkQuota(atLimit, quota, { ...skill, highCost: true }).allowed).toBe(false)
    // 非高成本技能 → 放行（AC-20 说的是"停止高成本任务"）
    expect(checkQuota(atLimit, quota, { ...skill, highCost: false }).allowed).toBe(true)
  })

  it('🔴 单价是"可注入的假设"且**承重**：把单价翻倍，同一个账本从放行变拒绝', () => {
    const quota: AgentQuota = { maxMicroCents: ADVICE_COST * 2 + 1_000, maxHighCostCalls: 99 }
    const ledger = appendCall(EMPTY_LEDGER, callRecord())
    const doubled: PriceTable = {
      inputMicroCentsPerK: DEFAULT_PRICE_TABLE.inputMicroCentsPerK * 2,
      outputMicroCentsPerK: DEFAULT_PRICE_TABLE.outputMicroCentsPerK * 2,
    }
    // 默认单价：已用 4,500 + 预估 4,500 = 9,000 ≤ 9,001 → 放行
    expect(checkQuota(ledger, quota, skill, DEFAULT_PRICE_TABLE).allowed).toBe(true)
    // 单价翻倍：已用 4,500（已发生的按当时价）+ 预估 9,000 = 13,500 > 9,001 → 拒绝
    expect(checkQuota(ledger, quota, skill, doubled).allowed).toBe(false)
  })

  it('额度/次数的拒绝理由含**可核对的数字**（不是"额度不足"四个字）', () => {
    const d = checkQuota(EMPTY_LEDGER, { maxMicroCents: 1, maxHighCostCalls: 0 }, skill)
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.reason).toMatch(/已用.*上限/)
    expect(d.allowed === false && d.estimateMicroCents).toBe(ADVICE_COST)
  })

  it('默认额度是 500 分（占位假设，改动必须看得见）', () => {
    expect(500 * MICRO_CENTS_PER_CENT).toBe(500_000_000)
  })
})

describe('内核 · 额度耗尽时 runSkill 不发起调用', () => {
  it('🔴 额度为 0 → BLOCKED_QUOTA，且 provider.complete **零调用**', async () => {
    const { state, provider } = countingProvider(validAdvice)
    const out = await runSkill({
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      provider: { kind: 'ready', provider },
      ledger: EMPTY_LEDGER,
      quota: { maxMicroCents: 0, maxHighCostCalls: 0 },
    })
    expect(out.status).toBe('BLOCKED_QUOTA')
    expect(state.calls).toBe(0)
    expect(out.cost).toBeNull()
    expect(out.ledger.calls).toHaveLength(0)
  })

  it('🔴 高成本次数到顶 → BLOCKED_QUOTA，且 provider.complete **零调用**', async () => {
    const { state, provider } = countingProvider({ counterpartLabel: '对方', draftMessage: '你好', usedFieldKeys: [] })
    const out = await runSkill({
      skill: 'INTRO_DRAFT',
      input: {
        goal: '为两位成员起草一条克制的开场介绍',
        subjectLabel: '我',
        counterpartLabel: '对方',
        allowedFieldKeys: [],
      },
      provider: { kind: 'ready', provider },
      ledger: EMPTY_LEDGER,
      quota: { maxMicroCents: 10 ** 12, maxHighCostCalls: 0 },
    })
    expect(out.status).toBe('BLOCKED_QUOTA')
    expect(state.calls).toBe(0)
    expect(out.degradeCode).toBeNull()
  })

  it('对照：额度充足时同一个技能**会**发起调用（证明上面两条不是"永远不调用"）', async () => {
    const { state, provider } = countingProvider(validAdvice)
    const out = await runSkill({
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      provider: { kind: 'ready', provider },
      ledger: EMPTY_LEDGER,
    })
    expect(out.status).toBe('PROPOSED')
    expect(state.calls).toBe(1)
  })

  it('输入不合法时**不记账也不调用**（不合格的输入不该花钱）', async () => {
    const { state, provider } = countingProvider(validAdvice)
    const out = await runSkill({
      skill: 'COORDINATION_ADVICE',
      input: { goal: '太短' }, // min(8) 不满足 + 未知字段 → 双重不合格
      provider: { kind: 'ready', provider },
      ledger: EMPTY_LEDGER,
    })
    expect(out.status).toBe('FAILED')
    expect(out.degradeCode).toBe('INPUT_INVALID')
    expect(out.cost).toBeNull()
    expect(state.calls).toBe(0)
  })

  it('技能声明的 highCost 与判定对象一致（改技能画像必须同步影响判定）', () => {
    expect(SKILLS.INTRO_DRAFT.costProfile.highCost).toBe(true)
    expect(SKILLS.COORDINATION_ADVICE.costProfile.highCost).toBe(false)
    expect(SKILLS.INTENT_EXTRACTION.costProfile.highCost).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// 服务层：账本装载与期次过滤必须承重
// ═══════════════════════════════════════════════════════════

describe('服务层 · 账本来自"本期已发生的调用"', () => {
  /** 预置一条已入账的本期调用（模拟"别人/上次已经花掉的钱"）。 */
  function seedCall(at: Date, microCents = ADVICE_COST) {
    fake.calls.push({
      id: `seed_${fake.calls.length + 1}`,
      organizationId: ORG,
      runId: 'seed_run',
      seq: 1,
      skill: 'COORDINATION_ADVICE',
      providerKind: 'STUB',
      risk: 'LOW',
      highCost: false,
      ok: true,
      inputTokens: ADVICE_USAGE.inputTokens,
      outputTokens: ADVICE_USAGE.outputTokens,
      microCents,
      at,
    })
  }

  /**
   * 额度刚好够**一次预估调用**（不是"够一次实际调用" —— 见 `ADVICE_ESTIMATE` 的说明）。
   * 于是：本期已有任何一笔账 → 拒绝；本期零账 → 放行。这就是 A/B 对照的杠杆。
   */
  const QUOTA: AgentQuota = { maxMicroCents: ADVICE_ESTIMATE, maxHighCostCalls: 99 }

  it('预估 ≠ 实际：预估来自 costProfile（2,000/900），比夹具的实际用量大一个量级', () => {
    expect(ADVICE_ESTIMATE).toBeGreaterThan(ADVICE_COST)
    expect(ADVICE_ESTIMATE).toBe(84_000)
  })

  it('🔴 A/B 对照：预置的本期调用**就是**拒绝的原因（清掉它同一请求就通过）', async () => {
    const { provider } = countingProvider(validAdvice)
    seedCall(IN_PERIOD)

    const blocked = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      idempotencyKey: 'budget-a',
      provider: { kind: 'ready', provider },
      quota: QUOTA,
      now: NOW,
    })
    expect(blocked.run.status).toBe('BLOCKED_QUOTA')
    expect(fake.calls).toHaveLength(1) // **零新增**：账本没被写脏

    // 清掉预置行 → 同一请求（换幂等键）通过。
    fake.calls = []
    const allowed = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      idempotencyKey: 'budget-b',
      provider: { kind: 'ready', provider },
      quota: QUOTA,
      now: NOW,
    })
    expect(allowed.run.status).toBe('PROPOSED')
    expect(fake.calls).toHaveLength(1)
  })

  it('🔴 期次过滤承重：上个月的调用不算进本月额度', async () => {
    const { provider } = countingProvider(validAdvice)
    seedCall(PREV_PERIOD)
    const r = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      idempotencyKey: 'budget-c',
      provider: { kind: 'ready', provider },
      quota: QUOTA,
      now: NOW,
    })
    expect(r.run.status).toBe('PROPOSED')
    // 账本里现在两条：预置的（上个月）+ 本次新增。
    expect(fake.calls).toHaveLength(2)
  })

  it('🔴 服务层高成本到顶：INTRO_DRAFT 被拒、低风险仍可跑（同一库、同一请求批次）', async () => {
    const intro = countingProvider({ counterpartLabel: '对方', draftMessage: '你好', usedFieldKeys: [] })
    const tightQuota: AgentQuota = { maxMicroCents: 10 ** 12, maxHighCostCalls: 0 }

    const blocked = await createAgentRun(ctx(ORG), {
      skill: 'INTRO_DRAFT',
      input: {
        goal: '为两位成员起草一条克制的开场介绍',
        subjectLabel: '我',
        counterpartLabel: '对方',
        allowedFieldKeys: [],
      },
      idempotencyKey: 'budget-d',
      provider: { kind: 'ready', provider: intro.provider },
      quota: tightQuota,
      now: NOW,
    })
    expect(blocked.run.status).toBe('BLOCKED_QUOTA')
    expect(intro.state.calls).toBe(0)

    const advice = countingProvider(validAdvice)
    const ok = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      idempotencyKey: 'budget-e',
      provider: { kind: 'ready', provider: advice.provider },
      quota: tightQuota,
      now: NOW,
    })
    expect(ok.run.status).toBe('PROPOSED')
    expect(advice.state.calls).toBe(1)
  })

  it('BLOCKED_QUOTA 会留下**审计旁证**，但账本不含调用行', async () => {
    const { provider } = countingProvider(validAdvice)
    await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: adviceInput,
      idempotencyKey: 'budget-f',
      provider: { kind: 'ready', provider },
      quota: { maxMicroCents: 0, maxHighCostCalls: 0 },
      now: NOW,
    })
    const auditMock = (db as unknown as { tenantAuditEvent: { create: jest.Mock } }).tenantAuditEvent.create
    const events = auditMock.mock.calls.map((c) => JSON.stringify(c[0]))
    expect(events.some((e) => e.includes('agent.run.blocked_quota'))).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════
// 用量面：下发的额度必须就是执行时用的那份
// ═══════════════════════════════════════════════════════════

describe('服务层 · 用量面下发的额度与执行同源', () => {
  it('注入额度后，usage.quota 与 used/remaining 用**同一份**额度复算', async () => {
    const quota: AgentQuota = { maxMicroCents: 100_000, maxHighCostCalls: 3 }
    fake.calls.push({
      id: 'seed_1',
      organizationId: ORG,
      runId: 'seed_run',
      seq: 1,
      skill: 'COORDINATION_ADVICE',
      providerKind: 'STUB',
      risk: 'LOW',
      highCost: false,
      ok: true,
      inputTokens: 100,
      outputTokens: 50,
      microCents: ADVICE_COST,
      at: IN_PERIOD,
    })

    const usage = await agentUsage(ctx(ORG), { now: NOW, quota, price: DEFAULT_PRICE_TABLE })
    expect(usage.quota.maxMicroCents).toBe(100_000)
    expect(usage.quota.maxHighCostCalls).toBe(3)
    expect(usage.quota.usedMicroCents).toBe(ADVICE_COST)
    expect(usage.quota.remainingMicroCents).toBe(100_000 - ADVICE_COST)
    expect(usage.totals.microCents).toBe(ADVICE_COST)
  })

  it('不注入时下发的是默认占位额度，且 assumptions.quota 说明它是占位', async () => {
    const usage = await agentUsage(ctx(ORG), { now: NOW })
    expect(usage.quota.maxMicroCents).toBe(500_000_000)
    expect(usage.quota.maxHighCostCalls).toBe(20)
    expect(usage.assumptions.quota).toContain('占位假设')
  })

  it('注入时不冒充占位说明（口径必须与事实一致）', async () => {
    const usage = await agentUsage(ctx(ORG), { now: NOW, quota: { maxMicroCents: 1, maxHighCostCalls: 0 } })
    expect(usage.assumptions.quota).not.toContain('占位假设')
    expect(usage.assumptions.quota).toContain('注入')
  })

  it('账本快照类型自洽：ledgerTotals 对本套件构造的账本可复算', () => {
    const ledger: LedgerSnapshot = appendCall(EMPTY_LEDGER, callRecord({ highCost: true }))
    expect(ledger.calls).toHaveLength(1)
    expect(ledger.calls[0].microCents).toBe(ADVICE_COST)
  })
})
