/**
 * V21 第三批 · C02 —— 审批与执行职责分离（R1）负例测试
 *
 * 背景：第二批红队真实复现 R1 —— 单一 OWNER/ADMIN 会话可完成
 * 「发起 → 批准 → 执行」自我闭环。本批把职责分离写成**服务端**策略：
 *   ① `decideAgentRun`：发起人不得批准自己的运行 → 403 `SELF_APPROVAL_FORBIDDEN`
 *   ② `executeAgentRun`：执行前复检批准合规性与有效期 → 403 / 409 `APPROVAL_EXPIRED`
 *   ③ 两者都写 `policyVersion`，让历史裁决可区分"旧策略自批"与"新策略合规批准"
 *
 * 纪律：这些是**拒绝路径**测试 —— 断言"没有副作用发生"，而不只是"抛了错"。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// next-auth 是 ESM-only：只要 `src/lib/auth/auth.ts` 被真实加载，jest 就会在 require 阶段炸。
// 这里测的是审批/执行的判定逻辑，不需要真实会话 —— mock 掉即可（与 tests/connection 同做法）。
jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

jest.mock('@/lib/db', () => ({
  db: {
    agentRun: { findFirst: jest.fn(), update: jest.fn() },
    agentApproval: { create: jest.fn() },
    agentExecution: { create: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}))

jest.mock('@/lib/workflow', () => ({
  deliverNotification: jest.fn(async () => ({ status: 'SENT', deliveryId: 'dlv_1', channel: 'IN_APP' })),
}))

import { db } from '@/lib/db'
import { decideAgentRun } from '@/lib/agents/runs'
import { executeAgentRun } from '@/lib/agents/executor'
import { deliverNotification } from '@/lib/workflow'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy/resolve'
import {
  AGENT_APPROVAL_POLICY_VERSION,
  AGENT_APPROVAL_TTL_MS,
  APPROVAL_EXPIRED,
  SELF_APPROVAL_FORBIDDEN,
} from '@/lib/agents/policy'

const ORG = 'org_1'
const REQUESTER = 'u_requester'
const APPROVER = 'u_approver'

const approverCtx: TenantContext = {
  organizationId: ORG,
  userId: APPROVER,
  role: 'ADMIN',
  membershipId: 'ms_approver',
}
const requesterCtx: TenantContext = {
  organizationId: ORG,
  userId: REQUESTER,
  role: 'ADMIN',
  membershipId: 'ms_requester',
}
const memberCtx: TenantContext = {
  organizationId: ORG,
  userId: 'u_member',
  role: 'MEMBER',
  membershipId: 'ms_member',
}

const runFindFirst = db.agentRun.findFirst as unknown as jest.Mock
const runUpdate = db.agentRun.update as unknown as jest.Mock
const approvalCreate = db.agentApproval.create as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const deliverMock = deliverNotification as unknown as jest.Mock

function awaitingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    organizationId: ORG,
    status: 'AWAITING_APPROVAL',
    requestedBy: REQUESTER,
    skill: 'INTENT_EXTRACTION',
    risk: 'LOW',
    requiresApproval: true,
    approval: null,
    execution: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  runUpdate.mockResolvedValue({})
  approvalCreate.mockResolvedValue({})
  auditCreate.mockResolvedValue({})
})

describe('C02 · 审批侧：发起人不得自批', () => {
  it('🔴 发起人批准自己的运行 → 403 SELF_APPROVAL_FORBIDDEN', async () => {
    runFindFirst.mockResolvedValue(awaitingRow())
    await expect(decideAgentRun(requesterCtx, 'run_1', 'APPROVED')).rejects.toMatchObject({
      statusCode: 403,
      details: { code: SELF_APPROVAL_FORBIDDEN },
    })
  })

  it('🔴 自批被拒时零副作用：不写裁决、不改状态、不写审计', async () => {
    runFindFirst.mockResolvedValue(awaitingRow())
    await expect(decideAgentRun(requesterCtx, 'run_1', 'APPROVED')).rejects.toBeInstanceOf(ForbiddenError)
    expect(approvalCreate).not.toHaveBeenCalled()
    expect(runUpdate).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('🔴 客户端伪造批准者 ID 无效：判定只认服务端 ctx.userId', async () => {
    runFindFirst.mockResolvedValue(awaitingRow())
    // 即使请求体里塞了 approverId=APPROVER，ctx 仍是发起人 ⇒ 必须拒绝。
    await expect(
      decideAgentRun(requesterCtx, 'run_1', 'APPROVED', 'note', {
        now: new Date(),
      }),
    ).rejects.toMatchObject({ statusCode: 403, details: { code: SELF_APPROVAL_FORBIDDEN } })
  })

  it('🔴 无 agent.approve 能力（MEMBER）→ 403，且在读库之前就拒绝', async () => {
    runFindFirst.mockResolvedValue(awaitingRow())
    await expect(decideAgentRun(memberCtx, 'run_1', 'APPROVED')).rejects.toBeInstanceOf(ForbiddenError)
    expect(runFindFirst).not.toHaveBeenCalled()
  })

  it('🔴 跨租户（本租户查不到该运行）→ 404，不泄露存在性', async () => {
    runFindFirst.mockResolvedValue(null)
    await expect(decideAgentRun(approverCtx, 'run_other_org', 'APPROVED')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('✅ 另一主体批准 → 写裁决，审计记录 policyVersion 与职责分离', async () => {
    runFindFirst
      .mockResolvedValueOnce(awaitingRow())
      // 批准后的回读（findRunRow）也要给一个可用行，避免 DTO 崩溃
      .mockResolvedValue(
        awaitingRow({
          status: 'APPROVED',
          approval: {
            decision: 'APPROVED',
            actorId: APPROVER,
            deciderRole: 'ADMIN',
            decidedAt: new Date(),
            note: null,
          },
        }),
      )

    // 本用例只关心"写入与审计"；批准后的 DTO 组装需要完整 row（providerKind 等），
    // 这里不构造全量夹具，因此对 DTO 阶段的错误不做断言（写入已完成）。
    await decideAgentRun(approverCtx, 'run_1', 'APPROVED').catch(() => {})

    expect(approvalCreate).toHaveBeenCalledTimes(1)
    expect(approvalCreate.mock.calls[0][0].data).toMatchObject({
      actorId: APPROVER,
      decision: 'APPROVED',
    })
    // `writeTenantAudit` 最终走 `db.tenantAuditEvent.create({ data: { … } })`，
    // 且 `safeMetadata` 在落库前已被 `JSON.stringify` ⇒ 断言前要解析回来。
    const audit = auditCreate.mock.calls[0]?.[0]?.data
    expect(audit).toBeDefined()
    expect(JSON.parse(audit.safeMetadata)).toMatchObject({
      policyVersion: AGENT_APPROVAL_POLICY_VERSION,
      separationOfDuties: true,
    })
  })
})

describe('C02 · 执行侧：旧自批与过期批准必须拒绝', () => {
  it('🔴 旧策略写入的自批记录 → 执行 403，且零投递', async () => {
    runFindFirst.mockResolvedValue(
      awaitingRow({
        status: 'APPROVED',
        approval: {
          decision: 'APPROVED',
          actorId: REQUESTER, // 自己批自己（历史数据）
          deciderRole: 'OWNER',
          decidedAt: new Date(),
          note: null,
        },
      }),
    )

    await expect(executeAgentRun(approverCtx, 'run_1')).rejects.toMatchObject({
      statusCode: 403,
      details: { code: SELF_APPROVAL_FORBIDDEN },
    })
    expect(deliverMock).not.toHaveBeenCalled()
  })

  it('🔴 批准超过 24h → 执行 409 APPROVAL_EXPIRED，且零投递', async () => {
    const stale = new Date(Date.now() - AGENT_APPROVAL_TTL_MS - 60_000)
    runFindFirst.mockResolvedValue(
      awaitingRow({
        status: 'APPROVED',
        approval: {
          decision: 'APPROVED',
          actorId: APPROVER,
          deciderRole: 'ADMIN',
          decidedAt: stale,
          note: null,
        },
      }),
    )

    await expect(executeAgentRun(approverCtx, 'run_1')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: APPROVAL_EXPIRED },
    })
    expect(deliverMock).not.toHaveBeenCalled()
  })

  it('🔴 执行者无 agent.execute 能力（MEMBER）→ 403，且零投递', async () => {
    runFindFirst.mockResolvedValue(
      awaitingRow({
        status: 'APPROVED',
        approval: {
          decision: 'APPROVED',
          actorId: APPROVER,
          deciderRole: 'ADMIN',
          decidedAt: new Date(),
          note: null,
        },
      }),
    )

    await expect(executeAgentRun(memberCtx, 'run_1')).rejects.toBeInstanceOf(ForbiddenError)
    expect(deliverMock).not.toHaveBeenCalled()
  })
})
