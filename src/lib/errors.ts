/**
 * Custom error class for API errors with HTTP status codes
 * Use in route handlers' catch blocks to return proper status codes
 */
export class ApiError extends Error {
  public readonly statusCode: number
  public readonly details?: any

  constructor(statusCode: number, message: string, details?: any) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.details = details
  }
}

/**
 * 401 Unauthorized
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized', details?: any) {
    super(401, message, details)
    this.name = 'UnauthorizedError'
  }
}

/**
 * 403 Forbidden
 */
export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', details?: any) {
    super(403, message, details)
    this.name = 'ForbiddenError'
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends ApiError {
  constructor(message = 'Not found', details?: any) {
    super(404, message, details)
    this.name = 'NotFoundError'
  }
}

/**
 * 400 Bad Request — 输入形状/取值不合法（与 401/403 的"身份/权限"问题分开）
 */
export class ValidationError extends ApiError {
  constructor(message = 'Invalid request', details?: any) {
    super(400, message, details)
    this.name = 'ValidationError'
  }
}

/**
 * 409 Conflict — 资源状态冲突（如幂等键被不同请求体复用、状态机非法迁移）
 */
export class ConflictError extends ApiError {
  constructor(message = 'Conflict', details?: any) {
    super(409, message, details)
    this.name = 'ConflictError'
  }
}

/**
 * 429 Too Many Requests
 */
export class RateLimitError extends ApiError {
  constructor(message = 'Too many requests', details?: any) {
    super(429, message, details)
    this.name = 'RateLimitError'
  }
}

/**
 * Helper: format an error into a NextResponse-compatible JSON shape
 * Pass any caught error; if it's an ApiError, use its statusCode.
 */
export function formatErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return {
      json: {
        success: false,
        error: error.message,
        ...(error.details && { details: error.details }),
      },
      status: error.statusCode,
    }
  }
  // Non-ApiError: genuine server error → 500
  return {
    json: {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    },
    status: 500,
  }
}

/**
 * 唯一约束冲突判定 —— **不能只认 `code === 'P2002'`**。
 *
 * 实测（2026-11-07，T07 生产路径 E2E）：在 libSQL/Turso adapter 下，同一个
 * `Organization.slug` 重复插入抛出的对象是
 *
 *   { code: 'N/A', message: 'SQLITE_CONSTRAINT: ... UNIQUE constraint failed: Organization.slug' }
 *
 * 也就是说 `code` 根本不等于 `P2002`，真正可判的信号在 message 里。
 * 只判 `P2002` 的后果不是"少一个分支"，而是把一次**预期内的业务冲突**
 * （用户填了个已被占用的标识）变成 500「服务器内部错误」：
 * 用户会以为系统坏了并反复重试，而正确动作明明是"换个标识"。
 *
 * @param field 形如 `Organization.slug`；给了就要求命中的是这一列，
 *              避免把"别的唯一键冲突"误判成本字段的冲突。
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  const e = error as { code?: unknown; message?: unknown; meta?: { target?: unknown } } | null
  const byCode = e?.code === 'P2002'
  const message = typeof e?.message === 'string' ? e.message : ''
  const byMessage = /UNIQUE constraint failed/i.test(message)
  if (!byCode && !byMessage) return false
  if (!field) return true

  const column = String(field.includes('.') ? field.split('.').pop() : field).toLowerCase()
  if (byCode) {
    const target = JSON.stringify(e?.meta?.target ?? '')
    // meta.target 缺失时不否证（老版本 Prisma 不带 target）；有时才做列名比对。
    return target === '""' || target === '{}' ? true : target.toLowerCase().includes(column)
  }
  return message.toLowerCase().includes(column)
}
