/**
 * `GET /api/v1/public/pulse` —— 首页活数据的**诚实性**回归
 *
 * 这个端点唯一不可退让的性质是「**缺数据时不能显示成 0**」：
 * 首页把它当作「这周真的跑了多少」来展示，一旦把查询失败渲染成 0，
 * 就等于在营销页上写下不存在的经营数据。
 *
 * 因此本文件断言的不是"字段齐全"，而是三条边界：
 *   1. 单项查询失败 ⇒ 该项 `null`，**其余项照常给数**（不整体塌成 null）；
 *   2. 全部失败 ⇒ `activity: null` + `note: aggregate_unavailable`；
 *   3. 阶段事件表缺失（未迁移）⇒ `stages: []` + `note: stage_events_unavailable`，
 *      而不是 0 条柱子。
 *
 * 另外断言响应里**不含**租户/用户标识 —— 匿名面不得因为"聚合"就顺手带出主体。
 */

import type { NextRequest } from 'next/server'

type PulseModule = typeof import('@/app/api/v1/public/pulse/route')
type PrismaMock = {
  mission: { count: jest.Mock }
  agentRun: { count: jest.Mock }
  agentApproval: { count: jest.Mock }
  outcome: { count: jest.Mock }
  agentRunStageEvent: { groupBy: jest.Mock }
}

let mockRateAllowed = true

jest.mock('@/lib/rate-limit', () => ({
  rateLimit: () => async () =>
    mockRateAllowed
      ? { success: true, remaining: 59, resetAt: Date.now() + 60_000, limit: 60, backend: 'memory' }
      : { success: false, remaining: 0, resetAt: Date.now() + 30_000, limit: 60, backend: 'memory' },
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    mission: { count: jest.fn() },
    agentRun: { count: jest.fn() },
    agentApproval: { count: jest.fn() },
    outcome: { count: jest.fn() },
    agentRunStageEvent: { groupBy: jest.fn() },
  },
}))

/** `/lib/agents/stage-events` 会 import `@/lib/db`（真实 PrismaClient），测试里挡掉。 */
jest.mock('@/lib/db', () => ({ db: {}, getDb: () => ({}) }))

/**
 * `@/lib/interop/tools` 会经 `@/lib/connection` 拉进 `next-auth`（ESM），
 * 在 ts-jest 的 CJS 运行时里加载不了。这里只替换**名单常量**，
 * 行为断言不依赖工具的具体实现（只断言"名字数量被如实转成 mcpTools"）。
 */
jest.mock('@/lib/interop/tools', () => ({
  INTEROP_TOOL_NAMES: [
    'list_missions',
    'list_bridges',
    'bridge_discovery',
    'list_outcomes',
    'report_outcome',
  ],
}))

/**
 * 路由持有 60s 进程内缓存，所以每个用例必须拿到**全新的模块实例**，
 * 否则第二个用例会读到第一个用例缓存下来的聚合结果。
 */
function loadFresh(): { GET: PulseModule['GET']; prisma: PrismaMock } {
  let mod!: PulseModule
  let prisma!: PrismaMock
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    prisma = require('@/lib/prisma').prisma as PrismaMock
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@/app/api/v1/public/pulse/route') as PulseModule
  })
  return { GET: mod.GET, prisma }
}

function call(GET: PulseModule['GET']) {
  const req = new Request('http://localhost/api/v1/public/pulse') as unknown as NextRequest
  return GET(req)
}

beforeEach(() => {
  mockRateAllowed = true
})

describe('public/pulse 的缺失数据语义', () => {
  it('全部查询正常：返回四个计数与阶段分布', async () => {
    const { GET, prisma } = loadFresh()
    prisma.mission.count.mockResolvedValue(12)
    prisma.agentRun.count.mockResolvedValue(34)
    prisma.agentApproval.count.mockResolvedValue(7)
    prisma.outcome.count.mockResolvedValue(5)
    prisma.agentRunStageEvent.groupBy.mockResolvedValue([
      { stage: 'MODEL_CALL', _count: { _all: 30 } },
      { stage: 'PERSISTED', _count: { _all: 22 } },
      { stage: 'SOMETHING_ELSE', _count: { _all: 9 } },
    ])

    const res = await call(GET)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.activity).toEqual({
      missions: 12,
      runs: 34,
      decisions: 7,
      verifiedOutcomes: 5,
    })
    // 白名单：非编排阶段名不得出现在匿名响应里
    expect(body.data.stages).toEqual([
      { stage: 'MODEL_CALL', count: 30 },
      { stage: 'PERSISTED', count: 22 },
    ])
    expect(body.data.note).toBeUndefined()
  })

  it('单项失败只影响该项，其余照常给数（不得整体塌成 null）', async () => {
    const { GET, prisma } = loadFresh()
    prisma.mission.count.mockRejectedValue(new Error('no such table: Mission'))
    prisma.agentRun.count.mockResolvedValue(34)
    prisma.agentApproval.count.mockResolvedValue(7)
    prisma.outcome.count.mockResolvedValue(5)
    prisma.agentRunStageEvent.groupBy.mockResolvedValue([])

    const body = await (await call(GET)).json()

    expect(body.data.activity).toEqual({
      missions: null,
      runs: 34,
      decisions: 7,
      verifiedOutcomes: 5,
    })
  })

  it('全部失败：activity 为 null 且附机器可读原因（不是 0）', async () => {
    const { GET, prisma } = loadFresh()
    for (const fn of [prisma.mission.count, prisma.agentRun.count, prisma.agentApproval.count, prisma.outcome.count]) {
      fn.mockRejectedValue(new Error('db down'))
    }
    prisma.agentRunStageEvent.groupBy.mockRejectedValue(new Error('db down'))

    const body = await (await call(GET)).json()

    expect(body.data.activity).toBeNull()
    expect(body.data.note).toBe('aggregate_unavailable')
  })

  it('阶段事件表未迁移：stages 为空 + note 标注，而不是画 0 条', async () => {
    const { GET, prisma } = loadFresh()
    prisma.mission.count.mockResolvedValue(0)
    prisma.agentRun.count.mockResolvedValue(0)
    prisma.agentApproval.count.mockResolvedValue(0)
    prisma.outcome.count.mockResolvedValue(0)
    prisma.agentRunStageEvent.groupBy.mockRejectedValue(
      new Error('SQLITE_UNKNOWN: no such table: main.AgentRunStageEvent'),
    )

    const body = await (await call(GET)).json()

    expect(body.data.activity).toEqual({
      missions: 0,
      runs: 0,
      decisions: 0,
      verifiedOutcomes: 0,
    })
    expect(body.data.stages).toEqual([])
    expect(body.data.note).toBe('stage_events_unavailable')
  })

  it('只统计"对手方确认/外部核验"的成果（SELF_REPORTED 不计入）', async () => {
    const { GET, prisma } = loadFresh()
    prisma.mission.count.mockResolvedValue(0)
    prisma.agentRun.count.mockResolvedValue(0)
    prisma.agentApproval.count.mockResolvedValue(0)
    prisma.outcome.count.mockResolvedValue(0)
    prisma.agentRunStageEvent.groupBy.mockResolvedValue([])

    await call(GET)

    const where = prisma.outcome.count.mock.calls[0][0].where
    expect(where.verificationLevel.in).toEqual(['COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'])
    expect(where.verificationLevel.in).not.toContain('SELF_REPORTED')
  })

  it('匿名响应不含租户/用户标识', async () => {
    const { GET, prisma } = loadFresh()
    prisma.mission.count.mockResolvedValue(1)
    prisma.agentRun.count.mockResolvedValue(1)
    prisma.agentApproval.count.mockResolvedValue(1)
    prisma.outcome.count.mockResolvedValue(1)
    prisma.agentRunStageEvent.groupBy.mockResolvedValue([])

    const raw = JSON.stringify(await (await call(GET)).json())

    for (const key of ['organizationId', 'organization_id', 'userId', 'requestedBy', 'verifierId', 'goal']) {
      expect(raw).not.toContain(key)
    }
  })

  it('限流命中返回 429 且带 Retry-After', async () => {
    mockRateAllowed = false
    const { GET } = loadFresh()

    const res = await call(GET)

    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})
