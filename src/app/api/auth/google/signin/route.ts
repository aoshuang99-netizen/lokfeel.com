/**
 * Google OAuth 2.0 Sign-in Endpoint
 *
 * GET /api/auth/google/signin?callbackUrl=/dashboard
 *
 * WHY CUSTOM (instead of NextAuth built-in):
 * NextAuth v5 uses PKCE for Google OAuth but stores the code_verifier as a
 * JWE-encrypted cookie. Our custom callback cannot decrypt this JWE, so the
 * token exchange fails with "code_verifier mismatch" at Google.
 *
 * This endpoint generates our OWN PKCE code_verifier/code_challenge and stores
 * the code_verifier as a plain-text cookie (like the Twitter OAuth flow).
 * This ensures the callback handler can read and use it correctly.
 *
 * Flow:
 * 1. Validate Google OAuth config
 * 2. Generate PKCE code_verifier + code_challenge (our own, not NextAuth's)
 * 3. Build Google authorization URL with code_challenge
 * 4. Store code_verifier in a plain-text cookie
 * 5. Redirect to Google authorization URL
 */

import { NextRequest, NextResponse } from "next/server";
import { getGoogleConfig, generateCodeVerifier, generateCodeChallenge, buildGoogleAuthorizationUrl } from "@/lib/auth/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = getGoogleConfig();

  if (!config.valid) {
    console.error("[Google OAuth Signin] Google OAuth not configured");
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Google OAuth 未配置，请联系管理员");
    return NextResponse.redirect(loginUrl);
  }

  // Get callbackUrl from query params
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || "/dashboard";

  // Generate our own PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Build the redirect URI (where Google will send the user back)
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

  // Build Google authorization URL
  const googleAuthUrl = buildGoogleAuthorizationUrl({
    clientId: config.clientId,
    redirectUri,
    codeChallenge,
  });

  // Store code_verifier and callbackUrl in cookies (plain-text, like Twitter)
  const response = NextResponse.redirect(googleAuthUrl);

  // PKCE code verifier (needed for token exchange)
  response.cookies.set("google-pkce-verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  // Callback URL for after sign-in
  response.cookies.set("google-callback-url", callbackUrl, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  console.log("[Google OAuth Signin] Redirecting to Google authorization");
  return response;
}
