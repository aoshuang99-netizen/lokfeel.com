/**
 * T02 · Mission 服务测试（租户隔离 + 状态机 + 加入授权 + 公开投影）
 *
 * 本文件里带 🔒 的断言是**防回归锁**：它们钉死的是"实现方式"而非"输出值"，
 * 例如「查询必须同时带 id 与 organizationId 谓词」。这类断言写得越死，
 * 未来重构时越不容易把租户隔离悄悄改没。
 */

jest.mock('@/lib/db', () => ({
  db: {
    mission: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    missionParticipation: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    membership: { findFirst: jest.fn() },
    tenantAuditEvent: { create: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn() }))

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import {
  createMission,
  getMission,
  getMissionById,
  getSharePageData,
  joinMission,
  listMissions,
  transitionMission,
  updateMission,
} from '@/lib/connection/missions'

const missionFindFirst = db.mission.findFirst as unknown as jest.Mock
const missionFindUnique = db.mission.findUnique as unknown as jest.Mock
const missionFindMany = db.mission.findMany as unknown as jest.Mock
const missionCount = db.mission.count as unknown as jest.Mock
const missionCreate = db.mission.create as unknown as jest.Mock
const missionUpdate = db.mission.update as unknown as jest.Mock
const partCount = db.missionParticipation.count as unknown as jest.Mock
const partGroupBy = db.missionParticipation.groupBy as unknown as jest.Mock
const partFindUnique = db.missionParticipation.findUnique as unknown as jest.Mock
const partUpsert = db.missionParticipation.upsert as unknown as jest.Mock
const membershipFindFirst = db.membership.findFirst as unknown as jest.Mock
const auditCreate = db.tenantAuditEvent.create as unknown as jest.Mock

const ORG = 'org_1'
const ctx: TenantContext = {
  organizationId: ORG,
  userId: 'u_1',
  role: 'OPERATOR',
  membershipId: 'ms_1',
}

function missionRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm_1',
    organizationId: ORG,
    ownerId: 'u_1',
    title: 'T',
    goal: 'G',
    offer: 'O',
    constraints: null,
    successCriteria: 'S',
    status: 'ACTIVE',
    shareToken: 'tok_abcdefghijklmnopqrstuv',
    publicPreview: true,
    maxParticipants: null,
    expiresAt: null,
    publishedAt: new Date('2026-10-01T00:00:00.000Z'),
    closedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  }
}

const createInput = {
  title: '渠道合作',
  goal: '在 3 个月内找到 2 家东南亚分销伙伴',
  offer: '样品 + 培训',
  constraints: ['东南亚'],
  successCriteria: '签署试销协议',
  expiresAt: null,
  maxParticipants: null,
  publicPreview: true,
  publish: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  auditCreate.mockResolvedValue({})
  partCount.mockResolvedValue(0)
  partGroupBy.mockResolvedValue([])
})

describe('T02 · Mission 服务', () => {
  describe('租户隔离（AC-01 的任务维度）', () => {
    it('🔒 getMissionById 必须同时以 id 与 organizationId 为谓词', async () => {
      missionFindFirst.mockResolvedValue(missionRow())

      await getMissionById(ctx, 'm_1')

      const where = missionFindFirst.mock.calls[0][0].where
      expect(where.id).toBe('m_1')
      // 若有人删掉 organizationId，这条就退化成"任何租户都能按 id 读任意任务"。
      expect(where.organizationId).toBe(ORG)
    })

    it('跨租户读取表现为 404（存在但不属于本租户 → 不泄露"存在"这一事实）', async () => {
      missionFindFirst.mockResolvedValue(null) // DB 层已按租户过滤
      await expect(getMission(ctx, 'm_of_other_org')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('🔒 listMissions 的 where 必带 organizationId，且分页参数被钳制', async () => {
      missionCount.mockResolvedValue(0)
      missionFindMany.mockResolvedValue([])

      await listMissions(ctx, { page: 0, pageSize: 9999 })

      const args = missionFindMany.mock.calls[0][0]
      expect(args.where.organizationId).toBe(ORG)
      expect(args.take).toBe(100) // 上限
      expect(args.skip).toBe(0)
    })

    it('listMissions 的 status 过滤是可选谓词，且计数走 groupBy（避免 N+1）', async () => {
      missionCount.mockResolvedValue(1)
      missionFindMany.mockResolvedValue([missionRow()])
      partGroupBy.mockResolvedValue([{ missionId: 'm_1', _count: { _all: 7 } }])

      const out = await listMissions(ctx, { status: 'ACTIVE' })

      expect(missionFindMany.mock.calls[0][0].where).toEqual({
        organizationId: ORG,
        status: 'ACTIVE',
      })
      expect(partGroupBy).toHaveBeenCalledTimes(1)
      expect(out.items[0].participantCount).toBe(7)
      expect(out.total).toBe(1)
    })

    it('计数失败时退化为 0，不抛出（列表不应因计数而整体 500）', async () => {
      missionCount.mockResolvedValue(1)
      missionFindMany.mockResolvedValue([missionRow()])
      partGroupBy.mockRejectedValue(new Error('db hiccup'))

      const out = await listMissions(ctx)
      expect(out.items[0].participantCount).toBe(0)
    })
  })

  describe('createMission', () => {
    it('organizationId / ownerId 一律取自服务端上下文（不读输入）', async () => {
      missionCreate.mockResolvedValue(missionRow({ status: 'DRAFT', publishedAt: null }))

      await createMission(ctx, createInput)

      const data = missionCreate.mock.calls[0][0].data
      expect(data.organizationId).toBe(ORG)
      expect(data.ownerId).toBe('u_1')
      expect(data.status).toBe('DRAFT')
      expect(data.publishedAt).toBeNull()
      expect(data.constraints).toBe('["东南亚"]') // JSON 文本，非数组对象
      expect(typeof data.shareToken).toBe('string')
      expect(data.shareToken.length).toBeGreaterThanOrEqual(22)
    })

    it('publish=true → 直接 ACTIVE 并记 publishedAt', async () => {
      missionCreate.mockResolvedValue(missionRow())
      await createMission(ctx, { ...createInput, publish: true })
      const data = missionCreate.mock.calls[0][0].data
      expect(data.status).toBe('ACTIVE')
      expect(data.publishedAt).toBeInstanceOf(Date)
    })

    it('写审计，但**不**把 goal/offer 正文写进元数据', async () => {
      missionCreate.mockResolvedValue(missionRow())
      await createMission(ctx, createInput)

      expect(auditCreate).toHaveBeenCalledTimes(1)
      const row = auditCreate.mock.calls[0][0].data
      expect(row.eventType).toBe('mission.created')
      expect(JSON.stringify(row.safeMetadata)).not.toContain(createInput.goal)
    })

    it('shareToken 撞唯一键时重试，最终成功', async () => {
      missionCreate
        .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
        .mockResolvedValueOnce(missionRow())
      const out = await createMission(ctx, createInput)
      expect(out.id).toBe('m_1')
      expect(missionCreate).toHaveBeenCalledTimes(2)
    })
  })

  describe('updateMission —— 字段与生命周期', () => {
    it('跨租户 → 404', async () => {
      missionFindFirst.mockResolvedValue(null)
      await expect(updateMission(ctx, 'm_x', { title: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('CLOSED 是终态：可读不可改 → 409', async () => {
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'CLOSED' })
      await expect(updateMission(ctx, 'm_1', { title: 'x' })).rejects.toBeInstanceOf(ConflictError)
      expect(missionUpdate).not.toHaveBeenCalled()
    })

    it('constraints 为空数组时落 null（而不是 "[]" 字符串）', async () => {
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'DRAFT' })
      missionUpdate.mockResolvedValue(missionRow())
      await updateMission(ctx, 'm_1', { constraints: [] })
      expect(missionUpdate.mock.calls[0][0].data.constraints).toBeNull()
    })

    it('审计只记字段名，不记内容', async () => {
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'DRAFT' })
      missionUpdate.mockResolvedValue(missionRow())
      await updateMission(ctx, 'm_1', { title: '机密标题', offer: '机密报价' })

      // writeTenantAudit 会把元数据 JSON.stringify 后落库（safeMetadata 是 TEXT），
      // 因此这里必须反序列化 —— 顺带验证了"元数据确实以文本形态存储"。
      const meta = JSON.parse(auditCreate.mock.calls[0][0].data.safeMetadata)
      expect(meta.fields).toEqual(['offer', 'title'])
      expect(JSON.stringify(meta)).not.toContain('机密')
    })
  })

  describe('transitionMission —— 显式状态机', () => {
    it('DRAFT --publish--> ACTIVE（补 publishedAt）', async () => {
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'DRAFT', publishedAt: null })
      missionUpdate.mockResolvedValue(missionRow())
      await transitionMission(ctx, 'm_1', 'publish')
      const data = missionUpdate.mock.calls[0][0].data
      expect(data.status).toBe('ACTIVE')
      expect(data.publishedAt).toBeInstanceOf(Date)
    })

    it('ACTIVE --pause--> PAUSED；PAUSED --resume--> ACTIVE', async () => {
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', publishedAt: new Date() })
      missionUpdate.mockResolvedValue(missionRow({ status: 'PAUSED' }))
      await transitionMission(ctx, 'm_1', 'pause')
      expect(missionUpdate.mock.calls[0][0].data.status).toBe('PAUSED')

      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'PAUSED', publishedAt: new Date() })
      missionUpdate.mockResolvedValue(missionRow())
      await transitionMission(ctx, 'm_1', 'resume')
      expect(missionUpdate.mock.calls[1][0].data.status).toBe('ACTIVE')
    })

    it('close 记 closedAt', async () => {
      missionFindFirst.mockResolvedValue({ id: 'm_1', status: 'ACTIVE', publishedAt: new Date() })
      missionUpdate.mockResolvedValue(missionRow({ status: 'CLOSED' }))
      await transitionMission(ctx, 'm_1', 'close')
      expect(missionUpdate.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date)
    })

    it('🔒 非法迁移一律 409（不猜测意图）：CLOSED→pause、DRAFT→resume、ACTIVE→publish', async () => {
      for (const [status, action] of [
        ['CLOSED', 'pause'],
        ['DRAFT', 'resume'],
        ['ACTIVE', 'publish'],
        ['CLOSED', 'close'],
      ] as const) {
        missionFindFirst.mockResolvedValue({ id: 'm_1', status, publishedAt: null })
        await expect(transitionMission(ctx, 'm_1', action)).rejects.toBeInstanceOf(ConflictError)
      }
      expect(missionUpdate).not.toHaveBeenCalled()
    })

    it('跨租户 → 404', async () => {
      missionFindFirst.mockResolvedValue(null)
      await expect(transitionMission(ctx, 'm_x', 'publish')).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('joinMission —— 授权链', () => {
    const TOKEN = 'tok_abcdefghijklmnopqrstuv'
    const missionBase = {
      id: 'm_1',
      organizationId: ORG,
      status: 'ACTIVE',
      expiresAt: null,
      maxParticipants: null,
    }

    it('🔒 非本租户成员 → 403（租户从 DB 行取，不采信请求）', async () => {
      missionFindUnique.mockResolvedValue(missionBase)
      membershipFindFirst.mockResolvedValue(null) // 回查不到成员关系

      await expect(joinMission('u_outsider', TOKEN, { note: null })).rejects.toBeInstanceOf(
        ForbiddenError
      )
      // 越权尝试必须被记录
      expect(auditCreate).toHaveBeenCalled()
      expect(auditCreate.mock.calls[0][0].data.eventType).toBe('tenant.access_denied')
      expect(partUpsert).not.toHaveBeenCalled()
    })

    it('🔒 成员回查必须同时带 userId 与 mission 的 organizationId', async () => {
      missionFindUnique.mockResolvedValue(missionBase)
      membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
      partFindUnique.mockResolvedValue(null)
      partUpsert.mockResolvedValue({ id: 'p_1' })

      await joinMission('u_1', TOKEN, { note: null })

      const where = membershipFindFirst.mock.calls[0][0].where
      expect(where.userId).toBe('u_1')
      expect(where.organizationId).toBe(ORG)
      expect(where.status).toBe('ACTIVE')
    })

    it('DRAFT 的 token 表现为"不存在"（不泄露草稿的存在）', async () => {
      missionFindUnique.mockResolvedValue({ ...missionBase, status: 'DRAFT' })
      await expect(joinMission('u_1', TOKEN, { note: null })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('token 查不到 → 404', async () => {
      missionFindUnique.mockResolvedValue(null)
      await expect(joinMission('u_1', TOKEN, { note: null })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('PAUSED / CLOSED / 已过期 → 409（状态不可加入优先于名额）', async () => {
      membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })

      missionFindUnique.mockResolvedValue({ ...missionBase, status: 'PAUSED' })
      await expect(joinMission('u_1', TOKEN, { note: null })).rejects.toBeInstanceOf(ConflictError)

      missionFindUnique.mockResolvedValue({ ...missionBase, status: 'CLOSED' })
      await expect(joinMission('u_1', TOKEN, { note: null })).rejects.toBeInstanceOf(ConflictError)

      missionFindUnique.mockResolvedValue({
        ...missionBase,
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      })
      await expect(joinMission('u_1', TOKEN, { note: null })).rejects.toBeInstanceOf(ConflictError)
    })

    it('名额已满 → 409', async () => {
      missionFindUnique.mockResolvedValue({ ...missionBase, maxParticipants: 2 })
      membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
      partFindUnique.mockResolvedValue(null)
      partCount.mockResolvedValue(2)

      await expect(joinMission('u_1', TOKEN, { note: null })).rejects.toBeInstanceOf(ConflictError)
      expect(partUpsert).not.toHaveBeenCalled()
    })

    it('🔒 重复加入是幂等的：alreadyJoined=true，不写审计、不改名额', async () => {
      missionFindUnique.mockResolvedValue(missionBase)
      membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
      partFindUnique.mockResolvedValue({ id: 'p_1', status: 'INTERESTED' })

      const out = await joinMission('u_1', TOKEN, { note: null })

      expect(out).toEqual({
        missionId: 'm_1',
        participationId: 'p_1',
        status: 'INTERESTED',
        alreadyJoined: true,
      })
      expect(partUpsert).not.toHaveBeenCalled()
      expect(auditCreate).not.toHaveBeenCalled()
    })

    it('曾退出（WITHDRAWN）→ 重新加入走 upsert', async () => {
      missionFindUnique.mockResolvedValue(missionBase)
      membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
      partFindUnique.mockResolvedValue({ id: 'p_1', status: 'WITHDRAWN' })
      partUpsert.mockResolvedValue({ id: 'p_1' })

      const out = await joinMission('u_1', TOKEN, { note: 'hi' })

      expect(out.alreadyJoined).toBe(false)
      expect(partUpsert).toHaveBeenCalledTimes(1)
      expect(auditCreate.mock.calls[0][0].data.eventType).toBe('mission.joined')
    })

    it('成功加入：participation 带 mission 的 organizationId（不是请求里的）', async () => {
      missionFindUnique.mockResolvedValue(missionBase)
      membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
      partFindUnique.mockResolvedValue(null)
      partUpsert.mockResolvedValue({ id: 'p_9' })

      await joinMission('u_1', TOKEN, { note: '想合作' })

      const args = partUpsert.mock.calls[0][0]
      expect(args.create.organizationId).toBe(ORG)
      expect(args.create.missionId).toBe('m_1')
      expect(args.create.userId).toBe('u_1')
      expect(args.create.status).toBe('INTERESTED')
    })

    it('🔒 名额竞态：写入后超额 → 回滚为 WITHDRAWN 并 409（不静默超额）', async () => {
      missionFindUnique.mockResolvedValue({ ...missionBase, maxParticipants: 1 })
      membershipFindFirst.mockResolvedValue({ id: 'ms_1', organizationId: ORG, role: 'MEMBER' })
      partFindUnique.mockResolvedValue(null)
      partCount.mockResolvedValueOnce(0).mockResolvedValueOnce(2) // 写入前 0，写入后 2
      partUpsert.mockResolvedValue({ id: 'p_1' })
      const partUpdate = db.missionParticipation.update as unknown as jest.Mock
      partUpdate.mockResolvedValue({})

      await expect(joinMission('u_1', TOKEN, { note: null })).rejects.toBeInstanceOf(ConflictError)

      expect(partUpdate).toHaveBeenCalledWith({
        where: { id: 'p_1' },
        data: { status: 'WITHDRAWN' },
      })
      // 审计不得在失败路径上写"已加入"
      expect(auditCreate).not.toHaveBeenCalled()
    })
  })

  describe('getSharePageData —— 公开面', () => {
    const TOKEN = 'tok_abcdefghijklmnopqrstuv'

    it('DRAFT → not_found', async () => {
      missionFindUnique.mockResolvedValue({
        ...missionRow({ status: 'DRAFT' }),
        organization: { name: 'C', status: 'ACTIVE' },
      })
      expect(await getSharePageData(TOKEN, null)).toEqual({ kind: 'not_found' })
    })

    it('租户被停用 → not_found（停租户不得继续对外曝光）', async () => {
      missionFindUnique.mockResolvedValue({
        ...missionRow(),
        organization: { name: 'C', status: 'SUSPENDED' },
      })
      expect(await getSharePageData(TOKEN, null)).toEqual({ kind: 'not_found' })
    })

    it('token 不存在 → not_found', async () => {
      missionFindUnique.mockResolvedValue(null)
      expect(await getSharePageData(TOKEN, null)).toEqual({ kind: 'not_found' })
    })

    it('publicPreview=false 且**匿名** → auth_required（连标题都不给）', async () => {
      missionFindUnique.mockResolvedValue({
        ...missionRow({ publicPreview: false }),
        organization: { name: 'C', status: 'ACTIVE' },
      })
      expect(await getSharePageData(TOKEN, null)).toEqual({ kind: 'auth_required' })
    })

    it('publicPreview=false 但**本租户成员**可看', async () => {
      missionFindUnique.mockResolvedValue({
        ...missionRow({ publicPreview: false }),
        organization: { name: 'C', status: 'ACTIVE' },
      })
      membershipFindFirst.mockResolvedValue({ id: 'ms_1' })
      partFindUnique.mockResolvedValue(null)

      const out = await getSharePageData(TOKEN, 'u_1')
      expect(out.kind).toBe('view')
    })

    it('匿名可看：viewer 为 null，投影**不含**任何内部标识', async () => {
      missionFindUnique.mockResolvedValue({
        ...missionRow(),
        organization: { name: '跨境社群', status: 'ACTIVE' },
      })

      const out = await getSharePageData(TOKEN, null)
      expect(out.kind).toBe('view')
      if (out.kind !== 'view') throw new Error('unreachable')

      expect(out.viewer).toBeNull()
      const json = JSON.stringify(out.view)
      for (const field of ['id', 'organizationId', 'ownerId', 'shareToken', 'constraints']) {
        expect(json).not.toContain(`"${field}"`)
      }
      expect(out.view.community).toBe('跨境社群')
      expect(out.view.candidates).toEqual([])
      expect(out.view.candidatesAvailable).toBe(false)
    })

    it('已登录成员：viewer 暴露 joined/member 状态（供页面渲染），但不含内部 id', async () => {
      missionFindUnique.mockResolvedValue({
        ...missionRow(),
        organization: { name: 'C', status: 'ACTIVE' },
      })
      membershipFindFirst.mockResolvedValue({ id: 'ms_1' })
      partFindUnique.mockResolvedValue({ status: 'INTERESTED' })

      const out = await getSharePageData(TOKEN, 'u_1')
      if (out.kind !== 'view') throw new Error('unreachable')
      expect(out.viewer).toEqual({ joined: true, member: true })
    })
  })
})
