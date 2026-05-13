/**
 * Google OAuth Test Endpoint
 * GET /api/auth/test-google
 *
 * Tests the Google OAuth configuration without actually redirecting.
 * Returns JSON with the authorization URL so the diagnostic tool
 * can verify the setup works (bypassing browser fetch cross-origin
 * redirect limitations).
 *
 * Uses our custom PKCE flow (same as /api/auth/google/signin).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildGoogleAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  getGoogleConfig,
} from "@/lib/auth/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = getGoogleConfig();

  if (!config.valid) {
    return NextResponse.json({
      status: "fail",
      error: "Google OAuth 未配置",
      detail: "GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 未设置",
      clientIdSet: !!process.env.GOOGLE_CLIENT_ID,
      clientSecretSet: !!process.env.GOOGLE_CLIENT_SECRET,
    });
  }

  try {
    // Generate PKCE (same as the real signin flow)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Build redirect URI
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback/google`;

    // Build Google authorization URL
    const googleAuthUrl = buildGoogleAuthorizationUrl({
      clientId: config.clientId,
      redirectUri,
      codeChallenge,
    });

    return NextResponse.json({
      status: "pass",
      detail: "Google OAuth configuration valid (custom PKCE)",
      authUrl: googleAuthUrl,
      redirectUri,
      clientId: config.clientId.substring(0, 20) + "...",
      pkceMethod: "S256 (custom, plain-text cookie)",
      note: "This URL is for testing only. Use /api/auth/google/signin for actual login.",
    });
  } catch (err: any) {
    return NextResponse.json({
      status: "fail",
      error: "Failed to build Google OAuth URL",
      detail: err.message,
    });
  }
}
