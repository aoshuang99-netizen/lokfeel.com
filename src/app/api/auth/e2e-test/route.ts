/**
 * OAuth E2E Test Endpoint
 * GET /api/auth/e2e-test
 *
 * Simulates the COMPLETE OAuth flow without real OAuth:
 * 1. Create a test user in DB
 * 2. Generate a verification token (like firebase-bridge does)
 * 3. Test the firebase-token authorize() function
 * 4. Test CSRF → POST to callback → session creation
 *
 * This catches issues that the diagnostic endpoint misses (like
 * session creation failures, callback handler bugs, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// In-memory rate limit (1 request per 30 seconds)
let lastRun = 0;

export async function GET(request: NextRequest) {
  const now = Date.now();
  if (now - lastRun < 30000) {
    return NextResponse.json({
      error: "Rate limited. Please wait 30 seconds between tests.",
      retryAfter: Math.ceil((30000 - (now - lastRun)) / 1000),
    }, { status: 429 });
  }
  lastRun = now;

  const results: Record<string, { status: "pass" | "fail" | "warn"; detail: string; duration?: number }> = {};
  const steps: string[] = [];
  let testUserId = "";
  let testToken = "";

  try {
    // Step 1: Generate test user ID
    testUserId = `e2e-test-${Date.now()}`;
    steps.push(`Test user ID: ${testUserId}`);
    results["GENERATE_TEST_ID"] = {
      status: "pass",
      detail: `Generated test ID: ${testUserId}`,
    };

    // Step 2: Create a test user in DB (same as firebase-bridge does)
    const createUserStart = Date.now();
    try {
      const testUser = await db.user.create({
        data: {
          email: `${testUserId}@test.lokfeel.com`,
          name: `E2E Test User`,
          emailVerified: new Date(),
        },
      });

      // Create account record
      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "google",
          providerAccountId: `e2e-test-${Date.now()}`,
        },
      });

      // Create profile
      await db.profile.create({
        data: {
          userId: testUser.id,
          displayName: "E2E Test",
          profileStatus: "DRAFT",
          age: 18,
          gender: "OTHER",
          sexuality: "OTHER",
        },
      });

      testUserId = testUser.id; // Use the real DB ID
      const createUserDuration = Date.now() - createUserStart;
      results["CREATE_TEST_USER"] = {
        status: "pass",
        detail: `Created user ${testUser.id.substring(0, 8)}... in ${createUserDuration}ms`,
        duration: createUserDuration,
      };
    } catch (err: any) {
      results["CREATE_TEST_USER"] = {
        status: "fail",
        detail: `Failed: ${err.message?.substring(0, 100)}`,
      };
      // Continue with fake user ID for remaining tests
      testUserId = `fake-${testUserId}`;
    }

    // Step 3: Generate sign-in token (same as firebase-bridge)
    testToken = `fb_${testUserId}_${crypto.randomUUID().replace(/-/g, "")}_${Date.now()}`;
    const createTokenStart = Date.now();
    try {
      const created = await db.verificationToken.create({
        data: {
          identifier: `firebase:${testUserId}`,
          token: testToken,
          expires: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
      const createTokenDuration = Date.now() - createTokenStart;
      results["CREATE_SIGNIN_TOKEN"] = {
        status: "pass",
        detail: `Token created (ID: ${created.id?.substring(0, 10)}...) in ${createTokenDuration}ms`,
        duration: createTokenDuration,
      };
    } catch (err: any) {
      results["CREATE_SIGNIN_TOKEN"] = {
        status: "fail",
        detail: `Failed: ${err.message?.substring(0, 100)}`,
      };
    }

    // Step 4: Verify token lookup (same as firebase-token authorize)
    const lookupStart = Date.now();
    try {
      const found = await db.verificationToken.findUnique({
        where: {
          identifier_token: {
            identifier: `firebase:${testUserId}`,
            token: testToken,
          },
        },
      });

      if (found) {
        const lookupDuration = Date.now() - lookupStart;
        results["TOKEN_LOOKUP"] = {
          status: "pass",
          detail: `Token found in ${lookupDuration}ms`,
          duration: lookupDuration,
        };

        // Check expiration
        if (found.expires < new Date()) {
          results["TOKEN_EXPIRY"] = {
            status: "fail",
            detail: `Token already expired! Expires: ${found.expires.toISOString()}`,
          };
        } else {
          results["TOKEN_EXPIRY"] = {
            status: "pass",
            detail: `Token valid until ${found.expires.toISOString()}`,
          };
        }
      } else {
        results["TOKEN_LOOKUP"] = {
          status: "fail",
          detail: "Token NOT found after creation!",
        };
      }
    } catch (err: any) {
      results["TOKEN_LOOKUP"] = {
        status: "fail",
        detail: `Lookup failed: ${err.message?.substring(0, 100)}`,
      };
    }

    // Step 5: Simulate the auto-submit HTML flow (CSRF → POST)
    const origin = request.nextUrl.origin;
    const csrfStart = Date.now();
    try {
      const csrfRes = await fetch(`${origin}/api/auth/csrf`, {
        headers: { Cookie: request.headers.get("cookie") || "" },
      });
      const csrfData = await csrfRes.json();

      if (csrfData.csrfToken) {
        const csrfDuration = Date.now() - csrfStart;
        results["CSRF_FETCH"] = {
          status: "pass",
          detail: `CSRF token obtained in ${csrfDuration}ms`,
          duration: csrfDuration,
        };

        // Step 6: POST to firebase-token callback (this is where most failures happen)
        const postStart = Date.now();
        const formBody = new URLSearchParams({
          csrfToken: csrfData.csrfToken,
          token: testToken,
          userId: testUserId,
          callbackUrl: "/dashboard",
        });

        const callbackRes = await fetch(`${origin}/api/auth/callback/firebase-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: request.headers.get("cookie") || "",
          },
          body: formBody.toString(),
          redirect: "manual", // Don't follow redirects
        });

        const postDuration = Date.now() - postStart;
        const location = callbackRes.headers.get("location");
        const setCookie = callbackRes.headers.get("set-cookie");

        results["FIREBASE_TOKEN_CALLBACK"] = {
          status: callbackRes.status === 302 || callbackRes.status === 307 ? "pass" : "fail",
          detail: `Status: ${callbackRes.status}, Location: ${location?.substring(0, 80) || "none"}, Duration: ${postDuration}ms`,
          duration: postDuration,
        };

        // Check if session cookie was set
        const hasSessionCookie = setCookie?.includes("next-auth.session-token") || setCookie?.includes("authjs.session-token");
        results["SESSION_COOKIE"] = {
          status: hasSessionCookie ? "pass" : "fail",
          detail: hasSessionCookie
            ? "Session cookie set successfully!"
            : `No session cookie found. Set-Cookie: ${(setCookie || "none").substring(0, 100)}`,
        };

        // Step 7: Verify token was consumed (single-use)
        try {
          const afterPost = await db.verificationToken.findUnique({
            where: {
              identifier_token: {
                identifier: `firebase:${testUserId}`,
                token: testToken,
              },
            },
          });
          results["TOKEN_CONSUMED"] = {
            status: !afterPost ? "pass" : "fail",
            detail: !afterPost
              ? "Token was deleted (single-use confirmed)"
              : "Token still exists after use! Single-use not working.",
          };
        } catch (err: any) {
          results["TOKEN_CONSUMED"] = {
            status: "warn",
            detail: `Could not verify: ${err.message?.substring(0, 60)}`,
          };
        }

        // Step 8: Verify session is actually valid
        if (hasSessionCookie) {
          const sessionStart = Date.now();
          const sessionRes = await fetch(`${origin}/api/auth/session`, {
            headers: { Cookie: request.headers.get("cookie") || "" },
          });
          const sessionDuration = Date.now() - sessionStart;

          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            results["SESSION_VALIDATION"] = {
              status: sessionData.user ? "pass" : "fail",
              detail: sessionData.user
                ? `Session valid! User: ${sessionData.user.email} (${sessionDuration}ms)`
                : `Session empty or invalid (${sessionDuration}ms)`,
              duration: sessionDuration,
            };
          } else {
            results["SESSION_VALIDATION"] = {
              status: "warn",
              detail: `Session endpoint returned ${sessionRes.status}`,
            };
          }
        }
      } else {
        results["CSRF_FETCH"] = {
          status: "fail",
          detail: "No CSRF token in response",
        };
      }
    } catch (err: any) {
      results["CSRF_CALLBACK_FLOW"] = {
        status: "fail",
        detail: `Flow error: ${err.message?.substring(0, 100)}`,
      };
    }

  } catch (err: any) {
    results["UNEXPECTED_ERROR"] = {
      status: "fail",
      detail: err.message?.substring(0, 200) || "Unknown error",
    };
  } finally {
    // Cleanup: delete test user and any remaining tokens
    try {
      if (testUserId && !testUserId.startsWith("fake-")) {
        await db.verificationToken.deleteMany({
          where: { identifier: `firebase:${testUserId}` },
        });
        await db.profile.deleteMany({ where: { userId: testUserId } });
        await db.account.deleteMany({ where: { userId: testUserId } });
        await db.user.delete({ where: { id: testUserId } });
        results["CLEANUP"] = {
          status: "pass",
          detail: "Test user and tokens cleaned up",
        };
      }
    } catch (err: any) {
      results["CLEANUP"] = {
        status: "warn",
        detail: `Cleanup failed (non-critical): ${err.message?.substring(0, 60)}`,
      };
    }
  }

  // Summary
  const allResults = Object.values(results);
  const passCount = allResults.filter((r) => r.status === "pass").length;
  const failCount = allResults.filter((r) => r.status === "fail").length;
  const total = allResults.length;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    testType: "end-to-end OAuth simulation",
    steps,
    summary: {
      total,
      pass: passCount,
      fail: failCount,
      status: failCount === 0 ? "ALL E2E TESTS PASSED" : `${failCount} E2E TEST(S) FAILED`,
    },
    checks: results,
    diagnosis: failCount > 0 ? generateDiagnosis(results) : undefined,
  });
}

function generateDiagnosis(results: Record<string, { status: string; detail: string }>): string[] {
  const issues: string[] = [];

  if (results["CREATE_SIGNIN_TOKEN"]?.status === "fail") {
    issues.push("CRITICAL: Cannot create verification tokens. Check database permissions and schema.");
  }
  if (results["TOKEN_LOOKUP"]?.status === "fail") {
    issues.push("CRITICAL: Token lookup failed. The verification token created cannot be found. Possible DB schema issue.");
  }
  if (results["CSRF_FETCH"]?.status === "fail") {
    issues.push("CRITICAL: CSRF endpoint not working. NextAuth may not be properly configured.");
  }
  if (results["FIREBASE_TOKEN_CALLBACK"]?.status === "fail") {
    issues.push("CRITICAL: firebase-token callback failed. The authorize() function is rejecting the token. Check server logs for [firebase-token authorize] errors.");
  }
  if (results["SESSION_COOKIE"]?.status === "fail") {
    issues.push("CRITICAL: No session cookie set after callback. NextAuth session creation is failing.");
  }
  if (results["TOKEN_CONSUMED"]?.status === "fail") {
    issues.push("WARN: Token not deleted after use. Single-use tokens are not working properly.");
  }
  if (results["SESSION_VALIDATION"]?.status === "fail") {
    issues.push("CRITICAL: Session exists but is not valid. JWT signing may be failing (check AUTH_SECRET).");
  }

  return issues;
}
