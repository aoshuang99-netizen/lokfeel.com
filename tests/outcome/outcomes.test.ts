/**
 * T08 · 成果服务层 —— 单测
 *
 * 覆盖三类风险（与 AC-15 直接相关）：
 *   1. **自报不算验证成功** —— 上报后级别恒为 `SELF_REPORTED`，且**请求体塞 `verificationLevel` 无效**；
 *   2. **不得自我确认** —— 上报人调 confirm → 400（语义不成立）；第三方 → 403；
 *   3. **租户谓词 + 投影边界** —— 每个查询带 `organizationId`；DTO **不含** userId。
 *
 * 另钉住两条阶段机接线（T06 留的空洞）：
 *   上报 → `ACTION_COMPLETED`；确认 / 核验 → `OUTCOME_RECORDED`。
 */

jest.mock('@/lib/db', () => ({
  db: {
    connectionProposal: { findFirst: jest.fn() },
    outcome: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    outcomeVerification: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

// 只替换阶段推进（重依赖），`partyRoleOf` 走真实实现 —— 不复制它的逻辑。
jest.mock('@/lib/workflow/workflow', () => ({
  advanceIntroductionWorkflow: jest.fn(async () => ({ stage: 'ACTION_COMPLETED', changed: true })),
}))

import { db } from '@/lib/db'
import { advanceIntroductionWorkflow } from '@/lib/workflow/workflow'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { confirmOutcome, listOutcomes, reportOutcome, verifyOutcome } from '@/lib/outcome/outcomes'
import type { TenantContext } from '@/lib/tenancy'

const ORG = 'org_1'
const REPORTER = 'u_reporter'
const COUNTERPARTY = 'u_counterparty'

const ctx = (userId: string, role: TenantContext['role'] = 'MEMBER'): TenantContext => ({
  organizationId: ORG,
  userId,
  role,
  membershipId: `ms_${userId}`,
})

const PROPOSAL = {
  id: 'p_1',
  missionId: 'm_1',
  proposerId: REPORTER,
  candidateId: COUNTERPARTY,
  status: 'MUTUALLY_ACCEPTED',
  introducedAt: new Date('2026-10-01T00:00:00.000Z'),
}

const SUMMARY = '他们合作完成了一个项目'

const OUTCOME_ROW = {
  id: 'o_1',
  organizationId: ORG,
  proposalId: 'p_1',
  missionId: 'm_1',
  reporterId: REPORTER,
  counterpartyId: COUNTERPARTY,
  summary: SUMMARY,
  verificationLevel: 'SELF_REPORTED',
  occurredAt: new Date('2026-10-02T00:00:00.000Z'),
  createdAt: new Date('2026-10-02T01:00:00.000Z'),
}

const propFindFirst = db.connectionProposal.findFirst as unknown as jest.Mock
const outcomeFindUnique = db.outcome.findUnique as unknown as jest.Mock
const outcomeFindFirst = db.outcome.findFirst as unknown as jest.Mock
const outcomeFindMany = db.outcome.findMany as unknown as jest.Mock
const outcomeCreate = db.outcome.create as unknown as jest.Mock
const outcomeUpdateMany = db.outcome.updateMany as unknown as jest.Mock
const verifFindFirst = db.outcomeVerification.findFirst as unknown as jest.Mock
const verifFindMany = db.outcomeVerification.findMany as unknown as jest.Mock
const verifCreate = db.outcomeVerification.create as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const advanceMock = advanceIntroductionWorkflow as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  propFindFirst.mockResolvedValue(PROPOSAL)
  outcomeFindUnique.mockResolvedValue(null)
  outcomeFindFirst.mockResolvedValue(OUTCOME_ROW)
  outcomeFindMany.mockResolvedValue([])
  outcomeCreate.mockResolvedValue({ id: 'o_1' })
  outcomeUpdateMany.mockResolvedValue({ count: 1 })
  verifFindFirst.mockResolvedValue(null)
  verifFindMany.mockResolvedValue([])
  verifCreate.mockResolvedValue({ id: 'v_1' })
  auditCreate.mockResolvedValue({})
  advanceMock.mockResolvedValue({ stage: 'ACTION_COMPLETED', changed: true })
})

// ═══════════════════════════════════════════════════════════
describe('reportOutcome —— 前置与权限', () => {
  it('提案不存在 → 404', async () => {
    propFindFirst.mockResolvedValue(null)
    await expect(reportOutcome(ctx(REPORTER), { proposalId: 'p_x', summary: SUMMARY })).rejects.toBeInstanceOf(
      NotFoundError
    )
  })

  it('非当事方 → 403，且**不**写库', async () => {
    await expect(
      reportOutcome(ctx('u_stranger'), { proposalId: 'p_1', summary: SUMMARY })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(outcomeCreate).not.toHaveBeenCalled()
  })

  it('未介绍（introducedAt = null）→ 409（没有连接就没有成果）', async () => {
    propFindFirst.mockResolvedValue({ ...PROPOSAL, introducedAt: null })
    await expect(reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })).rejects.toMatchObject({
      name: 'ConflictError',
      details: { blockers: ['not_introduced'] },
    })
  })

  it('已撤销 / 已拒绝 → 409', async () => {
    propFindFirst.mockResolvedValue({ ...PROPOSAL, status: 'REVOKED' })
    await expect(reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })).rejects.toBeInstanceOf(
      ConflictError
    )
  })

  it('summary 太短 / 太长 / 非字符串 → 400', async () => {
    for (const bad of ['短', 'x'.repeat(1001), 42]) {
      await expect(
        reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: bad as unknown as string })
      ).rejects.toBeInstanceOf(ValidationError)
    }
    expect(outcomeCreate).not.toHaveBeenCalled()
  })

  it('occurredAt 早于介绍时间 → 400（成果不可能在连接建立前发生）', async () => {
    await expect(
      reportOutcome(ctx(REPORTER), {
        proposalId: 'p_1',
        summary: SUMMARY,
        occurredAt: '2026-09-01T00:00:00.000Z',
      })
    ).rejects.toMatchObject({ name: 'ValidationError', details: { field: 'occurredAt' } })
  })

  it('同一提案已有成果 → 409（一个提案只落一份成果）', async () => {
    outcomeFindUnique.mockResolvedValue({ id: 'o_existing' })
    await expect(reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })).rejects.toMatchObject({
      name: 'ConflictError',
      details: { outcomeId: 'o_existing' },
    })
  })
})

describe('reportOutcome —— 落库与阶段机接线', () => {
  it('成功：reporter = 当前用户，counterparty = 对侧，级别恒为 SELF_REPORTED', async () => {
    const dto = await reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })
    const data = outcomeCreate.mock.calls[0][0].data

    expect(data.organizationId).toBe(ORG)
    expect(data.reporterId).toBe(REPORTER)
    expect(data.counterpartyId).toBe(COUNTERPARTY)
    expect(data.verificationLevel).toBe('SELF_REPORTED')
    // 🔴 自报不算验证成功
    expect(dto.verified).toBe(false)
    expect(dto.verificationLevel).toBe('SELF_REPORTED')
  })

  it('🔴 请求体塞 verificationLevel **无效**（级别是派生的，不是入参）', async () => {
    await reportOutcome(ctx(REPORTER), {
      proposalId: 'p_1',
      summary: SUMMARY,
      verificationLevel: 'EXTERNALLY_VERIFIED',
    } as unknown as Parameters<typeof reportOutcome>[1])

    expect(outcomeCreate.mock.calls[0][0].data.verificationLevel).toBe('SELF_REPORTED')
  })

  it('上报 → 阶段机推进 ACTION_COMPLETED（不是终态）', async () => {
    await reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })
    expect(advanceMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ACTION_COMPLETED', proposalId: 'p_1', by: REPORTER })
    )
  })

  it('审计 outcome.reported：eventType 正确，且 safeMetadata **不记** summary 原文', async () => {
    await reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })
    const data = auditCreate.mock.calls[0][0].data

    expect(data.eventType).toBe('outcome.reported')
    expect(data.actorId).toBe(REPORTER)
    // ⚠️ eventType 是独立字段，**不在** safeMetadata 里 —— 别把两者混在一处断言。
    expect(data.safeMetadata).not.toContain(SUMMARY)
  })

  it('DTO 不含 reporterId / counterpartyId（隐私边界）', async () => {
    const dto = await reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })
    expect(dto).not.toHaveProperty('reporterId')
    expect(dto).not.toHaveProperty('counterpartyId')
    expect(JSON.stringify(dto)).not.toContain(REPORTER)
    expect(JSON.stringify(dto)).not.toContain(COUNTERPARTY)
    expect(dto.myRole).toBe('REPORTER')
  })

  it('阶段推进失败不影响上报结果（尽力而为）', async () => {
    advanceMock.mockRejectedValue(new Error('workflow down'))
    await expect(
      reportOutcome(ctx(REPORTER), { proposalId: 'p_1', summary: SUMMARY })
    ).resolves.toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════
describe('confirmOutcome —— AC-15 的核心', () => {
  it('🔴 上报人确认自己的成果 → 400（不是权限问题，是语义不成立）', async () => {
    await expect(confirmOutcome(ctx(REPORTER), 'o_1')).rejects.toBeInstanceOf(ValidationError)
    expect(verifCreate).not.toHaveBeenCalled()
  })

  it('第三方（非当事方）→ 403', async () => {
    await expect(confirmOutcome(ctx('u_stranger'), 'o_1')).rejects.toBeInstanceOf(ForbiddenError)
    expect(verifCreate).not.toHaveBeenCalled()
  })

  it('对手方确认 → 写 COUNTERPARTY_CONFIRMED，派生级别前进，阶段机 → OUTCOME_RECORDED', async () => {
    outcomeFindFirst.mockResolvedValue({ ...OUTCOME_ROW, verificationLevel: 'COUNTERPARTY_CONFIRMED' })
    verifFindMany.mockResolvedValue([
      { level: 'COUNTERPARTY_CONFIRMED', actorId: COUNTERPARTY, createdAt: new Date('2026-10-03T00:00:00.000Z') },
    ])

    const { outcome, created } = await confirmOutcome(ctx(COUNTERPARTY), 'o_1')

    expect(created).toBe(true)
    expect(verifCreate.mock.calls[0][0].data.level).toBe('COUNTERPARTY_CONFIRMED')
    expect(verifCreate.mock.calls[0][0].data.actorId).toBe(COUNTERPARTY)
    expect(outcomeUpdateMany.mock.calls[0][0].data.verificationLevel).toBe('COUNTERPARTY_CONFIRMED')
    expect(advanceMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'OUTCOME_RECORDED', reason: 'counterparty_confirmed' })
    )
    expect(outcome.verified).toBe(true)
  })

  it('幂等：重复确认 → created: false，不重复写、不再推进阶段', async () => {
    verifFindFirst.mockResolvedValue({ id: 'v_existing' })
    const { created } = await confirmOutcome(ctx(COUNTERPARTY), 'o_1')

    expect(created).toBe(false)
    expect(verifCreate).not.toHaveBeenCalled()
    expect(advanceMock).not.toHaveBeenCalled()
  })

  it('成果不存在（跨租户 / 不存在）→ 404', async () => {
    outcomeFindFirst.mockResolvedValue(null)
    await expect(confirmOutcome(ctx(COUNTERPARTY), 'o_x')).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ═══════════════════════════════════════════════════════════
describe('verifyOutcome —— 仅 ADMIN+', () => {
  it('MEMBER / OPERATOR → 403（outcome.verify 只在 ADMIN_EXTRA）', async () => {
    for (const role of ['MEMBER', 'OPERATOR'] as const) {
      await expect(verifyOutcome(ctx('u_admin', role), 'o_1')).rejects.toBeInstanceOf(ForbiddenError)
    }
    expect(verifCreate).not.toHaveBeenCalled()
  })

  it('ADMIN 核验 → EXTERNALLY_VERIFIED，且**不要求**是当事方', async () => {
    outcomeFindFirst.mockResolvedValue({ ...OUTCOME_ROW, verificationLevel: 'EXTERNALLY_VERIFIED' })
    verifFindMany.mockResolvedValue([
      { level: 'EXTERNALLY_VERIFIED', actorId: 'u_admin', createdAt: new Date('2026-10-04T00:00:00.000Z') },
    ])

    const { outcome, created } = await verifyOutcome(ctx('u_admin', 'ADMIN'), 'o_1', {
      evidence: '合同编号 XYZ',
    })

    expect(created).toBe(true)
    expect(verifCreate.mock.calls[0][0].data.level).toBe('EXTERNALLY_VERIFIED')
    expect(verifCreate.mock.calls[0][0].data.evidence).toBe('合同编号 XYZ')
    expect(advanceMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'OUTCOME_RECORDED', reason: 'externally_verified' })
    )
    expect(outcome.verified).toBe(true)
  })

  it('审计只记"有没有证据"，**不记** evidence 原文', async () => {
    outcomeFindFirst.mockResolvedValue({ ...OUTCOME_ROW, verificationLevel: 'EXTERNALLY_VERIFIED' })
    await verifyOutcome(ctx('u_admin', 'ADMIN'), 'o_1', { evidence: '合同编号 XYZ' })

    const meta = auditCreate.mock.calls[0][0].data.safeMetadata
    expect(meta).toContain('hasEvidence')
    expect(meta).not.toContain('XYZ')
  })
})

// ═══════════════════════════════════════════════════════════
describe('listOutcomes —— 租户谓词与下推', () => {
  it('谓词始终带 organizationId', async () => {
    await listOutcomes(ctx('u_any'))
    expect(outcomeFindMany.mock.calls[0][0].where.organizationId).toBe(ORG)
  })

  it('verifiedOnly → 下推 VERIFIED_LEVELS（不含 SELF_REPORTED）', async () => {
    await listOutcomes(ctx('u_any'), { verifiedOnly: true })
    expect(outcomeFindMany.mock.calls[0][0].where.verificationLevel).toEqual({
      in: ['COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED'],
    })
  })

  it('level 过滤直接下推；missionId 也下推', async () => {
    await listOutcomes(ctx('u_any'), { level: 'SELF_REPORTED', missionId: 'm_9' })
    expect(outcomeFindMany.mock.calls[0][0].where.verificationLevel).toBe('SELF_REPORTED')
    expect(outcomeFindMany.mock.calls[0][0].where.missionId).toBe('m_9')
  })

  it('limit 被钳制在 1..200', async () => {
    await listOutcomes(ctx('u_any'), { limit: 9999 })
    expect(outcomeFindMany.mock.calls[0][0].take).toBe(200)
    await listOutcomes(ctx('u_any'), { limit: 0 })
    expect(outcomeFindMany.mock.calls[1][0].take).toBe(1)
  })

  it('列表 DTO 同样不含 userId；观察者的 myRole 是 OBSERVER', async () => {
    outcomeFindMany.mockResolvedValue([OUTCOME_ROW])
    const out = await listOutcomes(ctx('u_other'))
    expect(out[0].myRole).toBe('OBSERVER')
    expect(JSON.stringify(out)).not.toContain(REPORTER)
  })
})
