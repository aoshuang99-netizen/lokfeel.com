/**
 * V21 · G09 RED 测试 —— 独立成果核验（不把模型输出当证据）
 *
 * 覆盖：
 *   - parseVerificationBody strict：proposal / modelOutput / spec → 400 MODEL_OUTPUT_NOT_EVIDENCE；
 *     其它未知字段拒绝；criteria 非空且逐条 confirmed:boolean；
 *   - evaluateVerificationGate 五道前置：无 sourceRunId / 非 EXECUTED / 无回执 /
 *     criteria 未全 true / 自己核自己 → 可判定的 code；
 *   - createVerification：无回执 409、自己核自己 409、跨租户 404、
 *     成功时响应含 verificationLevel + evidence 四重清单且只陈述事实；
 *   - GET 返回记录或 null（不是空数组假绿）；
 *   - 路由负例：能力不足 403、模型输出当证据 400。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    mission: { findFirst: jest.fn() },
    agentRun: { findFirst: jest.fn() },
    agentExecution: { findFirst: jest.fn() },
    executionVerification: { findFirst: jest.fn(), create: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    membership: { findFirst: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { NotFoundError, ValidationError } from '@/lib/errors'
import {
  parseVerificationBody,
  evaluateVerificationGate,
  createVerification,
  getVerification,
  type VerificationCriterion,
} from '@/lib/connection/verification'
import * as verificationRoute from '@/app/api/v1/missions/[missionId]/verification/route'
import type { TenantContext } from '@/lib/tenancy/resolve'

const ORG = 'org_1'
const ctx: TenantContext = { organizationId: ORG, userId: 'u_1', role: 'ADMIN', membershipId: 'ms_1' }

const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const agentRunFindFirst = db.agentRun.findFirst as unknown as jest.Mock
const agentExecutionFindFirst = db.agentExecution.findFirst as unknown as jest.Mock
const verificationFindFirst = db.executionVerification.findFirst as unknown as jest.Mock
const verificationCreate = db.executionVerification.create as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const requireAuthMock = requireAuth as unknown as jest.Mock

const allConfirmed: VerificationCriterion[] = [
  { label: '签署试销协议', confirmed: true },
  { label: '完成首批出货', confirmed: true },
]

const executedFacts = {
  sourceRunId: 'run_1',
  runStatus: 'EXECUTED',
  hasReceipt: true,
  criteria: allConfirmed,
  verifierId: 'u_1',
  requestedBy: 'u_2',
}

function asRole(role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER', userId = 'u_1') {
  requireAuthMock.mockResolvedValue({ user: { id: userId } })
  membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role })
}

const params = (obj: Record<string, string>) => ({ params: Promise.resolve(obj) })

function get(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET', headers })
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
})

// ═══════════════════════════════════════════════════════════════
describe('V21/G09 · parseVerificationBody（strict · 禁止模型输出当证据）', () => {
  it('合法请求 → criteria 保留', () => {
    const parsed = parseVerificationBody({ criteria: allConfirmed, evidenceNote: '对方已回签' })
    expect(parsed.criteria).toHaveLength(2)
    expect(parsed.evidenceNote).toBe('对方已回签')
  })

  it('🔴 proposal / modelOutput / spec 作为证据 → 400 MODEL_OUTPUT_NOT_EVIDENCE', () => {
    for (const key of ['proposal', 'modelOutput', 'spec']) {
      try {
        parseVerificationBody({ criteria: allConfirmed, [key]: '模型说目标已达成' })
        throw new Error('应当抛 ValidationError')
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError)
        expect((e as ValidationError).details.code).toBe('MODEL_OUTPUT_NOT_EVIDENCE')
      }
    }
  })

  it('其它未知字段一律拒绝（strict）', () => {
    expect(() => parseVerificationBody({ criteria: allConfirmed, verdict: 'EXTERNALLY_VERIFIED' })).toThrow(ValidationError)
    expect(() => parseVerificationBody({ criteria: allConfirmed, verifierId: 'u_2' })).toThrow(ValidationError)
  })

  it('criteria 空数组 / 非数组 → 400', () => {
    expect(() => parseVerificationBody({ criteria: [] })).toThrow(ValidationError)
    expect(() => parseVerificationBody({ criteria: 'ok' })).toThrow(ValidationError)
  })

  it('criteria 逐条必须是 confirmed:boolean（字符串 "true" 不接受）', () => {
    expect(() => parseVerificationBody({ criteria: [{ label: 'x', confirmed: 'true' }] })).toThrow(ValidationError)
    expect(() => parseVerificationBody({ criteria: [{ label: 'x' }] })).toThrow(ValidationError)
    expect(() => parseVerificationBody({ criteria: [{ label: 'x', confirmed: true, evil: 1 }] })).toThrow(ValidationError)
  })
})

describe('V21/G09 · evaluateVerificationGate（五道前置，缺一即拒）', () => {
  it('全部满足 → null（放行）', () => {
    expect(evaluateVerificationGate(executedFacts)).toBeNull()
  })

  it('① 无 sourceRunId → MISSION_NOT_LINKED', () => {
    expect(evaluateVerificationGate({ ...executedFacts, sourceRunId: null })?.code).toBe('MISSION_NOT_LINKED')
  })

  it('② 关联 run 非 EXECUTED → RUN_NOT_EXECUTED', () => {
    expect(evaluateVerificationGate({ ...executedFacts, runStatus: 'APPROVED' })?.code).toBe('RUN_NOT_EXECUTED')
    expect(evaluateVerificationGate({ ...executedFacts, runStatus: null })?.code).toBe('RUN_NOT_EXECUTED')
  })

  it('③ 无真实 AgentExecution 回执 → RECEIPT_MISSING', () => {
    expect(evaluateVerificationGate({ ...executedFacts, hasReceipt: false })?.code).toBe('RECEIPT_MISSING')
  })

  it('④ criteria 未逐条全 true → CRITERIA_NOT_CONFIRMED', () => {
    expect(evaluateVerificationGate({
      ...executedFacts,
      criteria: [{ label: 'x', confirmed: true }, { label: 'y', confirmed: false }],
    })?.code).toBe('CRITERIA_NOT_CONFIRMED')
  })

  it('⑤ verifierId === run.requestedBy（自己核自己）→ SELF_VERIFICATION_FORBIDDEN', () => {
    expect(evaluateVerificationGate({ ...executedFacts, requestedBy: 'u_1' })?.code).toBe('SELF_VERIFICATION_FORBIDDEN')
  })
})

describe('V21/G09 · createVerification / getVerification（服务层，内存 db）', () => {
  function seedExecuted() {
    missionFindFirst.mockResolvedValue({ id: 'm_1', sourceRunId: 'run_1', status: 'ACTIVE' })
    agentRunFindFirst.mockResolvedValue({
      id: 'run_1', status: 'EXECUTED', requestedBy: 'u_2', skill: 'INTENT_EXTRACTION',
    })
    agentExecutionFindFirst.mockResolvedValue({
      id: 'exec_1', deliveryId: 'dlv_1', deliveryStatus: 'SENT', channel: 'IN_APP', kind: 'RECEIPT',
    })
  }

  it('跨租户 mission → 404', async () => {
    missionFindFirst.mockResolvedValue(null)
    await expect(createVerification(ctx, 'm_other', { criteria: allConfirmed })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('🔴 无回执核验 → 409 RECEIPT_MISSING', async () => {
    seedExecuted()
    agentExecutionFindFirst.mockResolvedValue(null)
    await expect(createVerification(ctx, 'm_1', { criteria: allConfirmed }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'RECEIPT_MISSING' } })
    expect(verificationCreate).not.toHaveBeenCalled()
  })

  it('🔴 自己核自己 → 409 SELF_VERIFICATION_FORBIDDEN', async () => {
    seedExecuted()
    agentRunFindFirst.mockResolvedValue({
      id: 'run_1', status: 'EXECUTED', requestedBy: 'u_1', skill: 'INTENT_EXTRACTION',
    })
    await expect(createVerification(ctx, 'm_1', { criteria: allConfirmed }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'SELF_VERIFICATION_FORBIDDEN' } })
    expect(verificationCreate).not.toHaveBeenCalled()
  })

  it('成功 → verificationLevel=COUNTERPARTY_CONFIRMED + evidence 四重清单，只陈述事实', async () => {
    seedExecuted()
    verificationCreate.mockImplementation(async (args: any) => ({ id: 'ver_1', ...args.data }))

    const out = await createVerification(ctx, 'm_1', { criteria: allConfirmed, evidenceNote: '对方已回签' })

    expect(out.verificationLevel).toBe('COUNTERPARTY_CONFIRMED')
    expect(out.verifierId).toBe('u_1')
    expect(out.evidence.http.method).toBe('POST')
    expect(out.evidence.http.path).toContain('/verification')
    expect(out.evidence.dbRows).toMatchObject({ verificationId: 'ver_1', missionId: 'm_1', runId: 'run_1', executionId: 'exec_1' })
    expect(out.evidence.auditEventType).toBe('mission.verification_recorded')
    expect(out.evidence.receipt).toMatchObject({ deliveryId: 'dlv_1', deliveryStatus: 'SENT' })
    expect(out.statement).toContain('不宣布目标达成')

    const data = verificationCreate.mock.calls[0][0].data
    expect(data.organizationId).toBe(ORG)
    expect(data.verifierId).toBe('u_1')
    expect(data.receiptRef).toBe('dlv_1')
    expect(JSON.parse(data.criteriaJson)).toHaveLength(2)
    expect(auditCreate).toHaveBeenCalledTimes(1)
  })

  it('🔴 重复核验 / 并发撞唯一键 → 409 VERIFICATION_ALREADY_RECORDED（真实 QA 实测曾 500）', async () => {
    seedExecuted()
    // Prisma 真实错误形态：P2002 + "Unique constraint failed on the fields: (`missionId`, `runId`)"
    const uniqueError = Object.assign(
      new Error('Unique constraint failed on the fields: (`missionId`, `runId`)'),
      { code: 'P2002' },
    )
    verificationCreate.mockRejectedValue(uniqueError)

    await expect(createVerification(ctx, 'm_1', { criteria: allConfirmed })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'VERIFICATION_ALREADY_RECORDED' },
    })
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('GET 无记录 → null（不是空数组假绿）', async () => {
    verificationFindFirst.mockResolvedValue(null)
    expect(await getVerification(ctx, 'm_1')).toBeNull()
  })
})

describe('V21/G09 · /api/v1/missions/[missionId]/verification（HTTP）', () => {
  it('OPERATOR 无 outcome.verify → 403', async () => {
    asRole('OPERATOR')
    const res = await (verificationRoute.POST as any)(
      post('/api/v1/missions/m_1/verification', { criteria: allConfirmed }),
      params({ missionId: 'm_1' })
    )
    expect(res.status).toBe(403)
    expect(verificationCreate).not.toHaveBeenCalled()
  })

  it('模型输出当证据 → 400 MODEL_OUTPUT_NOT_EVIDENCE', async () => {
    asRole('ADMIN')
    const res = await (verificationRoute.POST as any)(
      post('/api/v1/missions/m_1/verification', { criteria: allConfirmed, proposal: '目标已达成' }),
      params({ missionId: 'm_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details.code).toBe('MODEL_OUTPUT_NOT_EVIDENCE')
  })

  it('GET 无核验记录 → 200 且 data === null（不是 []）', async () => {
    asRole('MEMBER')
    verificationFindFirst.mockResolvedValue(null)
    const res = await (verificationRoute.GET as any)(
      get('/api/v1/missions/m_1/verification'),
      params({ missionId: 'm_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toBeNull()
  })
})
