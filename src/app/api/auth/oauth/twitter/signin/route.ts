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

  console.log("[Twitter OAuth Signin] Config valid:", config.valid);
  console.log("[Twitter OAuth Signin] Client ID (first 10 chars):", config.clientId.substring(0, 10) + "...");

  if (!config.valid) {
    // Twitter OAuth not configured — redirect to login with error
    console.error("[Twitter OAuth Signin] Twitter OAuth not configured — missing TWITTER_CLIENT_ID or TWITTER_CLIENT_SECRET");
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "error",
      "Twitter OAuth 未配置。请在 Vercel 环境变量中设置 TWITTER_CLIENT_ID 和 TWITTER_CLIENT_SECRET。"
    );
    return NextResponse.redirect(loginUrl);
  }

  // Get callbackUrl from query params
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || "/dashboard";

  console.log("[Twitter OAuth Signin] Callback URL:", callbackUrl);
  console.log("[Twitter OAuth Signin] Redirect URI (for Twitter):", `${request.nextUrl.origin}/api/auth/twitter/callback`);

  // Generate PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  console.log("[Twitter OAuth Signin] Generated PKCE code_verifier (length):", codeVerifier.length);

  // Generate CSRF state
  const state = crypto.randomUUID();

  console.log("[Twitter OAuth Signin] Generated state:", state);

  // Build the redirect URI (where Twitter will send the user back)
  // This MUST match the actual route path and Twitter Developer Portal configuration
  // Use NEXT_PUBLIC_APP_URL to ensure correct domain in production
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const redirectUri = `${baseUrl}/api/auth/oauth/twitter/callback`;

  // Build Twitter authorization URL
  const twitterAuthUrl = buildAuthorizationUrl({
    clientId: config.clientId,
    redirectUri,
    codeChallenge,
    state,
  });

  console.log("[Twitter OAuth Signin] Twitter authorization URL:", twitterAuthUrl.substring(0, 100) + "...");

  // Store code_verifier, state, and callbackUrl in cookies
  const response = NextResponse.redirect(twitterAuthUrl);

  // Determine if we're in production (for cookie secure flag)
  // In production (HTTPS), secure must be true
  // In development (HTTP localhost), secure must be false
  const isProduction = process.env.NODE_ENV === "production";
  const isSecure = isProduction;

  console.log("[Twitter OAuth Signin] Environment:", process.env.NODE_ENV);
  console.log("[Twitter OAuth Signin] Cookie secure flag:", isSecure);

  // PKCE code verifier (needed for token exchange) — 30 min timeout
  response.cookies.set("twitter-pkce-verifier", codeVerifier, {
    httpOnly: true,
    secure: isSecure,  // Dynamic based on environment
    sameSite: "lax",
    maxAge: 1800, // 30 minutes (was 600 = 10 min)
    path: "/",
  });

  // CSRF state — 30 min timeout
  response.cookies.set("twitter-oauth-state", state, {
    httpOnly: true,
    secure: isSecure,  // Dynamic based on environment
    sameSite: "lax",
    maxAge: 1800, // 30 minutes (was 600 = 10 min)
    path: "/",
  });

  // Callback URL for after sign-in — 30 min timeout
  response.cookies.set("twitter-callback-url", callbackUrl, {
    httpOnly: true,
    secure: isSecure,  // Dynamic based on environment
    sameSite: "lax",
    maxAge: 1800, // 30 minutes (was 600 = 10 min)
    path: "/",
  });

  console.log("[Twitter OAuth] Redirecting to Twitter authorization");
  return response;
}
