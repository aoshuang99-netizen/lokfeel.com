/**
 * T03 · Intent 服务层测试（租户隔离 + 本人谓词 + 状态派生 + 投影边界）
 *
 * 带 🔒 的断言是**防回归锁**：它们钉死的是"实现方式"（例如查询必须同时带
 * organizationId 与 userId 谓词），而不是输出值。这类断言写得越死，
 * 未来重构越不容易把"个人数据只能本人读"这件事悄悄改没。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    socialIntent: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    mission: { findFirst: jest.fn() },
    missionParticipation: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

import { db } from '@/lib/db'
import { ConflictError, NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import {
  createIntent,
  deriveIntentStatus,
  getIntent,
  getIntentById,
  listMissionIntentsForOrganizer,
  listMyIntents,
  liveDisclosureOf,
  previewDisclosure,
  transitionIntent,
  updateIntent,
} from '@/lib/connection/intents'

const intentFindFirst = db.socialIntent.findFirst as unknown as jest.Mock
const intentFindUnique = db.socialIntent.findUnique as unknown as jest.Mock
const intentFindMany = db.socialIntent.findMany as unknown as jest.Mock
const intentCount = db.socialIntent.count as unknown as jest.Mock
const intentCreate = db.socialIntent.create as unknown as jest.Mock
const intentUpdate = db.socialIntent.update as unknown as jest.Mock
const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const partFindUnique = db.missionParticipation.findUnique as unknown as jest.Mock
const userFindUnique = db.user.findUnique as unknown as jest.Mock
const userFindMany = db.user.findMany as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock

const ORG = 'org_1'
const ctx: TenantContext = {
  organizationId: ORG,
  userId: 'u_1',
  role: 'MEMBER',
  membershipId: 'ms_1',
}

function intentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i_1',
    organizationId: ORG,
    missionId: 'm_1',
    userId: 'u_1',
    need: '需要东南亚渠道',
    offer: '提供样品与培训',
    constraints: '["东南亚"]',
    disclosure: '{"displayName":"ORGANIZER"}',
    status: 'ACTIVE',
    expiresAt: null,
    withdrawnAt: null,
    importConsentAt: null,
    importedFields: null,
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    updatedAt: new Date('2026-10-05T00:00:00.000Z'),
    ...over,
  }
}

const createInput = {
  missionId: 'm_1',
  need: '需要东南亚渠道',
  offer: '提供样品与培训',
  constraints: ['东南亚'],
  disclosure: { displayName: 'ORGANIZER' as const },
  expiresAt: null,
  importPlan: { accepted: [], rejected: [], includesSensitive: false },
  importConsentGiven: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  intentCount.mockResolvedValue(0)
  intentFindMany.mockResolvedValue([])
  userFindMany.mockResolvedValue([])
})

describe('T03 · 状态派生', () => {
  it('ACTIVE / WITHDRAWN / EXPIRED 三态由存储状态与有效期共同决定', () => {
    const now = new Date('2026-10-10T00:00:00.000Z')
    expect(deriveIntentStatus(intentRow() as any, now)).toBe('ACTIVE')
    expect(deriveIntentStatus(intentRow({ status: 'WITHDRAWN' }) as any, now)).toBe('WITHDRAWN')
    expect(
      deriveIntentStatus(intentRow({ expiresAt: new Date('2026-10-09T00:00:00.000Z') }) as any, now)
    ).toBe('EXPIRED')
    // 撤销优先于过期（撤销是明确的用户意图）
    expect(
      deriveIntentStatus(
        intentRow({ status: 'WITHDRAWN', expiresAt: new Date('2026-10-09T00:00:00.000Z') }) as any,
        now
      )
    ).toBe('WITHDRAWN')
  })

  it('🔒 liveDisclosureOf：撤销与过期**当即可披露字段归零**（不依赖任何定时任务）', () => {
    const now = new Date('2026-10-10T00:00:00.000Z')
    expect(liveDisclosureOf(intentRow() as any, now)).toEqual({ displayName: 'ORGANIZER' })
    expect(liveDisclosureOf(intentRow({ status: 'WITHDRAWN' }) as any, now)).toEqual({})
    expect(
      liveDisclosureOf(intentRow({ expiresAt: new Date('2026-10-09T00:00:00.000Z') }) as any, now)
    ).toEqual({})
  })
})

describe('T03 · 读（本人）', () => {
  it('🔒 getIntentById 必须同时以 id + organizationId + userId 为谓词', async () => {
    intentFindFirst.mockResolvedValue(intentRow())
    await getIntentById(ctx, 'i_1')

    const where = intentFindFirst.mock.calls[0][0].where
    expect(where.id).toBe('i_1')
    expect(where.organizationId).toBe(ORG)
    // 若有人删掉 userId，这条就退化成"同租户任何人可读任何人的意图与披露配置"。
    expect(where.userId).toBe('u_1')
  })

  it('他人的意图 / 跨租户 → 404（不泄露"存在"这一事实）', async () => {
    intentFindFirst.mockResolvedValue(null)
    await expect(getIntent(ctx, 'i_other')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('🔒 listMyIntents 的 where 必带 organizationId + userId，分页被钳制', async () => {
    await listMyIntents(ctx, { page: 0, pageSize: 9999 })
    const args = intentFindMany.mock.calls[0][0]
    expect(args.where.organizationId).toBe(ORG)
    expect(args.where.userId).toBe('u_1')
    expect(args.take).toBe(100)
    expect(args.skip).toBe(0)
  })

  it('listMyIntents 的 missionId 过滤是可选谓词', async () => {
    intentCount.mockResolvedValue(1)
    intentFindMany.mockResolvedValue([intentRow()])
    const out = await listMyIntents(ctx, { missionId: 'm_1' })
    expect(intentFindMany.mock.calls[0][0].where.missionId).toBe('m_1')
    expect(out.items[0].explicitDisclosureKeys).toEqual(['displayName'])
    expect(out.items[0].disclosure.email).toBe('SELF')
  })
})

describe('T03 · 写 —— createIntent', () => {
  it('任务不属于本租户 → 404', async () => {
    missionFindFirst.mockResolvedValue(null)
    await expect(createIntent(ctx, createInput)).rejects.toBeInstanceOf(NotFoundError)
    expect(intentCreate).not.toHaveBeenCalled()
  })

  it('任务为草稿 / 已关闭 → 409（成员本不该看到）', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'DRAFT' })
    await expect(createIntent(ctx, createInput)).rejects.toBeInstanceOf(ConflictError)
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'CLOSED' })
    await expect(createIntent(ctx, createInput)).rejects.toBeInstanceOf(ConflictError)
  })

  it('🔒 未加入任务（无 INTERESTED 参与）→ 409，且不落库', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue(null)
    await expect(createIntent(ctx, createInput)).rejects.toBeInstanceOf(ConflictError)
    expect(intentCreate).not.toHaveBeenCalled()

    // 已被移出/自己退出的参与关系同样不算数
    partFindUnique.mockResolvedValue({ status: 'WITHDRAWN' })
    await expect(createIntent(ctx, createInput)).rejects.toBeInstanceOf(ConflictError)
    expect(intentCreate).not.toHaveBeenCalled()
  })

  it('🔒 已存在意图 → 409（不静默覆盖，避免替用户丢弃既有授权设置）', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue({ status: 'INTERESTED' })
    intentFindUnique.mockResolvedValue({ id: 'i_1', status: 'ACTIVE' })
    await expect(createIntent(ctx, createInput)).rejects.toBeInstanceOf(ConflictError)

    intentFindUnique.mockResolvedValue({ id: 'i_1', status: 'WITHDRAWN' })
    await expect(createIntent(ctx, createInput)).rejects.toThrow(/reactivate/i)
    expect(intentCreate).not.toHaveBeenCalled()
  })

  it('合法 → 创建成功：organizationId 来自会话、披露表被编码、导入同意被记录', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue({ status: 'INTERESTED' })
    intentFindUnique.mockResolvedValue(null)
    intentCreate.mockResolvedValue(
      intentRow({ disclosure: '{"displayName":"ORGANIZER"}', importConsentAt: new Date('2026-10-10T00:00:00.000Z'), importedFields: '["displayName"]' })
    )

    const out = await createIntent(ctx, {
      ...createInput,
      importPlan: { accepted: ['displayName'], rejected: [], includesSensitive: false },
      importConsentGiven: true,
    })

    const data = intentCreate.mock.calls[0][0].data
    expect(data.organizationId).toBe(ORG) // 绝不来自请求体
    expect(data.userId).toBe('u_1')
    expect(data.missionId).toBe('m_1')
    expect(data.status).toBe('ACTIVE')
    expect(data.disclosure).toBe('{"displayName":"ORGANIZER"}')
    expect(data.importedFields).toBe('["displayName"]')
    expect(data.importConsentAt).toBeInstanceOf(Date)
    expect(out.id).toBe('i_1')
    expect(out.importedFields).toEqual(['displayName'])
  })

  it('空披露表编码为 null（不落 "{}"）；空约束同样为 null', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue({ status: 'INTERESTED' })
    intentFindUnique.mockResolvedValue(null)
    intentCreate.mockResolvedValue(intentRow({ disclosure: null, constraints: null }))

    await createIntent(ctx, { ...createInput, constraints: [], disclosure: {} })
    const data = intentCreate.mock.calls[0][0].data
    expect(data.disclosure).toBeNull()
    expect(data.constraints).toBeNull()
  })

  it('审计只记结构性信息：授权键、授予对手方的键、导入字段（不记 need/offer 正文）', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue({ status: 'INTERESTED' })
    intentFindUnique.mockResolvedValue(null)
    intentCreate.mockResolvedValue(intentRow({ disclosure: '{"displayName":"COUNTERPARTY","bio":"ORGANIZER"}' }))

    await createIntent(ctx, createInput)

    const created = auditCreate.mock.calls.map((c) => JSON.parse(c[0].data.safeMetadata))
    const createdEvent = created.find((m) => m && m.grantedKeys)
    expect(createdEvent.grantedKeys.sort()).toEqual(['bio', 'displayName'])
    expect(createdEvent.grantedToCounterparty).toEqual(['displayName'])
    // 正文不得进入审计
    expect(JSON.stringify(created)).not.toContain('东南亚渠道')
  })

  it('导入同意生成**独立**审计事件（可单独检索）', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue({ status: 'INTERESTED' })
    intentFindUnique.mockResolvedValue(null)
    intentCreate.mockResolvedValue(intentRow())

    await createIntent(ctx, {
      ...createInput,
      importPlan: { accepted: ['bio'], rejected: [], includesSensitive: false },
      importConsentGiven: true,
    })

    const events = auditCreate.mock.calls.map((c) => c[0].data.eventType)
    expect(events).toContain('intent.created')
    expect(events).toContain('intent.profile_import_consented')
  })

  it('并发撞唯一约束（P2002）→ 409 而不是 500', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE' })
    partFindUnique.mockResolvedValue({ status: 'INTERESTED' })
    intentFindUnique.mockResolvedValue(null)
    intentCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    await expect(createIntent(ctx, createInput)).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('T03 · 写 —— updateIntent', () => {
  it('撤销后不可编辑 → 409（须 reactivate）', async () => {
    intentFindFirst.mockResolvedValue({ id: 'i_1', status: 'WITHDRAWN' })
    await expect(updateIntent(ctx, 'i_1', { need: '新的需求描述' })).rejects.toBeInstanceOf(ConflictError)
    expect(intentUpdate).not.toHaveBeenCalled()
  })

  it('🔒 更新谓词同样带 organizationId + userId（不能改到别人的意图）', async () => {
    intentFindFirst.mockResolvedValue({ id: 'i_1', status: 'ACTIVE' })
    intentUpdate.mockResolvedValue(intentRow())
    await updateIntent(ctx, 'i_1', { need: '更新后的需求描述' })
    const where = intentFindFirst.mock.calls[0][0].where
    expect(where.id).toBe('i_1')
    expect(where.organizationId).toBe(ORG)
    expect(where.userId).toBe('u_1')
  })

  it('只写显式给出的字段；披露表整体替换（空表 → null）', async () => {
    intentFindFirst.mockResolvedValue({ id: 'i_1', status: 'ACTIVE' })
    intentUpdate.mockResolvedValue(intentRow({ disclosure: null }))

    await updateIntent(ctx, 'i_1', { disclosure: {} })
    const data = intentUpdate.mock.calls[0][0].data
    expect(Object.keys(data)).toEqual(['disclosure'])
    expect(data.disclosure).toBeNull()
  })

  it('审计只记字段名', async () => {
    intentFindFirst.mockResolvedValue({ id: 'i_1', status: 'ACTIVE' })
    intentUpdate.mockResolvedValue(intentRow())
    await updateIntent(ctx, 'i_1', { need: '更新后的需求描述', offer: '新的提供物' })
    const meta = JSON.parse(auditCreate.mock.calls[0][0].data.safeMetadata)
    expect(meta.fields).toEqual(['need', 'offer'])
    expect(JSON.stringify(meta)).not.toContain('更新后的需求描述')
  })
})

describe('T03 · 写 —— 撤销 / 复活（幂等）', () => {
  it('withdraw：ACTIVE → WITHDRAWN，写入 withdrawnAt', async () => {
    intentFindFirst.mockResolvedValue(intentRow())
    intentUpdate.mockResolvedValue(intentRow({ status: 'WITHDRAWN', withdrawnAt: new Date() }))

    const out = await transitionIntent(ctx, 'i_1', 'withdraw')
    const data = intentUpdate.mock.calls[0][0].data
    expect(data.status).toBe('WITHDRAWN')
    expect(data.withdrawnAt).toBeInstanceOf(Date)
    expect(out.status).toBe('WITHDRAWN')
  })

  it('withdraw 幂等：已撤销时直接返回，不重复写库', async () => {
    intentFindFirst.mockResolvedValue(intentRow({ status: 'WITHDRAWN', withdrawnAt: new Date() }))
    const out = await transitionIntent(ctx, 'i_1', 'withdraw')
    expect(out.status).toBe('WITHDRAWN')
    expect(intentUpdate).not.toHaveBeenCalled()
  })

  it('🔒 reactivate 对已过期意图 → 409（"复活即过期"是空操作，须先续期）', async () => {
    intentFindFirst.mockResolvedValue(
      intentRow({ status: 'WITHDRAWN', expiresAt: new Date('2000-01-01T00:00:00.000Z') })
    )
    await expect(transitionIntent(ctx, 'i_1', 'reactivate')).rejects.toBeInstanceOf(ConflictError)
    expect(intentUpdate).not.toHaveBeenCalled()
  })

  it('reactivate：WITHDRAWN → ACTIVE 并清空 withdrawnAt；对已 ACTIVE 幂等', async () => {
    intentFindFirst.mockResolvedValue(intentRow({ status: 'WITHDRAWN' }))
    intentUpdate.mockResolvedValue(intentRow())
    await transitionIntent(ctx, 'i_1', 'reactivate')
    expect(intentUpdate.mock.calls[0][0].data).toEqual({ status: 'ACTIVE', withdrawnAt: null })

    jest.clearAllMocks()
    auditCreate.mockResolvedValue({})
    intentFindFirst.mockResolvedValue(intentRow())
    const out = await transitionIntent(ctx, 'i_1', 'reactivate')
    expect(out.status).toBe('ACTIVE')
    expect(intentUpdate).not.toHaveBeenCalled()
  })
})

describe('T03 · 披露预览（本人自查）', () => {
  it('返回两个受众视角的真实投影；未授权字段不出现', async () => {
    intentFindFirst.mockResolvedValue(intentRow({ disclosure: '{"displayName":"ORGANIZER","age":"COUNTERPARTY"}' }))
    userFindUnique.mockResolvedValue({
      email: 'lin@example.com',
      profile: { displayName: '林晓', age: 32, bio: '八年跨境' },
    })

    const out = await previewDisclosure(ctx, 'i_1')
    expect(out.status).toBe('ACTIVE')
    // ORGANIZER 档组织者可见；COUNTERPARTY 档组织者也在受众链上（最宽档）
    expect(Object.keys(out.preview.organizer).sort()).toEqual(['age', 'displayName'])
    // 对手方只拿得到最宽档
    expect(Object.keys(out.preview.counterparty)).toEqual(['age'])
    // 受保护字段与未授权字段的**值**永不出现。
    // 注意：`summary` 里会出现字段**名**（那是目录元数据，是给用户看的自查说明），
    // 所以这里断言的是值，而不是键名。
    const json = JSON.stringify(out)
    expect(json).not.toContain('lin@example.com')
    expect(json).not.toContain('八年跨境')
    expect(Object.keys(out.preview.organizer)).not.toContain('bio')
    expect(out.summary.withheld).toContain('bio')
  })

  it('撤销后的预览为空（用户能确认"真的不再披露了"）', async () => {
    intentFindFirst.mockResolvedValue(intentRow({ status: 'WITHDRAWN' }))
    userFindUnique.mockResolvedValue({ email: 'lin@example.com', profile: { displayName: '林晓' } })
    const out = await previewDisclosure(ctx, 'i_1')
    expect(out.preview.organizer).toEqual({})
    expect(out.preview.counterparty).toEqual({})
    expect(out.summary.visibleToOrganizer).toEqual([])
  })
})

describe('T03 · 组织者视角（AC-03 执法点）', () => {
  it('任务不属于本租户 → 404', async () => {
    missionFindFirst.mockResolvedValue(null)
    await expect(listMissionIntentsForOrganizer(ctx, 'm_x')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('🔒 where 限定租户 + 任务 + ACTIVE + 未过期（撤销/过期的意图不进运营视图）', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1' })
    await listMissionIntentsForOrganizer(ctx, 'm_1')
    const where = intentFindMany.mock.calls[0][0].where
    expect(where.organizationId).toBe(ORG)
    expect(where.missionId).toBe('m_1')
    expect(where.status).toBe('ACTIVE')
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }])
  })

  it('🔒 未授权字段（email/age/bio）在响应里**根本不存在**', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1' })
    intentFindMany.mockResolvedValue([
      intentRow({ disclosure: '{"displayName":"ORGANIZER"}' }),
      intentRow({ id: 'i_2', userId: 'u_2', disclosure: '{"displayName":"SELF","age":"SELF"}' }),
    ])
    intentCount.mockResolvedValue(2)
    userFindMany.mockResolvedValue([
      { id: 'u_1', email: 'a@example.com', profile: { displayName: '林晓', age: 32, bio: '八年跨境' } },
      { id: 'u_2', email: 'b@example.com', profile: { displayName: '王强', age: 41, bio: '制造业' } },
    ])

    const out = await listMissionIntentsForOrganizer(ctx, 'm_1')
    const json = JSON.stringify(out)

    expect(out.items[0].subject).toEqual({ displayName: '林晓' })
    // 第二个人的一切字段都是 SELF → 投影为空
    expect(out.items[1].subject).toEqual({})
    for (const forbidden of ['"email"', '"age"', '"bio"', 'a@example.com', 'b@example.com']) {
      expect(json).not.toContain(forbidden)
    }
    // 组织者视图里也不该出现 userId 或披露配置
    expect(json).not.toContain('"userId"')
    expect(json).not.toContain('"disclosure"')
  })

  it('用户档案缺失时不报错，投影为空', async () => {
    missionFindFirst.mockResolvedValue({ id: 'm_1' })
    intentFindMany.mockResolvedValue([intentRow()])
    intentCount.mockResolvedValue(1)
    userFindMany.mockResolvedValue([])

    const out = await listMissionIntentsForOrganizer(ctx, 'm_1')
    expect(out.items[0].subject).toEqual({})
  })
})
