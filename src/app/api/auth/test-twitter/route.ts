/**
 * Twitter OAuth Test Endpoint
 * GET /api/auth/test-twitter
 *
 * Tests the Twitter OAuth configuration without actually redirecting.
 * Returns JSON with the authorization URL so the diagnostic tool
 * can verify the setup works (bypassing browser fetch cross-origin
 * redirect limitations).
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
    return NextResponse.json({
      status: "fail",
      error: "Twitter OAuth 未配置",
      detail: "TWITTER_CLIENT_ID 或 TWITTER_CLIENT_SECRET 未设置",
      clientIdSet: !!process.env.TWITTER_CLIENT_ID,
      clientSecretSet: !!process.env.TWITTER_CLIENT_SECRET,
    });
  }

  try {
    // Generate PKCE (same as the real signin flow)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Generate CSRF state
    const state = crypto.randomUUID();

    // Build redirect URI
    const redirectUri = `${request.nextUrl.origin}/api/auth/twitter/callback`;

    // Build Twitter authorization URL
    const twitterAuthUrl = buildAuthorizationUrl({
      clientId: config.clientId,
      redirectUri,
      codeChallenge,
      state,
    });

    return NextResponse.json({
      status: "pass",
      detail: "Twitter OAuth configuration valid",
      authUrl: twitterAuthUrl,
      redirectUri,
      clientId: config.clientId.substring(0, 10) + "...",
      statePreview: state.substring(0, 8) + "...",
      note: "This URL is for testing only. Use /api/auth/twitter/signin for actual login.",
    });
  } catch (err: any) {
    return NextResponse.json({
      status: "fail",
      error: "Failed to build Twitter OAuth URL",
      detail: err.message,
    });
  }
}
