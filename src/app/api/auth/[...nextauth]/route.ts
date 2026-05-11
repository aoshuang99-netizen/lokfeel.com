import { handlers } from '@/lib/auth/auth'
import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for auth routes
export const dynamic = 'force-dynamic'

/**
 * NextAuth v5 beta bug workaround:
 *
 * When `pages.signIn` is set in auth config, NextAuth's render.signin()
 * throws UnknownAction("Unsupported action") if a providerId is passed.
 * This means /api/auth/signin/google → error=Configuration.
 *
 * Fix: Intercept /api/auth/signin/:provider requests and construct the
 * Google OAuth URL directly, bypassing NextAuth's broken render.signin().
 *
 * For other auth actions, delegate to NextAuth handlers as usual.
 */

// Google OAuth endpoints (from OIDC discovery)
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export async function GET(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Check if this is a /api/auth/signin/:provider request
  const signinMatch = pathname.match(/^\/api\/auth\/signin\/(.+)$/);

  if (signinMatch) {
    const providerId = signinMatch[1];

    if (providerId === "google") {
      // Check if Google OAuth is configured
      const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
      
      if (!clientId || !clientSecret) {
        console.error('[Auth] Google OAuth not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
        return NextResponse.redirect(new URL('/login?error=OAuthNotConfigured&provider=google', request.url));
      }
      
      return handleGoogleOAuthRedirect(request);
    }

    if (providerId === "twitter" || providerId === "x") {
      // Twitter OAuth is handled by /api/auth/twitter/signin
      return NextResponse.redirect(new URL('/api/auth/twitter/signin', request.url));
    }

    // For other providers, let NextAuth handle (may or may not work)
    console.warn(`[Auth] signin/${providerId} — only Google and Twitter are handled by custom logic`);
  }

  // Delegate all other requests to NextAuth
  try {
    return await handlers.GET(request);
  } catch (err: any) {
    console.error('[NextAuth] GET handler error:', err.message);
    // Fallback: redirect to login with error
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

/**
 * Construct Google OAuth URL and redirect directly
 * This bypasses NextAuth's broken render.signin(providerId) implementation
 */
function handleGoogleOAuthRedirect(request: NextRequest): NextResponse {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.error('[Auth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return NextResponse.redirect(new URL('/login?error=Configuration', request.url));
  }

  // Get callbackUrl from query params, default to /dashboard
  const callbackUrl = request.nextUrl.searchParams.get('callbackUrl') || '/dashboard';

  // Generate state and nonce for CSRF protection
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  // Google OAuth redirect URI
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

  // Construct Google OAuth URL
  const googleUrl = new URL(GOOGLE_AUTH_URL);
  googleUrl.searchParams.set('client_id', clientId);
  googleUrl.searchParams.set('redirect_uri', redirectUri);
  googleUrl.searchParams.set('response_type', 'code');
  googleUrl.searchParams.set('scope', 'openid email profile');
  googleUrl.searchParams.set('prompt', 'select_account');
  googleUrl.searchParams.set('access_type', 'offline');
  googleUrl.searchParams.set('state', state);
  googleUrl.searchParams.set('nonce', nonce);

  // Store state and callbackUrl in a cookie for the callback handler
  const response = NextResponse.redirect(googleUrl);
  response.cookies.set('auth-google-state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });
  response.cookies.set('auth-google-callback', callbackUrl, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  console.log('[Auth] Redirecting to Google OAuth, state:', state.substring(0, 8) + '...');
  return response;
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
