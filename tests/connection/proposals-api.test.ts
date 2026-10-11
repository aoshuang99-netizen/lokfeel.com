/**
 * T05 · Consent & Trust —— HTTP 层测试
 *
 * 与 `proposals.test.ts`（服务层）的分工：
 *   - 服务层测「状态机 / 可介绍性 / 投影」；
 *   - 本文件测**路由装配与端到端语义**：鉴权关卡、能力关卡（自助 vs 运营）、
 *     幂等键装配、以及三条 AC 在 HTTP 层的可观测形式：
 *       · AC-04 —— 单方同意 → 200，但 `state` 仍是 `CONSENT_PENDING`；
 *       · AC-05 —— 撤销/拒绝后再表态 → 409（**不是**幂等成功）；
 *       · AC-06 —— 介绍执行时校验，失败列出**全部** blockers；重复介绍 → 409。
 *   另含两条隐私断言：COUNTERPARTY 档只在**介绍落地后**才生效（档位升级）。
 *
 * 直接调用路由导出的 handler（不启服务），可离线确定性地覆盖状态码全谱系。
 *
 * ⚠️ **本层证不了路径形状**：handler 是直接 import 的、`params` 由测试手工构造，
 *    请求 URL **不参与路由匹配**。因此 `/connections/{connectionId}/consent` 这种
 *    "只有 3 段、**没有** `proposals` 中间段" 的形状，只有 **E2E**（真实浏览器 /
 *    `ctx.request` 打真实 URL）能证 —— 实现期正是在这里连错 3 次而**单测全绿**
 *    （见 `changes.md` §4 与 `risks.md` R10）。下面的 describe 名按真实路径书写，
 *    以免后人照着 4 段写法再去踩一次。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    connectionProposal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    proposalDecision: { findMany: jest.fn(), upsert: jest.fn() },
    socialIntent: { findFirst: jest.fn(), findMany: jest.fn() },
    mission: { findFirst: jest.fn(), findUnique: jest.fn() },
    missionParticipation: { findMany: jest.fn() },
    membership: { findFirst: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { UnauthorizedError } from '@/lib/errors'

import * as proposalsRoute from '@/app/api/v1/connections/proposals/route'
import * as consentRoute from '@/app/api/v1/connections/[connectionId]/consent/route'
import * as revokeRoute from '@/app/api/v1/connections/[connectionId]/revoke/route'
import * as introduceRoute from '@/app/api/v1/connections/[connectionId]/introduce/route'
import * as introductionsRoute from '@/app/api/v1/connections/introductions/route'

const requireAuthMock = requireAuth as unknown as jest.Mock
const propFindFirst = db.connectionProposal.findFirst as unknown as jest.Mock
const propFindMany = db.connectionProposal.findMany as unknown as jest.Mock
const propCreate = db.connectionProposal.create as unknown as jest.Mock
const propUpdate = db.connectionProposal.update as unknown as jest.Mock
const propUpdateMany = db.connectionProposal.updateMany as unknown as jest.Mock
const decisionFindMany = db.proposalDecision.findMany as unknown as jest.Mock
const decisionUpsert = db.proposalDecision.upsert as unknown as jest.Mock
const intentFindFirst = db.socialIntent.findFirst as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock
const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const partFindMany = db.missionParticipation.findMany as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const userFindUnique = db.user.findUnique as unknown as jest.Mock
const userFindMany = db.user.findMany as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const idemFindUnique = db.idempotencyRecord.findUnique as unknown as jest.Mock
const idemCreate = db.idempotencyRecord.create as unknown as jest.Mock
const txn = db.$transaction as unknown as jest.Mock

const ORG = 'org_1'
const ME = 'u_me' // 被介绍方（候选）
const OP = 'u_op' // 发起方（运营）

function proposalRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p_1',
    organizationId: ORG,
    missionId: 'm_1',
    proposerId: OP,
    candidateId: ME,
    status: 'CONSENT_PENDING',
    rationale: '你们互补：他需要东南亚渠道，你有本地清关资源。',
    expiresAt: null,
    introducedAt: null,
    closedAt: null,
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    updatedAt: new Date('2026-10-05T00:00:00.000Z'),
    ...over,
  }
}

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', userId = ME) {
  requireAuthMock.mockResolvedValue({ user: { id: userId } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

/** 对侧（另一名参与人）的档案 + 披露表：displayName 只授权给「匹配后的对手方」。 */
function stubCounterparty() {
  userFindUnique.mockResolvedValue({
    email: 'op-secret@example.test',
    profile: { displayName: '对手姓名', city: '上海', bio: '不应外泄的简介' },
  })
  intentFindFirst.mockResolvedValue({
    disclosure: '{"displayName":"COUNTERPARTY","city":"CANDIDATE"}',
    status: 'ACTIVE',
    expiresAt: null,
  })
}

const createBody = {
  missionId: 'm_1',
  candidateId: ME,
  rationale: '你们互补：他需要渠道，你有渠道。',
}

function post(url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function get(url: string) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET' })
}

const params = (obj: Record<string, string>) => ({ params: Promise.resolve(obj) })

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  decisionFindMany.mockResolvedValue([])
  intentFindMany.mockResolvedValue([])
  userFindMany.mockResolvedValue([])
  propUpdateMany.mockResolvedValue({ count: 1 })
  propUpdate.mockResolvedValue({})
  decisionUpsert.mockResolvedValue({})
  // $transaction 收到的是已经创建好的 promise 数组 —— 原样 await 即可。
  txn.mockImplementation((ops: unknown[]) => Promise.all(ops))
})

// ═══════════════════════════════════════════════════════════
// 发起提案
// ═══════════════════════════════════════════════════════════

describe('T05 · POST /api/v1/connections/proposals', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (proposalsRoute.POST as any)(
      post('/api/v1/connections/proposals', createBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    expect(res.status).toBe(401)
    expect(propCreate).not.toHaveBeenCalled()
  })

  it('🔒 MEMBER 无 proposal.create → 403（牵线是运营动作），且不触达 DB', async () => {
    asRole('MEMBER')
    const res = await (proposalsRoute.POST as any)(
      post('/api/v1/connections/proposals', createBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    expect(res.status).toBe(403)
    expect(propCreate).not.toHaveBeenCalled()
  })

  it('缺失 Idempotency-Key → 400，且不触达 DB', async () => {
    asRole('OPERATOR')
    const res = await (proposalsRoute.POST as any)(
      post('/api/v1/connections/proposals', createBody),
      undefined
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details).toEqual({ field: 'Idempotency-Key' })
    expect(propCreate).not.toHaveBeenCalled()
  })

  it('rationale 过短 → 400（8 字下限）', async () => {
    asRole('OPERATOR')
    const res = await (proposalsRoute.POST as any)(
      post('/api/v1/connections/proposals', { ...createBody, rationale: '太短' }, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('rationale')
  })

  it('OPERATOR → 201，且落库带 organizationId（租户由会话决定，不吃请求体）', async () => {
    asRole('OPERATOR', OP)
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindMany.mockResolvedValue([{ userId: OP }, { userId: ME }])
    propFindFirst.mockResolvedValue(null)
    propCreate.mockResolvedValue(proposalRow())
    idemFindUnique.mockResolvedValue(null)
    idemCreate.mockResolvedValue({})
    stubCounterparty()

    const res = await (proposalsRoute.POST as any)(
      post('/api/v1/connections/proposals', createBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(propCreate.mock.calls[0][0].data.organizationId).toBe(ORG)
    expect(propCreate.mock.calls[0][0].data.status).toBe('CONSENT_PENDING')
    expect(body.data.state).toBe('CONSENT_PENDING')
  })

  it('🔒 同键重放 → 201 + Idempotent-Replayed，且不产生第二条', async () => {
    asRole('OPERATOR', OP)
    const { hashRequest, parseProposalCreate } = await import('@/lib/connection/proposal-input')
    const { hashRequest: hash } = await import('@/lib/connection/idempotency')
    void hashRequest
    idemFindUnique.mockResolvedValue({
      requestHash: hash(parseProposalCreate(createBody)),
      resourceId: 'p_1',
    })
    propFindFirst.mockResolvedValue(proposalRow())
    stubCounterparty()

    const res = await (proposalsRoute.POST as any)(
      post('/api/v1/connections/proposals', createBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('Idempotent-Replayed')).toBe('true')
    expect(propCreate).not.toHaveBeenCalled()
  })

  it('同键异体 → 409', async () => {
    asRole('OPERATOR', OP)
    idemFindUnique.mockResolvedValue({ requestHash: 'other', resourceId: 'p_1' })
    const res = await (proposalsRoute.POST as any)(
      post('/api/v1/connections/proposals', createBody, { 'Idempotency-Key': 'k1' }),
      undefined
    )
    expect(res.status).toBe(409)
  })
})

// ═══════════════════════════════════════════════════════════
// 列出我的提案
// ═══════════════════════════════════════════════════════════

describe('T05 · GET /api/v1/connections/proposals', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (proposalsRoute.GET as any)(get('/api/v1/connections/proposals'), undefined)
    expect(res.status).toBe(401)
  })

  it('MEMBER 自助可用 → 200，谓词写死为「我是发起方或被介绍方」', async () => {
    asRole('MEMBER')
    propFindMany.mockResolvedValue([proposalRow()])
    decisionFindMany.mockResolvedValue([])
    userFindMany.mockResolvedValue([{ id: OP, email: 'op-secret@example.test', profile: { displayName: '对手姓名' } }])
    intentFindMany.mockResolvedValue([])

    const res = await (proposalsRoute.GET as any)(get('/api/v1/connections/proposals'), undefined)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.proposals).toHaveLength(1)

    const where = propFindMany.mock.calls[0][0].where
    expect(where.organizationId).toBe(ORG)
    expect(where.OR).toEqual([{ proposerId: ME }, { candidateId: ME }])
  })

  it('未知 state → 400（不静默忽略拼错的过滤值）', async () => {
    asRole('MEMBER')
    const res = await (proposalsRoute.GET as any)(
      get('/api/v1/connections/proposals?states=MUTUAL'),
      undefined
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('states')
  })

  it('limit=0 → 400', async () => {
    asRole('MEMBER')
    const res = await (proposalsRoute.GET as any)(
      get('/api/v1/connections/proposals?limit=0'),
      undefined
    )
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════
// 表态：consent
// ═══════════════════════════════════════════════════════════

describe('T05 · POST /api/v1/connections/{connectionId}/consent', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'accept' }),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(401)
  })

  it('decision 大小写不归一：`Accept` → 400', async () => {
    asRole('MEMBER')
    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'Accept' }),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('decision')
  })

  it('🔒 非参与方 → 403（服务层判定"不是这条提案的人"）', async () => {
    asRole('MEMBER', 'u_stranger')
    propFindFirst.mockResolvedValue(proposalRow())
    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'accept' }),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(403)
    expect(decisionUpsert).not.toHaveBeenCalled()
  })

  it('★AC-04 单方同意 → 200，但 state 仍为 CONSENT_PENDING（不产生介绍）', async () => {
    asRole('MEMBER', ME)
    propFindFirst
      .mockResolvedValueOnce(proposalRow()) // 本次写入前
      .mockResolvedValueOnce(proposalRow({ status: 'CONSENT_PENDING' })) // 写入后（仍是待决）
    decisionFindMany
      .mockResolvedValueOnce([]) // before：无人表态
      .mockResolvedValueOnce([{ personId: ME, decision: 'ACCEPT' }]) // after：仅我
    stubCounterparty()

    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'accept' }),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.state).toBe('CONSENT_PENDING')
    expect(body.data.myDecision).toBe('ACCEPT')
    expect(body.data.counterpartDecision).toBeNull()
    // 已经同意过 → 不再给「同意」（避免"点了两次、以为第一次没生效"），
    // 也不再给「拒绝」—— 此刻改主意的准确语义是"撤回同意"，两个按钮会导致
    // 同一个意图写出两种不同的决策记录。剩下唯一准确的出口是「撤回」。
    expect(body.data.actions).toEqual(['REVOKE'])
    // 状态机写回的是 CONSENT_PENDING，而不是 MUTUALLY_ACCEPTED
    expect(propUpdate.mock.calls[0][0].data.status).toBe('CONSENT_PENDING')
    // 也没有写 closedAt
    expect(propUpdate.mock.calls[0][0].data.closedAt).toBeUndefined()
  })

  it('双方都同意 → state 变为 MUTUALLY_ACCEPTED', async () => {
    asRole('MEMBER', ME)
    propFindFirst
      .mockResolvedValueOnce(proposalRow()) // before
      .mockResolvedValueOnce(proposalRow({ status: 'MUTUALLY_ACCEPTED' })) // after
    decisionFindMany
      .mockResolvedValueOnce([{ personId: OP, decision: 'ACCEPT' }]) // before：发起方已同意
      .mockResolvedValueOnce([
        { personId: OP, decision: 'ACCEPT' },
        { personId: ME, decision: 'ACCEPT' },
      ])
    stubCounterparty()

    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'accept' }),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.state).toBe('MUTUALLY_ACCEPTED')
    expect(propUpdate.mock.calls[0][0].data.status).toBe('MUTUALLY_ACCEPTED')
  })

  it('★AC-05 已关闭（REJECTED）后再表态 → 409', async () => {
    asRole('MEMBER', ME)
    propFindFirst.mockResolvedValue(proposalRow({ status: 'REJECTED', closedAt: new Date() }))
    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'accept' }),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(409)
    expect(decisionUpsert).not.toHaveBeenCalled()
  })

  it('★AC-05 已介绍后 → 409（介绍是既成事实，不可被撤销改写）', async () => {
    asRole('MEMBER', ME)
    propFindFirst.mockResolvedValue(proposalRow({ introducedAt: new Date() }))
    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'reject' }),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(409)
  })

  it('过期后 accept → 409（但拒绝/撤回仍可关闭它）', async () => {
    asRole('MEMBER', ME)
    propFindFirst.mockResolvedValue(proposalRow({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }))
    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'accept' }),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(409)
  })

  it('🔒 同意前用 CANDIDATE 档：只授权给 COUNTERPARTY 的字段**键不存在**', async () => {
    asRole('MEMBER', ME)
    propFindFirst
      .mockResolvedValueOnce(proposalRow())
      .mockResolvedValueOnce(proposalRow({ status: 'CONSENT_PENDING' }))
    decisionFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ personId: ME, decision: 'ACCEPT' }])
    stubCounterparty()

    const res = await (consentRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/consent', { decision: 'accept' }),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(body.data.counterpart.audience).toBe('CANDIDATE')
    expect(Object.keys(body.data.counterpart.subject)).toEqual(['city'])
    expect(Object.prototype.hasOwnProperty.call(body.data.counterpart.subject, 'displayName')).toBe(false)

    const json = JSON.stringify(body)
    expect(json).not.toContain('op-secret@example.test')
    expect(json).not.toContain('对手姓名')
    expect(json).not.toContain('不应外泄的简介')
  })
})

// ═══════════════════════════════════════════════════════════
// 撤销：revoke
// ═══════════════════════════════════════════════════════════

describe('T05 · POST /api/v1/connections/{connectionId}/revoke', () => {
  it('空 body 合法 → 200，状态进入 REVOKED 并写 closedAt', async () => {
    asRole('MEMBER', ME)
    propFindFirst
      .mockResolvedValueOnce(proposalRow())
      .mockResolvedValueOnce(proposalRow({ status: 'REVOKED', closedAt: new Date() }))
    decisionFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ personId: ME, decision: 'REVOKE' }])
    stubCounterparty()

    const res = await (revokeRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/revoke'),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.state).toBe('REVOKED')
    expect(propUpdate.mock.calls[0][0].data.status).toBe('REVOKED')
    expect(propUpdate.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date)
  })

  it('★AC-05 二次撤销（已关闭）→ 409，不是幂等成功', async () => {
    asRole('MEMBER', ME)
    propFindFirst.mockResolvedValue(proposalRow({ status: 'REVOKED', closedAt: new Date() }))
    const res = await (revokeRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/revoke'),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(409)
  })

  it('note 超长 → 400', async () => {
    asRole('MEMBER', ME)
    const res = await (revokeRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/revoke', { note: 'x'.repeat(400) }),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.field).toBe('note')
  })
})

// ═══════════════════════════════════════════════════════════
// 介绍执行点：introduce（AC-06）
// ═══════════════════════════════════════════════════════════

describe('T05 · POST /api/v1/connections/{connectionId}/introduce', () => {
  it('🔒 MEMBER 无 proposal.create → 403（介绍是运营动作）', async () => {
    asRole('MEMBER', ME)
    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(403)
    expect(propUpdateMany).not.toHaveBeenCalled()
  })

  it('★AC-04 单方同意（CONSENT_PENDING）→ 409 + blockers 含 not_mutually_accepted', async () => {
    asRole('OPERATOR', OP)
    propFindFirst.mockResolvedValue(proposalRow({ status: 'CONSENT_PENDING' }))

    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error.details.blockers).toContain('not_mutually_accepted')
    // 不可介绍时**不**再查双方意图（省一次查询，错误信息更聚焦）
    expect(intentFindMany).not.toHaveBeenCalled()
    expect(propUpdateMany).not.toHaveBeenCalled()
  })

  it('★AC-06 一方已撤销意图 → 409 + blockers 含 candidate_intent_not_live', async () => {
    asRole('OPERATOR', OP)
    propFindFirst.mockResolvedValue(proposalRow({ status: 'MUTUALLY_ACCEPTED' }))
    intentFindMany.mockResolvedValue([
      { userId: OP, status: 'ACTIVE', expiresAt: null },
      { userId: ME, status: 'WITHDRAWN', expiresAt: null },
    ])

    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error.details.blockers).toContain('candidate_intent_not_live')
    expect(propUpdateMany).not.toHaveBeenCalled()
  })

  it('★AC-06 一方意图已过期 → 409（派生过期，库里仍是 ACTIVE）', async () => {
    asRole('OPERATOR', OP)
    propFindFirst.mockResolvedValue(proposalRow({ status: 'MUTUALLY_ACCEPTED' }))
    intentFindMany.mockResolvedValue([
      { userId: OP, status: 'ACTIVE', expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      { userId: ME, status: 'ACTIVE', expiresAt: null },
    ])

    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error.details.blockers).toContain('proposer_intent_not_live')
  })

  it('★AC-06 双方同意且意图均有效 → 200，且落库是 CAS（谓词含 introducedAt: null）', async () => {
    asRole('OPERATOR', OP)
    propFindFirst
      .mockResolvedValueOnce(proposalRow({ status: 'MUTUALLY_ACCEPTED' })) // 执行前
      .mockResolvedValueOnce(proposalRow({ status: 'MUTUALLY_ACCEPTED', introducedAt: new Date() })) // 执行后
    intentFindMany.mockResolvedValue([
      { userId: OP, status: 'ACTIVE', expiresAt: null },
      { userId: ME, status: 'ACTIVE', expiresAt: null },
    ])
    decisionFindMany.mockResolvedValue([
      { personId: OP, decision: 'ACCEPT' },
      { personId: ME, decision: 'ACCEPT' },
    ])
    stubCounterparty()

    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.introducedAt).not.toBeNull()

    const where = propUpdateMany.mock.calls[0][0].where
    expect(where.introducedAt).toBeNull()
    expect(where.status).toBe('MUTUALLY_ACCEPTED')
    expect(where.organizationId).toBe(ORG)
  })

  it('🔒 AC-06 并发下 CAS 失败（count=0）→ 409，而不是双写成功', async () => {
    asRole('OPERATOR', OP)
    propFindFirst.mockResolvedValue(proposalRow({ status: 'MUTUALLY_ACCEPTED' }))
    intentFindMany.mockResolvedValue([
      { userId: OP, status: 'ACTIVE', expiresAt: null },
      { userId: ME, status: 'ACTIVE', expiresAt: null },
    ])
    propUpdateMany.mockResolvedValue({ count: 0 }) // 另一个并发请求已抢先写入

    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    expect(res.status).toBe(409)
  })

  it('★AC-06 重复介绍 → 409 + blockers 含 already_introduced', async () => {
    asRole('OPERATOR', OP)
    propFindFirst.mockResolvedValue(
      proposalRow({ status: 'MUTUALLY_ACCEPTED', introducedAt: new Date() })
    )
    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error.details.blockers).toContain('already_introduced')
  })

  it('🔒 介绍落地后档位升级为 COUNTERPARTY：授权给该档的字段此时才可见', async () => {
    asRole('OPERATOR', OP)
    propFindFirst
      .mockResolvedValueOnce(proposalRow({ status: 'MUTUALLY_ACCEPTED' }))
      .mockResolvedValueOnce(proposalRow({ status: 'MUTUALLY_ACCEPTED', introducedAt: new Date() }))
    intentFindMany.mockResolvedValue([
      { userId: OP, status: 'ACTIVE', expiresAt: null },
      { userId: ME, status: 'ACTIVE', expiresAt: null },
    ])
    decisionFindMany.mockResolvedValue([
      { personId: OP, decision: 'ACCEPT' },
      { personId: ME, decision: 'ACCEPT' },
    ])
    stubCounterparty()

    const res = await (introduceRoute.POST as any)(
      post('/api/v1/connections/proposals/p_1/introduce'),
      params({ connectionId: 'p_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.counterpart.audience).toBe('COUNTERPARTY')
    // 介绍前看不到的 displayName（只授权给 COUNTERPARTY）现在出现了
    expect(Object.keys(body.data.counterpart.subject).sort()).toEqual(['city', 'displayName'])
    // 未授权字段（bio）依旧不存在
    expect(Object.prototype.hasOwnProperty.call(body.data.counterpart.subject, 'bio')).toBe(false)
    expect(JSON.stringify(body)).not.toContain('不应外泄的简介')
  })
})

// ═══════════════════════════════════════════════════════════
// 已建立连接列表：introductions
// ═══════════════════════════════════════════════════════════

describe('T05 · GET /api/v1/connections/introductions', () => {
  it('匿名 → 401', async () => {
    requireAuthMock.mockRejectedValue(new UnauthorizedError('Unauthorized'))
    const res = await (introductionsRoute.GET as any)(get('/api/v1/connections/introductions'))
    expect(res.status).toBe(401)
  })

  it('MEMBER 自助可用 → 200；只含已介绍的行，且档位恒为 COUNTERPARTY', async () => {
    asRole('MEMBER')
    propFindMany.mockResolvedValue([
      proposalRow({ status: 'MUTUALLY_ACCEPTED', introducedAt: new Date('2026-10-06T00:00:00.000Z') }),
    ])
    userFindMany.mockResolvedValue([
      { id: OP, email: 'op-secret@example.test', profile: { displayName: '对手姓名', bio: '不应外泄的简介' } },
    ])
    intentFindMany.mockResolvedValue([
      {
        missionId: 'm_1',
        userId: OP,
        disclosure: '{"displayName":"COUNTERPARTY"}',
        status: 'ACTIVE',
        expiresAt: null,
      },
    ])

    const res = await (introductionsRoute.GET as any)(get('/api/v1/connections/introductions'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.introductions).toHaveLength(1)
    expect(body.data.introductions[0].audience).toBe('COUNTERPARTY')
    expect(body.data.introductions[0].subject).toEqual({ displayName: '对手姓名' })

    // 查询谓词：必须限定「已介绍」，且仍是我参与的行
    const where = propFindMany.mock.calls[0][0].where
    expect(where.introducedAt).toEqual({ not: null })
    expect(where.organizationId).toBe(ORG)

    const json = JSON.stringify(body)
    expect(json).not.toContain('op-secret@example.test')
    expect(json).not.toContain('不应外泄的简介')
  })

  it('🔒 对方已撤销意图 → 披露当场归零（投影为空对象，不需要定时任务）', async () => {
    asRole('MEMBER')
    propFindMany.mockResolvedValue([
      proposalRow({ status: 'MUTUALLY_ACCEPTED', introducedAt: new Date('2026-10-06T00:00:00.000Z') }),
    ])
    userFindMany.mockResolvedValue([
      { id: OP, email: 'op-secret@example.test', profile: { displayName: '对手姓名' } },
    ])
    intentFindMany.mockResolvedValue([
      {
        missionId: 'm_1',
        userId: OP,
        disclosure: '{"displayName":"COUNTERPARTY"}',
        status: 'WITHDRAWN',
        expiresAt: null,
      },
    ])

    const res = await (introductionsRoute.GET as any)(get('/api/v1/connections/introductions'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.introductions[0].subject).toEqual({})
  })
})
