/**
 * Google OAuth 2.0 Sign-in Endpoint (v2 — Fixed Route Conflict)
 *
 * GET /api/auth/oauth/google/signin?callbackUrl=/dashboard
 *
 * WHY THIS PATH (/api/auth/oauth/google/* instead of /api/auth/google/*):
 * Next.js App Router's [...nextauth] catch-all route at /api/auth/[...nextauth]
 * takes priority over specific routes like /api/auth/google/signin, causing 404.
 * By moving to /api/auth/oauth/google/, we avoid the catch-all conflict entirely.
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
  // Step 1: Validate Google OAuth config
  const config = getGoogleConfig();

  console.log("[Google OAuth Signin] Config valid:", config.valid);
  console.log("[Google OAuth Signin] Client ID (first 10 chars):", config.clientId.substring(0, 10) + "...");

  if (!config.valid) {
    console.error("[Google OAuth Signin] Google OAuth not configured — missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Google OAuth not configured. Please contact support.");
    return NextResponse.redirect(loginUrl);
  }

  // Get callbackUrl from query params
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || "/dashboard";

  console.log("[Google OAuth Signin] Callback URL:", callbackUrl);
  console.log("[Google OAuth Signin] Redirect URI (for Google):", `${request.nextUrl.origin}/api/auth/oauth/google/callback`);

  // Step 2: Generate our own PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  console.log("[Google OAuth Signin] Generated PKCE code_verifier (length):", codeVerifier.length);
  console.log("[Google OAuth Signin] Generated PKCE code_challenge (length):", codeChallenge.length);

  // Build the redirect URI (where Google will send the user back)
  // This MUST match the actual route path and Google Cloud Console configuration
  // Use NEXT_PUBLIC_APP_URL to ensure correct domain in production
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const redirectUri = `${baseUrl}/api/auth/oauth/google/callback`;

  // Build Google authorization URL
  const googleAuthUrl = buildGoogleAuthorizationUrl({
    clientId: config.clientId,
    redirectUri,
    codeChallenge,
  });

  console.log("[Google OAuth Signin] Google authorization URL:", googleAuthUrl.substring(0, 100) + "...");

  // Store code_verifier and callbackUrl in cookies (plain-text, like Twitter)
  const response = NextResponse.redirect(googleAuthUrl);

  // Determine if we're in production (for cookie secure flag)
  // In production (HTTPS), secure must be true
  // In development (HTTP localhost), secure must be false
  const isProduction = process.env.NODE_ENV === "production";
  const isSecure = isProduction;

  console.log("[Google OAuth Signin] Environment:", process.env.NODE_ENV);
  console.log("[Google OAuth Signin] Cookie secure flag:", isSecure);

  // PKCE code verifier (needed for token exchange) — 30 min timeout
  response.cookies.set("google-pkce-verifier", codeVerifier, {
    httpOnly: true,
    secure: isSecure,  // Dynamic based on environment
    sameSite: "lax",
    maxAge: 1800, // 30 minutes (was 600 = 10 min)
    path: "/",
  });

  // Callback URL for after sign-in — 30 min timeout
  response.cookies.set("google-callback-url", callbackUrl, {
    httpOnly: true,
    secure: isSecure,  // Dynamic based on environment
    sameSite: "lax",
    maxAge: 1800, // 30 minutes (was 600 = 10 min)
    path: "/",
  });

  console.log("[Google OAuth Signin] Redirecting to Google authorization");
  return response;
}
