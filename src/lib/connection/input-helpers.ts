/**
 * T03 · 输入校验原语（T02 的 `mission-input.ts` 与本任务的 `intent-input.ts` 共用）
 *
 * 抽出来的动因是**去重而非复用**：两个模块原本各自实现了一套 `requiredString` /
 * `optionalInt` / `optionalDate`。一旦它们的边界行为（trim、空串转 null、日期可解析性）
 * 出现分叉，就会出现"同一个 `expiresAt` 在任务创建通过、在意图提交被拒"这类
 * 难以排查的不一致。集中到一处后，行为只有一种。
 *
 * 所有失败一律抛 `ValidationError`（400）并带 `details.field`：
 * 前端可以直接把错误定位到具体输入框，而不是弹一句"参数错误"。
 */

import { ValidationError } from '@/lib/errors'

/** 抛出带字段定位的 400。返回 `never` 以便在表达式位置使用。 */
export function fail(field: string, message: string): never {
  throw new ValidationError(message, { field })
}

/** 必填字符串：trim 后校验长度闭区间 `[min, max]`。 */
export function requiredString(
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

/** 可选字符串：`undefined`/`null`/空白 → `null`（而不是空串，避免"空串"与"无值"混淆）。 */
export function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') fail(field, `${field} must be a string`)
  const s = (value as string).trim()
  if (!s) return null
  if (s.length > max) fail(field, `${field} must be at most ${max} characters`)
  return s
}

export function optionalInt(
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

/** 可选布尔。**严格要求 boolean 字面量**，不接受 `"true"` / `1` —— 同意类的字段不接受模糊输入。 */
export function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') fail(field, `${field} must be a boolean`)
  return value as boolean
}

/** 必须是 `true` 才通过（用于「显式同意」这类不可含糊的开关）。 */
export function requireTrue(value: unknown, field: string, message: string): true {
  if (value !== true) fail(field, message)
  return true
}

/**
 * 日期：接受 ISO 字符串或 Date。
 * `requireFuture` 用于「有效期」——创建一个一落地就过期的有效期没有意义。
 */
export function optionalDate(
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
export function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

/**
 * 字符串数组（用于"导入哪些字段"这类清单）。
 * 严格模式：非数组即 400（不做"单值提升为数组"的猜测 —— 猜测会把拼错的输入读成有效值）。
 */
export function requiredStringArray(
  value: unknown,
  field: string,
  max: number
): string[] {
  if (!Array.isArray(value)) fail(field, `${field} must be an array of strings`)
  const out: string[] = []
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'string') fail(field, `${field} must contain only strings`)
    const s = raw.trim()
    if (!s) continue
    if (!out.includes(s)) out.push(s)
    if (out.length > max) fail(field, `${field} must contain at most ${max} items`)
  }
  return out
}
