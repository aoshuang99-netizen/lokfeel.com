/**
 * T06 · 阶段持久化（`workflow.ts`）—— AC-14 的流程推进落点
 *
 * 与 `stage-machine.test.ts`（纯判定）分工：这里验的是**持久化语义**——
 * 幂等创建、CAS 推进、时间线追加、停滞检测。用 mock 的 db 精确构造
 * "并发推进""阶段已到位"等场景。
 */

jest.mock('@/lib/db', () => ({
  db: {
    introductionWorkflow: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    connectionProposal: { findFirst: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { db } from '@/lib/db'
import {
  advanceIntroductionWorkflow,
  ensureIntroductionWorkflow,
  getIntroductionWorkflow,
} from '@/lib/workflow/workflow'

const wfFindUnique = db.introductionWorkflow.findUnique as unknown as jest.Mock
const wfFindFirst = db.introductionWorkflow.findFirst as unknown as jest.Mock
const wfCreate = db.introductionWorkflow.create as unknown as jest.Mock
const wfUpdateMany = db.introductionWorkflow.updateMany as unknown as jest.Mock
const propFindFirst = db.connectionProposal.findFirst as unknown as jest.Mock

const ORG = 'org_1'
const NOW = new Date('2026-10-12T00:00:00.000Z')

function wfRow(over: Record<string, unknown> = {}) {
  return {
    id: 'wf_1',
    proposalId: 'p_1',
    organizationId: ORG,
    missionId: 'm_1',
    stage: 'PROPOSED',
    stageEnteredAt: NOW,
    timeline: JSON.stringify([{ stage: 'PROPOSED', at: NOW.toISOString(), by: null, reason: 'proposal_created' }]),
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  wfUpdateMany.mockResolvedValue({ count: 1 })
})

describe('T06 · ensureIntroductionWorkflow（幂等创建）', () => {
  it('已存在 → created:false，不重复创建', async () => {
    wfFindUnique.mockResolvedValue({ id: 'wf_1' })
    const r = await ensureIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_1',
      missionId: 'm_1',
      now: NOW,
    })
    expect(r).toEqual({ id: 'wf_1', created: false })
    expect(wfCreate).not.toHaveBeenCalled()
  })

  it('不存在 → 创建，初始阶段 PROPOSED + 一条时间线', async () => {
    wfFindUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: 'wf_1' })
    wfCreate.mockResolvedValue({ id: 'wf_1' })
    const r = await ensureIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_1',
      missionId: 'm_1',
      by: 'u_op',
      now: NOW,
    })
    expect(r).toEqual({ id: 'wf_1', created: true })
    const data = wfCreate.mock.calls[0][0].data
    expect(data.stage).toBe('PROPOSED')
    expect(data.stageEnteredAt).toEqual(NOW)
    expect(JSON.parse(data.timeline)).toEqual([
      { stage: 'PROPOSED', at: NOW.toISOString(), by: 'u_op', reason: 'proposal_created' },
    ])
  })

  it('★ 并发创建撞唯一键 → 读回胜者（created:false），不抛错', async () => {
    wfFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'wf_winner' })
    wfCreate.mockRejectedValue(new Error('UNIQUE constraint failed'))
    const r = await ensureIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_1',
      missionId: 'm_1',
      now: NOW,
    })
    expect(r).toEqual({ id: 'wf_winner', created: false })
  })
})

describe('T06 · advanceIntroductionWorkflow', () => {
  it('阶段不变（同事件重放）→ changed:false，不写库、不追加时间线', async () => {
    wfFindUnique.mockResolvedValue(wfRow({ stage: 'INTRODUCED' }))
    const r = await advanceIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_1',
      event: 'INTRODUCED',
      reason: 'again',
      now: NOW,
    })
    expect(r).toEqual({ stage: 'INTRODUCED', changed: false })
    expect(wfUpdateMany).not.toHaveBeenCalled()
  })

  it('阶段前进 → CAS 更新 + 时间线追加一条', async () => {
    wfFindUnique.mockResolvedValue(wfRow({ stage: 'CONSENT_PENDING' }))
    wfUpdateMany.mockResolvedValue({ count: 1 })
    const r = await advanceIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_1',
      event: 'INTRODUCED',
      reason: 'connection_introduced',
      by: null,
      now: NOW,
    })
    expect(r).toEqual({ stage: 'INTRODUCED', changed: true })

    const upd = wfUpdateMany.mock.calls[0][0]
    expect(upd.where).toMatchObject({ id: 'wf_1', organizationId: ORG, stage: 'CONSENT_PENDING' })
    expect(upd.data.stage).toBe('INTRODUCED')
    const timeline = JSON.parse(upd.data.timeline)
    expect(timeline.at(-1)).toMatchObject({ stage: 'INTRODUCED', reason: 'connection_introduced' })
    expect(timeline).toHaveLength(2)
  })

  it('★ 并发推进：CAS count=0 → 读回现状，不覆盖他人结论', async () => {
    wfFindUnique
      .mockResolvedValueOnce(wfRow({ stage: 'CONSENT_PENDING' })) // 首次读
      .mockResolvedValueOnce({ stage: 'INTRODUCED' }) // 被抢先后的读回
    wfUpdateMany.mockResolvedValue({ count: 0 })
    const r = await advanceIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_1',
      event: 'INTRODUCED',
      reason: 'x',
      now: NOW,
    })
    expect(r.changed).toBe(false)
    expect(r.stage).toBe('INTRODUCED')
  })

  it('工作流不存在（历史提案）→ 就地创建再推进（这一层"总能用"）', async () => {
    // 第一次 findUnique 返回 null（工作流不存在）；之后 ensure 内部再查。
    wfFindUnique
      .mockResolvedValueOnce(null) // advance 的首次读
      .mockResolvedValueOnce(null) // ensure 的查
      .mockResolvedValueOnce(wfRow({ stage: 'PROPOSED' })) // ensure 后重新读
    propFindFirst.mockResolvedValue({ missionId: 'm_1' })
    wfCreate.mockResolvedValue({ id: 'wf_1' })

    const r = await advanceIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_1',
      event: 'INTRODUCED',
      reason: 'x',
      now: NOW,
    })
    expect(wfCreate).toHaveBeenCalled()
    expect(r.stage).toBe('INTRODUCED')
    expect(r.changed).toBe(true)
  })

  it('提案不存在（无法就地创建）→ 安全返回 PROPOSED/未变', async () => {
    wfFindUnique.mockResolvedValue(null)
    propFindFirst.mockResolvedValue(null)
    const r = await advanceIntroductionWorkflow({
      organizationId: ORG,
      proposalId: 'p_x',
      event: 'INTRODUCED',
      reason: 'x',
      now: NOW,
    })
    expect(r).toEqual({ stage: 'PROPOSED', changed: false })
  })
})

describe('T06 · getIntroductionWorkflow（含停滞检测）', () => {
  it('不存在 → null', async () => {
    wfFindFirst.mockResolvedValue(null)
    expect(await getIntroductionWorkflow(ORG, 'p_x', NOW)).toBeNull()
  })

  it('存在 → 解析时间线；进入阶段超过 7 天 → stalled:true', async () => {
    wfFindFirst.mockResolvedValue(
      wfRow({ stage: 'COORDINATING', stageEnteredAt: new Date(NOW.getTime() - 10 * 24 * 3600_000) })
    )
    const v = await getIntroductionWorkflow(ORG, 'p_1', NOW)
    expect(v?.stage).toBe('COORDINATING')
    expect(v?.timeline).toHaveLength(1)
    expect(v?.stalled).toBe(true)
  })

  it('刚进入阶段 → stalled:false', async () => {
    wfFindFirst.mockResolvedValue(wfRow({ stage: 'COORDINATING', stageEnteredAt: NOW }))
    const v = await getIntroductionWorkflow(ORG, 'p_1', NOW)
    expect(v?.stalled).toBe(false)
  })
})
