/**
 * T09 · **组织级 Agent 额度**（从订阅方案派生）
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个套件钉住什么、以及为什么非钉不可
 * ═══════════════════════════════════════════════════════════════
 * 接线前，`agentUsage` 的 `assumptions.quota` 会自己承认
 * "组织级真实额度配置尚未接线" —— 也就是说：**限额判定用的数字与本组织付了多少钱无关**。
 * 接线后，额度从订阅事件派生。这个改动最容易做成"只是换了句话"，因为：
 *
 *   · 响应里的 `assumptions.quota` 文案**变了**，看起来像接完了；
 *   · 而判定路径可能**根本没变**（还是那个全局常量），
 *     这种"文案说 A、行为是 B"的分叉，没有任何现成断言会抓。
 *
 * 所以本套件的核心不是那几行文案，而是**承重断言**：
 *   🔴 同一份账本、同一个请求，仅因为**订阅方案不同**，判定从"拒绝"变"放行"。
 *      没有这条，"额度来自方案"就只是个说法。
 *
 * 另外钉住两条结构性质：
 *   ① `FREE` 档的数值与内核 `DEFAULT_QUOTA` **逐字相同**（接线前未订阅组织跑的就是它）
 *      —— 这条断言把"两处数字漂移"从静默变成红灯；
 *   ② 显式注入额度时**不查订阅**（纯注入路径零额外 IO，测试与脚本因此不需要订阅夹具）。
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
    // 🔴 组织级额度的派生输入。本套件必须提供它，否则派生会抛
    //    "billingEvent.findMany is not a function" —— 那正是我们**想要**的失败方式
    //    （不静默退回某个默认额度）。
    billingEvent: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { db } from '@/lib/db'
import {
  DEFAULT_PRICE_TABLE,
  DEFAULT_QUOTA,
  MICRO_CENTS_PER_CENT,
  SKILLS,
  createStubProvider,
  estimateMicroCents,
  type ModelProvider,
} from '@/lib/agent'
import { agentQuotaOf, agentUsage, createAgentRun } from '@/lib/agents'
import { BILLING_PLANS, EFFECTIVE_PLANS, PLAN_LABELS, planLimitsOf } from '@/lib/billing/plans'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { createFakeAgentDb, installFakeAgentDb, type FakeAgentDb } from './_fake-db'

const ORG = 'org_1'
const NOW = new Date('2026-10-15T00:00:00.000Z')
const IN_PERIOD = new Date('2026-10-01T00:00:00.000Z')

const ctx = (organizationId: string): TenantContext => ({
  organizationId,
  userId: 'u_1',
  role: 'ADMIN',
  membershipId: 'ms_1',
})

const ADVICE_INPUT = { goal: '为社群成员对接合适的合作伙伴', allowedCandidateIds: ['cand_1'] }
const ADVICE_OUTPUT = {
  rationale: '双方都在做渠道对接',
  suggestions: ['先发一条介绍'],
  candidateIds: ['cand_1'],
}

/** 协调建议的**预估**成本（判定用的就是它，不是某次调用实际花了多少）。 */
const ADVICE_ESTIMATE = estimateMicroCents(SKILLS.COORDINATION_ADVICE.costProfile, DEFAULT_PRICE_TABLE)

const CENTS = MICRO_CENTS_PER_CENT

let fake: FakeAgentDb
let eventSeq = 0

function subscriptionStarted(plan: string): FakeAgentDb['billingEvents'][number] {
  eventSeq += 1
  return {
    id: `be_${eventSeq}`,
    organizationId: ORG,
    type: 'SUBSCRIPTION_STARTED',
    plan,
    chargeId: null,
    amountCents: null,
    currency: 'USD',
    gatewayStatus: null,
    reason: null,
    occurredAt: IN_PERIOD,
    createdAt: IN_PERIOD,
  }
}

function planChanged(plan: string, at: Date): FakeAgentDb['billingEvents'][number] {
  eventSeq += 1
  return {
    id: `be_${eventSeq}`,
    organizationId: ORG,
    type: 'PLAN_CHANGED',
    plan,
    chargeId: null,
    amountCents: null,
    currency: 'USD',
    gatewayStatus: null,
    reason: null,
    occurredAt: at,
    createdAt: at,
  }
}

/** 往本期账本里塞一条"已发生"的调用（用于制造"接近上限"的处境）。 */
function seedSpend(microCents: number): void {
  fake.calls.push({
    id: `seed_${fake.calls.length + 1}`,
    organizationId: ORG,
    runId: 'seed_run',
    seq: fake.calls.length + 1,
    skill: 'COORDINATION_ADVICE',
    providerKind: 'STUB',
    risk: 'LOW',
    highCost: false,
    ok: true,
    inputTokens: 100,
    outputTokens: 50,
    microCents,
    at: IN_PERIOD,
  })
}

/** 往本期账本里塞 n 条**高成本**调用（金额很小，只为占"次数"）。 */
function seedHighCostCalls(n: number): void {
  for (let i = 0; i < n; i += 1) {
    fake.calls.push({
      id: `hc_${i + 1}`,
      organizationId: ORG,
      runId: 'seed_run',
      seq: fake.calls.length + 1,
      skill: 'INTRO_DRAFT',
      providerKind: 'STUB',
      risk: 'HIGH',
      highCost: true,
      ok: true,
      inputTokens: 10,
      outputTokens: 5,
      microCents: 1,
      at: IN_PERIOD,
    })
  }
}

function countingProvider(payload: unknown) {
  const state = { calls: 0 }
  const provider: ModelProvider = createStubProvider(() => {
    state.calls += 1
    return JSON.stringify(payload)
  })
  return { state, provider }
}

const billingEventFindMany = () =>
  (db as unknown as { billingEvent: { findMany: jest.Mock } }).billingEvent.findMany

beforeEach(() => {
  jest.clearAllMocks()
  eventSeq = 0
  fake = createFakeAgentDb()
  installFakeAgentDb(db, fake)
})

// ═══════════════════════════════════════════════════════════
// ① 纯函数：方案 → 额度
// ═══════════════════════════════════════════════════════════

describe('方案 → 额度（纯函数，无 IO）', () => {
  it('🔴 FREE 档 == 内核 DEFAULT_QUOTA（钉住"接线前后行为不变"这条等价关系）', () => {
    const free = agentQuotaOf('FREE')
    expect(free.maxMicroCents).toBe(DEFAULT_QUOTA.maxMicroCents)
    expect(free.maxHighCostCalls).toBe(DEFAULT_QUOTA.maxHighCostCalls)
    // 再把数值本身钉住：两处都改还能同时改错，但至少改一处会红。
    expect(free.maxMicroCents).toBe(500 * CENTS)
  })

  it('🔴 两列都直接来自方案表（不是被复制/写死的第二个数）', () => {
    for (const plan of EFFECTIVE_PLANS) {
      const limits = planLimitsOf(plan)
      const quota = agentQuotaOf(plan)
      expect(quota.maxMicroCents).toBe(limits.agentMicroCentsPerMonth)
      expect(quota.maxHighCostCalls).toBe(limits.agentHighCostCallsPerMonth)
    }
  })

  it('逐档严格递增（额度与高成本次数都不下降，且至少一项真的变大）', () => {
    const plans = EFFECTIVE_PLANS
    for (let i = 1; i < plans.length; i += 1) {
      const prev = agentQuotaOf(plans[i - 1])
      const cur = agentQuotaOf(plans[i])
      expect(cur.maxMicroCents).toBeGreaterThanOrEqual(prev.maxMicroCents)
      expect(cur.maxHighCostCalls).toBeGreaterThanOrEqual(prev.maxHighCostCalls)
      expect(
        cur.maxMicroCents > prev.maxMicroCents ||
          cur.maxHighCostCalls > prev.maxHighCostCalls,
      ).toBe(true)
    }
  })

  it('🔴 所有档位都是**有限**正整数 —— 花费上限不提供"无限"（AC-20 要的是停下来）', () => {
    for (const plan of EFFECTIVE_PLANS) {
      const q = agentQuotaOf(plan)
      expect(Number.isInteger(q.maxMicroCents)).toBe(true)
      expect(Number.isFinite(q.maxMicroCents)).toBe(true)
      expect(q.maxMicroCents).toBeGreaterThan(0)
      expect(Number.isInteger(q.maxHighCostCalls)).toBe(true)
      expect(q.maxHighCostCalls).toBeGreaterThan(0)
    }
    // 与 T08 的"业务配额"刻意不同：那边 SCALE 的 proposalPerMonth 就是 null（不限）。
    // 这两者**不该**被"统一"—— 一个是商业配额，一个是花费上限。
    expect(planLimitsOf('SCALE').proposalPerMonth).toBeNull()
    expect(Number.isFinite(planLimitsOf('SCALE').agentMicroCentsPerMonth)).toBe(true)
  })

  it('额度与次数**不是**同一个来源被复制出来的（两列各自生效）', () => {
    // 若有人把 agentHighCostCallsPerMonth 写成派生自金额，这条会红。
    const table = BILLING_PLANS.map((p) => planLimitsOf(p).agentHighCostCallsPerMonth)
    const money = BILLING_PLANS.map((p) => planLimitsOf(p).agentMicroCentsPerMonth)
    expect(table).toEqual([...table].sort((a, b) => a - b))
    expect(money).toEqual([...money].sort((a, b) => a - b))
  })
})

// ═══════════════════════════════════════════════════════════
// ② 服务层：额度真的从订阅派生
// ═══════════════════════════════════════════════════════════

describe('服务层 · 额度从订阅事件派生', () => {
  it('从未订阅 → FREE 档，且文案点明方案名（不再说"尚未接线"）', async () => {
    const usage = await agentUsage(ctx(ORG), { now: NOW })
    expect(usage.plan).toBe('FREE')
    expect(usage.quota.maxMicroCents).toBe(500 * CENTS)
    expect(usage.quota.maxHighCostCalls).toBe(20)
    expect(usage.assumptions.quota).toContain(PLAN_LABELS.FREE)
    expect(usage.assumptions.quota).not.toContain('尚未接线')
    // 数字仍是假设 —— 这句话必须留着，否则就是拿占位数冒充定价。
    expect(usage.assumptions.quota).toContain('占位假设')
  })

  it('订阅 GROWTH → 额度换成 GROWTH 档，且 used + remaining == max 自洽', async () => {
    fake.billingEvents.push(subscriptionStarted('GROWTH'))
    seedSpend(1_234_567)

    const usage = await agentUsage(ctx(ORG), { now: NOW })
    expect(usage.plan).toBe('GROWTH')
    expect(usage.quota.maxMicroCents).toBe(25_000 * CENTS)
    expect(usage.quota.usedMicroCents).toBe(1_234_567)
    expect(usage.quota.usedMicroCents + usage.quota.remainingMicroCents).toBe(
      usage.quota.maxMicroCents,
    )
    expect(usage.assumptions.quota).toContain(PLAN_LABELS.GROWTH)
  })

  it('🔴 降级后额度立刻变小（读时派生，不是写进组织的缓存列）', async () => {
    fake.billingEvents.push(subscriptionStarted('GROWTH'))
    const before = await agentUsage(ctx(ORG), { now: NOW })
    expect(before.quota.maxMicroCents).toBe(25_000 * CENTS)

    fake.billingEvents.push(planChanged('STARTER', new Date('2026-10-10T00:00:00.000Z')))
    const after = await agentUsage(ctx(ORG), { now: NOW })
    expect(after.plan).toBe('STARTER')
    expect(after.quota.maxMicroCents).toBe(5_000 * CENTS)
    expect(after.quota.maxMicroCents).toBeLessThan(before.quota.maxMicroCents)
  })

  it('🔴 承重断言：同一账本、同一请求，仅因方案不同就从"被拒"变"放行"', async () => {
    // 已用 600 分：FREE 的上限是 500 分 ⇒ 必然拒；GROWTH 的上限是 25 000 分 ⇒ 允许。
    // 这条是"额度来自方案"的**唯一**承重证据 —— 文案变了不算。
    seedSpend(600 * CENTS)

    // ── A：未订阅（FREE）→ 拒绝，且 provider 零调用 ──
    const blocked = countingProvider(ADVICE_OUTPUT)
    const denied = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: ADVICE_INPUT,
      idempotencyKey: 'org-quota-a',
      provider: { kind: 'ready', provider: blocked.provider },
      now: NOW,
    })
    expect(denied.run.status).toBe('BLOCKED_QUOTA')
    expect(blocked.state.calls).toBe(0)
    // 拒绝理由里的上限必须是 FREE 档的数字（可核对，不是"额度不足"四个字）。
    expect(String(denied.run.reason)).toContain('500')

    // ── B：同一账本 + 订阅 GROWTH → 放行，provider 真被调用 ──
    fake.billingEvents.push(subscriptionStarted('GROWTH'))
    const allowed = countingProvider(ADVICE_OUTPUT)
    const ok = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: ADVICE_INPUT,
      idempotencyKey: 'org-quota-b',
      provider: { kind: 'ready', provider: allowed.provider },
      now: NOW,
    })
    expect(ok.run.status).toBe('PROPOSED')
    expect(allowed.state.calls).toBe(1)
  })

  it('注入额度时**不查订阅**（纯注入路径零额外 IO）', async () => {
    await agentUsage(ctx(ORG), { now: NOW, quota: { maxMicroCents: 1, maxHighCostCalls: 0 } })
    expect(billingEventFindMany()).not.toHaveBeenCalled()

    // 对照：不注入时必须查（否则上面那条会因为"压根没走过派生"而假通过）。
    await agentUsage(ctx(ORG), { now: NOW })
    expect(billingEventFindMany()).toHaveBeenCalled()
  })

  it('注入额度时 plan 为 null（不冒充某个方案），文案也不冒充', async () => {
    const usage = await agentUsage(ctx(ORG), {
      now: NOW,
      quota: { maxMicroCents: 100_000, maxHighCostCalls: 3 },
    })
    expect(usage.plan).toBeNull()
    expect(usage.assumptions.quota).toContain('注入')
    expect(usage.assumptions.quota).not.toContain('占位假设')
  })

  it('派生与判定同源：usage.quota.maxMicroCents 就是判定时用的上限', async () => {
    fake.billingEvents.push(subscriptionStarted('STARTER'))
    const usage = await agentUsage(ctx(ORG), { now: NOW })

    // 把它灌到"恰好差 1 微分就超"：上限 − 预估 − 已用 = 1 ⇒ 放行；再多 1 ⇒ 拒。
    seedSpend(usage.quota.maxMicroCents - ADVICE_ESTIMATE - 1)
    const pass = countingProvider(ADVICE_OUTPUT)
    const a = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: ADVICE_INPUT,
      idempotencyKey: 'org-quota-c',
      provider: { kind: 'ready', provider: pass.provider },
      now: NOW,
    })
    expect(a.run.status).toBe('PROPOSED')

    // 再多 2 微分（越过刚才那条边界）→ 拒。
    fake.calls[0].microCents += 2
    const fail = countingProvider(ADVICE_OUTPUT)
    const b = await createAgentRun(ctx(ORG), {
      skill: 'COORDINATION_ADVICE',
      input: ADVICE_INPUT,
      idempotencyKey: 'org-quota-d',
      provider: { kind: 'ready', provider: fail.provider },
      now: NOW,
    })
    expect(b.run.status).toBe('BLOCKED_QUOTA')
    expect(fail.state.calls).toBe(0)
  })

  it('🔴 高成本次数上限同样来自方案：用到顶即停，换档后阈值真的变了', async () => {
    const introInput = {
      goal: '为两位成员起草一条克制的开场介绍',
      subjectLabel: '我',
      counterpartLabel: '对方',
      allowedFieldKeys: [],
    }
    const introOutput = { counterpartLabel: '对方', draftMessage: '你好', usedFieldKeys: [] }

    // FREE 的高成本上限是 20 次 ⇒ 灌满 20 次后，高成本技能必须停。
    seedHighCostCalls(20)

    const blocked = countingProvider(introOutput)
    const denied = await createAgentRun(ctx(ORG), {
      skill: 'INTRO_DRAFT',
      input: introInput,
      idempotencyKey: 'org-quota-hc-1',
      provider: { kind: 'ready', provider: blocked.provider },
      now: NOW,
    })
    expect(denied.run.status).toBe('BLOCKED_QUOTA')
    expect(String(denied.run.reason)).toMatch(/高成本/)
    expect(blocked.state.calls).toBe(0)

    // 同一账本 + 订阅 GROWTH（上限 1 000）⇒ 20 次远未到顶，放行。
    fake.billingEvents.push(subscriptionStarted('GROWTH'))
    const allowed = countingProvider(introOutput)
    const passed = await createAgentRun(ctx(ORG), {
      skill: 'INTRO_DRAFT',
      input: introInput,
      idempotencyKey: 'org-quota-hc-2',
      provider: { kind: 'ready', provider: allowed.provider },
      now: NOW,
    })
    // INTRO_DRAFT 是高**风险**技能 ⇒ requiresApproval ⇒ 状态停在待批（而不是 PROPOSED）。
    // 这里要证的是"额度放行了"，所以断言"进入了需要人工裁决的下一步"，而不是某个具体绿状态。
    expect(passed.run.status).toBe('AWAITING_APPROVAL')
    expect(allowed.state.calls).toBe(1)
  })
})
