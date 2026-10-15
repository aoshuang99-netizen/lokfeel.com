/**
 * T10 · Bridge **服务层** —— 协议聚合（发起 / 列表 / 双边审批 / 撤销）
 *
 * 本文件是 `CommunityBridge` **唯一**的写入口（`status` 列只在这里被改）。
 * 对内遵守一条铁律：**任何 UPDATE 之前必须先过内核真相表**
 * （`planBridgeTransition()`），且 UPDATE 本身带 `status` CAS 谓词 ——
 * 这样"两个群主同时批准"、"批准与撤销并发"都不会造出非法状态。
 *
 * ── 与内核的分工（与 T09 的 `agent` / `agents` 完全同构）──────────────
 *   `@/lib/bridge`（单数）  = 纯内核：状态机真相表 + 三方交集判定。无 IO，受门禁 B1/B2/B5。
 *   `@/lib/bridges`（复数） = 本目录：读写 DB、过租户能力、写审计。**import** 内核，反之不成立。
 *
 * ── 🔴 审计面最小化（plan.md §6 Slice 2 的硬要求）────────────────────
 *   审计只记**计数与状态**，**绝不**记字段键的**值**。理由：审计表的读者（合规/运营）
 *   与"谁 opt-in 了什么"的读者不是同一批人，把字段值写进审计等于给跨群授权开第二条泄漏面。
 *   唯一例外是 `purpose`：purpose limitation 要求**用途可被审计**，
 *   否则"这份共享是为什么开的"在事后无法回答。它由发起方自己撰写，不含对方数据。
 *
 * ── 关于 `recipientFieldKeys` 的语义（最容易误读的一处）──────────────
 *   创建时发起方**同时**给出两侧的字段集，其中 `recipientFieldKeys` 是**对另一侧的提议**。
 *   **被邀方批准 = 接受该提议**（`recipientApprovedAt` 落值），从此刻起内核 ①环 才成立。
 *   在此之前（`PENDING`）投影恒为空 —— 所以"发起方替对方配了字段"**不会**导致任何共享。
 *   若被邀方不同意，唯一的动作是**撤销**（本切片的 7 个端点里没有"改字段"，
 *   见 plan.md §5 与 §8.1 的诚实清单）。
 */

import type { Prisma } from '@/generated'
import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { can, type TenantCapability } from '@/lib/tenancy/capabilities'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { hashRequest, requireIdempotencyKey, withIdempotency } from '@/lib/connection/idempotency'
import { decodeStringArray } from '@/lib/connection/json-codec'
import { isFieldKey } from '@/lib/connection/field-catalog'
import {
  BRIDGE_STATUS_VIEWS,
  bridgeStatusView,
  normalizeFieldKeys,
  planBridgeTransition,
  type BridgeAction,
  type BridgeActionRefusal,
  type BridgeStatus,
  type BridgeStatusView,
  type BridgeView,
} from '@/lib/bridge'
import {
  sideOf,
  toBridgeDto,
  type BridgeDto,
  type BridgeRow,
  type MemberOptInRow,
} from './dto'

// ═══════════════════════════════════════════════════════════
// 常量与边界
// ═══════════════════════════════════════════════════════════

/** 幂等作用域（与 `IdempotencyRecord.scope` 对齐）。 */
export const BRIDGE_SCOPE = 'bridge.create'

export const BRIDGE_LIMITS = {
  /** 列表上限。 */
  listMax: 100,
  /** 跨群投影一次最多返回多少名成员。 */
  discoveryMax: 200,
  /** 单侧字段键数量上限（防止把整本目录倒进去当"全开"）。 */
  fieldKeysMax: 40,
  /** 可共享任务类型数量上限。 */
  missionKindsMax: 20,
  /** 单个任务类型的最大长度。 */
  missionKindMaxLength: 40,
  /** 用途声明最大长度。 */
  purposeMax: 200,
} as const

/** 协议行读取列（**显式列举** —— 新列默认不进入跨群链路）。 */
const BRIDGE_SELECT = {
  id: true,
  initiatorOrgId: true,
  recipientOrgId: true,
  status: true,
  initiatorFieldKeys: true,
  recipientFieldKeys: true,
  shareableMissionKinds: true,
  purpose: true,
  initiatorApprovedAt: true,
  recipientApprovedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const

// ═══════════════════════════════════════════════════════════
// 入参校验（**全部在服务端** —— 请求体属不可信输入）
// ═══════════════════════════════════════════════════════════

/** 提取路径参数 `bridgeId`。缺失/非法 → 404（路径段缺失属于"资源不存在"）。 */
export function requireBridgeId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new NotFoundError('Bridge not found')
  }
  return raw.trim()
}

/**
 * 校验并归一化字段键数组。
 *
 * 🔴 每个键都必须来自 T03 的**字段目录**（`isFieldKey`）—— 这一条把"跨群共享"
 *    限制在目录以内，不允许出现目录之外的自由字段（否则"最小披露"就没了基准）。
 *    目录之外的键**报 400 并列出违规值**，而不是静默丢弃：静默丢弃的症状是
 *    "我明明勾了却没有"，用户无从排查。
 */
export function requireFieldKeys(raw: unknown, field: string, allowEmpty = true): string[] {
  if (raw === undefined || raw === null) {
    if (allowEmpty) return []
    throw new ValidationError(`${field} is required`, { field })
  }
  if (!Array.isArray(raw)) {
    throw new ValidationError(`${field} must be an array of field keys`, { field })
  }
  const unknown = raw.filter((k) => !isFieldKey(k))
  if (unknown.length > 0) {
    throw new ValidationError(`${field} contains unknown field keys`, {
      field,
      unknown: unknown.map((k) => String(k)),
    })
  }
  const keys = normalizeFieldKeys(raw as string[])
  if (keys.length > BRIDGE_LIMITS.fieldKeysMax) {
    throw new ValidationError(
      `${field} must contain at most ${BRIDGE_LIMITS.fieldKeysMax} field keys`,
      { field, count: keys.length },
    )
  }
  return keys
}

/**
 * 校验可共享任务类型。
 *
 * ⚠️ 取值域是**自由文本**（任务类型尚未收敛成枚举，见 plan.md §8.2），
 *    因此这里只做**长度与非空**校验 —— 但**必须**做：否则它会退化成
 *    "什么都允许"的 `'*'`，而 `'*'` 恰好是"无范围限制"的同义词。
 */
export function requireMissionKinds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError('shareableMissionKinds must be a non-empty array of strings', {
      field: 'shareableMissionKinds',
    })
  }
  const kinds: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new ValidationError('shareableMissionKinds must contain only strings', {
        field: 'shareableMissionKinds',
      })
    }
    const v = item.trim()
    if (!v) {
      throw new ValidationError('shareableMissionKinds must not contain empty strings', {
        field: 'shareableMissionKinds',
      })
    }
    if (v === '*') {
      throw new ValidationError(
        "shareableMissionKinds must not contain '*' —— 跨群共享必须声明可共享的任务类型，不得退化为「全部」",
        { field: 'shareableMissionKinds' },
      )
    }
    if (v.length > BRIDGE_LIMITS.missionKindMaxLength) {
      throw new ValidationError(
        `shareableMissionKinds entries must be at most ${BRIDGE_LIMITS.missionKindMaxLength} characters`,
        { field: 'shareableMissionKinds', length: v.length },
      )
    }
    kinds.push(v)
  }
  const unique = [...new Set(kinds)]
  if (unique.length > BRIDGE_LIMITS.missionKindsMax) {
    throw new ValidationError(
      `shareableMissionKinds must contain at most ${BRIDGE_LIMITS.missionKindsMax} entries`,
      { field: 'shareableMissionKinds', count: unique.length },
    )
  }
  return unique
}

/** 校验用途声明（**必填** —— 跨群共享必须有可陈述的目的）。 */
export function requirePurpose(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationError('purpose is required (purpose limitation)', { field: 'purpose' })
  }
  const v = raw.trim()
  if (v.length > BRIDGE_LIMITS.purposeMax) {
    throw new ValidationError(`purpose must be at most ${BRIDGE_LIMITS.purposeMax} characters`, {
      field: 'purpose',
      length: v.length,
    })
  }
  return v
}

/** 校验被邀方组织 id（形状级）。存在性/是否自邀由 `createBridge` 在服务端回查。 */
export function requireRecipientOrgId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationError('recipientOrgId is required', { field: 'recipientOrgId' })
  }
  return raw.trim()
}

/** 解析 `?status=` —— 未知值 → 400（**不静默忽略**，否则用户以为过滤生效了）。 */
export function parseBridgeStatusView(raw: string | null): BridgeStatusView | undefined {
  if (raw === null || raw === '') return undefined
  if (!(BRIDGE_STATUS_VIEWS as readonly string[]).includes(raw)) {
    throw new ValidationError(`unknown status: ${raw}`, {
      field: 'status',
      allowed: BRIDGE_STATUS_VIEWS,
    })
  }
  return raw as BridgeStatusView
}

export function parseBridgeLimit(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(`limit must be a positive integer, got: ${raw}`, { field: 'limit' })
  }
  return Math.min(n, BRIDGE_LIMITS.listMax)
}

// ═══════════════════════════════════════════════════════════
// 行 → 内核视角
// ═══════════════════════════════════════════════════════════

/**
 * DB 行 → 内核 `BridgeView`。
 *
 * ⚠️ JSON 列的解析走 `decodeStringArray()`（**容错**）：一行脏数据只让那一行的字段集退化成
 *    `[]`（= 什么都不共享），而不是让整个列表 500。**降级方向必须是"更少共享"** ——
 *    这是本模块唯一可接受的解析失败语义。
 */
export function toBridgeView(row: BridgeRow): BridgeView {
  return {
    status: row.status as BridgeStatus,
    initiatorFieldKeys: decodeStringArray(row.initiatorFieldKeys),
    recipientFieldKeys: decodeStringArray(row.recipientFieldKeys),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }
}

/** Prisma 唯一约束冲突（P2002）。duck-typing 判定，避免为它 import 生成代码。 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}

// ═══════════════════════════════════════════════════════════
// 读取
// ═══════════════════════════════════════════════════════════

/**
 * 按 id 读一份协议，**同时**施加"观察者组织必须是当事方"的谓词。
 *
 * 🔴 谓词写在一起（而不是"先按 id 查、再断言是不是当事方"）：后者漏一次断言就是一次
 *    跨租户读取，而漏断言的代码在类型上是完全合法的。写进 `WHERE` 则**查询本身就查不到**
 *    —— 跨租户一律表现为 404（"不存在"），连"存在这一事实"都不泄露。
 */
export async function findBridgeRow(
  organizationId: string,
  bridgeId: string,
): Promise<BridgeRow | null> {
  return db.communityBridge.findFirst({
    where: {
      id: bridgeId,
      OR: [{ initiatorOrgId: organizationId }, { recipientOrgId: organizationId }],
    },
    select: BRIDGE_SELECT,
  })
}

/** opt-in 行读取列（同样显式列举）。 */
const OPT_IN_SELECT = {
  id: true,
  bridgeId: true,
  organizationId: true,
  userId: true,
  status: true,
  disclosedFieldKeys: true,
  optedInAt: true,
  withdrawnAt: true,
} as const

/**
 * 读取观察者自己的 opt-in 行（单条）。
 *
 * ⚠️ 写路径在 `./optins.ts`；本文件只做**读** —— 协议聚合的读路径需要它来算 `canOptOut`
 *    与 `myOptIn`，放在这里可以避免 `bridges ↔ optins` 的循环 import。
 */
export async function findMyOptInRow(
  bridgeId: string,
  userId: string,
): Promise<MemberOptInRow | null> {
  return db.bridgeMemberOptIn.findFirst({
    where: { bridgeId, userId },
    select: OPT_IN_SELECT,
  })
}

/** 批量读观察者的 opt-in（列表页用，避免 N+1）。 */
export async function findMyOptInRows(
  userId: string,
  bridgeIds: readonly string[],
): Promise<Map<string, MemberOptInRow>> {
  const out = new Map<string, MemberOptInRow>()
  if (bridgeIds.length === 0) return out
  const rows = await db.bridgeMemberOptIn.findMany({
    where: { userId, bridgeId: { in: [...bridgeIds] } },
    select: OPT_IN_SELECT,
  })
  for (const r of rows) out.set(r.bridgeId, r as MemberOptInRow)
  return out
}

/**
 * 状态过滤 → SQL 谓词。
 *
 * 🔴 `EXPIRED` 是**派生值**，落库只有三个状态，因此必须翻译成
 *    `status = 'ACTIVE' AND expiresAt <= now`。反过来 `ACTIVE` 过滤**必须**把过期行排除
 *    —— 用户筛"生效中"要的是**现在能用**的协议，而不是"状态列写着 ACTIVE"的协议。
 *    两条谓词互补且不重叠，恰好把落库的 `ACTIVE` 切干净。
 */
function statusWhere(view: BridgeStatusView, now: Date): Prisma.CommunityBridgeWhereInput {
  if (view === 'EXPIRED') {
    return { status: 'ACTIVE', expiresAt: { not: null, lte: now } }
  }
  if (view === 'ACTIVE') {
    return {
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }
  }
  return { status: view }
}

/** 用内核算出的状态视图 + 能力，得出 `canApprove` / `canRevoke`（DTO 的三态合取）。 */
function transitionFlags(
  row: BridgeRow,
  organizationId: string,
  canManage: boolean,
  now: Date,
): { canApprove: boolean; canRevoke: boolean } {
  const view = toBridgeView(row)
  const side = sideOf(row, organizationId)
  if (!canManage || side === null) return { canApprove: false, canRevoke: false }
  // 🔴 与 `decideBridge()` 用的是**同一个**纯函数 + 同一份输入（side 从行推导），
  //    所以"界面说能点、点了却 409"在结构上不存在。
  return {
    canApprove: planBridgeTransition(view, 'APPROVE', side, now).ok,
    canRevoke: planBridgeTransition(view, 'REVOKE', side, now).ok,
  }
}

// ═══════════════════════════════════════════════════════════
// 列表 / 详情
// ═══════════════════════════════════════════════════════════

export interface ListBridgesOptions {
  status?: BridgeStatusView
  limit?: number
  now?: Date
}

export interface ListBridgesResult {
  bridges: BridgeDto[]
  total: number
}

export async function listBridges(
  ctx: TenantContext,
  options: ListBridgesOptions = {},
): Promise<ListBridgesResult> {
  const now = options.now ?? new Date()
  const limit = Math.min(options.limit ?? BRIDGE_LIMITS.listMax, BRIDGE_LIMITS.listMax)
  const { canManage, canOptIn } = bridgeCapabilities(ctx)

  const where: Prisma.CommunityBridgeWhereInput = {
    OR: [
      { initiatorOrgId: ctx.organizationId },
      { recipientOrgId: ctx.organizationId },
    ],
    ...(options.status ? statusWhere(options.status, now) : {}),
  }

  const [rows, total] = await Promise.all([
    db.communityBridge.findMany({
      where,
      select: BRIDGE_SELECT,
      // 最近更新的排前面（新批准的协议应当立刻出现在顶部）。
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    }),
    db.communityBridge.count({ where }),
  ])

  const mine = await findMyOptInRows(ctx.userId, rows.map((r) => r.id))

  const bridges = (rows as BridgeRow[]).map((row) =>
    toBridgeDto(
      row,
      bridgeStatusView(toBridgeView(row), now),
      transitionFlags(row, ctx.organizationId, canManage, now),
      { organizationId: ctx.organizationId, canManage, canOptIn, myOptIn: mine.get(row.id) ?? null, now },
    ),
  )

  return { bridges, total }
}

export async function getBridge(
  ctx: TenantContext,
  bridgeId: string,
  now: Date = new Date(),
): Promise<BridgeDto> {
  const row = await findBridgeRow(ctx.organizationId, bridgeId)
  if (!row) throw new NotFoundError('Bridge not found')

  const myOptIn = await findMyOptInRow(row.id, ctx.userId)
  const { canManage, canOptIn } = bridgeCapabilities(ctx)

  return toBridgeDto(
    row,
    bridgeStatusView(toBridgeView(row), now),
    transitionFlags(row, ctx.organizationId, canManage, now),
    { organizationId: ctx.organizationId, canManage, canOptIn, myOptIn, now },
  )
}

// ═══════════════════════════════════════════════════════════
// 发起（幂等）
// ═══════════════════════════════════════════════════════════

export interface CreateBridgeInput {
  recipientOrgId: unknown
  initiatorFieldKeys: unknown
  recipientFieldKeys: unknown
  shareableMissionKinds: unknown
  purpose: unknown
  /** 来自 `Idempotency-Key` 请求头（**必需** —— 缺省不退化为非幂等）。 */
  idempotencyKey: unknown
  expiresAt?: unknown
}

export interface CreateBridgeResult {
  bridge: BridgeDto
  /** true = 命中幂等记录（本次未创建资源）。 */
  replayed: boolean
}

/** 解析可选的 `expiresAt`（ISO-8601 字符串或 null）。 */
function parseExpiresAt(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') {
    throw new ValidationError('expiresAt must be an ISO-8601 string', { field: 'expiresAt' })
  }
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) {
    throw new ValidationError('expiresAt must be a parseable ISO-8601 date', { field: 'expiresAt' })
  }
  return new Date(t)
}

/**
 * 发起一份跨群协议。
 *
 * 🔴 落库即 `PENDING`：发起方**创建即视为发起方已批准**（`initiatorApprovedAt` 落值），
 *    但 `recipientApprovedAt` 保持 `null` ⇒ 内核 `bridgeUsableReason()` 判 `BRIDGE_PENDING`
 *    ⇒ 投影恒为空。**代码里不存在"单边发起即可共享"的路径**。
 *
 * 四道服务端校验（每道对应一种"建出来就是错的"）：
 *   ① 被邀方组织必须存在且 `ACTIVE`；
 *   ② 不能邀请自己（自建协议在语义上是配置错误，且会让 ①环 的"双边"退化成单边）；
 *   ③ 字段键必须全部来自目录（`requireFieldKeys`）；
 *   ④ 一对组织之间**同时只能有一份**协议 —— 已存在则 409（库级 `@@unique` 兜底并发）。
 */
export async function createBridge(
  ctx: TenantContext,
  input: CreateBridgeInput,
  now: Date = new Date(),
): Promise<CreateBridgeResult> {
  const key = requireIdempotencyKey(input.idempotencyKey)

  const recipientOrgId = requireRecipientOrgId(input.recipientOrgId)
  const initiatorFieldKeys = requireFieldKeys(input.initiatorFieldKeys, 'initiatorFieldKeys')
  const recipientFieldKeys = requireFieldKeys(input.recipientFieldKeys, 'recipientFieldKeys')
  const shareableMissionKinds = requireMissionKinds(input.shareableMissionKinds)
  const purpose = requirePurpose(input.purpose)
  const expiresAt = parseExpiresAt(input.expiresAt)

  // ② 自邀检查放在 IO **之前**：形状/语义都不对的请求不该占用一把幂等键。
  if (recipientOrgId === ctx.organizationId) {
    throw new ValidationError('recipientOrgId must not be your own organization', {
      field: 'recipientOrgId',
    })
  }

  // ① 被邀方组织必须存在且启用。
  const recipient = await db.organization.findFirst({
    where: { id: recipientOrgId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!recipient) {
    throw new ValidationError('recipientOrgId does not reference an active organization', {
      field: 'recipientOrgId',
    })
  }

  // ④ 先查一次是"检查"，真正的并发安全由 `@@unique([initiatorOrgId, recipientOrgId])` 兜底
  //    （查到没冲突、写入时被抢先 → P2002 → 翻成 409）。与 `updateOrganization` 同一手法。
  const existing = await db.communityBridge.findFirst({
    where: { initiatorOrgId: ctx.organizationId, recipientOrgId },
    select: { id: true },
  })
  if (existing) {
    throw new ConflictError('A bridge between these two organizations already exists', {
      field: 'recipientOrgId',
      bridgeId: existing.id,
    })
  }

  const requestHash = hashRequest({
    recipientOrgId,
    initiatorFieldKeys,
    recipientFieldKeys,
    shareableMissionKinds,
    purpose,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  })

  const caps = bridgeCapabilities(ctx)
  const toDtoOf = async (row: BridgeRow): Promise<BridgeDto> => {
    const myOptIn = await findMyOptInRow(row.id, ctx.userId)
    return toBridgeDto(
      row,
      bridgeStatusView(toBridgeView(row), now),
      transitionFlags(row, ctx.organizationId, caps.canManage, now),
      {
        organizationId: ctx.organizationId,
        canManage: caps.canManage,
        canOptIn: caps.canOptIn,
        myOptIn,
        now,
      },
    )
  }

  const outcome = await withIdempotency<BridgeDto>({
    organizationId: ctx.organizationId,
    scope: BRIDGE_SCOPE,
    key,
    requestHash,
    resourceType: 'bridge',
    load: async (resourceId) => {
      const row = await findBridgeRow(ctx.organizationId, resourceId)
      return row ? toDtoOf(row) : null
    },
    create: async () => {
      let row: BridgeRow
      try {
        row = (await db.communityBridge.create({
          data: {
            initiatorOrgId: ctx.organizationId,
            recipientOrgId,
            status: 'PENDING',
            initiatorFieldKeys: JSON.stringify(initiatorFieldKeys),
            recipientFieldKeys: JSON.stringify(recipientFieldKeys),
            shareableMissionKinds: JSON.stringify(shareableMissionKinds),
            purpose,
            // 创建 = 发起方同意。
            initiatorApprovedAt: now,
            recipientApprovedAt: null,
            expiresAt,
            createdBy: ctx.userId,
          },
          select: BRIDGE_SELECT,
        })) as BridgeRow
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError('A bridge between these two organizations already exists', {
            field: 'recipientOrgId',
          })
        }
        throw err
      }

      // 审计是**旁路**：失败不改变业务结果（与 `writeTenantAudit` 的约定一致）。
      // 🔴 只记**计数与状态** —— 不记任何字段键的值（见文件头）。
      await writeTenantAudit({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        eventType: 'bridge.created',
        resourceType: 'bridge',
        resourceId: row.id,
        safeMetadata: {
          counterpartyOrgId: recipientOrgId,
          status: row.status,
          initiatorFieldCount: initiatorFieldKeys.length,
          recipientFieldCount: recipientFieldKeys.length,
          missionKindCount: shareableMissionKinds.length,
          hasExpiry: expiresAt !== null,
          // purpose 是**发起方自撰**的用途声明，且 purpose limitation 要求它可被审计。
          purpose,
        },
      }).catch(() => {})

      return { resourceId: row.id, resource: await toDtoOf(row) }
    },
    // 孤儿回收：幂等记录写失败且无法判定为并发重放时，删掉刚建的协议。
    // ⚠️ 这里用**硬删除**：建出来又被判定为孤儿的协议**从未生效**（PENDING），
    //    留着它会让"一对组织一份协议"的唯一约束挡住用户重试。
    compensate: async (resourceId) => {
      await db.communityBridge.deleteMany({ where: { id: resourceId } }).catch(() => {})
    },
  })

  return { bridge: outcome.resource, replayed: outcome.replayed }
}

// ═══════════════════════════════════════════════════════════
// 双边审批 / 撤销
// ═══════════════════════════════════════════════════════════

/** 内核动作拒绝码 → HTTP 语义的错误。**分开映射**，不让领域结论退化成统一的 400。 */
function actionRefusalToError(reason: BridgeActionRefusal, action: BridgeAction): Error {
  switch (reason) {
    case 'WRONG_SIDE':
      return new ForbiddenError(
        'Only the invited organization can approve a bridge; the initiator is approved on creation',
      )
    case 'NOT_A_PARTY':
      return new NotFoundError('Bridge not found')
    case 'ALREADY_ACTIVE':
      return new ConflictError('Bridge is already active')
    case 'BRIDGE_REVOKED':
      return new ConflictError('Bridge has been revoked and cannot be changed')
    case 'BRIDGE_EXPIRED':
      return new ConflictError('Bridge has expired; create a new one to share again')
    default:
      return new ConflictError(`Bridge cannot ${action.toLowerCase()} in its current state`)
  }
}

/**
 * 批准 / 撤销一份协议（**`status` 的唯一写入点**）。
 *
 * 🔴 三条结构性保证：
 *   ① 立场 `side` **从 DB 行推导**（`sideOf`），不从请求体读 —— 否则调用方可以
 *      自称"我是被邀方"来绕过 `WRONG_SIDE`。
 *   ② 迁移合法性由内核真相表判（`planBridgeTransition`），本函数只做**映射与落库**。
 *   ③ UPDATE 带 `status = plan.from` 的 CAS 谓词 —— 两个群主同时点批准、或
 *      "批准 vs 撤销"并发时，后到的那次 `updateMany` 影响 0 行 ⇒ 抛 409，
 *      **不会**出现"撤销后又被批准成 ACTIVE"这种时间倒流。
 */
export async function decideBridge(
  ctx: TenantContext,
  bridgeId: string,
  action: BridgeAction,
  now: Date = new Date(),
): Promise<BridgeDto> {
  const caps = bridgeCapabilities(ctx)
  const row = await findBridgeRow(ctx.organizationId, bridgeId)
  if (!row) throw new NotFoundError('Bridge not found')

  const side = sideOf(row, ctx.organizationId)
  if (side === null) {
    // 理论上不可达（`findBridgeRow` 已含当事方谓词）—— 留作纵深防御。
    throw new NotFoundError('Bridge not found')
  }

  const plan = planBridgeTransition(toBridgeView(row), action, side, now)
  if (!plan.ok) throw actionRefusalToError(plan.reason, action)

  const data: Prisma.CommunityBridgeUpdateManyMutationInput = { status: plan.to }
  if (plan.to === 'ACTIVE') data.recipientApprovedAt = now
  if (plan.to === 'REVOKED') {
    data.revokedAt = now
    data.revokedBy = ctx.userId
  }

  const updated = await db.communityBridge.updateMany({
    // 🔴 CAS：只有仍处于"我以为的起始状态"时才允许迁移。
    where: { id: row.id, status: plan.from },
    data,
  })
  if (updated.count === 0) {
    throw new ConflictError(
      'Bridge state changed concurrently; reload and retry',
      { bridgeId: row.id, expected: plan.from },
    )
  }

  const fresh = await findBridgeRow(ctx.organizationId, row.id)
  if (!fresh) throw new NotFoundError('Bridge not found')

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: plan.to === 'ACTIVE' ? 'bridge.approved' : 'bridge.revoked',
    resourceType: 'bridge',
    resourceId: fresh.id,
    // 只记状态迁移与立场，不记任何字段值。
    safeMetadata: { from: plan.from, to: plan.to, side },
  }).catch(() => {})

  const myOptIn = await findMyOptInRow(fresh.id, ctx.userId)
  return toBridgeDto(
    fresh,
    bridgeStatusView(toBridgeView(fresh), now),
    transitionFlags(fresh, ctx.organizationId, caps.canManage, now),
    {
      organizationId: ctx.organizationId,
      canManage: caps.canManage,
      canOptIn: caps.canOptIn,
      myOptIn,
      now,
    },
  )
}

/**
 * 能力取值（**服务层唯一**出现 `bridge.*` 字面量的地方）。
 *
 * 为什么收敛成一个函数：能力名是**字符串**，散落各处时一次笔误
 * （`'bridge.read'` 写成 `'bridge.optin'`）在类型上完全合法 —— 三个名字都是那个联合类型的成员。
 * 收敛后"哪三个能力"只在一处出现，改名字也只需改一处。
 *
 * ⚠️ 路由层**不**用它，而是直接用 `withTenant('bridge.read')` —— 那是**能力守卫**；
 *    本函数是给**服务层内部计算 DTO 的 `canX` 字段**用的（"界面该不该给按钮"）。
 *    两者必须一致，而它们共享同一份真相（`@/lib/tenancy/capabilities` 的 `can()`）。
 */
export function bridgeCapabilities(ctx: TenantContext): {
  canRead: boolean
  canManage: boolean
  canOptIn: boolean
} {
  const has = (c: TenantCapability) => can(ctx.role, c)
  return {
    canRead: has('bridge.read'),
    canManage: has('bridge.manage'),
    canOptIn: has('bridge.optin'),
  }
}

/** 本组织在一份协议里允许共享的字段集（成员 opt-in 的上界）。 */
export function allowedFieldKeysForSide(row: BridgeRow, organizationId: string): string[] {
  const side = sideOf(row, organizationId)
  if (side === 'INITIATOR') return normalizeFieldKeys(decodeStringArray(row.initiatorFieldKeys))
  if (side === 'RECIPIENT') return normalizeFieldKeys(decodeStringArray(row.recipientFieldKeys))
  return []
}
