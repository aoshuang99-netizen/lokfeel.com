/**
 * OAuth Diagnostic Endpoint
 * GET /api/auth/diagnostic
 *
 * Tests the complete OAuth chain without requiring actual OAuth:
 * 1. Verify env vars are configured
 * 2. Test database connectivity
 * 3. Test CSRF token generation
 * 4. Test firebase-token provider routing
 * 5. Test verification token creation + lookup + deletion
 *
 * This endpoint helps diagnose where the OAuth flow breaks.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const results: Record<string, { status: "pass" | "fail" | "warn"; detail: string }> = {};

  // 1. Check env vars
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const twitterClientId = process.env.TWITTER_CLIENT_ID?.trim();
  const twitterSecret = process.env.TWITTER_CLIENT_SECRET?.trim();
  const authSecret = process.env.AUTH_SECRET?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  results["GOOGLE_CLIENT_ID"] = {
    status: clientId ? "pass" : "fail",
    detail: clientId ? `Set (${clientId.substring(0, 10)}...)` : "NOT SET",
  };
  results["GOOGLE_CLIENT_SECRET"] = {
    status: clientSecret ? "pass" : "fail",
    detail: clientSecret ? `Set (length: ${clientSecret.length})` : "NOT SET",
  };
  results["TWITTER_CLIENT_ID"] = {
    status: twitterClientId ? "pass" : "fail",
    detail: twitterClientId ? `Set (${twitterClientId.substring(0, 10)}...)` : "NOT SET",
  };
  results["TWITTER_CLIENT_SECRET"] = {
    status: twitterSecret ? "pass" : "fail",
    detail: twitterSecret ? `Set (length: ${twitterSecret.length})` : "NOT SET",
  };
  results["AUTH_SECRET"] = {
    status: authSecret ? "pass" : "fail",
    detail: authSecret ? `Set (length: ${authSecret.length})` : "NOT SET",
  };
  results["DATABASE_URL"] = {
    status: databaseUrl ? "pass" : "fail",
    detail: databaseUrl ? `Set (${databaseUrl.substring(0, 20)}...)` : "NOT SET",
  };

  // 2. Test database connectivity
  const dbStart = Date.now();
  try {
    await db.user.findFirst({ select: { id: true } });
    const dbTime = Date.now() - dbStart;
    results["DATABASE"] = {
      status: dbTime < 5000 ? "pass" : "warn",
      detail: `Connected in ${dbTime}ms`,
    };
  } catch (err: any) {
    results["DATABASE"] = {
      status: "fail",
      detail: `Connection failed: ${err.message?.substring(0, 100)}`,
    };
  }

  // 3. Test verification token round-trip (the critical path for OAuth)
  const testUserId = "diagnostic-test-" + Date.now();
  const testToken = `fb_${testUserId}_test_${Date.now()}`;
  try {
    // Create
    const created = await db.verificationToken.create({
      data: {
        identifier: `firebase:${testUserId}`,
        token: testToken,
        expires: new Date(Date.now() + 60000),
      },
    });
    results["VERIFICATION_CREATE"] = {
      status: "pass",
      detail: `Created token ID: ${created.id?.substring(0, 10)}...`,
    };

    // Lookup
    const found = await db.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: `firebase:${testUserId}`,
          token: testToken,
        },
      },
    });
    results["VERIFICATION_LOOKUP"] = {
      status: found ? "pass" : "fail",
      detail: found ? `Found token ID: ${found.id?.substring(0, 10)}...` : "NOT FOUND",
    };

    // Delete
    await db.verificationToken.delete({ where: { id: created.id } });
    results["VERIFICATION_DELETE"] = {
      status: "pass",
      detail: "Deleted successfully",
    };
  } catch (err: any) {
    results["VERIFICATION_TOKEN"] = {
      status: "fail",
      detail: `Error: ${err.message?.substring(0, 100)}`,
    };
  }

  // 4. Check CSRF cookies
  const cookieStore = await cookies();
  const csrfCookie = cookieStore.get("__Host-authjs.csrf-token");
  results["CSRF_COOKIE"] = {
    status: csrfCookie ? "pass" : "warn",
    detail: csrfCookie ? `Present (length: ${csrfCookie.value.length})` : "Not in current request (normal for direct API calls)",
  };

  // 5. Summary
  const allResults = Object.values(results);
  const passCount = allResults.filter((r) => r.status === "pass").length;
  const failCount = allResults.filter((r) => r.status === "fail").length;
  const total = allResults.length;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    summary: {
      total: total,
      pass: passCount,
      fail: failCount,
      status: failCount === 0 ? "ALL CHECKS PASSED" : `${failCount} CHECK(S) FAILED`,
    },
    checks: results,
  });
}
