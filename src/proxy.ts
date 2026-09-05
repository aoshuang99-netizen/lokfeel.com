import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * PROXY — Region Block + Security + CORS + Debug Endpoint Protection
 *
 * FEATURES:
 * 1. Block access from China (CN) mainland IP addresses on ALL pages
 *    (home, login, register, admin, dashboard, explore, etc.)
 * 2. Security headers on every response
 * 3. CORS restrictions for API routes
 * 4. Block debug/diagnostic endpoints from non-admin origins
 *
 * NOTE: This replaces the deprecated `middleware.ts` file.
 * See: https://nextjs.org/docs/messages/middleware-to-proxy
 */

// Blocked country codes — mainland China
// NOTE: temporarily DISABLED (empty array) so the app is reachable from China
// (owner access from GMT+8). Re-enable with ['CN'] ONLY after wiring IP_WHITELIST
// into the check below (it is currently dead code) and adding the owner's static
// IP, otherwise every CN visitor is redirected to /blocked. Compliance review
// required before re-enabling a blanket CN region block.
const BLOCKED_COUNTRIES: string[] = []

// IP whitelist — always allow (add your home/office IPs here)
const IP_WHITELIST: string[] = [
  // Add Frank's IPs here to bypass geo-block
  // Example: '123.456.789.0'
]

// Allowed paths (even from blocked regions)
const ALLOWED_PATHS = [
  '/blocked',
  '/api/geo-check',
  '/api/health',
  '/_next/',
  '/favicon',
]

// Debug/diagnostic paths — block external access entirely
const BLOCKED_DEBUG_PATHS = [
  '/api/debug-auth',
  '/api/db-check',
  '/api/diagnostic/',
]

function isAllowedPath(pathname: string): boolean {
  // Exact match for /blocked (not /blocked-foo, /blocked-bar, etc.)
  if (pathname === '/blocked') return true
  // Prefix match for paths that have sub-paths
  return ALLOWED_PATHS.filter(p => p !== '/blocked').some(allowed => pathname.startsWith(allowed))
}

function getCountry(request: NextRequest): string {
  // 1. Vercel Edge header (Pro/Enterprise guaranteed, Hobby best-effort)
  const vercelCountry = request.headers.get('x-vercel-ip-country')
  if (vercelCountry && vercelCountry !== 'unknown') return vercelCountry

  // 2. Cloudflare header (if behind CF)
  const cfCountry = request.headers.get('cf-ipcountry')
  if (cfCountry && cfCountry !== 'XX') return cfCountry

  // 3. Fallback: read x-forwarded-for (limited accuracy)
  // Future: integrate IP geolocation API for Hobby plans
  return ''
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const country = getCountry(request)
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
               request.headers.get('x-real-ip') || 
               ''

  // ─── 1. Region Block ───
  // Skip geo-block for API routes — they return JSON, not HTML.
  // Redirecting API calls to /blocked (an HTML page) causes
  // "Unexpected end of JSON input" on the client when fetch().json() runs.
  // API routes have their own auth/permission checks.
  const isApiRoute = pathname.startsWith('/api')
  
  if (BLOCKED_COUNTRIES.includes(country) && !isAllowedPath(pathname) && !isApiRoute) {
    const blockedUrl = request.nextUrl.clone()
    blockedUrl.pathname = '/blocked'
    blockedUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(blockedUrl)
  }
  
  // For API routes from blocked regions, return a proper JSON error
  if (BLOCKED_COUNTRIES.includes(country) && isApiRoute && !isAllowedPath(pathname)) {
    return new NextResponse(
      JSON.stringify({ error: 'Service not available in your region', code: 'REGION_BLOCKED' }),
      { status: 451, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ─── 2. Block debug/diagnostic endpoints from external access ───
  const isDebugPath = BLOCKED_DEBUG_PATHS.some(p => pathname.startsWith(p))
  if (isDebugPath) {
    // Allow Vercel internal requests (cron) but block external browser/API access
    const userAgent = request.headers.get('user-agent') || ''
    const isVercelCron = request.headers.get('x-vercel-cron') === 'true'
    // These endpoints have their own auth (requireAdminAuth), but we add
    // an extra layer: reject requests with browser-like User-Agent
    if (!isVercelCron && /mozilla|chrome|safari|firefox|edge/i.test(userAgent) && !pathname.startsWith('/api/health')) {
      return new NextResponse(
        JSON.stringify({ error: 'Not Found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  // ─── 3. CORS for API routes ───
  const response = NextResponse.next()

  if (pathname.startsWith('/api')) {
    const origin = request.headers.get('origin')
    // Allow same-origin requests (Origin matches the request host)
    // This ensures all Vercel deployment URLs work automatically
    const requestHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
    const isSameOrigin = origin ? origin.endsWith(`://${requestHost}`) : true
    
    // Allowed CORS origins
    const ALLOWED_ORIGINS = [
      'https://app.lokfeel.com',
      'https://lokfeel.com',
      'https://admin.lokfeel.com',
    ]
    
    function isLocalhostOrigin(origin: string): boolean {
      return /^https?:\/\/localhost(:\d+)?$/.test(origin) || origin.startsWith('http://127.0.0.1')
    }
    
    function isVercelPreview(origin: string): boolean {
      return /https:\/\/nexus-app-.*\.vercel\.app$/.test(origin)
    }
    
    if (origin && !ALLOWED_ORIGINS.includes(origin) && !isSameOrigin && !isLocalhostOrigin(origin) && !isVercelPreview(origin)) {
      // Block requests from unauthorized cross-origin sources
      return new NextResponse(
        JSON.stringify({ error: 'Forbidden: CORS policy' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
    // Add CORS headers for allowed origins
    if (origin) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      response.headers.set('Access-Control-Max-Age', '86400')
      response.headers.set('Vary', 'Origin')
    }
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: response.headers })
    }
  }

  // ─── 4. Security + Cache headers on all responses ───
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)')

  // ─── 5. CDN cache headers for public pages ───
  // next.config.ts headers() may not apply when middleware is present,
  // so we explicitly set s-maxage here for Cloudflare to cache.
  const publicPaths = ['/', '/login', '/register']
  const staticPublicPaths = ['/terms', '/privacy', '/about', '/faq', '/contact', '/community-guidelines', '/safety-tips', '/cookies', '/dmca', '/18-usc-2257', '/cancellations-policy', '/refunds', '/press', '/careers', '/support']
  if (publicPaths.includes(pathname) || pathname === '/') {
    // s-maxage=300: CDN caches for 5 min
    // stale-while-revalidate=86400: serve stale for up to 24h while revalidating
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400')
  } else if (staticPublicPaths.includes(pathname)) {
    // Static legal/info pages: cache for 2 hours, serve stale for 24h
    response.headers.set('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=86400')
  } else if (pathname === '/sitemap.xml' || pathname === '/robots.txt') {
    // Sitemap & robots: cache for 1 hour, serve stale for 24h
    response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  }

  return response
}

export const config = {
  // Explicitly list all paths that need middleware processing.
  // Next.js middleware matcher: negative lookahead was incorrectly excluding /login etc.
  // Using positive match list instead for reliability.
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
