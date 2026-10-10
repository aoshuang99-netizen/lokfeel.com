/**
 * T02 · Mission 输入校验（**写路径的唯一收口**）
 *
 * 为什么单独一个文件：
 *   主指令要求「LLM 输出必须 schema 校验并有人工修订」——同样地，**HTTP 输入必须
 *   经确定性校验**后才能进入领域逻辑。把校验集中在纯函数里，有三个好处：
 *     1. 可被纯单测覆盖（无需 DB / 无需起服务）；
 *     2. 路由层保持"薄"，不出现散落的 `Number(body.x) || 0` 这类隐式兜底；
 *     3. 未知/多余字段被**显式丢弃**，而不是被 Prisma 原样写库（防"客户端塞额外列"）。
 *
 * 所有失败一律抛 `ValidationError`（400），并带 `details.field` 便于前端定位。
 */

import { ValidationError } from '@/lib/errors'
import { normalizeStringArray } from './json-codec'

// ── 字段长度约束（与 contracts + reference_backend/app/main.py 的 Field(...) 对齐）──
export const LIMITS = {
  goalMin: 8,
  goalMax: 1000,
  offerMin: 1,
  offerMax: 500,
  successCriteriaMin: 5,
  successCriteriaMax: 500,
  titleMax: 120,
  noteMax: 500,
  maxParticipantsMin: 1,
  maxParticipantsMax: 10000,
} as const

function fail(field: string, message: string): never {
  throw new ValidationError(message, { field })
}

/** 必填字符串：trim 后校验长度。 */
function requiredString(
  value: unknown,
  field: string,
  min: number,
  max: number
): string {
  if (typeof value !== 'string') fail(field, `${field} must be a string`)
  const s = (value as string).trim()
  if (s.length < min) fail(field, `${field} must be at least ${min} characters`)
  if (s.length > max) fail(field, `${field} must be at most ${max} characters`)
  return s
}

/** 可选字符串：`undefined`/`null`/`''` → `null`。 */
function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') fail(field, `${field} must be a string`)
  const s = (value as string).trim()
  if (!s) return null
  if (s.length > max) fail(field, `${field} must be at most ${max} characters`)
  return s
}

function optionalInt(
  value: unknown,
  field: string,
  min: number,
  max: number
): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    fail(field, `${field} must be an integer`)
  }
  if (n < min || n > max) {
    fail(field, `${field} must be between ${min} and ${max}`)
  }
  return n
}

function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') fail(field, `${field} must be a boolean`)
  return value as boolean
}

/**
 * 日期：接受 ISO 字符串或 Date。`requireFuture` 用于创建（截止时间必须在未来，
 * 否则任务一创建就是失效态）；更新时允许把截止时间改到过去（用于"立即结束"）。
 */
function optionalDate(
  value: unknown,
  field: string,
  opts: { requireFuture?: boolean; now?: Date } = {}
): Date | null {
  if (value === undefined || value === null || value === '') return null
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) fail(field, `${field} must be a valid ISO-8601 date`)
  if (opts.requireFuture) {
    const now = opts.now ?? new Date()
    if (d.getTime() <= now.getTime()) fail(field, `${field} must be in the future`)
  }
  return d
}

/** 只允许纯对象（拒绝数组/标量），否则无法安全地按字段取值。 */
function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════
// 创建
// ═══════════════════════════════════════════════════════════

export interface ParsedMissionCreate {
  title: string
  goal: string
  offer: string
  constraints: string[]
  successCriteria: string
  expiresAt: Date | null
  maxParticipants: number | null
  publicPreview: boolean
  publish: boolean
}

export function parseMissionCreate(body: unknown, now: Date = new Date()): ParsedMissionCreate {
  const b = asObject(body)

  const goal = requiredString(b.goal, 'goal', LIMITS.goalMin, LIMITS.goalMax)
  const offer = requiredString(b.offer, 'offer', LIMITS.offerMin, LIMITS.offerMax)
  const successCriteria = requiredString(
    b.successCriteria,
    'successCriteria',
    LIMITS.successCriteriaMin,
    LIMITS.successCriteriaMax
  )

  // title 可省略：以 goal 前 80 字兜底。**在写路径派生**而不是让 DB 出现空标题，
  // 因为分享页/列表都把它当标题渲染。
  const title =
    optionalString(b.title, 'title', LIMITS.titleMax) ?? goal.slice(0, 80)

  return {
    title,
    goal,
    offer,
    constraints: normalizeStringArray(b.constraints),
    successCriteria,
    expiresAt: optionalDate(b.expiresAt, 'expiresAt', { requireFuture: true, now }),
    maxParticipants: optionalInt(
      b.maxParticipants,
      'maxParticipants',
      LIMITS.maxParticipantsMin,
      LIMITS.maxParticipantsMax
    ),
    publicPreview: optionalBool(b.publicPreview, 'publicPreview') ?? true,
    // 契约的 MissionIn.discoverable 对应本仓的"是否立即发布"。
    // 语义映射：discoverable=true ⇔ 立即 ACTIVE；缺省先落 DRAFT（保守：不自动对外可见）。
    publish: optionalBool(b.publish, 'publish') ?? optionalBool(b.discoverable, 'discoverable') ?? false,
  }
}

// ═══════════════════════════════════════════════════════════
// 更新（PATCH 语义：只改显式给出的字段）
// ═══════════════════════════════════════════════════════════

export interface ParsedMissionPatch {
  title?: string
  goal?: string
  offer?: string
  constraints?: string[]
  successCriteria?: string
  expiresAt?: Date | null
  maxParticipants?: number | null
  publicPreview?: boolean
}

export function parseMissionPatch(body: unknown, now: Date = new Date()): ParsedMissionPatch {
  const b = asObject(body)
  const patch: ParsedMissionPatch = {}

  if ('title' in b) patch.title = requiredString(b.title, 'title', 1, LIMITS.titleMax)
  if ('goal' in b) patch.goal = requiredString(b.goal, 'goal', LIMITS.goalMin, LIMITS.goalMax)
  if ('offer' in b) patch.offer = requiredString(b.offer, 'offer', LIMITS.offerMin, LIMITS.offerMax)
  if ('successCriteria' in b) {
    patch.successCriteria = requiredString(
      b.successCriteria,
      'successCriteria',
      LIMITS.successCriteriaMin,
      LIMITS.successCriteriaMax
    )
  }
  if ('constraints' in b) patch.constraints = normalizeStringArray(b.constraints)
  if ('expiresAt' in b) {
    // 更新允许把截止时间提前（例如"今天结束"），故不要求未来。
    patch.expiresAt = optionalDate(b.expiresAt, 'expiresAt', { now })
  }
  if ('maxParticipants' in b) {
    patch.maxParticipants = optionalInt(
      b.maxParticipants,
      'maxParticipants',
      LIMITS.maxParticipantsMin,
      LIMITS.maxParticipantsMax
    )
  }
  if ('publicPreview' in b) {
    patch.publicPreview = optionalBool(b.publicPreview, 'publicPreview')
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Patch must contain at least one updatable field')
  }
  return patch
}

// ═══════════════════════════════════════════════════════════
// 加入
// ═══════════════════════════════════════════════════════════

export interface ParsedJoin {
  note: string | null
}

export function parseJoin(body: unknown): ParsedJoin {
  if (body === undefined || body === null || body === '') return { note: null }
  const b = asObject(body)
  return { note: optionalString(b.note, 'note', LIMITS.noteMax) }
}

// ═══════════════════════════════════════════════════════════
// 状态机动作
// ═══════════════════════════════════════════════════════════

export const MISSION_ACTIONS = ['publish', 'pause', 'resume', 'close'] as const
export type MissionAction = (typeof MISSION_ACTIONS)[number]

export function parseMissionAction(value: unknown): MissionAction {
  if (typeof value === 'string' && (MISSION_ACTIONS as readonly string[]).includes(value)) {
    return value as MissionAction
  }
  return fail('action', `action must be one of: ${MISSION_ACTIONS.join(', ')}`)
}
