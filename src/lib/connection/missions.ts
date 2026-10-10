/**
 * T02 · Mission 领域服务（Connection OS 的第一个实体）
 *
 * 三条不变量（贯穿本文件，也是 T02 的安全底线）：
 *
 *   1. **租户谓词不可省**：任何对 Mission 的读写都**必须**同时带
 *      `id` 与 `organizationId: ctx.organizationId`。绝不先按 id 查出来再"顺便"
 *      比对租户 —— 那样在遗漏分支时会静默泄露（tests/connection 有防回归锁）。
 *
 *   2. **状态迁移是查表，不是猜**：`transitionMission` 的合法迁移集合显式列出，
 *      非法迁移一律 409。不得出现"看起来像发布就让它 ACTIVE"的隐式行为。
 *
 *   3. **公开面走白名单投影**：一切对外（匿名可达）输出都必须经
 *      `public-view.ts` 的 `toPublicMissionView()`，**不得**直接把 DB 行返回。
 *
 * 副作用（审计）一律以 `writeTenantAudit(...).catch(() => {})` 包裹：
 * 审计是旁路，其故障不得改变业务结果（与 T01 的约定一致）。
 */

import { db } from '@/lib/db'
import { ConflictError, NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import { resolveTenantForUser } from '@/lib/tenancy'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { decodeStringArray, encodeJson } from './json-codec'
import { generateShareToken } from './share-token'
import {
  toPublicMissionView,
  type PublicMissionStatus,
  type PublicMissionView,
} from './public-view'
import type { MissionAction, ParsedMissionCreate, ParsedMissionPatch } from './mission-input'

// ═══════════════════════════════════════════════════════════
// DTO
// ═══════════════════════════════════════════════════════════

export interface MissionDto {
  id: string
  organizationId: string
  ownerId: string
  title: string
  goal: string
  offer: string
  constraints: string[]
  successCriteria: string
  status: PublicMissionStatus
  publicPreview: boolean
  maxParticipants: number | null
  /** 分享路径（**只给路径，不拼绝对域名** —— 域名由 publicOriginOf 决定，见 T00 的窗口期教训）。 */
  sharePath: string
  shareToken: string
  expiresAt: string | null
  publishedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  participantCount: number
}

interface MissionRow {
  id: string
  organizationId: string
  ownerId: string
  title: string
  goal: string
  offer: string
  constraints: string | null
  successCriteria: string
  status: string
  shareToken: string
  publicPreview: boolean
  maxParticipants: number | null
  expiresAt: Date | null
  publishedAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function toMissionDto(row: MissionRow, participantCount: number): MissionDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerId: row.ownerId,
    title: row.title,
    goal: row.goal,
    offer: row.offer,
    constraints: decodeStringArray(row.constraints),
    successCriteria: row.successCriteria,
    status: row.status as PublicMissionStatus,
    publicPreview: row.publicPreview,
    maxParticipants: row.maxParticipants,
    sharePath: `/m/${row.shareToken}`,
    shareToken: row.shareToken,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    participantCount,
  }
}

const MISSION_SELECT = {
  id: true,
  organizationId: true,
  ownerId: true,
  title: true,
  goal: true,
  offer: true,
  constraints: true,
  successCriteria: true,
  status: true,
  shareToken: true,
  publicPreview: true,
  maxParticipants: true,
  expiresAt: true,
  publishedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

// ═══════════════════════════════════════════════════════════
// 读
// ═══════════════════════════════════════════════════════════

/**
 * 按 id 读单条（**租户谓词不可省**）。
 * `load` 供幂等重放使用：返回 null 表示资源不存在/不属于该租户。
 */
export async function getMissionById(
  ctx: TenantContext,
  missionId: string
): Promise<MissionDto | null> {
  if (!missionId) return null
  const row = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: MISSION_SELECT,
  })
  if (!row) return null
  return toMissionDto(row, await countParticipants(row.id))
}

/** 同 `getMissionById`，但不存在时抛 404（路由层用）。 */
export async function getMission(ctx: TenantContext, missionId: string): Promise<MissionDto> {
  const found = await getMissionById(ctx, missionId)
  if (!found) throw new NotFoundError('Mission not found')
  return found
}

export interface ListMissionsOptions {
  page?: number
  pageSize?: number
  status?: PublicMissionStatus | null
}

export async function listMissions(
  ctx: TenantContext,
  options: ListMissionsOptions = {}
): Promise<{ items: MissionDto[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)))
  const where = {
    organizationId: ctx.organizationId,
    ...(options.status ? { status: options.status } : {}),
  }

  const [total, rows] = await Promise.all([
    db.mission.count({ where }),
    db.mission.findMany({
      where,
      select: MISSION_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const counts = await countParticipantsFor(rows.map((r) => r.id))

  return {
    items: rows.map((r) => toMissionDto(r, counts.get(r.id) ?? 0)),
    total,
    page,
    pageSize,
  }
}

/** 单个任务的参与人数（只计 INTERESTED）。 */
export async function countParticipants(missionId: string): Promise<number> {
  try {
    return await db.missionParticipation.count({
      where: { missionId, status: 'INTERESTED' },
    })
  } catch {
    return 0
  }
}

/** 批量计数。用 groupBy 而不是 N 次 count —— 列表页是热路径。 */
async function countParticipantsFor(missionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (missionIds.length === 0) return out
  try {
    const grouped = await db.missionParticipation.groupBy({
      by: ['missionId'],
      where: { missionId: { in: missionIds }, status: 'INTERESTED' },
      _count: { _all: true },
    })
    for (const g of grouped) {
      out.set(g.missionId, (g._count as { _all?: number })?._all ?? 0)
    }
  } catch {
    // 计数失败不得让列表整体 500：退化为 0，并且下面的兜底不伪造数字。
    return out
  }
  return out
}

// ═══════════════════════════════════════════════════════════
// 写 —— 创建
// ═══════════════════════════════════════════════════════════

/** 生成唯一 shareToken 的最大尝试次数（碰撞概率可忽略，仅作防御）。 */
const SHARE_TOKEN_ATTEMPTS = 3

export async function createMission(
  ctx: TenantContext,
  input: ParsedMissionCreate
): Promise<MissionDto> {
  const now = new Date()

  let row: MissionRow | null = null
  let lastErr: unknown = null

  for (let attempt = 0; attempt < SHARE_TOKEN_ATTEMPTS; attempt++) {
    try {
      row = (await db.mission.create({
        data: {
          organizationId: ctx.organizationId,
          ownerId: ctx.userId,
          title: input.title,
          goal: input.goal,
          offer: input.offer,
          constraints: input.constraints.length ? encodeJson(input.constraints) : null,
          successCriteria: input.successCriteria,
          status: input.publish ? 'ACTIVE' : 'DRAFT',
          publishedAt: input.publish ? now : null,
          shareToken: generateShareToken(),
          publicPreview: input.publicPreview,
          maxParticipants: input.maxParticipants,
          expiresAt: input.expiresAt,
        },
        select: MISSION_SELECT,
      })) as MissionRow
      break
    } catch (err) {
      lastErr = err
      // P2002 = 唯一约束冲突。只可能是 shareToken 撞了（id 是 cuid）。
      if (!isUniqueViolation(err)) throw err
    }
  }

  if (!row) throw lastErr ?? new Error('Failed to create mission')

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'mission.created',
    resourceType: 'mission',
    resourceId: row.id,
    // 只记录结构性信息，不记录 goal/offer 正文（可能含业务敏感内容）。
    safeMetadata: { status: row.status, published: row.status === 'ACTIVE' },
  }).catch(() => {})

  return toMissionDto(row, 0)
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  )
}

/**
 * 硬删除（仅供幂等补偿使用）。
 * 注意：**没有**对外暴露的删除路由 —— 业务删除走 `transitionMission(close)`。
 */
export async function hardDeleteMission(ctx: TenantContext, missionId: string): Promise<void> {
  await db.mission.deleteMany({
    where: { id: missionId, organizationId: ctx.organizationId },
  })
}

// ═══════════════════════════════════════════════════════════
// 写 —— 更新 / 状态机
// ═══════════════════════════════════════════════════════════

export async function updateMission(
  ctx: TenantContext,
  missionId: string,
  patch: ParsedMissionPatch
): Promise<MissionDto> {
  const current = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: { id: true, status: true },
  })
  if (!current) throw new NotFoundError('Mission not found')
  // CLOSED 是终态：可读不可改。要改必须先显式"重开"（本任务不提供，避免隐式复活）。
  if (current.status === 'CLOSED') {
    throw new ConflictError('Closed missions are read-only')
  }

  const data: Record<string, unknown> = {}
  if (patch.title !== undefined) data.title = patch.title
  if (patch.goal !== undefined) data.goal = patch.goal
  if (patch.offer !== undefined) data.offer = patch.offer
  if (patch.successCriteria !== undefined) data.successCriteria = patch.successCriteria
  if (patch.constraints !== undefined) {
    data.constraints = patch.constraints.length ? encodeJson(patch.constraints) : null
  }
  if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt
  if (patch.maxParticipants !== undefined) data.maxParticipants = patch.maxParticipants
  if (patch.publicPreview !== undefined) data.publicPreview = patch.publicPreview

  const row = (await db.mission.update({
    where: { id: current.id },
    data,
    select: MISSION_SELECT,
  })) as MissionRow

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'mission.updated',
    resourceType: 'mission',
    resourceId: row.id,
    // 只记录**改动的字段名**，不记录改动内容（避免 PII / 业务内容进审计）。
    safeMetadata: { fields: Object.keys(data).sort() },
  }).catch(() => {})

  return toMissionDto(row, await countParticipants(row.id))
}

/** 状态机：显式列出合法迁移。未列出的组合一律 409。 */
const TRANSITIONS: Record<MissionAction, { from: PublicMissionStatus[]; to: PublicMissionStatus }> = {
  publish: { from: ['DRAFT', 'PAUSED'], to: 'ACTIVE' },
  pause: { from: ['ACTIVE'], to: 'PAUSED' },
  resume: { from: ['PAUSED'], to: 'ACTIVE' },
  close: { from: ['DRAFT', 'ACTIVE', 'PAUSED'], to: 'CLOSED' },
}

/** 动作 → 审计事件名。**显式映射**，不做字符串拼接变形（易错且难读）。 */
const ACTION_EVENT: Record<MissionAction, string> = {
  publish: 'mission.published',
  pause: 'mission.paused',
  resume: 'mission.resumed',
  close: 'mission.closed',
}

export async function transitionMission(
  ctx: TenantContext,
  missionId: string,
  action: MissionAction,
  now: Date = new Date()
): Promise<MissionDto> {
  const current = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: { id: true, status: true, publishedAt: true },
  })
  if (!current) throw new NotFoundError('Mission not found')

  const rule = TRANSITIONS[action]
  const from = current.status as PublicMissionStatus
  if (!rule.from.includes(from)) {
    throw new ConflictError(`Cannot ${action} a mission in status ${from}`)
  }

  const data: Record<string, unknown> = { status: rule.to }
  if (rule.to === 'ACTIVE' && !current.publishedAt) data.publishedAt = now
  if (rule.to === 'CLOSED') data.closedAt = now

  const row = (await db.mission.update({
    where: { id: current.id },
    data,
    select: MISSION_SELECT,
  })) as MissionRow

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: ACTION_EVENT[action],
    resourceType: 'mission',
    resourceId: row.id,
    safeMetadata: { from, to: rule.to },
  }).catch(() => {})

  return toMissionDto(row, await countParticipants(row.id))
}

// ═══════════════════════════════════════════════════════════
// 写 —— 加入
// ═══════════════════════════════════════════════════════════

export interface JoinResult {
  missionId: string
  participationId: string
  status: 'INTERESTED'
  /** true = 之前已加入，本次为幂等命中（未产生新记录）。 */
  alreadyJoined: boolean
}

/**
 * 加入 Mission。**要求已登录，且必须是该 Mission 所属租户的 ACTIVE 成员。**
 *
 * 租户事实来源：`mission.organizationId`（**DB 行**），不是请求里的任何字段。
 * 然后回查 memberships 确认「该用户确实是该租户成员」——
 * 这正是 contracts/schema.sql:64「绝不信任客户端传入 organization_id」的落点。
 */
export async function joinMission(
  userId: string,
  shareToken: string,
  input: { note: string | null }
): Promise<JoinResult> {
  const mission = await db.mission.findUnique({
    where: { shareToken },
    select: {
      id: true,
      organizationId: true,
      status: true,
      expiresAt: true,
      maxParticipants: true,
    },
  })
  if (!mission || mission.status === 'DRAFT') {
    // DRAFT 的 token 一律表现为"不存在" —— 不泄露"有个未发布的草稿"这一事实。
    throw new NotFoundError('Mission not found')
  }

  // 授权：必须是该租户的 ACTIVE 成员（否则抛 403 并写 access_denied 审计）。
  await resolveTenantForUser(userId, { organizationId: mission.organizationId })

  const taken = await countParticipants(mission.id)
  const capacity = mission.maxParticipants ?? null
  const now = new Date()

  if (mission.status === 'PAUSED') throw new ConflictError('Mission is paused and not accepting participants')
  if (mission.status === 'CLOSED') throw new ConflictError('Mission is closed')
  if (mission.expiresAt && mission.expiresAt.getTime() <= now.getTime()) {
    throw new ConflictError('Mission has expired')
  }

  const existing = await db.missionParticipation.findUnique({
    where: { missionId_userId: { missionId: mission.id, userId } },
    select: { id: true, status: true },
  })

  // 已加入 → 幂等返回（**不**再占名额、**不**重复写审计）。
  if (existing && existing.status === 'INTERESTED') {
    return {
      missionId: mission.id,
      participationId: existing.id,
      status: 'INTERESTED',
      alreadyJoined: true,
    }
  }

  if (capacity !== null && taken >= capacity) {
    throw new ConflictError('Mission is full')
  }

  const participation = await db.missionParticipation.upsert({
    where: { missionId_userId: { missionId: mission.id, userId } },
    create: {
      organizationId: mission.organizationId,
      missionId: mission.id,
      userId,
      status: 'INTERESTED',
      note: input.note,
    },
    update: { status: 'INTERESTED', note: input.note },
    select: { id: true },
  })

  // 名额竞态兜底：并发加入可能让 taken 超出 capacity。
  // 这里「先写再核对、超了就补偿回滚」——代价是一次额外计数，
  // 换来的是**不会静默超额**（T06 会用事务/队列做更强的保证）。
  if (capacity !== null) {
    const after = await countParticipants(mission.id)
    if (after > capacity) {
      await db.missionParticipation
        .update({
          where: { id: participation.id },
          data: { status: 'WITHDRAWN' },
        })
        .catch(() => {})
      throw new ConflictError('Mission is full')
    }
  }

  await writeTenantAudit({
    organizationId: mission.organizationId,
    actorId: userId,
    eventType: 'mission.joined',
    resourceType: 'mission',
    resourceId: mission.id,
    safeMetadata: { hasNote: Boolean(input.note) },
  }).catch(() => {})

  return {
    missionId: mission.id,
    participationId: participation.id,
    status: 'INTERESTED',
    alreadyJoined: false,
  }
}

/** 退出（本人撤销）。幂等：未加入时也返回成功（不制造"失败"噪音）。 */
export async function withdrawFromMission(userId: string, missionId: string): Promise<void> {
  await db.missionParticipation.updateMany({
    where: { missionId, userId, status: 'INTERESTED' },
    data: { status: 'WITHDRAWN' },
  })
}

// ═══════════════════════════════════════════════════════════
// 公开面（匿名可达）—— 唯一出口
// ═══════════════════════════════════════════════════════════

export type SharePageResult =
  | { kind: 'not_found' }
  | { kind: 'auth_required' }
  | {
      kind: 'view'
      view: PublicMissionView
      viewer: { joined: boolean; member: boolean } | null
    }

/**
 * 分享页数据。**同时服务于**：
 *   - `/api/v1/public/missions/[token]`（匿名 JSON，`viewerUserId = null`）
 *   - `/m/[token]` 服务端渲染（可带会话，用于显示"已加入/管理"）
 * 一份实现两个消费者 —— 避免"页面能看、API 看不到"这类投影漂移。
 *
 * 隐私取舍：`publicPreview === false` 时匿名访客只拿到 `auth_required`，
 * 连标题都不披露（标题也可能含敏感信息）。
 */
export async function getSharePageData(
  shareToken: string,
  viewerUserId: string | null = null,
  now: Date = new Date()
): Promise<SharePageResult> {
  const mission = await db.mission.findUnique({
    where: { shareToken },
    select: {
      ...MISSION_SELECT,
      organization: { select: { name: true, status: true } },
    },
  })

  // 草稿 / 租户停用 → 一律"不存在"（不泄露内部状态）。
  if (!mission) return { kind: 'not_found' }
  if (mission.status === 'DRAFT') return { kind: 'not_found' }
  if (mission.organization?.status !== 'ACTIVE') return { kind: 'not_found' }

  let viewer: { joined: boolean; member: boolean } | null = null
  if (viewerUserId) {
    const [membership, participation] = await Promise.all([
      db.membership.findFirst({
        where: {
          userId: viewerUserId,
          organizationId: mission.organizationId,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
      db.missionParticipation.findUnique({
        where: { missionId_userId: { missionId: mission.id, userId: viewerUserId } },
        select: { status: true },
      }),
    ])
    viewer = {
      member: Boolean(membership),
      joined: participation?.status === 'INTERESTED',
    }
  }

  if (!mission.publicPreview && !viewer?.member) {
    return { kind: 'auth_required' }
  }

  const view = toPublicMissionView(
    {
      title: mission.title,
      goal: mission.goal,
      offer: mission.offer,
      successCriteria: mission.successCriteria,
      status: mission.status as PublicMissionStatus,
      expiresAt: mission.expiresAt,
      publishedAt: mission.publishedAt,
    },
    {
      participantCount: await countParticipants(mission.id),
      communityName: mission.organization?.name ?? null,
      // 名额语义显式传入（原件字段不出现在公开投影里，见 public-view.ts）。
      capacity: mission.maxParticipants,
      now,
    }
  )

  return { kind: 'view', view, viewer }
}
