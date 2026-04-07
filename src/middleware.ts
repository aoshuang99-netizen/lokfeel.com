import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Get the session token
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  })

  // ─── Admin Routes ──────────────────────────────────────────────
  // /admin/* requires ADMIN or SUPER_ADMIN role
  if (pathname.startsWith('/admin')) {
    if (!token) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    const role = token.role as string
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      // Logged in but not admin → redirect to dashboard with error
      const dashboardUrl = new URL('/dashboard', request.url)
      dashboardUrl.searchParams.set('error', 'unauthorized')
      return NextResponse.redirect(dashboardUrl)
    }
  }

  // ─── Dashboard Routes ──────────────────────────────────────────
  // /dashboard/* requires any authenticated user
  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // ─── Auth Routes ───────────────────────────────────────────────
  // Redirect already logged-in users away from /login and /register
  if ((pathname === '/login' || pathname === '/register') && token) {
    const role = token.role as string
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/admin', request.url))
    }
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // Match all paths except static files, API routes (handled separately), and _next internals
  matcher: [
    '/admin/:path*',
    '/dashboard/:path*',
    '/login',
    '/register',
  ],
}
