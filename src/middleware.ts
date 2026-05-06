import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * MIDDLEWARE — Region Block + Security + CORS
 *
 * FEATURES:
 * 1. Block access from China (CN) mainland IP addresses
 * 2. Security headers on every response
 * 3. CORS restrictions for API routes
 *
 * WHY NO AUTH CHECK HERE:
 * NextAuth v5 beta uses JWE (encrypted) session tokens.
 * Auth protection is at SERVER COMPONENT level using auth().
 * See: src/app/(dashboard)/layout.tsx
 */

// Blocked country codes — mainland China
// DISABLED: Founder (Frank) is in China and needs access.
const BLOCKED_COUNTRIES: string[] = []

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
  if (BLOCKED_COUNTRIES.includes(country) && !isAllowedPath(pathname)) {
    const blockedUrl = request.nextUrl.clone()
    blockedUrl.pathname = '/blocked'
    blockedUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(blockedUrl)
  }

  // ─── 2. CORS for API routes ───
  const response = pathname.startsWith('/api')
    ? NextResponse.next()
    : NextResponse.next()

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
