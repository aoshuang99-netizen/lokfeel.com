/**
 * T06 · 业务钩子 —— 把 T05 的业务事件翻译成工作流任务
 *
 * 钩子的两个必须成立的性质：
 *   ① **不抛错**：入队失败只记进 errors，绝不把已成功的业务操作变成 500；
 *   ② **状态重读**：凭数据库现状（而不是入参）决定"要不要排介绍"，
 *      因此单方 ACCEPT（仍是 CONSENT_PENDING）不会误排介绍任务（AC-04）。
 *
 * 为了聚焦钩子的**翻译逻辑**，这里把 runtime / workflow 两个下游模块 mock 掉，
 * 只断言"给它派了什么活"。下游自身的行为各由自己的测试覆盖。
 */

jest.mock('@/lib/db', () => ({
  db: {
    connectionProposal: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}))

jest.mock('@/lib/workflow/runtime', () => ({
  enqueueJob: jest.fn(),
  cancelJobsForProposal: jest.fn(),
}))

jest.mock('@/lib/workflow/workflow', () => ({
  ensureIntroductionWorkflow: jest.fn(),
  advanceIntroductionWorkflow: jest.fn(),
}))

import { db } from '@/lib/db'
import { enqueueJob, cancelJobsForProposal } from '@/lib/workflow/runtime'
import { advanceIntroductionWorkflow, ensureIntroductionWorkflow } from '@/lib/workflow/workflow'
import {
  FOLLOWUP_DELAY_MS,
  onConnectionIntroduced,
  onConsentDecided,
  onProposalCreated,
  reconcileMissingJobs,
} from '@/lib/workflow/hooks'

const propFindFirst = db.connectionProposal.findFirst as unknown as jest.Mock
const propFindMany = db.connectionProposal.findMany as unknown as jest.Mock
const enqueueMock = enqueueJob as unknown as jest.Mock
const cancelMock = cancelJobsForProposal as unknown as jest.Mock
const ensureMock = ensureIntroductionWorkflow as unknown as jest.Mock
const advanceMock = advanceIntroductionWorkflow as unknown as jest.Mock

const ORG = 'org_1'
const OP = 'u_op'
const ME = 'u_me'
const NOW = new Date('2026-10-12T00:00:00.000Z')

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p_1',
    organizationId: ORG,
    missionId: 'm_1',
    proposerId: OP,
    candidateId: ME,
    status: 'CONSENT_PENDING',
    introducedAt: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ensureMock.mockResolvedValue({ id: 'wf_1', created: true })
  advanceMock.mockResolvedValue({ stage: 'INTRODUCED', changed: true })
  enqueueMock.mockResolvedValue({ id: 'j_1', created: true, dedupeKey: 'k' })
  cancelMock.mockResolvedValue(0)
})

describe('T06 · onProposalCreated', () => {
  it('建工作流实例 + 只通知**被介绍方**（发起方不需要系统再告诉一遍）', async () => {
    propFindFirst.mockResolvedValue(row())
    const r = await onProposalCreated({ id: 'p_1', organizationId: ORG }, NOW)

    expect(ensureMock).toHaveBeenCalledTimes(1)
    expect(ensureMock.mock.calls[0][0]).toMatchObject({
      organizationId: ORG,
      proposalId: 'p_1',
      missionId: 'm_1',
      by: OP,
    })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const jobInput = enqueueMock.mock.calls[0][0]
    expect(jobInput.kind).toBe('PROPOSAL_CREATED')
    expect(jobInput.recipientId).toBe(ME)
    expect(jobInput.payload.recipientId).toBe(ME)
    expect(r.enqueued).toEqual(['j_1'])
    expect(r.errors).toEqual([])
  })

  it('★ 提案读不到 → 安静返回（不抛错），errors 里留痕', async () => {
    propFindFirst.mockResolvedValue(null)
    const r = await onProposalCreated({ id: 'p_x', organizationId: ORG }, NOW)
    expect(r.enqueued).toEqual([])
    expect(ensureMock).not.toHaveBeenCalled()
  })

  it('★ 入队失败不抛出：记进 errors，业务不受影响', async () => {
    propFindFirst.mockResolvedValue(row())
    enqueueMock.mockRejectedValue(new Error('queue down'))
    const r = await onProposalCreated({ id: 'p_1', organizationId: ORG }, NOW)
    expect(r.enqueued).toEqual([])
    expect(r.errors.join('|')).toContain('queue down')
  })

  it('★ 读库本身抛错也不抛给调用方（否则会把已成功的提案创建变成 500）', async () => {
    propFindFirst.mockRejectedValue(new Error('db down'))
    await expect(onProposalCreated({ id: 'p_1', organizationId: ORG }, NOW)).resolves.toMatchObject({
      enqueued: [],
    })
  })
})

describe('T06 · onConsentDecided', () => {
  it('★AC-04 单方 ACCEPT（仍 CONSENT_PENDING）→ 不排介绍，只通知对方', async () => {
    propFindFirst.mockResolvedValue(row({ status: 'CONSENT_PENDING' }))
    const r = await onConsentDecided(
      { id: 'p_1', organizationId: ORG },
      { actorId: OP, decision: 'ACCEPT' },
      NOW
    )
    // 由于我的表态，对方是 candidate
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0].kind).toBe('CONSENT_ACCEPTED')
    expect(enqueueMock.mock.calls[0][0].recipientId).toBe(ME)
    // 没有任何 INTRODUCE_CONNECTION
    expect(enqueueMock.mock.calls.some((c) => c[0].kind === 'INTRODUCE_CONNECTION')).toBe(false)
    expect(advanceMock.mock.calls[0][0].event).toBe('CONSENT_RECORDED')
    void r
  })

  it('★AC-14 双方同意 → 通知对方 + 排入介绍（提案级，不带 recipientId）', async () => {
    propFindFirst.mockResolvedValue(row({ status: 'MUTUALLY_ACCEPTED' }))
    await onConsentDecided({ id: 'p_1', organizationId: ORG }, { actorId: ME, decision: 'ACCEPT' }, NOW)

    const kinds = enqueueMock.mock.calls.map((c) => c[0].kind)
    expect(kinds).toContain('CONSENT_ACCEPTED')
    expect(kinds).toContain('INTRODUCE_CONNECTION')

    const intro = enqueueMock.mock.calls.find((c) => c[0].kind === 'INTRODUCE_CONNECTION')![0]
    expect(intro.recipientId).toBeUndefined() // 提案级原子动作
    expect(advanceMock.mock.calls[0][0].event).toBe('MUTUALLY_ACCEPTED')
  })

  it('表态人是 candidate 时，通知的是 proposer（对侧计算正确）', async () => {
    propFindFirst.mockResolvedValue(row())
    await onConsentDecided({ id: 'p_1', organizationId: ORG }, { actorId: ME, decision: 'ACCEPT' }, NOW)
    expect(enqueueMock.mock.calls[0][0].recipientId).toBe(OP)
  })

  it('★AC-05 REJECT → 取消待发任务，且**不**通知、**不**排介绍', async () => {
    propFindFirst.mockResolvedValue(row({ status: 'REJECTED' }))
    cancelMock.mockResolvedValue(2)
    const r = await onConsentDecided(
      { id: 'p_1', organizationId: ORG },
      { actorId: ME, decision: 'REJECT' },
      NOW
    )
    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock.mock.calls[0][0]).toMatchObject({ proposalId: 'p_1', reason: 'proposal_reject' })
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(advanceMock).not.toHaveBeenCalled()
    expect(r.cancelled).toBe(2)
  })

  it('★AC-05 REVOKE → 同样取消待发任务', async () => {
    propFindFirst.mockResolvedValue(row({ status: 'REVOKED' }))
    await onConsentDecided({ id: 'p_1', organizationId: ORG }, { actorId: ME, decision: 'REVOKE' }, NOW)
    expect(cancelMock.mock.calls[0][0].reason).toBe('proposal_revoke')
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

describe('T06 · onConnectionIntroduced', () => {
  it('★AC-14 推进到 INTRODUCED + 给双方各排一条**延迟**跟进', async () => {
    propFindFirst.mockResolvedValue(row({ status: 'MUTUALLY_ACCEPTED', introducedAt: NOW }))
    const r = await onConnectionIntroduced({ id: 'p_1', organizationId: ORG }, NOW)

    expect(advanceMock.mock.calls[0][0].event).toBe('INTRODUCED')
    const followups = enqueueMock.mock.calls.filter((c) => c[0].kind === 'COORDINATION_FOLLOWUP')
    expect(followups).toHaveLength(2)
    expect(followups.map((c) => c[0].recipientId).sort()).toEqual([OP, ME].sort())
    for (const f of followups) expect(f[0].delayMs).toBe(FOLLOWUP_DELAY_MS)
    expect(r.enqueued).toHaveLength(2)
  })
})

describe('T06 · reconcileMissingJobs（钩子非事务性的补偿）', () => {
  it('扫描"已双方同意但未介绍"的提案并补入队', async () => {
    propFindMany.mockResolvedValue([
      { id: 'p_1', organizationId: ORG, missionId: 'm_1' },
      { id: 'p_2', organizationId: ORG, missionId: 'm_1' },
    ])
    enqueueMock.mockResolvedValue({ id: 'j', created: true, dedupeKey: 'k' })

    const r = await reconcileMissingJobs({ now: NOW, limit: 20 })
    expect(r.scanned).toBe(2)
    expect(r.enqueued).toBe(2)

    const where = propFindMany.mock.calls[0][0].where
    expect(where.status).toBe('MUTUALLY_ACCEPTED')
    expect(where.introducedAt).toBeNull()
    expect(enqueueMock.mock.calls[0][0].kind).toBe('INTRODUCE_CONNECTION')
  })

  it('★ 已被人工取消/已死信的任务不会被复活：created:false 不计入 enqueued', async () => {
    propFindMany.mockResolvedValue([{ id: 'p_1', organizationId: ORG, missionId: 'm_1' }])
    enqueueMock.mockResolvedValue({ id: 'j_existing', created: false, dedupeKey: 'k' })
    const r = await reconcileMissingJobs({ now: NOW })
    expect(r.enqueued).toBe(0)
  })

  it('单条失败不影响其余（下一轮 tick 再试）', async () => {
    propFindMany.mockResolvedValue([
      { id: 'p_1', organizationId: ORG, missionId: 'm_1' },
      { id: 'p_2', organizationId: ORG, missionId: 'm_1' },
    ])
    enqueueMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ id: 'j', created: true })
    const r = await reconcileMissingJobs({ now: NOW })
    expect(r.scanned).toBe(2)
    expect(r.enqueued).toBe(1)
  })
})
