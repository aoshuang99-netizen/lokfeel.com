/**
 * `/api/v1/invitations/accept` —— 接受邀请
 *
 * **不带租户作用域**：受邀人往往还不属于这个组织（甚至还没有账号）。
 * 只用会话校验（`requireAuth`），租户由邀请本身决定 —— 这正是"链接即凭据"的正确形态：
 * 客户端无法通过参数指定要加入哪个组织。
 *
 * 三条拒绝：
 *   - token 不存在 → 404 `INVALID_TOKEN`
 *   - 不是 PENDING → 409（已接受/已撤销）
 *   - 过期 → 409 `EXPIRED`（并把状态惰性落库）
 *   - 会话邮箱 ≠ 邀请邮箱 → 403 `EMAIL_MISMATCH`（防链接转发）
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth/auth'
import { ValidationError } from '@/lib/errors'
import { acceptInvitation } from '@/lib/tenancy/invitations'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const token = (body as { token?: unknown })?.token
    if (typeof token !== 'string' || !token.trim()) {
      throw new ValidationError('token is required', { code: 'INVALID_TOKEN' })
    }

    const result = await acceptInvitation({
      userId: user.id,
      // 用**会话里**的邮箱，不读 body —— 否则"我是谁"就由客户端说了算。
      userEmail: user.email ?? '',
      token,
    })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
}
