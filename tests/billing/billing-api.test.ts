/**
 * T08 · 计费端点 HTTP 层测试（AC-21）
 *
 * 🔴 本文件钉住五件事：
 *   1. **能力口径**：`billing.read` = OPERATOR+、`billing.manage` = ADMIN+
 *      （**MEMBER 读用量必须 403** —— 用量是经营信息，不是全员可见的成果列表）；
 *   2. **租户谓词不可省**：账本与用量的每次查询都带 `organizationId`；
 *   3. **幂等两道**：同键同体 → 回放；**同键不同体 → 409**（不是静默回放）；
 *   4. **非法迁移在写入前被拒**：AC-21 点名的 `REFUNDED → SUCCEEDED` → 409 **且不写库**；
 *   5. **沙箱不冒充收款**：`gatewayStatus` 恒为 CAPTURED、`gateway.realChargesEnabled` 恒 false。
 *
 * 账本用**内存假库**实现（不是逐调用 stub）：服务层与纯内核会被**真实驱动**，
 * 断言的是"经过整条链路后的账本状态"，而不是"某个函数被调用过"。
 *
 * ⚠️ `jest.mock` 的工厂必须是**自给自足**的：ts-jest 会把 `import` 提升到文件顶部，
 *    工厂在首次 require 时就会执行 —— 那时文件里靠后的 `const` 还在 TDZ 里，
 *    在工厂里引用它们会 ReferenceError。故此处工厂只造裸 `jest.fn()`，
 *    行为与内存表在 `beforeEach` 里装配（那时所有模块级变量都已就绪）。
 */

jest.mock('@/lib/db', () => ({
  db: {
    billingEvent: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    usageRecord: { findMany: jest.fn(), createMany: jest.fn(), create: jest.fn() },
    connectionProposal: { findMany: jest.fn() },
    outcome: { findMany: jest.fn() },
    outcomeVerification: { findMany: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as usageRoute from '@/app/api/v1/billing/usage/route'
import * as subscriptionRoute from '@/app/api/v1/billing/subscription/route'
import * as eventsRoute from '@/app/api/v1/billing/subscription/events/route'
import * as collectRoute from '@/app/api/v1/billing/usage/collect/route'
import * as chargesRoute from '@/app/api/v1/billing/charges/route'

// ── 取 mock 句柄 ──
const requireAuthMock = requireAuth as unknown as jest.Mock
const billingEvent = db.billingEvent as unknown as {
  findMany: jest.Mock
  findFirst: jest.Mock
  create: jest.Mock
}
const usageRecord = db.usageRecord as unknown as {
  findMany: jest.Mock
  createMany: jest.Mock
  create: jest.Mock
}
const connectionProposal = db.connectionProposal as unknown as { findMany: jest.Mock }
const outcome = db.outcome as unknown as { findMany: jest.Mock }
const outcomeVerification = db.outcomeVerification as unknown as { findMany: jest.Mock }
const membership = db.membership as unknown as { findFirst: jest.Mock }

// ── 内存表 ──
interface EventRow {
  id: string
  organizationId: string
  type: string
  plan: string | null
  chargeId: string | null
  amountCents: number | null
  currency: string
  gatewayStatus: string | null
  providerRef: string | null
  reason: string | null
  actorId: string | null
  dedupeKey: string
  requestHash: string | null
  occurredAt: Date
  createdAt: Date
}

interface UsageRow {
  organizationId: string
  unit: string
  quantity: number
  occurredAt: Date
  periodKey: string
  sourceType: string
  sourceId: string
  dedupeKey: string
}

let eventRows: EventRow[] = []
let usageRows: UsageRow[] = []
let eventSeq = 0

const ORG = 'org_1'
const BASE = 'http://localhost'

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER') {
  requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
  membership.findFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

const getReq = (url: string) => new NextRequest(new URL(url, BASE), { method: 'GET' })
function postReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  eventRows = []
  usageRows = []
  eventSeq = 0

  membership.findFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'ADMIN' })
  connectionProposal.findMany.mockResolvedValue([])
  outcome.findMany.mockResolvedValue([])
  outcomeVerification.findMany.mockResolvedValue([])

  billingEvent.findMany.mockImplementation(async (args: { where: { organizationId: string } }) =>
    eventRows
      .filter((r) => r.organizationId === args.where.organizationId)
      .sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
  )
  billingEvent.findFirst.mockImplementation(
    async (args: { where: { organizationId: string; dedupeKey?: string } }) =>
      eventRows.find(
        (r) =>
          r.organizationId === args.where.organizationId &&
          (args.where.dedupeKey === undefined || r.dedupeKey === args.where.dedupeKey)
      ) ?? null
  )
  billingEvent.create.mockImplementation(
    async (args: { data: Omit<EventRow, 'id' | 'createdAt'> & { createdAt?: Date } }) => {
      // ⚠️ 尊重调用方显式传入的 `createdAt`（服务层现在会显式落它）。
      // 若在此处无条件覆盖成 `new Date()`，就会**掩盖**"校验序 ≠ 落库序"那类缺陷
      // —— 那正是本地真实踩到过的"款项不存在"。
      const row: EventRow = {
        ...(args.data as Omit<EventRow, 'id' | 'createdAt'>),
        id: `be_${++eventSeq}`,
        createdAt: args.data.createdAt ?? new Date(),
      }
      eventRows.push(row)
      return row
    }
  )

  // 同一个内存表要同时服务两种查询形状：按 periodKey（汇总）与按 dedupeKey.in（归集）。
  usageRecord.findMany.mockImplementation(
    async (args: { where: { organizationId: string; periodKey?: string; dedupeKey?: { in: string[] } } }) =>
      usageRows.filter(
        (r) =>
          r.organizationId === args.where.organizationId &&
          (args.where.periodKey === undefined || r.periodKey === args.where.periodKey) &&
          (args.where.dedupeKey === undefined || args.where.dedupeKey.in.includes(r.dedupeKey))
      )
  )
  usageRecord.createMany.mockImplementation(async (args: { data: UsageRow[] }) => {
    for (const d of args.data) usageRows.push({ ...d })
    return { count: args.data.length }
  })
  usageRecord.create.mockImplementation(async (args: { data: UsageRow }) => {
    usageRows.push({ ...args.data })
    return { ...args.data }
  })
})

// ═══════════════════════════════════════════════════════════
describe('鉴权与能力口径', () => {
  it('匿名访问用量 → 401，且不查库', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Authentication required'))
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage`))
    expect(res.status).toBe(401)
    expect(billingEvent.findMany).not.toHaveBeenCalled()
    expect(usageRecord.findMany).not.toHaveBeenCalled()
  })

  it('非成员 → 403 且不查库', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u_1' } })
    membership.findFirst.mockResolvedValue(null)
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage`))
    expect(res.status).toBe(403)
    expect(usageRecord.findMany).not.toHaveBeenCalled()
  })

  it('🔴 MEMBER 读用量 → 403（用量是经营信息，不是成果列表）', async () => {
    asRole('MEMBER')
    expect((await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage`))).status).toBe(403)
    expect((await subscriptionRoute.GET(getReq(`${BASE}/api/v1/billing/subscription`))).status).toBe(403)
  })

  it('OPERATOR 读用量/订阅 → 200（billing.read 从 OPERATOR 起）', async () => {
    asRole('OPERATOR')
    expect((await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage`))).status).toBe(200)
    expect((await subscriptionRoute.GET(getReq(`${BASE}/api/v1/billing/subscription`))).status).toBe(200)
  })

  it('🔴 OPERATOR 动账（写事件/扣款/归集）→ 403（billing.manage 取 ADMIN+）', async () => {
    asRole('OPERATOR')
    const events = await eventsRoute.POST(
      postReq(`${BASE}/api/v1/billing/subscription/events`, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 'k1' })
    )
    expect(events.status).toBe(403)
    const collect = await collectRoute.POST(postReq(`${BASE}/api/v1/billing/usage/collect`, {}))
    expect(collect.status).toBe(403)
    const charges = await chargesRoute.POST(
      postReq(`${BASE}/api/v1/billing/charges`, { amountCents: 100, description: 'x', dedupeKey: 'k2' })
    )
    expect(charges.status).toBe(403)
    expect(billingEvent.create).not.toHaveBeenCalled()
    expect(usageRecord.createMany).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════
describe('🔴 租户谓词', () => {
  it('用量查询带 organizationId；换个 organizationId 参数无效', async () => {
    asRole('OPERATOR')
    await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage?organizationId=org_hacker&periodKey=2026-10`))
    for (const [args] of usageRecord.findMany.mock.calls) {
      expect(args.where.organizationId).toBe(ORG)
      expect(args.where.organizationId).not.toBe('org_hacker')
    }
    for (const [args] of billingEvent.findMany.mock.calls) {
      expect(args.where.organizationId).toBe(ORG)
    }
  })

  it('账本查询带 organizationId（写事件时的已有事件加载）', async () => {
    asRole('ADMIN')
    await eventsRoute.POST(
      postReq(`${BASE}/api/v1/billing/subscription/events`, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 'k1' })
    )
    for (const [args] of billingEvent.findMany.mock.calls) {
      expect(args.where.organizationId).toBe(ORG)
    }
  })
})

// ═══════════════════════════════════════════════════════════
describe('用量汇总（AC-21「可复算」的响应面）', () => {
  it('basis 自描述：期次 + 开区间上界 + 方案限额 + 单元映射', async () => {
    asRole('OPERATOR')
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage?periodKey=2026-10`))
    const { data } = await res.json()

    expect(data.basis.scope).toBe('period')
    expect(data.basis.periodKey).toBe('2026-10')
    expect(data.basis.periodStart).toBe('2026-10-01T00:00:00.000Z')
    expect(data.basis.periodEnd).toBe('2026-11-01T00:00:00.000Z')
    expect(data.basis.plan).toBe('FREE')
    expect(data.basis.planLimits.introductionPerMonth).toBeGreaterThan(0)
    expect(data.basis.unitMapping).toMatchObject({ introduction: 'INTRODUCTION' })
  })

  it('缺省期次 = 当月（UTC）', async () => {
    asRole('OPERATOR')
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage`))
    const { data } = await res.json()
    const now = new Date()
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    expect(data.basis.periodKey).toBe(expected)
  })

  it('非法期次 → 400（不静默忽略，否则用户以为筛选生效了）', async () => {
    asRole('OPERATOR')
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage?periodKey=2026-13`))
    expect(res.status).toBe(400)
  })

  it('用量按 unit 聚合，且限额随之判定', async () => {
    asRole('OPERATOR')
    usageRows = [
      { organizationId: ORG, unit: 'INTRODUCTION', quantity: 1, occurredAt: new Date(), periodKey: '2026-10', sourceType: 'introduction', sourceId: 'p1', dedupeKey: 'introduction:p1' },
      { organizationId: ORG, unit: 'INTRODUCTION', quantity: 1, occurredAt: new Date(), periodKey: '2026-10', sourceType: 'introduction', sourceId: 'p2', dedupeKey: 'introduction:p2' },
      { organizationId: ORG, unit: 'PROPOSAL', quantity: 1, occurredAt: new Date(), periodKey: '2026-10', sourceType: 'proposal', sourceId: 'p1', dedupeKey: 'proposal:p1' },
    ]
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage?periodKey=2026-10`))
    const { data } = await res.json()

    expect(data.totals).toEqual({ proposal: 1, introduction: 2, outcome: 0, verification: 0 })
    expect(data.totalUnits).toBe(3)
    const intro = data.limits.find((l: { unit: string }) => l.unit === 'introduction')
    expect(intro).toMatchObject({ used: 2, limit: 3, remaining: 1, exhausted: false })
  })

  it('🔴 gateway 诚实块：沙箱态 + 真实扣款不可用（沙箱与真实态必须在响应里可区分）', async () => {
    asRole('OPERATOR')
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage`))
    const { data } = await res.json()
    expect(data.gateway).toMatchObject({ provider: 'creem', mode: 'sandbox', realChargesEnabled: false })
    expect(data.gateway.credentialsMissing).toEqual(expect.arrayContaining(['CREEM_API_KEY', 'CREEM_WEBHOOK_SECRET']))
  })
})

// ═══════════════════════════════════════════════════════════
describe('订阅状态（派生，不落列）', () => {
  it('空事件集 → FREE / NONE，且响应里没有 actorId / providerRef', async () => {
    asRole('OPERATOR')
    const res = await subscriptionRoute.GET(getReq(`${BASE}/api/v1/billing/subscription`))
    const { data } = await res.json()
    expect(data.plan).toBe('FREE')
    expect(data.status).toBe('NONE')
    expect(data.charges).toEqual([])
    const text = JSON.stringify(data)
    for (const forbidden of ['providerRef', 'actorId', 'dedupeKey', 'requestHash']) {
      expect(text).not.toContain(forbidden)
    }
  })
})

// ═══════════════════════════════════════════════════════════
describe('事件写入：幂等与非法迁移', () => {
  const URL_EVENTS = `${BASE}/api/v1/billing/subscription/events`

  it('首次写入 → 201，replayed=false；同键同体重放 → replayed=true 且不新增', async () => {
    asRole('ADMIN')
    const body = { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 'start-1' }

    const first = await eventsRoute.POST(postReq(URL_EVENTS, body))
    expect(first.status).toBe(201)
    expect((await first.json()).data.replayed).toBe(false)
    expect(eventRows).toHaveLength(1)

    const second = await eventsRoute.POST(postReq(URL_EVENTS, body))
    expect(second.status).toBe(201)
    expect((await second.json()).data.replayed).toBe(true)
    expect(eventRows).toHaveLength(1)
  })

  it('🔴 同键**不同体** → 409（静默回放会让调用方以为新动作生效了）', async () => {
    asRole('ADMIN')
    await eventsRoute.POST(postReq(URL_EVENTS, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 'k' }))
    const res = await eventsRoute.POST(
      postReq(URL_EVENTS, { type: 'PLAN_CHANGED', plan: 'SCALE', dedupeKey: 'k' })
    )
    expect(res.status).toBe(409)
    expect(eventRows).toHaveLength(1)
  })

  it('缺幂等键 → 400（账本不允许没有幂等键）', async () => {
    asRole('ADMIN')
    const res = await eventsRoute.POST(postReq(URL_EVENTS, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }))
    expect(res.status).toBe(400)
  })

  it('Idempotency-Key 头可作为 dedupeKey 的别名；与 body 不一致 → 400', async () => {
    asRole('ADMIN')
    const ok = await eventsRoute.POST(
      postReq(URL_EVENTS, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }, { 'idempotency-key': 'hdr-1' })
    )
    expect(ok.status).toBe(201)
    const bad = await eventsRoute.POST(
      postReq(URL_EVENTS, { type: 'PLAN_CHANGED', plan: 'SCALE', dedupeKey: 'a' }, { 'idempotency-key': 'b' })
    )
    expect(bad.status).toBe(400)
  })

  it('未知事件类型 → 400，且不写库', async () => {
    asRole('ADMIN')
    const res = await eventsRoute.POST(postReq(URL_EVENTS, { type: 'HACK_THE_PLANET', dedupeKey: 'x' }))
    expect(res.status).toBe(400)
    expect(eventRows).toHaveLength(0)
  })

  it('未订阅时 PLAN_CHANGED → 409 且不写库', async () => {
    asRole('ADMIN')
    const res = await eventsRoute.POST(postReq(URL_EVENTS, { type: 'PLAN_CHANGED', plan: 'GROWTH', dedupeKey: 'x' }))
    expect(res.status).toBe(409)
    expect(eventRows).toHaveLength(0)
  })

  it('🔴 AC-21 点名：REFUNDED → SUCCEEDED 必须 409，且不写库', async () => {
    asRole('ADMIN')
    const steps: Array<Record<string, unknown>> = [
      { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 'e1' },
      { type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: 9900, dedupeKey: 'e2' },
      { type: 'CHARGE_SUCCEEDED', chargeId: 'ch_1', amountCents: 9900, gatewayStatus: 'CAPTURED', dedupeKey: 'e3' },
      { type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 9900, dedupeKey: 'e4' },
    ]
    for (const s of steps) {
      const r = await eventsRoute.POST(postReq(URL_EVENTS, s))
      expect(r.status).toBe(201)
    }

    const before = eventRows.length
    const res = await eventsRoute.POST(
      postReq(URL_EVENTS, { type: 'CHARGE_SUCCEEDED', chargeId: 'ch_1', amountCents: 9900, dedupeKey: 'e5' })
    )
    expect(res.status).toBe(409)
    expect(eventRows).toHaveLength(before)
  })

  it('退款后订阅状态为 REFUNDED，净额为 0（状态由事件派生）', async () => {
    asRole('ADMIN')
    const steps: Array<Record<string, unknown>> = [
      { type: 'SUBSCRIPTION_STARTED', plan: 'GROWTH', dedupeKey: 'f1' },
      { type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: 19900, dedupeKey: 'f2' },
      { type: 'CHARGE_SUCCEEDED', chargeId: 'ch_1', amountCents: 19900, gatewayStatus: 'CAPTURED', dedupeKey: 'f3' },
      { type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 19900, dedupeKey: 'f4' },
    ]
    for (const s of steps) await eventsRoute.POST(postReq(URL_EVENTS, s))

    const res = await subscriptionRoute.GET(getReq(`${BASE}/api/v1/billing/subscription`))
    const { data } = await res.json()
    expect(data.status).toBe('REFUNDED')
    expect(data.plan).toBe('GROWTH')
    expect(data.paidTotalCents).toBe(19900)
    expect(data.refundedTotalCents).toBe(19900)
    expect(data.netPaidCents).toBe(0)
    expect(data.live).toBe(false)
  })

  it('未知 gatewayStatus → 400', async () => {
    asRole('ADMIN')
    const res = await eventsRoute.POST(
      postReq(URL_EVENTS, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 'g', gatewayStatus: 'MADE_UP' })
    )
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════
describe('扣款（沙箱）', () => {
  const URL_CHARGES = `${BASE}/api/v1/billing/charges`
  const URL_EVENTS = `${BASE}/api/v1/billing/subscription/events`

  it('🔴 沙箱：gatewayStatus=CAPTURED（永不 SUCCEEDED）+ 返回"本来会发出去的请求"', async () => {
    asRole('ADMIN')
    await eventsRoute.POST(postReq(URL_EVENTS, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 's1' }))

    const res = await chargesRoute.POST(
      postReq(URL_CHARGES, { amountCents: 9900, description: 'Starter 月费', dedupeKey: 'c1' })
    )
    expect(res.status).toBe(201)
    const { data } = await res.json()

    expect(data.gatewayStatus).toBe('CAPTURED')
    expect(data.providerRef.startsWith('sandbox:')).toBe(true)
    expect(data.requestSnapshot).toMatchObject({ amount: 9900, currency: 'USD' })
    expect(data.requestSnapshot.metadata).toMatchObject({ organizationId: ORG })
    expect(data.gateway.realChargesEnabled).toBe(false)

    // 账本侧走完 PENDING → SUCCEEDED，但每一条都带 CAPTURED
    const gateways = data.events.map((e: { event: { gatewayStatus: string } }) => e.event.gatewayStatus)
    expect(gateways).toContain('CAPTURED')
    expect(gateways).not.toContain('SUCCEEDED')
  })

  it('重复扣款（同 dedupeKey 同体）→ 账本不重复', async () => {
    asRole('ADMIN')
    await eventsRoute.POST(postReq(URL_EVENTS, { type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 's1' }))
    const body = { amountCents: 500, description: 'x', dedupeKey: 'c2' }
    await chargesRoute.POST(postReq(URL_CHARGES, body))
    const countAfterFirst = eventRows.length
    await chargesRoute.POST(postReq(URL_CHARGES, body))
    expect(eventRows.length).toBe(countAfterFirst)
  })

  it('金额为负 / 描述为空 → 400', async () => {
    asRole('ADMIN')
    expect(
      (await chargesRoute.POST(postReq(URL_CHARGES, { amountCents: -1, description: 'x', dedupeKey: 'c3' }))).status
    ).toBe(400)
    expect(
      (await chargesRoute.POST(postReq(URL_CHARGES, { amountCents: 1, description: '  ', dedupeKey: 'c4' }))).status
    ).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════
describe('用量归集（幂等补齐）', () => {
  const URL_COLLECT = `${BASE}/api/v1/billing/usage/collect`

  it('扫描原始表 → 入账；重复归集 → inserted=0（只增不减且不重复）', async () => {
    asRole('ADMIN')
    connectionProposal.findMany.mockResolvedValue([
      { id: 'p1', createdAt: new Date('2026-10-05T00:00:00Z'), introducedAt: new Date('2026-10-06T00:00:00Z') },
      { id: 'p2', createdAt: new Date('2026-10-07T00:00:00Z'), introducedAt: null },
    ])
    outcome.findMany.mockResolvedValue([
      { id: 'o1', occurredAt: new Date('2026-10-08T00:00:00Z'), verificationLevel: 'COUNTERPARTY_CONFIRMED' },
    ])
    outcomeVerification.findMany.mockResolvedValue([
      { outcomeId: 'o1', createdAt: new Date('2026-10-09T00:00:00Z') },
      { outcomeId: 'o1', createdAt: new Date('2026-10-10T00:00:00Z') }, // 第二条核验不该重复计费
    ])

    const first = await collectRoute.POST(postReq(URL_COLLECT, {}))
    expect(first.status).toBe(200)
    const d1 = (await first.json()).data
    expect(d1.inserted).toBe(5) // proposal×2 + introduction×1 + outcome×1 + verification×1
    expect(d1.perUnit).toEqual({ proposal: 2, introduction: 1, outcome: 1, verification: 1 })

    const second = await collectRoute.POST(postReq(URL_COLLECT, {}))
    const d2 = (await second.json()).data
    expect(d2.inserted).toBe(0)
    expect(d2.skipped).toBe(5)
    expect(usageRows).toHaveLength(5)
  })

  it('归集出的行带 periodKey（来自事实自身时间，不是"现在"）', async () => {
    asRole('ADMIN')
    connectionProposal.findMany.mockResolvedValue([
      { id: 'p1', createdAt: new Date('2026-09-20T00:00:00Z'), introducedAt: new Date('2026-10-03T00:00:00Z') },
    ])
    await collectRoute.POST(postReq(URL_COLLECT, {}))
    const byUnit = Object.fromEntries(usageRows.map((r) => [r.unit, r.periodKey]))
    expect(byUnit.PROPOSAL).toBe('2026-09')
    expect(byUnit.INTRODUCTION).toBe('2026-10')
  })

  it('自报成果不计入"核验"单元（只有已验证的才计费）', async () => {
    asRole('ADMIN')
    outcome.findMany.mockResolvedValue([
      { id: 'o1', occurredAt: new Date('2026-10-08T00:00:00Z'), verificationLevel: 'SELF_REPORTED' },
    ])
    const res = await collectRoute.POST(postReq(URL_COLLECT, {}))
    const d = (await res.json()).data
    expect(d.perUnit).toEqual({ proposal: 0, introduction: 0, outcome: 1, verification: 0 })
  })

  it('空库 → 全 0，不报错', async () => {
    asRole('ADMIN')
    const res = await collectRoute.POST(postReq(URL_COLLECT, {}))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ inserted: 0, skipped: 0, total: 0 })
  })
})

// ═══════════════════════════════════════════════════════════
describe('故障面', () => {
  it('500 不泄漏内部信息', async () => {
    asRole('OPERATOR')
    usageRecord.findMany.mockRejectedValueOnce(new Error('SQLITE_ERROR: no such table: main.UsageRecord'))
    const res = await usageRoute.GET(getReq(`${BASE}/api/v1/billing/usage`))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('UsageRecord')
  })
})
