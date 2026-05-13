import { handlers } from '@/lib/auth/auth'
import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for auth routes
export const dynamic = 'force-dynamic'

/**
 * NextAuth route handler with Google + Twitter custom flow support.
 *
 * Google OAuth: Custom PKCE flow —
 *   Signin: /api/auth/signin/google → /api/auth/google/signin (our own PKCE)
 *   Callback: /api/auth/callback/google → /api/auth/google/callback (our own verifier)
 *   WHY: NextAuth v5 stores code_verifier as JWE-encrypted cookie which our
 *   callback cannot decrypt. We generate our own PKCE with plain-text cookies.
 *
 * Twitter OAuth: Custom PKCE flow —
 *   Signin: /api/auth/signin/twitter → /api/auth/twitter/signin
 *   Callback: /api/auth/twitter/callback (direct, no interception needed)
 *   WHY: Fully custom PKCE implementation bypassing Firebase.
 *
 * All other NextAuth routes (CSRF, session, providers, etc.): Delegated to NextAuth handlers
 */

export async function GET(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Intercept Google signin ───
  // Redirect to our custom PKCE handler instead of NextAuth's built-in
  if (pathname.match(/^\/api\/auth\/signin\/google$/)) {
    const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || "/dashboard";
    const customSigninUrl = new URL('/api/auth/google/signin', request.url);
    customSigninUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(customSigninUrl);
  }

  // ─── Intercept Google callback ───
  // Redirect to our custom callback handler
  if (pathname.match(/^\/api\/auth\/callback\/google$/)) {
    const customCallbackUrl = new URL('/api/auth/google/callback', request.url);
    // Preserve query params (code, state, error, etc.)
    request.nextUrl.searchParams.forEach((value, key) => {
      customCallbackUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(customCallbackUrl);
  }

  // ─── Intercept Twitter/X signin ───
  const signinMatch = pathname.match(/^\/api\/auth\/signin\/(.+)$/);
  if (signinMatch) {
    const providerId = signinMatch[1];
    if (providerId === "twitter" || providerId === "x") {
      return NextResponse.redirect(new URL('/api/auth/twitter/signin', request.url));
    }
  }

  // ─── Delegate all other requests to NextAuth ───
  try {
    return await handlers.GET(request);
  } catch (err: any) {
    console.error('[NextAuth] GET handler error:', err.message, err.stack);
    // Return the actual error message for debugging, not a generic "Configuration"
    const errorUrl = new URL('/login', request.url);
    errorUrl.searchParams.set("error", `NextAuth Error: ${err.message?.substring(0, 60) || 'Unknown'}`);
    return NextResponse.redirect(errorUrl);
  }
}

export async function POST(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Intercept Google POST signin ───
  // NextAuth's built-in Google signin generates JWE-encrypted PKCE cookies
  // which our callback cannot decrypt. Redirect to our custom handler instead.
  if (pathname.match(/^\/api\/auth\/signin\/google$/)) {
    let callbackUrl = "/dashboard";
    try {
      const formData = await request.formData();
      callbackUrl = (formData.get("callbackUrl") as string) || "/dashboard";
    } catch {}

    const customSigninUrl = new URL('/api/auth/google/signin', request.url);
    customSigninUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(customSigninUrl);
  }

  // ─── Intercept Twitter/X POST signin ───
  // When the client POSTs to /api/auth/signin/twitter (NextAuth convention),
  // we redirect to our custom PKCE handler. NextAuth doesn't have a Twitter
  // provider registered, so it would fail — we handle it ourselves.
  const signinMatch = pathname.match(/^\/api\/auth\/signin\/(.+)$/);
  if (signinMatch) {
    const providerId = signinMatch[1];
    if (providerId === "twitter" || providerId === "x") {
      // Read callbackUrl from the form body
      let callbackUrl = "/dashboard";
      try {
        const formData = await request.formData();
        callbackUrl = (formData.get("callbackUrl") as string) || "/dashboard";
      } catch {}

      // Redirect to our custom Twitter PKCE signin endpoint
      const twitterSigninUrl = new URL('/api/auth/twitter/signin', request.url);
      twitterSigninUrl.searchParams.set('callbackUrl', callbackUrl);
      return NextResponse.redirect(twitterSigninUrl);
    }
  }

  try {
    return await handlers.POST(request);
  } catch (err: any) {
    console.error('[NextAuth] POST handler error:', err.message, err.stack);
    const errorUrl = new URL('/login', request.url);
    errorUrl.searchParams.set("error", `NextAuth Error: ${err.message?.substring(0, 60) || 'Unknown'}`);
    return NextResponse.redirect(errorUrl);
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
