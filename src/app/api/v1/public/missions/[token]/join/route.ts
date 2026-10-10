/**
 * T02 · `/api/v1/public/missions/[token]/join` —— **敏感动作，需身份验证**
 *
 * AC-11 的三条要求之一：「敏感动作需身份验证」。
 * 未注册访客**可以预览**，但**不能加入** —— 匿名请求在这里得到 401。
 *
 * 授权链（顺序即语义，任一步失败即拒）：
 *   1. `requireAuth()` —— 会话有效（匿名/游客/过期 token → 401）
 *   2. 限流（按 userId，防止已登录账号刷接口）
 *   3. 令牌形状 + Mission 存在且非草稿（→ 404）
 *   4. **必须是该 Mission 所属租户的 ACTIVE 成员**（服务层用 DB 行里的
 *      `organizationId` 回查 memberships，绝不采信请求里的任何租户字段 → 403）
 *   5. 状态/过期/名额校验（→ 409，并给出确定原因）
 *
 * 天然幂等：同一用户重复加入命中 `(missionId, userId)` 唯一键，返回 `alreadyJoined: true`。
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { errorResponse, notFound, rateLimited, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth/auth'
import { rateLimit } from '@/lib/rate-limit'
import { isShareTokenShaped, joinMission, parseJoin } from '@/lib/connection'

/** 加入限流：每用户每 5 分钟 30 次。 */
const joinLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 })

function noStore<T extends NextResponse>(res: T): T {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ token?: string }> }
) {
  try {
    // ① 身份验证 —— 这是「敏感动作需身份验证」的落点（匿名 → 401）。
    const { user } = await requireAuth()

    const { token = '' } = (await context.params) ?? {}

    // ② 限流（按用户，而非 IP —— 已登录账号可换 IP 绕过 IP 限流）。
    //    这里构造一个最小的 Request 只为复用 `rateLimit` 的取键约定
    //    （它默认取 `x-forwarded-for` 的第一段），避免另起一套计数实现。
    const verdict = await joinLimit(
      new Request('http://internal/join', {
        headers: { 'x-forwarded-for': `u:${user.id}` },
      })
    )
    if (!verdict.success) {
      const res = rateLimited('Too many join attempts. Please try again later.')
      res.headers.set(
        'Retry-After',
        String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000)))
      )
      return noStore(res)
    }

    // ③ 令牌形状 → 404（不触达 DB）
    if (!isShareTokenShaped(token)) return noStore(notFound('Mission not found'))

    const raw = await req.text()
    let body: unknown = null
    if (raw && raw.trim()) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = null // 非法 JSON 视为"无留言"，不因附属字段失败而拒绝加入
      }
    }
    const input = parseJoin(body)

    // ④⑤ 授权 + 状态校验（服务层）
    const result = await joinMission(user.id, token, input)
    return noStore(success(result))
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
