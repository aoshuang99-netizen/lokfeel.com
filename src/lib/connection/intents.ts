/**
 * T03 · SocialIntent 领域服务
 *
 * 三条不变量（与 T02 的 `missions.ts` 同源，T03 追加第四条）：
 *
 *   1. **租户谓词不可省**：任何读写都同时带 `id` 与 `organizationId: ctx.organizationId`。
 *   2. **本人谓词不可省**：意图是**个人数据**，读写还须带 `userId: ctx.userId`。
 *      组织者读取走**另一条**路径（`listMissionIntentsForOrganizer`），且只拿到投影。
 *   3. **披露只从 `discloseSubject()` 出**：本文件绝不把 `SubjectProfile` 原样返回；
 *      唯一出口是披露投影（AC-03）。
 *   4. **状态派生而非存储**：`WITHDRAWN` 是存储终态；`EXPIRED` 由 `expiresAt` 派生。
 *      撤销/过期的意图在投影时**一律视为"无可披露字段"**（空披露表），
 *      这样不需要任何定时任务参与，也没有"任务停摆导致过期失效"的失败模式。
 *
 * 副作用（审计）一律 `.catch(() => {})`：审计是旁路，不得改变业务结果。
 */

import { db } from '@/lib/db'
import type { Prisma } from '@/generated'
import { ConflictError, NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { decodeStringArray, encodeJson } from './json-codec'
import {
  decodeDisclosure,
  describeDisclosure,
  discloseSubject,
  effectiveDisclosure,
  encodeDisclosure,
  type DisclosureMap,
  type DisclosureSummary,
  type DisclosedProfile,
} from './disclosure'
import type { DisclosureAudience, DisclosureFieldKey } from './field-catalog'
import type { IntentStatusAction, ParsedIntentCreate, ParsedIntentPatch } from './intent-input'
import { loadSubjectProfile, loadSubjectProfiles } from './subject-profile'

// ═══════════════════════════════════════════════════════════
// 派生状态
// ═══════════════════════════════════════════════════════════

/** 对外呈现的状态。存储层只有 ACTIVE / WITHDRAWN，EXPIRED 由有效期派生。 */
export type IntentStatusView = 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED'

interface IntentRow {
  id: string
  organizationId: string
  missionId: string
  userId: string
  need: string
  offer: string
  constraints: string | null
  disclosure: string | null
  status: string
  expiresAt: Date | null
  withdrawnAt: Date | null
  importConsentAt: Date | null
  importedFields: string | null
  createdAt: Date
  updatedAt: Date
}

const INTENT_SELECT = {
  id: true,
  organizationId: true,
  missionId: true,
  userId: true,
  need: true,
  offer: true,
  constraints: true,
  disclosure: true,
  status: true,
  expiresAt: true,
  withdrawnAt: true,
  importConsentAt: true,
  importedFields: true,
  createdAt: true,
  updatedAt: true,
} as const

/**
 * 判定"派生状态"所需的最小字段集。
 *
 * 刻意**收窄**而不是直接要求 `IntentRow`：调用方常常只查到两三列就要判状态
 * （例如 T04 的候选服务只 select 了 9 列），要求全行会逼着它们多查 6 列、
 * 或者写一个 `as IntentRow` 把类型断言当胶水 —— 后者会让"少查了列"这类错误
 * 一路滑到运行期才炸。
 */
export type IntentStatusSource = Pick<IntentRow, 'status' | 'expiresAt'>

/** 投影"当前实际生效的披露表"所需的最小字段集。 */
export type IntentDisclosureSource = Pick<IntentRow, 'disclosure' | 'status' | 'expiresAt'>

export function deriveIntentStatus(
  row: IntentStatusSource,
  now: Date = new Date()
): IntentStatusView {
  if (row.status === 'WITHDRAWN') return 'WITHDRAWN'
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return 'ACTIVE'
}

/**
 * **投影时真正生效**的披露表。
 *
 * 已撤销 / 已过期的意图返回空表 —— 这是"撤销"与"过期"具备实际约束力的地方：
 * 撤销不是只把 status 改一下，而是**当即可披露字段归零**，无需任何后台任务配合。
 */
export function liveDisclosureOf(
  row: IntentDisclosureSource,
  now: Date = new Date()
): DisclosureMap {
  if (row.status !== 'ACTIVE') return {}
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return {}
  return decodeDisclosure(row.disclosure)
}

// ═══════════════════════════════════════════════════════════
// DTO
// ═══════════════════════════════════════════════════════════

/** **本人视角**的完整 DTO（含披露配置本身）。组织者**永远拿不到**这个形状。 */
export interface IntentDto {
  id: string
  organizationId: string
  missionId: string
  userId: string
  need: string
  offer: string
  constraints: string[]
  /** 补齐缺省后的完整披露表（字段 → 档位）。 */
  disclosure: Record<DisclosureFieldKey, DisclosureAudience>
  /** 用户**显式设置过**的键（用于 UI 回显"哪些是你主动选的"）。 */
  explicitDisclosureKeys: DisclosureFieldKey[]
  /** 从账户档案导入的字段（可能为空）。 */
  importedFields: DisclosureFieldKey[]
  importConsentAt: string | null
  status: IntentStatusView
  expiresAt: string | null
  withdrawnAt: string | null
  createdAt: string
  updatedAt: string
}

export function toIntentDto(row: IntentRow, now: Date = new Date()): IntentDto {
  const explicit = decodeDisclosure(row.disclosure)
  return {
    id: row.id,
    organizationId: row.organizationId,
    missionId: row.missionId,
    userId: row.userId,
    need: row.need,
    offer: row.offer,
    constraints: decodeStringArray(row.constraints),
    disclosure: effectiveDisclosure(explicit),
    explicitDisclosureKeys: Object.keys(explicit) as DisclosureFieldKey[],
    importedFields: decodeStringArray(row.importedFields) as DisclosureFieldKey[],
    importConsentAt: row.importConsentAt ? row.importConsentAt.toISOString() : null,
    status: deriveIntentStatus(row, now),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** **组织者视角**：只有意图本身 + 按 ORGANIZER 受众投影后的字段子集。 */
export interface OrganizerIntentView {
  intentId: string
  need: string
  offer: string
  constraints: string[]
  status: IntentStatusView
  expiresAt: string | null
  createdAt: string
  /** 未授权字段的键**不存在**于此对象。 */
  subject: DisclosedProfile
}

// ═══════════════════════════════════════════════════════════
// 读（本人）
// ═══════════════════════════════════════════════════════════

/** 本人读单条。**id + organizationId + userId 三重谓词**，跨租户/他人一律表现为不存在。 */
export async function getIntentById(
  ctx: TenantContext,
  intentId: string,
  now: Date = new Date()
): Promise<IntentDto | null> {
  if (!intentId) return null
  const row = (await db.socialIntent.findFirst({
    where: { id: intentId, organizationId: ctx.organizationId, userId: ctx.userId },
    select: INTENT_SELECT,
  })) as IntentRow | null
  return row ? toIntentDto(row, now) : null
}

export async function getIntent(
  ctx: TenantContext,
  intentId: string,
  now: Date = new Date()
): Promise<IntentDto> {
  const found = await getIntentById(ctx, intentId, now)
  if (!found) throw new NotFoundError('Intent not found')
  return found
}

export interface ListIntentsOptions {
  missionId?: string | null
  page?: number
  pageSize?: number
}

export async function listMyIntents(
  ctx: TenantContext,
  options: ListIntentsOptions = {},
  now: Date = new Date()
): Promise<{ items: IntentDto[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)))
  const where = {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    ...(options.missionId ? { missionId: options.missionId } : {}),
  }

  const [total, rows] = await Promise.all([
    db.socialIntent.count({ where }),
    db.socialIntent.findMany({
      where,
      select: INTENT_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return {
    items: (rows as IntentRow[]).map((r) => toIntentDto(r, now)),
    total,
    page,
    pageSize,
  }
}

/** 披露预览：给**本人**看"哪些字段会披露给谁"，含真实值投影（PRD 用户故事）。 */
export interface DisclosurePreview {
  intentId: string
  status: IntentStatusView
  summary: DisclosureSummary
  /**
   * 各受众**实际**会看到的内容（用真实档案投影；不含未授权字段）。
   *
   * 三个受众的可见集合是**逐层变宽**的（档位包含式，见 field-catalog）：
   *   `candidate` ⊆ `counterparty` ⊆ `organizer`
   * 即组织者看到的最多，候选看到的最少。所以预览里出现
   * "某项在 organizer 有、在 candidate 没有"是**正确**的；
   * 反过来（candidate 有、organizer 没有）永远不该发生 —— 测试对此有断言。
   */
  preview: {
    organizer: DisclosedProfile
    candidate: DisclosedProfile
    counterparty: DisclosedProfile
  }
}

export async function previewDisclosure(
  ctx: TenantContext,
  intentId: string,
  now: Date = new Date()
): Promise<DisclosurePreview> {
  const row = (await db.socialIntent.findFirst({
    where: { id: intentId, organizationId: ctx.organizationId, userId: ctx.userId },
    select: INTENT_SELECT,
  })) as IntentRow | null
  if (!row) throw new NotFoundError('Intent not found')

  const live = liveDisclosureOf(row, now)
  const profile = (await loadSubjectProfile(row.userId)) ?? {}

  return {
    intentId: row.id,
    status: deriveIntentStatus(row, now),
    summary: describeDisclosure(live),
    preview: {
      organizer: discloseSubject(profile, live, 'ORGANIZER'),
      candidate: discloseSubject(profile, live, 'CANDIDATE'),
      counterparty: discloseSubject(profile, live, 'COUNTERPARTY'),
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 写（本人）
// ═══════════════════════════════════════════════════════════

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
  )
}

export async function createIntent(
  ctx: TenantContext,
  input: ParsedIntentCreate,
  now: Date = new Date()
): Promise<IntentDto> {
  // ① 任务必须属于本租户（跨租户 → 404，不泄露"存在"这一事实）
  const mission = await db.mission.findFirst({
    where: { id: input.missionId, organizationId: ctx.organizationId },
    select: { id: true, status: true },
  })
  if (!mission) throw new NotFoundError('Mission not found')

  // ② 任务必须已发布（草稿阶段成员看不到，自然也不该能提交意图）
  if (mission.status === 'DRAFT') {
    throw new ConflictError('Mission is not published yet')
  }
  if (mission.status === 'CLOSED') {
    throw new ConflictError('Mission is closed')
  }

  // ③ 必须先加入（父锚点：MissionParticipation）。
  //    这是 T02/T03 的分工边界：join 是"我要参与"，intent 是"我的诉求与披露范围"。
  const participation = await db.missionParticipation.findUnique({
    where: { missionId_userId: { missionId: mission.id, userId: ctx.userId } },
    select: { status: true },
  })
  if (!participation || participation.status !== 'INTERESTED') {
    throw new ConflictError('Join the mission before submitting an intent')
  }

  // ④ 一人一意图。已存在即 409（**不静默覆盖**：覆盖等于替用户丢弃旧授权设置）。
  const existing = (await db.socialIntent.findUnique({
    where: { missionId_userId: { missionId: mission.id, userId: ctx.userId } },
    select: { id: true, status: true },
  })) as { id: string; status: string } | null
  if (existing) {
    throw new ConflictError(
      existing.status === 'WITHDRAWN'
        ? 'Intent was withdrawn; reactivate it instead of creating a new one'
        : 'Intent already exists; update it instead of creating a new one'
    )
  }

  let row: IntentRow
  try {
    row = (await db.socialIntent.create({
      data: {
        organizationId: ctx.organizationId,
        missionId: mission.id,
        userId: ctx.userId,
        need: input.need,
        offer: input.offer,
        constraints: input.constraints.length ? encodeJson(input.constraints) : null,
        disclosure: encodeDisclosure(input.disclosure),
        status: 'ACTIVE',
        expiresAt: input.expiresAt,
        importConsentAt: input.importConsentGiven ? now : null,
        importedFields: input.importPlan.accepted.length
          ? encodeJson(input.importPlan.accepted)
          : null,
      },
      select: INTENT_SELECT,
    })) as IntentRow
  } catch (err) {
    // 并发下同一 (missionId,userId) 撞唯一约束 → 语义同 ④，转 409 而不是 500。
    if (isUniqueViolation(err)) {
      throw new ConflictError('Intent already exists; update it instead of creating a new one')
    }
    throw err
  }

  const explicit = decodeDisclosure(row.disclosure)
  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'intent.created',
    resourceType: 'intent',
    resourceId: row.id,
    // 只记录**结构性信息**：哪些键被授权、是否有敏感字段、是否用了档案导入。
    // 绝不记录 need/offer 正文（含业务敏感内容）。
    safeMetadata: {
      missionId: mission.id,
      grantedKeys: Object.keys(explicit),
      grantedToCounterparty: Object.entries(explicit)
        .filter(([, a]) => a === 'COUNTERPARTY')
        .map(([k]) => k),
      importedFields: input.importPlan.accepted,
      includesSensitiveImport: input.importPlan.includesSensitive,
    },
  }).catch(() => {})

  if (input.importConsentGiven) {
    // 导入许可是**独立的安全事件**：将来审计"某个字段是怎么进到披露范围的"时，
    // 必须能单独检索到它，而不是从 intent.created 的 metadata 里翻。
    await writeTenantAudit({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      eventType: 'intent.profile_import_consented',
      resourceType: 'intent',
      resourceId: row.id,
      safeMetadata: {
        fields: input.importPlan.accepted,
        includesSensitive: input.importPlan.includesSensitive,
      },
    }).catch(() => {})
  }

  return toIntentDto(row, now)
}

export async function updateIntent(
  ctx: TenantContext,
  intentId: string,
  patch: ParsedIntentPatch,
  now: Date = new Date()
): Promise<IntentDto> {
  const current = (await db.socialIntent.findFirst({
    where: { id: intentId, organizationId: ctx.organizationId, userId: ctx.userId },
    select: { id: true, status: true },
  })) as { id: string; status: string } | null
  if (!current) throw new NotFoundError('Intent not found')
  // 撤销是终态：可读不可改。要改必须先 reactivate（显式动作，留审计）。
  if (current.status === 'WITHDRAWN') {
    throw new ConflictError('Withdrawn intents are read-only; reactivate it first')
  }

  const data: Record<string, unknown> = {}
  if (patch.need !== undefined) data.need = patch.need
  if (patch.offer !== undefined) data.offer = patch.offer
  if (patch.constraints !== undefined) {
    data.constraints = patch.constraints.length ? encodeJson(patch.constraints) : null
  }
  if (patch.disclosure !== undefined) data.disclosure = encodeDisclosure(patch.disclosure)
  if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt

  const row = (await db.socialIntent.update({
    where: { id: current.id },
    data,
    select: INTENT_SELECT,
  })) as IntentRow

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'intent.updated',
    resourceType: 'intent',
    resourceId: row.id,
    safeMetadata: {
      fields: Object.keys(data).sort(),
      // 披露范围变化是安全相关事件，单独标注（值仍不记录）。
      disclosureKeys: patch.disclosure ? Object.keys(patch.disclosure) : undefined,
    },
  }).catch(() => {})

  return toIntentDto(row, now)
}

// ═══════════════════════════════════════════════════════════
// 写 —— 状态机（撤销 / 复活）
// ═══════════════════════════════════════════════════════════

const TRANSITIONS: Record<
  IntentStatusAction,
  { from: IntentStatusView[]; to: 'ACTIVE' | 'WITHDRAWN'; event: string }
> = {
  withdraw: { from: ['ACTIVE', 'EXPIRED'], to: 'WITHDRAWN', event: 'intent.withdrawn' },
  reactivate: { from: ['WITHDRAWN'], to: 'ACTIVE', event: 'intent.reactivated' },
}

/**
 * 撤销 / 复活。**幂等**：目标态已达成时直接返回当前状态（不报 409）。
 *
 * 为什么这里比 T02 的 mission 状态机宽松：这是**本人对自己数据**的动作，
 * 重复点击"撤销"却收到 409 只会制造噪音；而它不产生任何放大效应
 * （不像 publish 会对外可见）。反过来，`reactivate` 对已过期的意图会 409 ——
 * 因为"复活一个已经失效的意图"是空操作，应当要求先续期，避免用户以为已生效。
 */
export async function transitionIntent(
  ctx: TenantContext,
  intentId: string,
  action: IntentStatusAction,
  now: Date = new Date()
): Promise<IntentDto> {
  const current = (await db.socialIntent.findFirst({
    where: { id: intentId, organizationId: ctx.organizationId, userId: ctx.userId },
    select: INTENT_SELECT,
  })) as IntentRow | null
  if (!current) throw new NotFoundError('Intent not found')

  const rule = TRANSITIONS[action]
  const view = deriveIntentStatus(current, now)
  if (view === rule.to) return toIntentDto(current, now) // 幂等

  // reactivate 的额外前置：**撤销态会掩盖过期**（`deriveIntentStatus` 优先返回
  // WITHDRAWN），所以有效期必须在这里显式检查。否则"复活一个已经失效的意图"
  // 会写出一条立刻 EXPIRED 的 ACTIVE 行 —— 用户以为已生效，实际什么都没发生。
  if (
    action === 'reactivate' &&
    current.expiresAt &&
    current.expiresAt.getTime() <= now.getTime()
  ) {
    throw new ConflictError('Intent has expired; set a future expiresAt before reactivating')
  }

  if (!rule.from.includes(view)) {
    throw new ConflictError(`Cannot ${action} an intent in status ${view}`)
  }

  const data: Record<string, unknown> =
    rule.to === 'WITHDRAWN' ? { status: 'WITHDRAWN', withdrawnAt: now } : { status: 'ACTIVE', withdrawnAt: null }

  const row = (await db.socialIntent.update({
    where: { id: current.id },
    data,
    select: INTENT_SELECT,
  })) as IntentRow

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: rule.event,
    resourceType: 'intent',
    resourceId: row.id,
    safeMetadata: { from: view, to: rule.to },
  }).catch(() => {})

  return toIntentDto(row, now)
}

/** 硬删除（仅供幂等补偿使用）。业务删除走 `transitionIntent(withdraw)`。 */
export async function hardDeleteIntent(ctx: TenantContext, intentId: string): Promise<void> {
  await db.socialIntent.deleteMany({
    where: { id: intentId, organizationId: ctx.organizationId, userId: ctx.userId },
  })
}

// ═══════════════════════════════════════════════════════════
// 读（组织者视角）—— AC-03 的执法点
// ═══════════════════════════════════════════════════════════

/**
 * 某任务下的意图清单（**组织者/运营**视角）。
 *
 * 与本人视角的三点关键差异：
 *   1. 只列 `ACTIVE` 且**未过期**的意图（撤销/过期不该出现在运营视图里）；
 *   2. **不返回**披露配置本身、不返回 userId、不返回 email；
 *   3. 字段一律经 `discloseSubject(profile, live, 'ORGANIZER')` ——
 *      未被授权到 ORGANIZER 档的字段，其键在响应里**根本不存在**（AC-03 负测在此）。
 */
export async function listMissionIntentsForOrganizer(
  ctx: TenantContext,
  missionId: string,
  options: { page?: number; pageSize?: number } = {},
  now: Date = new Date()
): Promise<{ items: OrganizerIntentView[]; total: number; page: number; pageSize: number }> {
  const mission = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  if (!mission) throw new NotFoundError('Mission not found')

  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)))

  // 未过期 = expiresAt 为空 或 仍在未来。用 DB 条件表达，保证 total 与 items 口径一致。
  // 显式标注类型：否则 `'ACTIVE'` 会被宽化成 `string`，与 Prisma 的 IntentStatus 枚举不兼容。
  const where: Prisma.SocialIntentWhereInput = {
    organizationId: ctx.organizationId,
    missionId: mission.id,
    status: 'ACTIVE',
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }

  const [total, rows] = await Promise.all([
    db.socialIntent.count({ where }),
    db.socialIntent.findMany({
      where,
      select: INTENT_SELECT,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const typedRows = rows as IntentRow[]
  const profiles = await loadSubjectProfiles(typedRows.map((r) => r.userId))

  const items: OrganizerIntentView[] = typedRows.map((r) => {
    const profile = profiles.get(r.userId) ?? {}
    const live = liveDisclosureOf(r, now)
    return {
      intentId: r.id,
      need: r.need,
      offer: r.offer,
      constraints: decodeStringArray(r.constraints),
      status: deriveIntentStatus(r, now),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      // ⚠️ 唯一出口：白名单投影。不得改为返回 profile 原对象。
      subject: discloseSubject(profile, live, 'ORGANIZER'),
    }
  })

  return { items, total, page, pageSize }
}

// ═══════════════════════════════════════════════════════════
// 分享页上下文（`/m/<token>/intent` 专用）
// ═══════════════════════════════════════════════════════════

/**
 * 按分享令牌取「我在这条任务上的意图」。
 *
 * 为什么需要它：分享页的**公开投影**刻意不含 `missionId`（内部标识不进 DOM）。
 * 但提交意图需要 missionId，所以由服务端在**渲染前**把它取出来交给表单 ——
 * 数据留在服务端组件里，不进公开投影，也不出现在匿名可见的响应里。
 *
 * 令牌语义与 `getSharePageData` 保持一致：草稿一律表现为"不存在"。
 */
export async function getMyIntentByShareToken(
  shareToken: string,
  userId: string,
  now: Date = new Date()
): Promise<{ missionId: string; missionOpen: boolean; myIntent: IntentDto | null } | null> {
  const mission = await db.mission.findUnique({
    where: { shareToken },
    // V17（WB17-01）：把 organizationId 一起取出来，供下一条查询做租户谓词。
    // 分享令牌只是"能看见这个 mission"，**不是**"能看见这个租户的任何意图"。
    select: { id: true, status: true, expiresAt: true, organizationId: true },
  })
  if (!mission || mission.status === 'DRAFT') return null

  const row = (await db.socialIntent.findFirst({
    where: { missionId: mission.id, userId, organizationId: mission.organizationId },
    select: INTENT_SELECT,
  })) as IntentRow | null

  const expired = Boolean(mission.expiresAt && mission.expiresAt.getTime() <= now.getTime())
  return {
    missionId: mission.id,
    missionOpen: mission.status === 'ACTIVE' && !expired,
    myIntent: row ? toIntentDto(row, now) : null,
  }
}
