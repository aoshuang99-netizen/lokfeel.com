import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * MIDDLEWARE — Region Block + Security
 * 
 * FEATURES:
 * 1. Block access from China (CN) mainland IP addresses
 *    - Uses Vercel Edge geolocation (request headers)
 *    - Redirects to /blocked page with friendly message
 * 
 * 2. Security headers on every response
 * 
 * WHY NO AUTH CHECK HERE:
 * NextAuth v5 beta uses JWE (encrypted) session tokens.
 * next-auth/jwt's getToken() CANNOT reliably decrypt JWE tokens
 * in Vercel's Edge Runtime (middleware).
 * Auth protection is at SERVER COMPONENT level using auth().
 * See: src/app/(dashboard)/layout.tsx
 */

// Blocked country codes — mainland China
const BLOCKED_COUNTRIES = ['CN']

// Paths that should always be accessible (even from blocked regions)
const ALLOWED_PATHS = [
  '/blocked',    // The blocked page itself
  '/api/health', // Health check endpoint
  '/_next/',     // Next.js static assets
  '/favicon',    // Favicon
]

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_PATHS.some(allowed => pathname.startsWith(allowed))
}

/**
 * Get country code from Vercel Edge headers
 * Vercel injects x-vercel-ip-country header at edge
 */
function getCountry(request: NextRequest): string {
  // Vercel Edge provides geo info via x-vercel-ip-country header
  const vercelCountry = request.headers.get('x-vercel-ip-country')
  if (vercelCountry) return vercelCountry

  // Fallback: check for Cloudflare header
  const cfCountry = request.headers.get('cf-ipcountry')
  if (cfCountry) return cfCountry

  return ''
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const country = getCountry(request)

  // ─── 1. Region Block: China ───
  if (BLOCKED_COUNTRIES.includes(country) && !isAllowedPath(pathname)) {
    const blockedUrl = request.nextUrl.clone()
    blockedUrl.pathname = '/blocked'
    blockedUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(blockedUrl)
  }

  // ─── 2. Pass through ───
  const response = NextResponse.next()

  // Add geo info to response headers for debugging (non-sensitive)
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
