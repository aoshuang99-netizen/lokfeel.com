/**
 * T02 · `/api/v1/public/missions/[token]` —— **匿名可达**的分享预览
 *
 * 这是本仓第一个真正意义上的「匿名可达面」，因此是本任务风险最高的端点。
 * 四条防护（缺一不可，见 docs/implementation/T02/risks.md R1）：
 *
 *   1. **限流**：按客户端 IP 计数（`rateLimit`）。Redis 不可用时退化为进程内计数
 *      —— 在 serverless 下这是**弱防护**，已在 risks.md 记为残留风险，不可当作分布式的。
 *   2. **令牌形状预检**：明显非法的 token 直接 404，不触达 DB（省资源 + 防探测）。
 *   3. **最小披露**：输出经 `toPublicMissionView()` 白名单投影，
 *      内部标识与 `constraints` 一律不出现在响应里。
 *   4. **禁止缓存**：`Cache-Control: no-store`，避免 CDN 把带令牌的响应长期缓存。
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { errorResponse, notFound, rateLimited, success, unauthorized } from '@/lib/api-response'
import { rateLimit } from '@/lib/rate-limit'
import { getSharePageData, isShareTokenShaped } from '@/lib/connection'

/** 预览限流：每 IP 每 5 分钟 120 次（正常访客远达不到；爬虫会被挡住）。 */
const previewLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 120 })

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

function noStore<T extends NextResponse>(res: T): T {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token?: string }> }
) {
  try {
    const { token = '' } = (await context.params) ?? {}

    // 限流在**任何**工作之前（包括形状检查），否则攻击者可无限探测形状。
    const verdict = await previewLimit(req)
    if (!verdict.success) {
      const res = rateLimited('Too many preview requests. Please try again later.')
      res.headers.set('Retry-After', String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))))
      return noStore(res)
    }

    if (!isShareTokenShaped(token)) return noStore(notFound('Mission not found'))

    const result = await getSharePageData(token, null)
    if (result.kind === 'not_found') return noStore(notFound('Mission not found'))
    if (result.kind === 'auth_required') {
      return noStore(unauthorized('Sign in to view this mission'))
    }
    return noStore(success({ mission: result.view, viewer: null }))
  } catch (error) {
    return noStore(errorResponse(error))
  }
}
