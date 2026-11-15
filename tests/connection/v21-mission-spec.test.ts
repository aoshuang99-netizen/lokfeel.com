/**
 * V21 · C04 RED 测试 —— Mission ↔ AgentRun 锚点、Spec 版本化编辑、乐观锁
 *
 * 覆盖：
 *   - parseMissionCreate 白名单接受 sourceRunId（字符串 / 只认这一个身份锚点）；
 *   - parseMissionPatch 可选 expectedUpdatedAt（不改变旧形状）；
 *   - parseSpecSaveBody strict 校验（WorkspaceSpec v1.2 + expectedVersion）；
 *   - getMissionSpec 返回 success({...}) **对象** data；
 *   - saveMissionSpec：版本冲突 / CLOSED / EXECUTED 关联 run / 唯一键并发冲突 / 成功写审计；
 *   - updateMission 可选乐观锁：冲突 409 MISSION_VERSION_CONFLICT，旧 PATCH 行为不变；
 *   - 路由负例：跨租户 404、能力不足 403、并发冲突 409。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    mission: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    agentRun: { findFirst: jest.fn() },
    missionSpecRevision: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    missionParticipation: { count: jest.fn(), groupBy: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
    membership: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/auth'
import { NotFoundError, ValidationError } from '@/lib/errors'
import {
  parseMissionCreate,
  parseMissionPatch,
} from '@/lib/connection/mission-input'
import { createMission, updateMission as updateMissionService } from '@/lib/connection/missions'
import {
  parseSpecSaveBody,
  getMissionSpec,
  saveMissionSpec,
} from '@/lib/connection/mission-spec'
import { WORKSPACE_SPEC_VERSION } from '@/lib/workspace-spec/schema'
import * as specRoute from '@/app/api/v1/missions/[missionId]/spec/route'
import type { TenantContext } from '@/lib/tenancy/resolve'

const ORG = 'org_1'
const ctx: TenantContext = { organizationId: ORG, userId: 'u_1', role: 'OPERATOR', membershipId: 'ms_1' }

const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const missionUpdate = db.mission.update as unknown as jest.Mock
const missionCreate = db.mission.create as unknown as jest.Mock
const agentRunFindFirst = db.agentRun.findFirst as unknown as jest.Mock
const revFindFirst = db.missionSpecRevision.findFirst as unknown as jest.Mock
const revFindMany = db.missionSpecRevision.findMany as unknown as jest.Mock
const revCreate = db.missionSpecRevision.create as unknown as jest.Mock
const partCount = db.missionParticipation.count as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const transaction = db.$transaction as unknown as jest.Mock
const requireAuthMock = requireAuth as unknown as jest.Mock

const validCreateBody = {
  goal: '在 3 个月内找到 2 家东南亚分销伙伴',
  offer: '产品样品 + 培训 + 联合营销预算',
  successCriteria: '签署试销协议并完成首批出货',
}

const validSpec = {
  version: WORKSPACE_SPEC_VERSION,
  title: '渠道合作工作区',
  nodes: [
    {
      id: 'n1',
      type: 'intent',
      title: '目标',
      data: { goal: '找到 2 家东南亚分销伙伴', successCriteria: ['签署试销协议'] },
    },
  ],
}

function missionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm_1',
    organizationId: ORG,
    ownerId: 'u_1',
    title: '渠道合作',
    goal: validCreateBody.goal,
    offer: validCreateBody.offer,
    constraints: null,
    successCriteria: validCreateBody.successCriteria,
    status: 'ACTIVE',
    shareToken: 'tok_abcdefghijklmnopqrstuv',
    publicPreview: true,
    maxParticipants: null,
    expiresAt: null,
    publishedAt: null,
    closedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    sourceRunId: null,
    ...over,
  }
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
  partCount.mockResolvedValue(0)
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db))
})

// ═══════════════════════════════════════════════════════════════
describe('V21/C04 · Mission ↔ AgentRun 锚点（parseMissionCreate）', () => {
  it('sourceRunId 为合法字符串时进入白名单', () => {
    const parsed = parseMissionCreate({ ...validCreateBody, sourceRunId: 'run_intent_1' })
    expect(parsed.sourceRunId).toBe('run_intent_1')
  })

  it('sourceRunId 非字符串 / 空串 → 400（带字段名）', () => {
    for (const bad of [123, {}, [], '', '   ']) {
      try {
        parseMissionCreate({ ...validCreateBody, sourceRunId: bad })
        throw new Error('应当抛 ValidationError')
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError)
        expect((e as ValidationError).details).toEqual({ field: 'sourceRunId' })
      }
    }
  })

  it('🔒 其它身份字段仍被丢弃（绝不信客户端传来的 organizationId/ownerId/requestedBy）', () => {
    const parsed = parseMissionCreate({
      ...validCreateBody,
      sourceRunId: 'run_1',
      organizationId: 'org_attacker',
      ownerId: 'u_attacker',
      requestedBy: 'u_attacker',
      status: 'ACTIVE',
    })
    expect(Object.keys(parsed)).not.toContain('organizationId')
    expect(Object.keys(parsed)).not.toContain('ownerId')
    expect(Object.keys(parsed)).not.toContain('requestedBy')
    expect(Object.keys(parsed)).not.toContain('status')
  })

  it('不带 sourceRunId 时输出形状与旧版逐字一致（旧幂等指纹零变化）', () => {
    const parsed = parseMissionCreate(validCreateBody)
    expect(Object.keys(parsed)).not.toContain('sourceRunId')
    expect(Object.keys(parsed).sort()).toEqual(
      ['title', 'goal', 'offer', 'constraints', 'successCriteria', 'expiresAt', 'maxParticipants', 'publicPreview', 'publish'].sort()
    )
  })
})

describe('V21/C04 · createMission 的 sourceRunId **真实性**校验', () => {
  it('本组织内真实的 INTENT_EXTRACTION run → 写入 sourceRunId，回查谓词带 skill + organizationId', async () => {
    agentRunFindFirst.mockResolvedValue({ id: 'run_1' })
    missionCreate.mockResolvedValue(missionRow({ sourceRunId: 'run_1' }))

    const out = await createMission(ctx, parseMissionCreate({ ...validCreateBody, sourceRunId: 'run_1' }))

    expect(agentRunFindFirst.mock.calls[0][0].where).toEqual({
      id: 'run_1',
      organizationId: ORG,
      skill: 'INTENT_EXTRACTION',
    })
    expect(missionCreate.mock.calls[0][0].data.sourceRunId).toBe('run_1')
    expect(out.sourceRunId).toBe('run_1') // MissionDto 暴露该字段
  })

  it('🔴 run 不存在 / 不属于本组织 / 非 INTENT_EXTRACTION → 400，且不创建 Mission', async () => {
    agentRunFindFirst.mockResolvedValue(null)
    await expect(
      createMission(ctx, parseMissionCreate({ ...validCreateBody, sourceRunId: 'run_bad' }))
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(missionCreate).not.toHaveBeenCalled()
  })

  it('不带 sourceRunId 时不产生 agentRun 回查（旧创建行为不变）', async () => {
    missionCreate.mockResolvedValue(missionRow())
    const out = await createMission(ctx, parseMissionCreate(validCreateBody))
    expect(agentRunFindFirst).not.toHaveBeenCalled()
    expect(out.sourceRunId).toBeNull()
  })
})

describe('V21/C04 · 可选乐观锁（parseMissionPatch / updateMission）', () => {
  it('expectedUpdatedAt 合法 ISO → 保留', () => {
    const patch = parseMissionPatch({ title: '新标题', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })
    expect(patch.expectedUpdatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(patch.title).toBe('新标题')
  })

  it('expectedUpdatedAt 非法 / 非字符串 → 400', () => {
    for (const bad of ['not-a-date', 123, null]) {
      expect(() => parseMissionPatch({ title: '新标题', expectedUpdatedAt: bad })).toThrow(ValidationError)
    }
  })

  it('不带 expectedUpdatedAt 时 patch 形状不变（向后兼容）', () => {
    expect(parseMissionPatch({ title: '新标题' })).toEqual({ title: '新标题' })
  })

  it('🔒 expectedUpdatedAt 与 DB 当前 updatedAt 不符 → 409 MISSION_VERSION_CONFLICT', async () => {
    missionFindFirst.mockResolvedValue({
      id: 'm_1',
      status: 'ACTIVE',
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    await expect(
      updateMissionService(ctx, 'm_1', {
        title: '新标题',
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 409, details: { code: 'MISSION_VERSION_CONFLICT' } })
    expect(missionUpdate).not.toHaveBeenCalled()
  })

  it('不带 expectedUpdatedAt 的旧 PATCH 行为完全不变', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', updatedAt: new Date() })
    missionUpdate.mockResolvedValue(missionRow({ title: '新标题' }))
    const out = await updateMissionService(ctx, 'm_1', { title: '新标题' } as any)
    expect(out.title).toBe('新标题')
    expect(missionUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('V21/C04 · parseSpecSaveBody（strict 校验）', () => {
  it('合法 WorkspaceSpec v1.2 + expectedVersion → 通过', () => {
    const parsed = parseSpecSaveBody({ spec: validSpec, expectedVersion: 0, changeNote: '首次保存' })
    expect(parsed.expectedVersion).toBe(0)
    expect(parsed.spec.version).toBe(WORKSPACE_SPEC_VERSION)
    expect(parsed.changeNote).toBe('首次保存')
  })

  it('spec 非法（version 错 / 未知字段 / 空 nodes）→ 400', () => {
    expect(() => parseSpecSaveBody({ spec: { ...validSpec, version: '9.9' }, expectedVersion: 0 })).toThrow(ValidationError)
    expect(() => parseSpecSaveBody({ spec: { ...validSpec, evil: 1 }, expectedVersion: 0 })).toThrow(ValidationError)
    expect(() => parseSpecSaveBody({ spec: { ...validSpec, nodes: [] }, expectedVersion: 0 })).toThrow(ValidationError)
  })

  it('expectedVersion 缺失 / 非整数 / 负数 → 400', () => {
    expect(() => parseSpecSaveBody({ spec: validSpec })).toThrow(ValidationError)
    expect(() => parseSpecSaveBody({ spec: validSpec, expectedVersion: '0' })).toThrow(ValidationError)
    expect(() => parseSpecSaveBody({ spec: validSpec, expectedVersion: -1 })).toThrow(ValidationError)
  })

  it('未知顶层字段 → 400（strict）', () => {
    expect(() => parseSpecSaveBody({ spec: validSpec, expectedVersion: 0, surprise: true })).toThrow(ValidationError)
  })
})

describe('V21/C04 · getMissionSpec / saveMissionSpec（服务层，内存 db）', () => {
  it('GET 返回对象 data（currentVersion + current + history），空历史不是空数组假绿', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1' })
    revFindMany.mockResolvedValue([])
    const state = await getMissionSpec(ctx, 'm_1')
    expect(Array.isArray(state)).toBe(false)
    expect(state).toMatchObject({ missionId: 'm_1', currentVersion: 0, current: null, history: [] })
  })

  it('跨租户 mission → 404', async () => {
    missionFindFirst.mockResolvedValue(null)
    await expect(getMissionSpec(ctx, 'm_other')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('expectedVersion 不符 → 409 SPEC_VERSION_CONFLICT', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', sourceRunId: null })
    revFindFirst.mockResolvedValue({ version: 2 })
    await expect(saveMissionSpec(ctx, 'm_1', { spec: validSpec as any, expectedVersion: 1, changeNote: null }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'SPEC_VERSION_CONFLICT' } })
    expect(revCreate).not.toHaveBeenCalled()
  })

  it('CLOSED → 409 MISSION_LOCKED', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'CLOSED', sourceRunId: null })
    await expect(saveMissionSpec(ctx, 'm_1', { spec: validSpec as any, expectedVersion: 0, changeNote: null }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'MISSION_LOCKED' } })
  })

  it('已存在 EXECUTED 的关联 run → 409 MISSION_LOCKED', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', sourceRunId: 'run_1' })
    agentRunFindFirst.mockResolvedValue({ id: 'run_1' })
    await expect(saveMissionSpec(ctx, 'm_1', { spec: validSpec as any, expectedVersion: 0, changeNote: null }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'MISSION_LOCKED' } })
  })

  it('并发下 @@unique 撞键 → 409 SPEC_VERSION_CONFLICT', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', sourceRunId: null })
    revFindFirst.mockResolvedValue(null)
    transaction.mockImplementation(async () => {
      throw Object.assign(new Error('UNIQUE constraint failed: missionId, version'), { code: 'P2002' })
    })
    await expect(saveMissionSpec(ctx, 'm_1', { spec: validSpec as any, expectedVersion: 0, changeNote: null }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'SPEC_VERSION_CONFLICT' } })
  })

  it('成功 → 事务内写入 version+1、带 organizationId，并写审计事件', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', sourceRunId: null })
    revFindFirst.mockResolvedValue(null)
    revCreate.mockResolvedValue({ id: 'rev_1' })
    revFindMany.mockResolvedValue([])

    await saveMissionSpec(ctx, 'm_1', { spec: validSpec as any, expectedVersion: 0, changeNote: '改了目标' })

    expect(transaction).toHaveBeenCalledTimes(1)
    const data = revCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ organizationId: ORG, missionId: 'm_1', version: 1, actorId: 'u_1' })
    expect(data.specJson).toContain('渠道合作工作区')
    expect(auditCreate).toHaveBeenCalledTimes(1)
    expect(auditCreate.mock.calls[0][0].data.eventType).toBe('mission.spec_revision_created')
  })
})

describe('V21/C04 · /api/v1/missions/[missionId]/spec（HTTP）', () => {
  it('GET → 200 且 data 是对象（不是 paginated 数组）', async () => {
    asRole('OPERATOR')
    missionFindFirst.mockResolvedValue({ id: 'm_1' })
    revFindMany.mockResolvedValue([])
    const res = await (specRoute.GET as any)(get('/api/v1/missions/m_1/spec'), params({ missionId: 'm_1' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(false)
    expect(body.data).toHaveProperty('history')
    expect(body.data).toHaveProperty('currentVersion')
  })

  it('跨租户 → 404', async () => {
    asRole('OPERATOR')
    missionFindFirst.mockResolvedValue(null)
    const res = await (specRoute.GET as any)(get('/api/v1/missions/m_other/spec'), params({ missionId: 'm_other' }))
    expect(res.status).toBe(404)
  })

  it('MEMBER 能力不足 → 403', async () => {
    asRole('MEMBER')
    const res = await (specRoute.POST as any)(
      post('/api/v1/missions/m_1/spec', { spec: validSpec, expectedVersion: 0 }),
      params({ missionId: 'm_1' })
    )
    expect(res.status).toBe(403)
    expect(revCreate).not.toHaveBeenCalled()
  })

  it('并发冲突 → 409 且 details.code = SPEC_VERSION_CONFLICT', async () => {
    asRole('OPERATOR')
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', sourceRunId: null })
    revFindFirst.mockResolvedValue({ version: 3 })
    const res = await (specRoute.POST as any)(
      post('/api/v1/missions/m_1/spec', { spec: validSpec, expectedVersion: 0 }),
      params({ missionId: 'm_1' })
    )
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error.details.code).toBe('SPEC_VERSION_CONFLICT')
  })
})
