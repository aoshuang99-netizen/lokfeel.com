/**
 * T06 · outbox 引擎（服务层）—— AC-07 幂等 / AC-17 崩溃恢复的主力用例
 *
 * 直接调用导出的函数、`@/lib/db` 全量 mock（不启数据库），因此可以精确构造
 * "两个 worker 同时领取""租约过期""连续失败到耗尽"这些在真库里很贵的场景。
 *
 * ⚠️ 本层证不了的东西（交给 E2E）：真实 SQL 的 CAS 语义（`updateMany` 的 where
 *    在真库里是否真的阻止了双写）。这里断言的是"我们把哪些谓词交给了 CAS"。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    workflowJob: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
    notificationDelivery: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    notification: { create: jest.fn() },
    connectionProposal: { findFirst: jest.fn() },
    introductionWorkflow: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    organization: { findUnique: jest.fn() },
    mission: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

// 只替换掉"有副作用的那一个" —— encode/decode 用真实实现，避免测试里再造一套 JSON 语义。
jest.mock('@/lib/connection', () => {
  const actual = jest.requireActual('@/lib/connection')
  return { ...actual, introduceConnection: jest.fn() }
})

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { introduceConnection } from '@/lib/connection'
import type { TenantContext } from '@/lib/tenancy'
import {
  cancelJobsForProposal,
  claimJobs,
  enqueueJob,
  executeJob,
  requeueJobManually,
  runWorkflowTick,
  takeOverJob,
  type ClaimedJob,
} from '@/lib/workflow'

const jobCreate = db.workflowJob.create as unknown as jest.Mock
const jobFindUnique = db.workflowJob.findUnique as unknown as jest.Mock
const jobFindFirst = db.workflowJob.findFirst as unknown as jest.Mock
const jobFindMany = db.workflowJob.findMany as unknown as jest.Mock
const jobUpdateMany = db.workflowJob.updateMany as unknown as jest.Mock
const delFindUnique = db.notificationDelivery.findUnique as unknown as jest.Mock
const delUpsert = db.notificationDelivery.upsert as unknown as jest.Mock
const delCount = db.notificationDelivery.count as unknown as jest.Mock
const notifCreate = db.notification.create as unknown as jest.Mock
const propFindFirst = db.connectionProposal.findFirst as unknown as jest.Mock
const wfFindUnique = db.introductionWorkflow.findUnique as unknown as jest.Mock
const wfCreate = db.introductionWorkflow.create as unknown as jest.Mock
const wfUpdateMany = db.introductionWorkflow.updateMany as unknown as jest.Mock
const orgFindUnique = db.organization.findUnique as unknown as jest.Mock
const missionFindUnique = db.mission.findUnique as unknown as jest.Mock
const userFindUnique = db.user.findUnique as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const introduceMock = introduceConnection as unknown as jest.Mock

const ORG = 'org_1'
const NOW = new Date('2026-10-12T00:00:00.000Z')
const OP = 'u_op'
const ME = 'u_me'

function ctx(role: TenantContext['role'] = 'ADMIN'): TenantContext {
  return { organizationId: ORG, userId: 'u_admin', role, membershipId: 'ms_admin' }
}

function job(over: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: 'j_1',
    organizationId: ORG,
    dedupeKey: 'introduce:p_1',
    kind: 'INTRODUCE_CONNECTION',
    proposalId: 'p_1',
    missionId: 'm_1',
    payloadRaw: null,
    attempts: 0,
    maxAttempts: 5,
    ...over,
  }
}

function proposalRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p_1',
    organizationId: ORG,
    missionId: 'm_1',
    proposerId: OP,
    candidateId: ME,
    status: 'MUTUALLY_ACCEPTED',
    introducedAt: null,
    rationale: '你们互补：他需要印尼渠道，你有印尼渠道。',
    ...over,
  }
}

/** 把"投递能跑通"的最小桩集装上（INTRODUCE 成功路径要这些）。 */
function stubDeliveryHappyPath() {
  delFindUnique.mockResolvedValue(null)
  delUpsert.mockResolvedValue({ id: 'nd_1' })
  notifCreate.mockResolvedValue({ id: 'n_1' })
  orgFindUnique.mockResolvedValue({ name: '示例社群' })
  missionFindUnique.mockResolvedValue({ title: '出海对接', shareToken: 'tok_1' })
  userFindUnique.mockResolvedValue({ email: 'member@example.test' })
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  jobUpdateMany.mockResolvedValue({ count: 1 })
  wfUpdateMany.mockResolvedValue({ count: 1 })
  wfFindUnique.mockResolvedValue(null)
  wfCreate.mockResolvedValue({ id: 'wf_1' })
  delCount.mockResolvedValue(0)
  stubDeliveryHappyPath()
})

// ═══════════════════════════════════════════════════════════════
// 入队（AC-07）
// ═══════════════════════════════════════════════════════════════

describe('T06 · enqueueJob（AC-07 幂等入队）', () => {
  it('首次入队 → PENDING + 正确幂等键 + created:true', async () => {
    jobCreate.mockResolvedValue({ id: 'j_1' })
    const r = await enqueueJob(
      { organizationId: ORG, kind: 'PROPOSAL_CREATED', proposalId: 'p_1', recipientId: ME },
      NOW
    )
    expect(r).toEqual({ id: 'j_1', created: true, dedupeKey: 'proposal-created:p_1:u_me' })
    const data = jobCreate.mock.calls[0][0].data
    expect(data.status).toBe('PENDING')
    expect(data.attempts).toBe(0)
    expect(data.maxAttempts).toBe(5)
    expect(data.nextAttemptAt).toEqual(NOW)
  })

  it('★AC-07 撞唯一键（重复入队）→ created:false，**不**重置状态', async () => {
    // 关键：不用 upsert。否则已 SUCCEEDED 的任务会被重置回 PENDING → 重复发通知。
    jobCreate.mockRejectedValue(new Error('UNIQUE constraint failed'))
    jobFindUnique.mockResolvedValue({ id: 'j_existing' })

    const r = await enqueueJob(
      { organizationId: ORG, kind: 'PROPOSAL_CREATED', proposalId: 'p_1', recipientId: ME },
      NOW
    )
    expect(r).toEqual({ id: 'j_existing', created: false, dedupeKey: 'proposal-created:p_1:u_me' })
    // 从未调用 update 把它复活
    expect(jobUpdateMany).not.toHaveBeenCalled()
  })

  it('delayMs>0 → nextAttemptAt 推迟（跟进任务 3 天后才可领）', async () => {
    jobCreate.mockResolvedValue({ id: 'j_1' })
    await enqueueJob(
      { organizationId: ORG, kind: 'COORDINATION_FOLLOWUP', proposalId: 'p_1', recipientId: ME, delayMs: 1000 },
      NOW
    )
    expect(jobCreate.mock.calls[0][0].data.nextAttemptAt.getTime()).toBe(NOW.getTime() + 1000)
  })

  it('唯一键冲突但读不回既有行 → 原样抛出（不假装成功）', async () => {
    jobCreate.mockRejectedValue(new Error('boom'))
    jobFindUnique.mockResolvedValue(null)
    await expect(
      enqueueJob({ organizationId: ORG, kind: 'INTRODUCE_CONNECTION', proposalId: 'p_1' }, NOW)
    ).rejects.toThrow('boom')
  })
})

// ═══════════════════════════════════════════════════════════════
// 领取（CAS + 租约）
// ═══════════════════════════════════════════════════════════════

describe('T06 · claimJobs（CAS + 租约）', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    id: 'j_1',
    organizationId: ORG,
    dedupeKey: 'introduce:p_1',
    kind: 'INTRODUCE_CONNECTION',
    status: 'PENDING',
    lockedUntil: null,
    nextAttemptAt: NOW,
    proposalId: 'p_1',
    missionId: 'm_1',
    payload: null,
    attempts: 0,
    maxAttempts: 5,
    ...over,
  })

  it('查询谓词同时包含 PENDING（到期）与 RUNNING（租约过期）', async () => {
    jobFindMany.mockResolvedValue([])
    await claimJobs({ workerId: 'w1', limit: 5, now: NOW })
    const where = jobFindMany.mock.calls[0][0].where
    expect(where.organizationId).toBeUndefined() // 不限租户=全租户扫描
    expect(where.OR).toEqual([
      { status: 'PENDING', nextAttemptAt: { lte: NOW } },
      { status: 'RUNNING', lockedUntil: { lt: NOW } },
    ])
  })

  it('CAS 命中（count=1）→ 领取成功，写入 RUNNING + workerId + 租约', async () => {
    jobFindMany.mockResolvedValue([candidate()])
    jobUpdateMany.mockResolvedValue({ count: 1 })

    const claimed = await claimJobs({ workerId: 'w1', limit: 5, now: NOW })
    expect(claimed).toHaveLength(1)
    expect(claimed[0].id).toBe('j_1')

    const upd = jobUpdateMany.mock.calls[0][0]
    // where 带上"读到的状态与租约值" → 只有没人改过才会成功
    expect(upd.where).toMatchObject({ id: 'j_1', status: 'PENDING', lockedUntil: null, nextAttemptAt: NOW })
    expect(upd.data.status).toBe('RUNNING')
    expect(upd.data.lockedBy).toBe('w1')
    expect(upd.data.lockedUntil.getTime()).toBe(NOW.getTime() + 60_000)
  })

  it('★AC-07 CAS 未命中（count=0，被别人抢走）→ 安静跳过，不算错误', async () => {
    jobFindMany.mockResolvedValue([candidate()])
    jobUpdateMany.mockResolvedValue({ count: 0 })
    const claimed = await claimJobs({ workerId: 'w1', limit: 5, now: NOW })
    expect(claimed).toEqual([])
  })

  it('★AC-17 崩溃恢复：租约过期的 RUNNING 任务能被新 worker 领取', async () => {
    jobFindMany.mockResolvedValue([
      candidate({ status: 'RUNNING', lockedUntil: new Date(NOW.getTime() - 1), attempts: 1 }),
    ])
    jobUpdateMany.mockResolvedValue({ count: 1 })
    const claimed = await claimJobs({ workerId: 'w2', limit: 5, now: NOW })
    expect(claimed).toHaveLength(1)
    expect(claimed[0].attempts).toBe(1)
    // 新 worker 重新加了租约
    expect(jobUpdateMany.mock.calls[0][0].data.lockedBy).toBe('w2')
  })

  it('limit<=0 → 直接返回空，不查库', async () => {
    const claimed = await claimJobs({ workerId: 'w1', limit: 0, now: NOW })
    expect(claimed).toEqual([])
    expect(jobFindMany).not.toHaveBeenCalled()
  })

  it('limit 上限：只领取 limit 条（即使候选更多）', async () => {
    jobFindMany.mockResolvedValue([
      candidate({ id: 'j_1' }),
      candidate({ id: 'j_2' }),
      candidate({ id: 'j_3' }),
    ])
    jobUpdateMany.mockResolvedValue({ count: 1 })
    const claimed = await claimJobs({ workerId: 'w1', limit: 2, now: NOW })
    expect(claimed.map((c) => c.id)).toEqual(['j_1', 'j_2'])
  })
})

// ═══════════════════════════════════════════════════════════════
// 执行 · INTRODUCE_CONNECTION
// ═══════════════════════════════════════════════════════════════

describe('T06 · executeJob · INTRODUCE_CONNECTION', () => {
  it('提案不存在 → SUPERSEDED（记 CANCELLED，不是 FAILED）', async () => {
    propFindFirst.mockResolvedValue(null)
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('SUPERSEDED')
    expect(jobUpdateMany.mock.calls.at(-1)![0].data.status).toBe('CANCELLED')
  })

  it('★AC-05 提案已 REJECTED → SUPERSEDED（不该发的不发）', async () => {
    propFindFirst.mockResolvedValue(proposalRow({ status: 'REJECTED' }))
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('SUPERSEDED')
    expect(introduceMock).not.toHaveBeenCalled()
    expect(jobUpdateMany.mock.calls.at(-1)![0].data.status).toBe('CANCELLED')
  })

  it('★AC-05 提案已 REVOKED → SUPERSEDED', async () => {
    propFindFirst.mockResolvedValue(proposalRow({ status: 'REVOKED' }))
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('SUPERSEDED')
    expect(introduceMock).not.toHaveBeenCalled()
  })

  it('非双方同意（且非明确拒绝/撤销）→ permanent → FAILED（需人看，重试无意义）', async () => {
    propFindFirst.mockResolvedValue(proposalRow({ status: 'CONSENT_PENDING' }))
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('FAILED')
    expect(jobUpdateMany.mock.calls.at(-1)![0].data.status).toBe('FAILED')
    expect(introduceMock).not.toHaveBeenCalled()
  })

  it('★ 已介绍过（introducedAt 非空）→ 补投递，不判 superseded（通知不能永久丢）', async () => {
    propFindFirst.mockResolvedValue(proposalRow({ introducedAt: NOW }))
    // 工作流已存在，推进为幂等 no-op
    wfFindUnique.mockResolvedValue({
      id: 'wf_1',
      proposalId: 'p_1',
      organizationId: ORG,
      missionId: 'm_1',
      stage: 'INTRODUCED',
      timeline: '[]',
      stageEnteredAt: NOW,
    })

    const r = await executeJob(job(), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('SUCCEEDED')
    // 不再调 introduceConnection（已经介绍过），但**发了**通知（补投递）
    expect(introduceMock).not.toHaveBeenCalled()
    expect(delUpsert).toHaveBeenCalled()
  })

  it('★AC-14 成功路径：调用 introduceConnection（正是 T05 那一个函数）→ 推进阶段 → 通知双方', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    membershipFindFirst.mockResolvedValue({ id: 'ms_op', role: 'OPERATOR' })
    wfFindUnique.mockResolvedValue({
      id: 'wf_1',
      proposalId: 'p_1',
      organizationId: ORG,
      missionId: 'm_1',
      stage: 'CONSENT_PENDING',
      timeline: '[]',
      stageEnteredAt: NOW,
    })
    introduceMock.mockResolvedValue({ introducedAt: NOW })

    const r = await executeJob(job(), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('SUCCEEDED')

    // ① 介绍**原样**调用 T05 的 introduceConnection（不另写一份校验）
    expect(introduceMock).toHaveBeenCalledTimes(1)
    const [callCtx, callProposalId] = introduceMock.mock.calls[0]
    expect(callProposalId).toBe('p_1')
    // 以**发起提案的运营**身份执行（不是系统万能身份）
    expect(callCtx).toMatchObject({ organizationId: ORG, userId: OP, role: 'OPERATOR' })

    // ② 阶段推进到 INTRODUCED
    expect(wfUpdateMany.mock.calls[0][0].data.stage).toBe('INTRODUCED')

    // ③ 双方各收到 IN_APP + EMAIL 两条投递 → upsert 4 次
    expect(delUpsert).toHaveBeenCalledTimes(4)
  })

  it('★ 发起提案的运营已离职/降级 → permanent → FAILED（等人工接管，不越权代做）', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    membershipFindFirst.mockResolvedValue(null)
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('FAILED')
    expect(introduceMock).not.toHaveBeenCalled()
  })

  it('★ T05 的 ConflictError(already_introduced) → superseded（不是失败）', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    membershipFindFirst.mockResolvedValue({ id: 'ms_op', role: 'OPERATOR' })
    introduceMock.mockRejectedValue(new ConflictError('already introduced', { blockers: ['already_introduced'] }))

    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('SUPERSEDED')
    expect(jobUpdateMany.mock.calls.at(-1)![0].data.status).toBe('CANCELLED')
  })

  it('★ 一方意图失效（*_intent_not_live）→ superseded（AC-06 的正当拒绝）', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    membershipFindFirst.mockResolvedValue({ id: 'ms_op', role: 'OPERATOR' })
    introduceMock.mockRejectedValue(
      new ConflictError('conflict', { blockers: ['candidate_intent_not_live'] })
    )
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('SUPERSEDED')
  })

  it('★ 并发争抢：仍是 MUTUALLY_ACCEPTED 却 CAS 冲突 → retryable → RETRY', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    membershipFindFirst.mockResolvedValue({ id: 'ms_op', role: 'OPERATOR' })
    introduceMock.mockRejectedValue(new ConflictError('cas conflict'))
    // 重读现状仍是 MUTUALLY_ACCEPTED、未介绍、未过期
    propFindFirst
      .mockResolvedValueOnce(proposalRow())
      .mockResolvedValueOnce(proposalRow())
      .mockResolvedValueOnce({ status: 'MUTUALLY_ACCEPTED', introducedAt: null, expiresAt: null })

    const r = await executeJob(job({ attempts: 0 }), { now: NOW })
    expect(r.outcome).toBe('RETRY')
    expect(r.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('介绍 NotFoundError → superseded（提案已被删）', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    membershipFindFirst.mockResolvedValue({ id: 'ms_op', role: 'OPERATOR' })
    introduceMock.mockRejectedValue(new NotFoundError('Proposal not found'))
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('SUPERSEDED')
  })

  it('介绍 ForbiddenError → permanent → FAILED', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    membershipFindFirst.mockResolvedValue({ id: 'ms_op', role: 'OPERATOR' })
    introduceMock.mockRejectedValue(new ForbiddenError('nope'))
    const r = await executeJob(job(), { now: NOW })
    expect(r.outcome).toBe('FAILED')
  })

  it('缺 proposalId → permanent → FAILED（载荷非法）', async () => {
    const r = await executeJob(job({ proposalId: null }), { now: NOW })
    expect(r.outcome).toBe('FAILED')
  })
})

// ═══════════════════════════════════════════════════════════════
// 执行 · 通知类 + 失败分类
// ═══════════════════════════════════════════════════════════════

describe('T06 · executeJob · 通知类与失败分类', () => {
  const notifyJob = (over: Partial<ClaimedJob> = {}) =>
    job({
      kind: 'PROPOSAL_CREATED',
      dedupeKey: 'proposal-created:p_1:u_me',
      payloadRaw: JSON.stringify({ recipientId: ME }),
      ...over,
    })

  it('提案不存在 → SUPERSEDED', async () => {
    propFindFirst.mockResolvedValue(null)
    const r = await executeJob(notifyJob(), { now: NOW })
    expect(r.outcome).toBe('SUPERSEDED')
  })

  it('★AC-05 提案已撤销 → SUPERSEDED（待发通知不出街）', async () => {
    propFindFirst.mockResolvedValue(proposalRow({ status: 'REVOKED' }))
    const r = await executeJob(notifyJob(), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('SUPERSEDED')
    expect(delUpsert).not.toHaveBeenCalled()
  })

  it('正常通知：IN_APP 真实落库 + EMAIL 沙箱捕获，各留痕一次', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    const r = await executeJob(notifyJob(), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('SUCCEEDED')
    expect(notifCreate).toHaveBeenCalledTimes(1) // 站内信
    expect(delUpsert).toHaveBeenCalledTimes(2) // IN_APP + EMAIL
  })

  it('payload 缺 recipientId → permanent → FAILED（载荷非法）', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    const r = await executeJob(notifyJob({ payloadRaw: null }), { now: NOW })
    expect(r.outcome).toBe('FAILED')
  })

  it('★ 暂时性失败（DB 抖动）→ RETRY，attempts+1 且推进 nextAttemptAt', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    notifCreate.mockRejectedValue(new Error('ECONNRESET')) // 未知错误 → 默认 retryable
    const r = await executeJob(notifyJob({ attempts: 0 }), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('RETRY')
    expect(r.attempts).toBe(1)
    const data = jobUpdateMany.mock.calls.at(-1)![0].data
    expect(data.status).toBe('PENDING')
    expect(data.attempts).toBe(1)
    expect(data.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('★AC-17 重试预算用尽 → DEAD（进死信等人接管，而非无限重试）', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    notifCreate.mockRejectedValue(new Error('still down'))
    const r = await executeJob(notifyJob({ attempts: 4, maxAttempts: 5 }), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('DEAD')
    const data = jobUpdateMany.mock.calls.at(-1)![0].data
    expect(data.status).toBe('DEAD')
    expect(data.deadLetteredAt).toEqual(NOW)
  })

  it('★ 内容泄漏（NotificationLeakError）→ permanent → FAILED，且**不重试**', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    // 让 upsert 抛泄漏错（模拟 delivery 守卫命中）—— 归一化后应归 permanent
    const { NotificationLeakError } = await import('@/lib/workflow/notification-content')
    delUpsert.mockRejectedValue(new NotificationLeakError('proposal.pending', 40))
    notifCreate.mockRejectedValue(new NotificationLeakError('proposal.pending', 40))

    const r = await executeJob(notifyJob({ attempts: 0 }), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('FAILED')
    expect(r.attempts).toBe(1)
  })

  it('收尾 CAS 未命中（count=0，租约被接管）→ 记 LOST，不覆盖他人结论', async () => {
    propFindFirst.mockResolvedValue(proposalRow())
    jobUpdateMany.mockResolvedValue({ count: 0 })
    const r = await executeJob(notifyJob(), { now: NOW, emailSender: null })
    expect(r.outcome).toBe('LOST')
  })
})

// ═══════════════════════════════════════════════════════════════
// 人工接管 / 手动重试 / 取消（AC-05 / AC-17）
// ═══════════════════════════════════════════════════════════════

describe('T06 · takeOverJob（workflow.manage）', () => {
  it('🔒 无 workflow.manage（OPERATOR）→ ForbiddenError，且不触达 DB', async () => {
    await expect(takeOverJob(ctx('OPERATOR'), 'j_1', null, NOW)).rejects.toBeInstanceOf(ForbiddenError)
    expect(jobFindFirst).not.toHaveBeenCalled()
  })

  it('任务不存在 → NotFoundError', async () => {
    jobFindFirst.mockResolvedValue(null)
    await expect(takeOverJob(ctx('ADMIN'), 'j_x', null, NOW)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('接管非终态任务 → TAKEN_OVER + 记录接管人', async () => {
    jobFindFirst.mockResolvedValue({ id: 'j_1', status: 'DEAD' })
    jobUpdateMany.mockResolvedValue({ count: 1 })
    await takeOverJob(ctx('ADMIN'), 'j_1', '先别发', NOW)
    const upd = jobUpdateMany.mock.calls[0][0]
    expect(upd.data.status).toBe('TAKEN_OVER')
    expect(upd.data.takenOverBy).toBe('u_admin')
    expect(upd.where.status.in).toEqual(['PENDING', 'RUNNING', 'DEAD', 'FAILED'])
  })

  it('已终态（CAS count=0）→ ConflictError（接管无意义）', async () => {
    jobFindFirst.mockResolvedValue({ id: 'j_1', status: 'SUCCEEDED' })
    jobUpdateMany.mockResolvedValue({ count: 0 })
    await expect(takeOverJob(ctx('ADMIN'), 'j_1', null, NOW)).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('T06 · requeueJobManually（workflow.manage）', () => {
  it('🔒 无权限 → ForbiddenError', async () => {
    await expect(requeueJobManually(ctx('OPERATOR'), 'j_1', NOW)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('只对 DEAD/FAILED/TAKEN_OVER 可重置（谓词正确）', async () => {
    jobUpdateMany.mockResolvedValue({ count: 1 })
    await requeueJobManually(ctx('ADMIN'), 'j_1', NOW)
    const upd = jobUpdateMany.mock.calls[0][0]
    expect(upd.where.status.in).toEqual(['DEAD', 'FAILED', 'TAKEN_OVER'])
    expect(upd.data.status).toBe('PENDING')
    expect(upd.data.attempts).toBe(0) // 人明确要求再试 → 允许重置预算
  })

  it('非可重试状态（count=0）→ ConflictError', async () => {
    jobUpdateMany.mockResolvedValue({ count: 0 })
    await expect(requeueJobManually(ctx('ADMIN'), 'j_1', NOW)).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('T06 · cancelJobsForProposal（AC-05）', () => {
  it('只取消 PENDING/RUNNING/DEAD —— 已 SUCCEEDED 的事不可撤回', async () => {
    jobUpdateMany.mockResolvedValue({ count: 3 })
    const n = await cancelJobsForProposal({ organizationId: ORG, proposalId: 'p_1', reason: 'revoked', now: NOW })
    expect(n).toBe(3)
    const upd = jobUpdateMany.mock.calls[0][0]
    expect(upd.where.proposalId).toBe('p_1')
    expect(upd.where.status.in).toEqual(['PENDING', 'RUNNING', 'DEAD'])
    expect(upd.data.status).toBe('CANCELLED')
  })

  it('没有待发任务 → 返回 0 且不写审计', async () => {
    jobUpdateMany.mockResolvedValue({ count: 0 })
    const n = await cancelJobsForProposal({ organizationId: ORG, proposalId: 'p_1', reason: 'revoked' })
    expect(n).toBe(0)
    expect(auditCreate).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════
// tick
// ═══════════════════════════════════════════════════════════════

describe('T06 · runWorkflowTick', () => {
  it('领取 + 逐个执行，并按结果分类计数', async () => {
    jobFindMany.mockResolvedValue([
      {
        id: 'j_1',
        organizationId: ORG,
        dedupeKey: 'proposal-created:p_1:u_me',
        kind: 'PROPOSAL_CREATED',
        status: 'PENDING',
        lockedUntil: null,
        nextAttemptAt: NOW,
        proposalId: 'p_1',
        missionId: 'm_1',
        payload: JSON.stringify({ recipientId: ME }),
        attempts: 0,
        maxAttempts: 5,
      },
      {
        id: 'j_2',
        organizationId: ORG,
        dedupeKey: 'introduce:p_9',
        kind: 'INTRODUCE_CONNECTION',
        status: 'PENDING',
        lockedUntil: null,
        nextAttemptAt: NOW,
        proposalId: 'p_9',
        missionId: 'm_1',
        payload: null,
        attempts: 0,
        maxAttempts: 5,
      },
    ])
    jobUpdateMany.mockResolvedValue({ count: 1 })
    // j_1：提案存在 → 成功；j_2：提案不存在 → superseded
    propFindFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'p_1' ? proposalRow() : null)
    )

    const report = await runWorkflowTick({ now: NOW, emailSender: null, limit: 10 })
    expect(report.claimed).toBe(2)
    expect(report.succeeded).toBe(1)
    expect(report.superseded).toBe(1)
    expect(report.budgetExhausted).toBe(false)
  })

  it('没有可领任务 → 全零报告', async () => {
    jobFindMany.mockResolvedValue([])
    const report = await runWorkflowTick({ now: NOW })
    expect(report.claimed).toBe(0)
    expect(report.succeeded).toBe(0)
  })
})
