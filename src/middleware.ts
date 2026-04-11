import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * MIDDLEWARE — Lightweight Version
 * 
 * WHY NO AUTH CHECK HERE:
 * 
 * NextAuth v5 beta uses JWE (encrypted) session tokens.
 * next-auth/jwt's getToken() CANNOT reliably decrypt JWE tokens
 * in Vercel's Edge Runtime (middleware).
 * 
 * The session API (/api/auth/session) works fine because it uses
 * the full NextAuth handler which has access to proper crypto context.
 * 
 * Solution: Auth protection moved to SERVER COMPONENT level
 * using auth() function (Node.js runtime, not Edge).
 * 
 * See: src/app/(dashboard)/layout.tsx for actual auth enforcement.
 */

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only redirect logic: already logged-in users shouldn't see login/register
  // (We can't reliably detect login status here, so skip this too)
  
  // Just pass through — let pages handle their own auth
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/dashboard/:path*',
    '/login',
    '/register',
  ],
}
