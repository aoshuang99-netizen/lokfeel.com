/**
 * 错误信封的**语义码透传** —— 回归测试
 *
 * 为什么值得单独一个文件：2026-11-07 的 T07 生产路径 E2E 里，三条断言红在同一个原因上 ——
 * `errorResponse()` 对 403/404 调的是 `forbidden(message)` / `notFound(message)`，
 * **把 `error.details` 整个丢掉了**。而租户层精心区分的拒绝码
 * （`EMAIL_MISMATCH` / `OWNER_GRANT_FORBIDDEN` / `OWNER_PROTECTED` / `INVALID_TOKEN` …）
 * 全都挂在这两个状态码上。
 *
 * 后果不是"少一个字段"，而是**界面给出错误的下一步**：
 *   - `EMAIL_MISMATCH` 被显示成「你没有权限」→ 用户去找管理员，而正确动作是换个账号登录；
 *   - `INVALID_TOKEN` 被显示成「找不到资源」→ 用户不知道要重新索取邀请。
 *
 * 这些用例全部断言"码能穿过 HTTP 边界"，而不是断言实现细节。
 */

import { errorResponse } from '@/lib/api-response'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  isUniqueViolation,
} from '@/lib/errors'

async function bodyOf(res: Response) {
  return (await res.json()) as {
    success: boolean
    error: { code: string; message: string; details?: Record<string, unknown> }
  }
}

describe('errorResponse 透传语义码', () => {
  it('403 保留 details.code（OWNER_GRANT_FORBIDDEN）', async () => {
    const res = errorResponse(
      new ForbiddenError('Forbidden: ownership must be transferred', { code: 'OWNER_GRANT_FORBIDDEN' }),
    )
    const body = await bodyOf(res)
    expect(res.status).toBe(403)
    // 顶层码仍是协议层的 PERMISSION_DENIED（HTTP 语义不变）
    expect(body.error.code).toBe('PERMISSION_DENIED')
    // 业务码必须能读到，否则前端只能走兜底文案
    expect(body.error.details?.code).toBe('OWNER_GRANT_FORBIDDEN')
  })

  it('403 保留 details.code（EMAIL_MISMATCH）', async () => {
    const res = errorResponse(new ForbiddenError('wrong email', { code: 'EMAIL_MISMATCH' }))
    expect((await bodyOf(res)).error.details?.code).toBe('EMAIL_MISMATCH')
  })

  it('404 保留 details.code（INVALID_TOKEN）', async () => {
    const res = errorResponse(new NotFoundError('Invitation not found', { code: 'INVALID_TOKEN' }))
    expect(res.status).toBe(404)
    expect((await bodyOf(res)).error.details?.code).toBe('INVALID_TOKEN')
  })

  it('409 / 400 的透传没有回归', async () => {
    const c = await bodyOf(errorResponse(new ConflictError('taken', { code: 'SLUG_TAKEN' })))
    const v = await bodyOf(errorResponse(new ValidationError('bad', { code: 'INVALID_EMAIL' })))
    expect(c.error.details?.code).toBe('SLUG_TAKEN')
    expect(v.error.details?.code).toBe('INVALID_EMAIL')
  })

  it('没有 details 时不伪造一个空对象（信封形状保持最小）', async () => {
    const body = await bodyOf(errorResponse(new ForbiddenError('nope')))
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe('PERMISSION_DENIED')
    // details 允许 undefined，但不允许 {} —— 否则前端 `details.code` 会读到 undefined 却以为"服务端给了码"
    expect(body.error.details === undefined || body.error.details === null).toBe(true)
  })
})

describe('isUniqueViolation —— libSQL 下不能只认 P2002', () => {
  it('识别 libSQL 的真实形态（code=N/A + UNIQUE constraint failed）', () => {
    const err = new Error(
      'Invalid `prisma.organization.create()` invocation:\nDatabase error. Code: `N/A`. ' +
        'Message: `SQLITE_CONSTRAINT: SQLite error: UNIQUE constraint failed: Organization.slug`',
    )
    expect(isUniqueViolation(err, 'Organization.slug')).toBe(true)
  })

  it('识别标准 Prisma P2002', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['slug'] } }, 'Organization.slug')).toBe(true)
  })

  it('别的唯一键冲突不算本字段的冲突', () => {
    const err = new Error('UNIQUE constraint failed: User.email')
    expect(isUniqueViolation(err, 'Organization.slug')).toBe(false)
    expect(isUniqueViolation(err, 'User.email')).toBe(true)
  })

  it('普通错误不误判', () => {
    expect(isUniqueViolation(new Error('connection reset'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation({ code: 'P2025', message: 'Record not found' })).toBe(false)
  })
})
