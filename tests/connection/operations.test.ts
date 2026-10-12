/**
 * T07 · 连接运营视图服务层 —— 单测
 *
 * 覆盖四类风险：
 *   1. **租户谓词**：提案查询必须强制带 `organizationId`；
 *   2. **投影边界**：DTO **不得**带出双方 userId（运营视图要的是"走到哪一步"，不是"是谁"）；
 *   3. **分桶**：已介绍的行必须落在 `INTRODUCED`，**不能**被 `deriveProposalState` 的
 *      `MUTUALLY_ACCEPTED` 吃掉（这是最容易写错、且错了会被当成"待介绍"的一条）；
 *   4. **诚实口径**：`truncated` 必须在窗口被截断时为真，`summary` 必须按窗口全量统计。
 *
 * 另覆盖 `canIntroduce`：它必须与执行点同源（`introductionBlockersByProposal`）——
 * 这里用"意图非 ACTIVE"造出 blocker，断言按钮判据随之变 false。
 */

jest.mock('@/lib/db', () => ({
  db: {
    connectionProposal: { findMany: jest.fn(), count: jest.fn() },
    introductionWorkflow: { findMany: jest.fn() },
    mission: { findMany: jest.fn() },
    socialIntent: { findMany: jest.fn() },
  },
}))

import { db } from '@/lib/db'
import {
  BUCKET_LABELS,
  CONNECTION_BUCKETS,
  SCAN_LIMIT,
  bucketOf,
  listOrgConnections,
  parseConnectionBucket,
} from '@/lib/connection/operations'
import type { TenantContext } from '@/lib/tenancy'

const ctx: TenantContext = {
  organizationId: 'org_1',
  userId: 'u_op',
  role: 'OPERATOR',
  membershipId: 'ms_1',
}

const propFindMany = db.connectionProposal.findMany as unknown as jest.Mock
const propCount = db.connectionProposal.count as unknown as jest.Mock
const wfFindMany = db.introductionWorkflow.findMany as unknown as jest.Mock
const missionFindMany = db.mission.findMany as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock

const NOW = new Date('2026-10-12T12:00:00.000Z')

const MISSION = 'm_1'

function propRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p_1',
    organizationId: 'org_1',
    missionId: MISSION,
    proposerId: 'u_op',
    candidateId: 'u_cand',
    status: 'CONSENT_PENDING',
    introducedAt: null,
    expiresAt: null,
    closedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  }
}

/** 双方意图都 ACTIVE —— 默认"可介绍"的前提。 */
function liveIntents() {
  return [
    { missionId: MISSION, userId: 'u_op', status: 'ACTIVE', expiresAt: null },
    { missionId: MISSION, userId: 'u_cand', status: 'ACTIVE', expiresAt: null },
  ]
}

beforeEach(() => {
  jest.clearAllMocks()
  propFindMany.mockResolvedValue([])
  propCount.mockResolvedValue(0)
  wfFindMany.mockResolvedValue([])
  missionFindMany.mockResolvedValue([])
  intentFindMany.mockResolvedValue([])
})

// ───────────────────────────────────────────────────────────
describe('bucketOf（纯函数）', () => {
  it('已介绍 → INTRODUCED（先判 introduced，而不是先判 state）', () => {
    // 注意状态仍是 MUTUALLY_ACCEPTED —— 这是 deriveProposalState 对已介绍行的返回值，
    // 若先判 state 就会落进 READY_TO_INTRODUCE（真 bug）。
    expect(bucketOf({ state: 'MUTUALLY_ACCEPTED', introduced: true })).toBe('INTRODUCED')
  })

  it('互选未介绍 → READY_TO_INTRODUCE', () => {
    expect(bucketOf({ state: 'MUTUALLY_ACCEPTED', introduced: false })).toBe('READY_TO_INTRODUCE')
  })

  it('待表态 → PENDING_CONSENT', () => {
    expect(bucketOf({ state: 'CONSENT_PENDING', introduced: false })).toBe('PENDING_CONSENT')
  })

  it('拒绝 / 撤销 / 过期 → 统一 CLOSED（对运营是同一件事：不会再推进）', () => {
    for (const s of ['REJECTED', 'REVOKED', 'EXPIRED'] as const) {
      expect(bucketOf({ state: s, introduced: false })).toBe('CLOSED')
    }
  })
})

describe('parseConnectionBucket', () => {
  it('缺省 / 空串 → ALL', () => {
    expect(parseConnectionBucket(null)).toBe('ALL')
    expect(parseConnectionBucket('')).toBe('ALL')
    expect(parseConnectionBucket('   ')).toBe('ALL')
  })

  it('大小写不敏感，取值必须是已知桶', () => {
    expect(parseConnectionBucket('introduced')).toBe('INTRODUCED')
    expect(parseConnectionBucket(' ready_to_introduce ')).toBe('READY_TO_INTRODUCE')
  })

  it('未知值 → null（由路由层转 400，**不**静默回退 ALL）', () => {
    expect(parseConnectionBucket('STALLED')).toBeNull()
    expect(parseConnectionBucket('__all__')).toBeNull()
  })

  it('每个声明的桶都有中文标签（新增桶时漏标签会在这里炸）', () => {
    for (const b of CONNECTION_BUCKETS) {
      expect(BUCKET_LABELS[b]).toBeTruthy()
    }
  })
})

// ───────────────────────────────────────────────────────────
describe('listOrgConnections', () => {
  it('空租户 → 全 0，且不查关联表（省掉三条无谓查询）', async () => {
    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.items).toEqual([])
    expect(res.total).toBe(0)
    expect(res.truncated).toBe(false)
    expect(res.summary).toEqual({
      ALL: 0,
      PENDING_CONSENT: 0,
      READY_TO_INTRODUCE: 0,
      INTRODUCED: 0,
      CLOSED: 0,
    })
    expect(wfFindMany).not.toHaveBeenCalled()
    expect(missionFindMany).not.toHaveBeenCalled()
    expect(intentFindMany).not.toHaveBeenCalled()
  })

  it('🔒 租户谓词：提案查询强制 organizationId（跨租户读的唯一保证）', async () => {
    propFindMany.mockResolvedValue([propRow()]) // 有行 → 才会走到三条关联查询
    await listOrgConnections(ctx, {}, NOW)
    expect(propFindMany.mock.calls[0][0].where).toEqual({ organizationId: 'org_1' })
    expect(propCount.mock.calls[0][0].where).toEqual({ organizationId: 'org_1' })
    expect(wfFindMany.mock.calls[0][0].where.organizationId).toBe('org_1')
    expect(missionFindMany.mock.calls[0][0].where.organizationId).toBe('org_1')
  })

  it('🔒 投影边界：DTO 不含 proposerId / candidateId（运营看流程，不看"是谁"）', async () => {
    propFindMany.mockResolvedValue([propRow()])
    const res = await listOrgConnections(ctx, {}, NOW)

    const keys = Object.keys(res.items[0]).sort()
    expect(keys).not.toContain('proposerId')
    expect(keys).not.toContain('candidateId')
    expect(keys).not.toContain('rationale')
    // 反向断言：该有的字段必须在（避免"什么都没返回"也叫通过）
    expect(keys).toEqual(
      [
        'bucket',
        'canIntroduce',
        'closedAt',
        'createdAt',
        'expiresAt',
        'introduceBlockers',
        'introduced',
        'introducedAt',
        'missionId',
        'missionTitle',
        'proposalId',
        'stage',
        'stageEnteredAt',
        'stalled',
        'state',
      ].sort()
    )
  })

  it('已介绍 → bucket INTRODUCED，state 仍是 MUTUALLY_ACCEPTED，introduced=true', async () => {
    propFindMany.mockResolvedValue([
      propRow({
        status: 'MUTUALLY_ACCEPTED',
        introducedAt: new Date('2026-10-05T00:00:00.000Z'),
      }),
    ])
    const res = await listOrgConnections(ctx, {}, NOW)

    expect(res.items[0].state).toBe('MUTUALLY_ACCEPTED')
    expect(res.items[0].bucket).toBe('INTRODUCED')
    expect(res.items[0].introduced).toBe(true)
    expect(res.items[0].introducedAt).toBe('2026-10-05T00:00:00.000Z')
  })

  it('派生过期：库里仍是 CONSENT_PENDING，对外状态是 EXPIRED 并落 CLOSED', async () => {
    propFindMany.mockResolvedValue([
      propRow({ status: 'CONSENT_PENDING', expiresAt: new Date('2026-10-01T00:00:00.000Z') }),
    ])
    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.items[0].state).toBe('EXPIRED')
    expect(res.items[0].bucket).toBe('CLOSED')
  })

  it('任务标题按 missionId 补上；任务被删则 missionTitle 为 null（不抛错）', async () => {
    propFindMany.mockResolvedValue([propRow(), propRow({ id: 'p_2', missionId: 'm_gone' })])
    missionFindMany.mockResolvedValue([{ id: MISSION, title: '寻找东南亚渠道' }])

    const res = await listOrgConnections(ctx, {}, NOW)
    const byId = new Map(res.items.map((r) => [r.proposalId, r]))
    expect(byId.get('p_1')!.missionTitle).toBe('寻找东南亚渠道')
    expect(byId.get('p_2')!.missionTitle).toBeNull()
  })

  it('停滞：非终态阶段超时 → stalled；终态阶段即使很旧也**不**算停滞', async () => {
    propFindMany.mockResolvedValue([
      propRow({ id: 'p_old', introducedAt: new Date('2026-09-01T00:00:00.000Z') }),
      propRow({ id: 'p_done', introducedAt: new Date('2026-09-01T00:00:00.000Z') }),
    ])
    wfFindMany.mockResolvedValue([
      { proposalId: 'p_old', stage: 'COORDINATING', stageEnteredAt: new Date('2026-09-20T00:00:00.000Z') },
      // 22 天前就记录了成果 —— 流程已走完，不该出现在"停滞"里。
      { proposalId: 'p_done', stage: 'OUTCOME_RECORDED', stageEnteredAt: new Date('2026-09-20T00:00:00.000Z') },
    ])

    const res = await listOrgConnections(ctx, {}, NOW)
    const byId = new Map(res.items.map((r) => [r.proposalId, r]))
    expect(byId.get('p_old')!.stalled).toBe(true)
    expect(byId.get('p_done')!.stalled).toBe(false)
    expect(byId.get('p_done')!.stage).toBe('OUTCOME_RECORDED')
  })

  it('无工作流实例 → stage 为 null 且不判停滞（"未建流程" ≠ "停滞"）', async () => {
    propFindMany.mockResolvedValue([propRow({ createdAt: new Date('2020-01-01T00:00:00.000Z') })])
    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.items[0].stage).toBeNull()
    expect(res.items[0].stalled).toBe(false)
  })

  it('canIntroduce：双方意图都 ACTIVE 的互选提案 → true', async () => {
    propFindMany.mockResolvedValue([propRow({ status: 'MUTUALLY_ACCEPTED' })])
    intentFindMany.mockResolvedValue(liveIntents())

    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.items[0].canIntroduce).toBe(true)
    expect(res.items[0].introduceBlockers).toEqual([])
  })

  it('canIntroduce：一方意图已撤销 → false 且指明是哪一方（与执行点同判据）', async () => {
    propFindMany.mockResolvedValue([propRow({ status: 'MUTUALLY_ACCEPTED' })])
    intentFindMany.mockResolvedValue([
      { missionId: MISSION, userId: 'u_op', status: 'ACTIVE', expiresAt: null },
      { missionId: MISSION, userId: 'u_cand', status: 'WITHDRAWN', expiresAt: null },
    ])

    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.items[0].canIntroduce).toBe(false)
    expect(res.items[0].introduceBlockers).toContain('candidate_intent_not_live')
  })

  it('canIntroduce：提案未互选时不查意图（第①层就挂了）', async () => {
    propFindMany.mockResolvedValue([propRow({ status: 'CONSENT_PENDING' })])
    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.items[0].canIntroduce).toBe(false)
    expect(res.items[0].introduceBlockers).toContain('not_mutually_accepted')
    expect(intentFindMany).not.toHaveBeenCalled()
  })

  it('summary 按**窗口全量**统计，不受当前分桶影响', async () => {
    propFindMany.mockResolvedValue([
      propRow({ id: 'a', status: 'CONSENT_PENDING' }),
      propRow({ id: 'b', status: 'MUTUALLY_ACCEPTED' }),
      propRow({ id: 'c', status: 'REJECTED' }),
    ])

    const res = await listOrgConnections(ctx, { bucket: 'CLOSED' }, NOW)
    expect(res.items).toHaveLength(1)
    expect(res.total).toBe(1)
    // 计数仍是三条（注意桶名是 PENDING_CONSENT，与状态名 CONSENT_PENDING 词序相反）
    expect(res.summary.ALL).toBe(3)
    expect(res.summary.PENDING_CONSENT).toBe(1)
    expect(res.summary.READY_TO_INTRODUCE).toBe(1)
    expect(res.summary.CLOSED).toBe(1)
  })

  it('stalledOnly 只留停滞行（派生过滤）', async () => {
    propFindMany.mockResolvedValue([propRow({ id: 'p_a' }), propRow({ id: 'p_b' })])
    wfFindMany.mockResolvedValue([
      { proposalId: 'p_a', stage: 'COORDINATING', stageEnteredAt: new Date('2026-09-01T00:00:00.000Z') },
      { proposalId: 'p_b', stage: 'COORDINATING', stageEnteredAt: new Date('2026-10-11T00:00:00.000Z') },
    ])

    const res = await listOrgConnections(ctx, { stalledOnly: true }, NOW)
    expect(res.items.map((r) => r.proposalId)).toEqual(['p_a'])
  })

  it('分页在**过滤之后**：pageSize=1 时第 2 页拿到第 2 条', async () => {
    propFindMany.mockResolvedValue([propRow({ id: 'p_1' }), propRow({ id: 'p_2' })])

    const p1 = await listOrgConnections(ctx, { page: 1, pageSize: 1 }, NOW)
    const p2 = await listOrgConnections(ctx, { page: 2, pageSize: 1 }, NOW)
    expect(p1.items.map((r) => r.proposalId)).toEqual(['p_1'])
    expect(p2.items.map((r) => r.proposalId)).toEqual(['p_2'])
    expect(p1.total).toBe(2)
    expect(p2.total).toBe(2)
  })

  it('truncated：库里提案多于窗口 → true（"共 N 条"不能当全量读）', async () => {
    propFindMany.mockResolvedValue([propRow()])
    propCount.mockResolvedValue(SCAN_LIMIT + 42)

    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.scanned).toBe(1)
    expect(res.truncated).toBe(true)
  })

  it('未截断时 truncated 为 false（不虚报）', async () => {
    propFindMany.mockResolvedValue([propRow()])
    propCount.mockResolvedValue(1)
    const res = await listOrgConnections(ctx, {}, NOW)
    expect(res.truncated).toBe(false)
  })

  it('窗口上限下推到 SQL（take = SCAN_LIMIT），不是全量拉回再切', async () => {
    await listOrgConnections(ctx, {}, NOW)
    expect(propFindMany.mock.calls[0][0].take).toBe(SCAN_LIMIT)
    expect(propFindMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' })
  })
})
