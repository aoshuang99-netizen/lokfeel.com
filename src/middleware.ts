import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * MIDDLEWARE — Region Block + Security + CORS + Debug Endpoint Protection
 *
 * FEATURES:
 * 1. Block access from China (CN) mainland IP addresses on ALL pages
 *    (home, login, register, admin, dashboard, explore, etc.)
 * 2. Security headers on every response
 * 3. CORS restrictions for API routes
 * 4. Block debug/diagnostic endpoints from non-admin origins
 *
 * WHY NO AUTH CHECK HERE:
 * NextAuth v5 beta uses JWE (encrypted) session tokens.
 * Auth protection is at SERVER COMPONENT level using auth().
 * See: src/app/(dashboard)/layout.tsx
 */

// Blocked country codes — mainland China
// ENABLED: Block all CN traffic from home, auth, admin, and dashboard pages.
const BLOCKED_COUNTRIES: string[] = ['CN']

// Allowed CORS origins
const ALLOWED_ORIGINS = [
  'https://app.lokfeel.com',
  'https://lokfeel.com',
  'https://admin.lokfeel.com',
]

// Paths that should always be accessible (even from blocked regions)
const ALLOWED_PATHS = [
  '/blocked',
  '/api/health',
  '/_next/',
  '/favicon',
]

// Debug/diagnostic paths — block external access entirely (Vercel Cron bypasses middleware)
const BLOCKED_DEBUG_PATHS = [
  '/api/debug-auth',
  '/api/db-check',
  '/api/diagnostic/',
]

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_PATHS.some(allowed => pathname.startsWith(allowed))
}

function getCountry(request: NextRequest): string {
  const vercelCountry = request.headers.get('x-vercel-ip-country')
  if (vercelCountry) return vercelCountry

  const cfCountry = request.headers.get('cf-ipcountry')
  if (cfCountry) return cfCountry

  return ''
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const country = getCountry(request)

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
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      // Block requests from unauthorized origins
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

  // Add geo info to response headers (non-sensitive)
  if (country) {
    response.headers.set('x-geo-country', country)
  }

  // ─── 4. Security headers on all responses ───
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)')

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
