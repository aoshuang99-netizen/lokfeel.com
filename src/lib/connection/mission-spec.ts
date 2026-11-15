/**
 * V21 · C04 —— Mission 字段级编辑持久化 / 版本 / 并发保护（服务层）
 *
 * 设计约束：
 *   - GET 返回 success({...}) **对象** data（当前版本 + 历史摘要），不是数组；
 *   - POST 用 WorkspaceSpecSchema.safeParse 严格校验；
 *   - expectedVersion 不符 → 409 SPEC_VERSION_CONFLICT；
 *   - CLOSED 或已存在 EXECUTED 的关联 run → 409 MISSION_LOCKED；
 *   - 版本递增由 @@unique([missionId, version]) 在事务内兜底；
 *   - 所有查询带 organizationId 谓词；actorId 只取服务端会话。
 *
 * 🔴 不模拟执行成功：这里保存的是**用户修订过的 spec**，不是"任务已完成"。
 */

import { db } from '@/lib/db'
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { WorkspaceSpecSchema, type WorkspaceSpec } from '@/lib/workspace-spec/schema'
import { asObject } from './input-helpers'

export interface ParsedSpecSave {
  spec: WorkspaceSpec
  expectedVersion: number
  changeNote: string | null
}

/** 完整版本（当前版本返回它）。 */
export interface SpecRevisionView {
  id: string
  missionId: string
  version: number
  spec: WorkspaceSpec
  goal: string | null
  offer: string | null
  successCriteria: string | null
  expiresAt: string | null
  actorId: string
  createdAt: string
  changeNote: string | null
}

/** 历史版本摘要（不含 spec 正文，避免历史越攒越大）。 */
export interface SpecRevisionSummary {
  id: string
  version: number
  actorId: string
  createdAt: string
  changeNote: string | null
}

export interface MissionSpecState {
  missionId: string
  currentVersion: number
  current: SpecRevisionView | null
  history: SpecRevisionSummary[]
}

interface RevisionRow {
  id: string
  missionId: string
  organizationId: string
  version: number
  specJson: string
  goal: string | null
  offer: string | null
  successCriteria: string | null
  expiresAt: string | null
  changeNote: string | null
  actorId: string
  createdAt: Date
}

const SPEC_SAVE_KEYS = new Set(['spec', 'expectedVersion', 'changeNote'])
const CHANGE_NOTE_MAX = 500

/**
 * 严格校验 POST body。未知字段一律拒绝（与 WorkspaceSpec 的 strictObject 同一取向），
 * 而不是静默丢弃 —— 客户端拼错的键必须变成 400，不能变成"看起来保存成功了"。
 */
export function parseSpecSaveBody(body: unknown): ParsedSpecSave {
  const b = asObject(body)
  for (const key of Object.keys(b)) {
    if (!SPEC_SAVE_KEYS.has(key)) {
      throw new ValidationError(`Unknown field: ${key}`, { field: key })
    }
  }

  const parsed = WorkspaceSpecSchema.safeParse(b.spec)
  if (!parsed.success) {
    throw new ValidationError('spec must be a valid WorkspaceSpec v1.2', {
      field: 'spec',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    })
  }

  const ev = b.expectedVersion
  if (typeof ev !== 'number' || !Number.isInteger(ev) || ev < 0) {
    throw new ValidationError('expectedVersion must be a non-negative integer', {
      field: 'expectedVersion',
    })
  }

  let changeNote: string | null = null
  if (b.changeNote !== undefined && b.changeNote !== null) {
    if (typeof b.changeNote !== 'string' || b.changeNote.length > CHANGE_NOTE_MAX) {
      throw new ValidationError(`changeNote must be a string of at most ${CHANGE_NOTE_MAX} chars`, {
        field: 'changeNote',
      })
    }
    changeNote = b.changeNote.trim() || null
  }

  return { spec: parsed.data, expectedVersion: ev, changeNote }
}

function toRevisionView(row: RevisionRow): SpecRevisionView {
  return {
    id: row.id,
    missionId: row.missionId,
    version: row.version,
    spec: JSON.parse(row.specJson) as WorkspaceSpec,
    goal: row.goal ?? null,
    offer: row.offer ?? null,
    successCriteria: row.successCriteria ?? null,
    expiresAt: row.expiresAt ?? null,
    actorId: row.actorId,
    createdAt: new Date(row.createdAt).toISOString(),
    changeNote: row.changeNote ?? null,
  }
}

function toSummary(row: RevisionRow): SpecRevisionSummary {
  return {
    id: row.id,
    version: row.version,
    actorId: row.actorId,
    createdAt: new Date(row.createdAt).toISOString(),
    changeNote: row.changeNote ?? null,
  }
}

/** GET：当前版本 + 历史摘要。🔴 用 success({...}) **对象** data，不用 paginated() 数组。 */
export async function getMissionSpec(
  ctx: TenantContext,
  missionId: string
): Promise<MissionSpecState> {
  // 先按 (id, organizationId) 确认任务存在：跨租户一律 404，不泄露"该 id 存在"。
  const mission = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  if (!mission) throw new NotFoundError('Mission not found')

  const rows = (await db.missionSpecRevision.findMany({
    where: { missionId, organizationId: ctx.organizationId },
    orderBy: { version: 'desc' },
  })) as unknown as RevisionRow[]

  return {
    missionId,
    currentVersion: rows[0]?.version ?? 0,
    current: rows.length ? toRevisionView(rows[0]) : null,
    history: rows.map(toSummary),
  }
}

/** 从 spec 的 intent 节点投影业务字段（找不到即 null）。 */
function projectSpec(spec: WorkspaceSpec): {
  goal: string | null
  offer: string | null
  successCriteria: string | null
  expiresAt: string | null
} {
  for (const node of spec.nodes) {
    if (node.type === 'intent') {
      const d = node.data
      return {
        goal: d.goal ?? null,
        offer: d.offer ?? null,
        successCriteria: d.successCriteria.length ? JSON.stringify(d.successCriteria) : null,
        expiresAt: d.expiresAt ?? null,
      }
    }
  }
  return { goal: null, offer: null, successCriteria: null, expiresAt: null }
}

export async function saveMissionSpec(
  ctx: TenantContext,
  missionId: string,
  input: ParsedSpecSave
): Promise<MissionSpecState> {
  const mission = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: { id: true, status: true, sourceRunId: true },
  })
  if (!mission) throw new NotFoundError('Mission not found')

  // 🔒 锁定条件一：CLOSED 是终态。
  if (mission.status === 'CLOSED') {
    throw new ConflictError('Mission is locked', { code: 'MISSION_LOCKED' })
  }
  // 🔒 锁定条件二：已存在 EXECUTED 的关联 run —— 执行已经发生了，
  //    再覆盖 spec 会让"当时按哪份规格执行"无从追溯，故一律 409。
  if (mission.sourceRunId) {
    const executed = await db.agentRun.findFirst({
      where: { id: mission.sourceRunId, organizationId: ctx.organizationId, status: 'EXECUTED' },
      select: { id: true },
    })
    if (executed) {
      throw new ConflictError('Mission is locked: linked run already executed', {
        code: 'MISSION_LOCKED',
      })
    }
  }

  const latest = (await db.missionSpecRevision.findFirst({
    where: { missionId, organizationId: ctx.organizationId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })) as { version: number } | null
  const currentVersion = latest?.version ?? 0

  // 乐观并发：客户端基于的那一版必须是**当前**那一版。
  if (input.expectedVersion !== currentVersion) {
    throw new ConflictError('Spec version conflict', {
      code: 'SPEC_VERSION_CONFLICT',
      expectedVersion: input.expectedVersion,
      currentVersion,
    })
  }

  const projection = projectSpec(input.spec)
  const version = currentVersion + 1

  try {
    // 版本递增与写入放在同一事务；`@@unique([missionId, version])` 是并发下
    // 第二道（也是库级最后一道）保证：两个都读到 N 的请求，第二个必撞唯一键。
    await db.$transaction(async (tx) => {
      await tx.missionSpecRevision.create({
        data: {
          organizationId: ctx.organizationId,
          missionId,
          version,
          specJson: JSON.stringify(input.spec),
          ...projection,
          changeNote: input.changeNote,
          actorId: ctx.userId,
        },
      })
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('Spec version conflict', {
        code: 'SPEC_VERSION_CONFLICT',
        expectedVersion: input.expectedVersion,
      })
    }
    throw err
  }

  // 审计是旁路：失败不改变业务结果（与 writeTenantAudit 的约定一致）。
  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'mission.spec_revision_created',
    resourceType: 'mission_spec',
    resourceId: missionId,
    safeMetadata: { version, hasChangeNote: Boolean(input.changeNote) },
  }).catch(() => {})

  return getMissionSpec(ctx, missionId)
}
