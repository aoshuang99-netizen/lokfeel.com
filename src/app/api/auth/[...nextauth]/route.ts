import { handlers } from '@/lib/auth/auth'
import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for auth routes
export const dynamic = 'force-dynamic'

/**
 * NextAuth route handler with Twitter redirect support.
 *
 * Google OAuth: handled entirely by NextAuth (signIn("google") → POST → Google → callback → session)
 * Twitter OAuth: custom flow at /api/auth/twitter/signin, intercepted here for redirect
 */

export async function GET(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if this is a /api/auth/signin/:provider request
  const signinMatch = pathname.match(/^\/api\/auth\/signin\/(.+)$/);

  if (signinMatch) {
    const providerId = signinMatch[1];

    if (providerId === "twitter" || providerId === "x") {
      // Twitter OAuth is handled by our custom /api/auth/twitter/signin
      return NextResponse.redirect(new URL('/api/auth/twitter/signin', request.url));
    }
  }

  // Delegate all other requests (including Google) to NextAuth
  try {
    return await handlers.GET(request);
  } catch (err: any) {
    console.error('[NextAuth] GET handler error:', err.message);
    return NextResponse.redirect(new URL('/login?error=Configuration', request.url));
  }
}

export async function POST(request: NextRequest) {
  try {
    return await handlers.POST(request);
  } catch (err: any) {
    console.error('[NextAuth] POST handler error:', err.message);
    return NextResponse.redirect(new URL('/login?error=Configuration', request.url));
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    },
  })
}
