import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  evaluateRegion,
  getCountryFromHeaders,
  getCacheControl,
  isCorsAllowed,
  isDebugPath,
  SECURITY_HEADERS,
} from './src/config/region-policy'

/**
 * PROXY — Region Block + Security + CORS + Debug Endpoint Protection
 *
 * FEATURES:
 * 1. 地域封禁（规则来自 `src/config/region-policy.ts`，**不再是本文件里的硬编码常量**）
 * 2. 每个响应都带安全响应头
 * 3. API 路由的 CORS 限制
 * 4. 调试/诊断端点对外不可访问（要求 DEBUG_SECRET）
 *
 * P0-6（2026-09-28）：地域规则、CORS 白名单、缓存规则全部改为**配置驱动**
 * （`GEO_*` / `CORS_*` 环境变量），使开源部署方能自定义而无需 fork 本文件。
 * 默认值等于改造前的行为 —— 不设任何 env 时线上表现完全一致。
 * 判定逻辑与策略解析在 `src/config/region-policy.ts`，那里有完整的
 * "为什么"与可测试的纯函数；本文件只负责把请求接到判定上。
 *
 * NOTE: This replaces the deprecated `middleware.ts` file.
 * See: https://nextjs.org/docs/messages/middleware-to-proxy
 */

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const country = getCountryFromHeaders(request.headers)
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    ''

  // ─── 1. 地域判定 ───
  // 说明：API 路由**不会**被 302 跳到 /blocked —— 那是个 HTML 页面，
  // 会让客户端的 fetch().json() 报 "Unexpected end of JSON input"。
  // API 在封禁地区返回 451 JSON；未封禁则照常走各自的鉴权。
  const regionDecision = evaluateRegion({ country, clientIp, pathname })

  if (regionDecision.action === 'redirect-blocked') {
    const blockedUrl = request.nextUrl.clone()
    blockedUrl.pathname = '/blocked'
    blockedUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(blockedUrl)
  }

  if (regionDecision.action === 'json-451') {
    return new NextResponse(
      JSON.stringify({ error: 'Service not available in your region', code: 'REGION_BLOCKED' }),
      { status: 451, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ─── 2. 调试/诊断端点：对外不可访问 ───
  if (isDebugPath(pathname)) {
    // BUG-637: 配置了 DEBUG_SECRET 就强制校验（fail closed），
    // 替代可伪造的 User-Agent 判定，作为主闸门。
    const debugSecret = process.env.DEBUG_SECRET
    if (debugSecret && request.headers.get('x-debug-secret') !== debugSecret) {
      return notFoundJson()
    }
    // 放行平台内部定时任务（cron），拒绝浏览器类 UA 的外部访问
    // 注意：这里**只**保留改造前就存在的 `x-vercel-cron`。不要顺手加别的
    // "平台内部"请求头 —— 这类头可被任意客户端伪造，在 DEBUG_SECRET 未配置时
    // 等于给调试端点开了一个绕过口。
    const userAgent = request.headers.get('user-agent') || ''
    const isPlatformCron = request.headers.get('x-vercel-cron') === 'true'
    if (
      !isPlatformCron &&
      /mozilla|chrome|safari|firefox|edge/i.test(userAgent) &&
      !pathname.startsWith('/api/health')
    ) {
      return notFoundJson()
    }
  }

  // ─── 3. API 路由 CORS ───
  const response = NextResponse.next()

  if (pathname.startsWith('/api')) {
    const origin = request.headers.get('origin')
    const requestHost =
      request.headers.get('x-forwarded-host') || request.headers.get('host') || ''

    // BUG-636: 用 host 精确比较，替代脆弱的 endsWith()
    //（否则攻击者的 origin 只要后缀匹配就能通过）
    if (!isCorsAllowed(origin, requestHost)) {
      return new NextResponse(JSON.stringify({ error: 'Forbidden: CORS policy' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (origin) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      response.headers.set('Access-Control-Max-Age', '86400')
      response.headers.set('Vary', 'Origin')
    }

    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: response.headers })
    }
  }

  // ─── 4. 所有响应都带安全头 ───
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }

  // ─── 5. 公开页面的 CDN 缓存头 ───
  // 中间件存在时 next.config.ts 的 headers() 可能不生效，故在此显式设置
  // 供 Cloudflare / 其它 CDN 使用（规则见 region-policy.ts 的 getCacheControl）。
  const cacheControl = getCacheControl(pathname)
  if (cacheControl) response.headers.set('Cache-Control', cacheControl)

  return response
}

function notFoundJson(): NextResponse {
  return new NextResponse(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  // Next.js 要求 matcher **静态可解析**，因此保留在这里（不可从外部模块导入）。
  // 正向列出所有需要处理的路径：负向 lookahead 曾误排除 /login。
  matcher: [
    '/',
    '/login',
    '/register',
    '/terms',
    '/privacy',
    '/about',
    '/faq',
    '/contact',
    '/community-guidelines',
    '/safety-tips',
    '/cookies',
    '/dmca',
    '/18-usc-2257',
    '/cancellations-policy',
    '/refunds',
    '/press',
    '/careers',
    '/support',
    '/dashboard/:path*',
    '/api/:path*',
    '/admin/:path*',
    '/sitemap.xml',
    '/robots.txt',
    '/blocked',
  ],
}
