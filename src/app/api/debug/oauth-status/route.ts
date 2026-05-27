/**
 * Debug endpoint: Check OAuth configuration status
 * GET /api/debug/oauth-status
 * 
 * Returns whether Google and Twitter OAuth are configured
 * (does NOT expose actual secrets)
 */

import { NextRequest, NextResponse } from "next/server";
import { getGoogleConfig } from "@/lib/auth/google-oauth";
import { getTwitterConfig } from "@/lib/auth/twitter-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const googleConfig = getGoogleConfig();
  const twitterConfig = getTwitterConfig();

  // Check Auth secret (needed for JWT encoding)
  const hasAuthSecret = !!process.env.AUTH_SECRET;

  // Check database URL (needed for user creation)
  const hasDatabaseUrl = !!process.env.DATABASE_URL;

  const status = {
    google: {
      configured: googleConfig.valid,
      clientIdLength: googleConfig.clientId?.length || 0,
      hasClientSecret: !!googleConfig.clientSecret,
    },
    twitter: {
      configured: twitterConfig.valid,
      clientIdLength: twitterConfig.clientId?.length || 0,
      hasClientSecret: !!twitterConfig.clientSecret,
    },
    auth: {
      hasAuthSecret,
      hasDatabaseUrl,
    },
    environment: process.env.NODE_ENV || "unknown",
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(status);
}
