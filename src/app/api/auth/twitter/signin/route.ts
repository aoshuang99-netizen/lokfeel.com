/**
 * Twitter OAuth 2.0 Sign-in Endpoint
 *
 * GET /api/auth/twitter/signin?callbackUrl=/dashboard
 *
 * Flow:
 * 1. Validate Twitter OAuth config
 * 2. Generate PKCE code_verifier + code_challenge
 * 3. Generate random state for CSRF protection
 * 4. Store code_verifier + state in cookies
 * 5. Redirect to Twitter authorization URL
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  getTwitterConfig,
} from "@/lib/auth/twitter-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = getTwitterConfig();

  if (!config.valid) {
    // Twitter OAuth not configured — redirect to login with error
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "error",
      "Twitter OAuth 未配置。请在 Vercel 环境变量中设置 TWITTER_CLIENT_ID 和 TWITTER_CLIENT_SECRET。"
    );
    return NextResponse.redirect(loginUrl);
  }

  // Get callbackUrl from query params
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || "/dashboard";

  // Generate PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Generate CSRF state
  const state = crypto.randomUUID();

  // Build the redirect URI (where Twitter will send the user back)
  const redirectUri = `${request.nextUrl.origin}/api/auth/twitter/callback`;

  // Build Twitter authorization URL
  const twitterAuthUrl = buildAuthorizationUrl({
    clientId: config.clientId,
    redirectUri,
    codeChallenge,
    state,
  });

  // Store code_verifier, state, and callbackUrl in cookies
  const response = NextResponse.redirect(twitterAuthUrl);

  // PKCE code verifier (needed for token exchange)
  response.cookies.set("twitter-pkce-verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes (matches Twitter's code TTL)
    path: "/",
  });

  // CSRF state
  response.cookies.set("twitter-oauth-state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  // Callback URL for after sign-in
  response.cookies.set("twitter-callback-url", callbackUrl, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  console.log("[Twitter OAuth] Redirecting to Twitter authorization");
  return response;
}
