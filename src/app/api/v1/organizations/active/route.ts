/**
 * V20.5 · Batch 3 —— `POST /api/v1/organizations/active`
 *
 * 切换「我现在在看哪个社群」。改的是 **cookie 软偏好**，不是权限：
 * 授权永远由 memberships 表判定（见 `src/lib/tenancy/active-org.ts` 文件头的
 * 「cookie 决定看哪个，memberships 决定能不能看」）。
 *
 * 为什么要有一个服务端端点，而不是让前端直接 `document.cookie = ...`：
 *   1. **先验证再写**。前端写 cookie 等于把"任意 organizationId 都能落进偏好"
 *      变成事实；虽然解析侧还会再查一次成员关系，但让一个明知不是成员的 id
 *      写进去，只会给后续每个请求加一次无谓的 DB 查询 + 一次回落分支。
 *      这里用 403 明确告诉调用方"你不是这个社群的成员"。
 *   2. **httpOnly**。前端不需要读它，服务端读就够了；`document.cookie` 写出来的
 *      cookie 不可能是 httpOnly。
 *
 * 为什么用 `resolveTenantForUser` 而不是 `withTenant(...)` 包装：
 *   本端点的**目的**就是换租户，如果被 `withTenant` 用「当前租户」的能力矩阵
 *   包起来，切换动作本身就会被当前租户的角色限制 —— 而角色是跟着租户走的，
 *   在 A 社群是 MEMBER、在 B 社群是 OWNER 是完全合法且常见的形态。
 *   这里只要求：已登录 + 是目标社群的 ACTIVE 成员。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { requireAuth } from '@/lib/auth/auth'
import { sessionCookieForRequest } from '@/lib/auth/session-cookie'
import { activeOrgCookieOptions, normalizeActiveOrgId, resolveTenantForUser } from '@/lib/tenancy'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth()

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }

    const raw = (body as { organizationId?: unknown } | null)?.organizationId
    const organizationId = normalizeActiveOrgId(raw)
    if (!organizationId) {
      throw new ValidationError('organizationId is required', { code: 'INVALID_ORGANIZATION_ID' })
    }

    // 授权点：不是 ACTIVE 成员 → ForbiddenError(403)。审计照常写
    //（这确实是"有人在试着看别家社群"，与 S12/S13 同一语义）。
    const tenant = await resolveTenantForUser(user.id, { organizationId })

    const response = success({ organizationId: tenant.organizationId, role: tenant.role })
    // cookie 的 `secure` 必须跟会话 cookie 同源同判（见 `session-cookie.ts` 的表）：
    // https 下写 Secure，http 下（CI / 自托管）不写 —— 否则浏览器直接丢弃，
    // 表现为"切换成功但一刷新又回到默认社群"。
    const cookie = sessionCookieForRequest(request)
    response.cookies.set({ ...activeOrgCookieOptions(cookie.secure), value: organizationId })
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
