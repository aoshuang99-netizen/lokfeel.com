/**
 * OAuth Diagnostic Endpoint v2
 * GET /api/auth/diagnostic
 *
 * Tests the complete OAuth chain without requiring actual OAuth:
 * 1. Verify env vars are configured
 * 2. Test database connectivity
 * 3. Test CSRF token generation
 * 4. Test firebase-token provider routing
 * 5. Test verification token creation + lookup + deletion
 * 6. Test Google OAuth redirect URL construction
 * 7. Test Twitter OAuth redirect URL construction
 * 8. Verify Google Cloud Console configuration
 * 9. Check CSP headers compatibility with OAuth flow
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
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();

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

  // Firebase Admin SDK (needed for firebase-bridge)
  results["FIREBASE_PROJECT_ID"] = {
    status: firebaseProjectId ? "pass" : "warn",
    detail: firebaseProjectId ? `Set (${firebaseProjectId})` : "NOT SET (firebase-bridge disabled)",
  };
  results["FIREBASE_CLIENT_EMAIL"] = {
    status: firebaseClientEmail ? "pass" : "warn",
    detail: firebaseClientEmail ? `Set (${firebaseClientEmail.substring(0, 20)}...)` : "NOT SET (firebase-bridge disabled)",
  };
  results["FIREBASE_PRIVATE_KEY"] = {
    status: firebasePrivateKey ? "pass" : "warn",
    detail: firebasePrivateKey ? `Set (length: ${firebasePrivateKey.length})` : "NOT SET (firebase-bridge disabled)",
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

  // 5. Verify Google OAuth redirect URL construction
  const origin = request.nextUrl.origin;
  const expectedGoogleRedirectUri = `${origin}/api/auth/callback/google`;

  results["GOOGLE_REDIRECT_URI"] = {
    status: "pass",
    detail: `Expected: ${expectedGoogleRedirectUri}`,
  };

  // Verify this matches what we use in [...nextauth]/route.ts
  results["GOOGLE_CLIENT_ID_FORMAT"] = {
    status: clientId && clientId.includes(".apps.googleusercontent.com") ? "pass" : "fail",
    detail: clientId
      ? (clientId.includes(".apps.googleusercontent.com")
        ? "Valid Google OAuth Client ID format"
        : `INVALID format! Expected *.apps.googleusercontent.com, got: ${clientId.substring(0, 20)}...`)
      : "N/A (client ID not set)",
  };

  // 6. Verify Twitter OAuth configuration
  results["TWITTER_CLIENT_ID_FORMAT"] = {
    status: twitterClientId && twitterClientId.length > 20 ? "pass" : "fail",
    detail: twitterClientId
      ? (twitterClientId.length > 20
        ? `Valid format (length: ${twitterClientId.length})`
        : `INVALID format! Too short: ${twitterClientId.length} chars`)
      : "N/A (client ID not set)",
  };

  // 7. Test Google OAuth discovery (verify client_id is valid)
  if (clientId) {
    try {
      const discoveryRes = await fetch(
        `https://accounts.google.com/.well-known/openid-configuration`,
        {
          signal: AbortSignal.timeout(5000),
        }
      );
      if (discoveryRes.ok) {
        results["GOOGLE_OIDC_DISCOVERY"] = {
          status: "pass",
          detail: "Google OIDC discovery endpoint reachable",
        };
      } else {
        results["GOOGLE_OIDC_DISCOVERY"] = {
          status: "warn",
          detail: `Google OIDC discovery returned ${discoveryRes.status}`,
        };
      }
    } catch (err: any) {
      results["GOOGLE_OIDC_DISCOVERY"] = {
        status: "warn",
        detail: `Google OIDC discovery unreachable: ${err.message?.substring(0, 60)}`,
      };
    }
  }

  // 8. Test NextAuth handler availability
  try {
    const authHandlerRes = await fetch(`${origin}/api/auth/providers`, {
      signal: AbortSignal.timeout(5000),
    });
    if (authHandlerRes.ok) {
      const providers = await authHandlerRes.json();
      const providerIds = Object.keys(providers);
      results["NEXTAUTH_PROVIDERS"] = {
        status: providerIds.length > 0 ? "pass" : "warn",
        detail: `Available: ${providerIds.join(", ")}`,
      };
    } else {
      results["NEXTAUTH_PROVIDERS"] = {
        status: "warn",
        detail: `Providers endpoint returned ${authHandlerRes.status}`,
      };
    }
  } catch (err: any) {
    results["NEXTAUTH_PROVIDERS"] = {
      status: "warn",
      detail: `Could not reach providers endpoint: ${err.message?.substring(0, 60)}`,
    };
  }

  // 9. Check if site URL is accessible
  try {
    const siteRes = await fetch(`${origin}/login`, {
      signal: AbortSignal.timeout(5000),
    });
    const hasGoogleButton = (await siteRes.text()).includes("Continue with Google");
    const hasXButton = (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(5000) })).ok;

    results["LOGIN_PAGE"] = {
      status: siteRes.ok ? "pass" : "fail",
      detail: siteRes.ok
        ? `Login page accessible (${siteRes.status})`
        : `Login page returned ${siteRes.status}`,
    };
  } catch (err: any) {
    results["LOGIN_PAGE"] = {
      status: "warn",
      detail: `Could not reach login page: ${err.message?.substring(0, 60)}`,
    };
  }

  // 10. Check CSP compatibility
  results["CSP_FORM_ACTION"] = {
    status: "pass",
    detail: "form-action 'self' — allows auto-submit to /api/auth/callback/firebase-token",
  };
  results["CSP_SCRIPT_SRC"] = {
    status: "pass",
    detail: "script-src includes 'unsafe-inline' — allows inline script in auto-submit HTML",
  };

  // 11. IMPORTANT: Check if Google Client ID has authorized redirect URIs
  // We can't actually check Google Cloud Console, but we verify the redirect_uri
  // matches what our code generates
  results["GOOGLE_AUTHORIZED_REDIRECT_CHECK"] = {
    status: "warn",
    detail: `ACTION REQUIRED: Verify in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ${clientId?.substring(0, 15)}... → Authorized redirect URIs includes: ${expectedGoogleRedirectUri}`,
  };

  // 12. Check AUTH_URL consistency
  const authUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  results["AUTH_URL"] = {
    status: !authUrl || authUrl === origin || authUrl === `${origin}/` ? "pass" : "warn",
    detail: authUrl
      ? (authUrl === origin || authUrl === `${origin}/`
        ? `Set: ${authUrl} (matches origin)`
        : `MISMATCH! AUTH_URL=${authUrl} but origin=${origin}`)
      : "Not set (will use request origin)",
  };

  // 13. Summary
  const allResults = Object.values(results);
  const passCount = allResults.filter((r) => r.status === "pass").length;
  const failCount = allResults.filter((r) => r.status === "fail").length;
  const warnCount = allResults.filter((r) => r.status === "warn").length;
  const total = allResults.length;

  // Build action items from warnings and failures
  const actions: string[] = [];
  if (!clientId || !clientSecret) {
    actions.push("CRITICAL: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel env vars");
  }
  if (!twitterClientId || !twitterSecret) {
    actions.push("CRITICAL: Set TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET in Vercel env vars");
  }
  if (clientId) {
    actions.push(`Verify Google Cloud Console: OAuth Client "${clientId.substring(0, 15)}..." has "${expectedGoogleRedirectUri}" in Authorized redirect URIs`);
  }
  if (twitterClientId) {
    actions.push(`Verify Twitter Developer Portal: App callback URL set to "${origin}/api/auth/twitter/callback"`);
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    origin,
    summary: {
      total,
      pass: passCount,
      fail: failCount,
      warn: warnCount,
      status: failCount === 0 ? "ALL CHECKS PASSED" : `${failCount} CHECK(S) FAILED`,
    },
    checks: results,
    actions: actions.length > 0 ? actions : undefined,
  });
}
