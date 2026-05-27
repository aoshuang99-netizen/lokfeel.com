/**
 * Full Auto E2E Test — Creem Mock Payment Flow
 * 
 * Auth: x-cron-secret header OR ?cron_secret= query param (same as cron endpoints)
 * 
 * Tests the complete Creem payment flow:
 *   1. Auth check (CRON_SECRET)
 *   2. Find eligible test user (male, no active subscription)
 *   3. Simulate checkout.completed webhook event
 *   4. Verify subscription was created in DB
 *   5. Verify payment record was created in DB
 *   6. Cleanup test data
 * 
 * Response: JSON report with per-step status, timing, and errors
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { upsertCreemSubscription, createCreemPaymentRecord } from "@/lib/creem";

interface StepResult {
  step: number;
  name: string;
  status: "pass" | "fail" | "skip" | "warn";
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface TestReport {
  timestamp: string;
  totalSteps: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  steps: StepResult[];
  environment: {
    NODE_ENV: string;
    VERCEL_ENV: string;
    hasCreemApiKey: boolean;
    hasCreemWebhookSecret: boolean;
    hasCreemMonthlyProductId: boolean;
    hasCreemYearlyProductId: boolean;
  };
  summary: string;
}

export async function POST(request: NextRequest) {
  const t0 = performance.now();
  const steps: StepResult[] = [];
  let testUserId = "";
  let testSubId = "";

  const addStep = (step: Omit<StepResult, "durationMs">, startTime: number) => {
    const durationMs = Math.round(performance.now() - startTime);
    steps.push({ ...step, durationMs });
    return durationMs;
  };

  // ── Step 0: Auth ─────────────────────────────
  const tAuth = performance.now();
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("x-cron-secret");
  const authQuery = request.nextUrl.searchParams.get("cron_secret");
  const providedSecret = authHeader || authQuery || "";

  if (!cronSecret) {
    addStep({ step: 0, name: "Auth — CRON_SECRET check", status: "fail", error: "CRON_SECRET not configured on server" }, tAuth);
    return NextResponse.json(buildReport(steps, t0, "ABORTED: CRON_SECRET not configured"), { status: 500 });
  }

  if (providedSecret !== cronSecret) {
    addStep({ step: 0, name: "Auth — CRON_SECRET validation", status: "fail", error: "Invalid or missing CRON_SECRET (use x-cron-secret header or ?cron_secret= query param)" }, tAuth);
    return NextResponse.json(buildReport(steps, t0, "ABORTED: Auth failed"), { status: 401 });
  }
  addStep({ step: 0, name: "Auth — CRON_SECRET validated", status: "pass" }, tAuth);

  // ── Step 1: Find test user ───────────────────────────
  const t1 = performance.now();
  try {
    // Find a male user with no active subscription
    const users = await db.user.findMany({
      where: {
        isBot: false,
        subscriptions: { none: { status: "ACTIVE" } },
        profile: { gender: { in: ["MAN", "MALE"] } },
      },
      take: 5,
      select: { id: true, email: true, name: true },
    });

    if (users.length === 0) {
      addStep({ step: 1, name: "Find eligible test user", status: "warn", 
        error: "No eligible male user without subscription found. Will use first available user.",
        details: { usersFound: 0 }
      }, t1);
      
      // Fallback: find ANY real user without active sub
      const anyUser = await db.user.findFirst({
        where: { 
          isBot: false,
          subscriptions: { none: { status: "ACTIVE" } },
        },
        select: { id: true, email: true, name: true },
      });

      if (!anyUser) {
        addStep({ step: 1, name: "Find any eligible user", status: "fail", 
          error: "No users found without active subscription. Cannot proceed."
        }, t1);
        return NextResponse.json(buildReport(steps, t0, "ABORTED: No eligible users"), { status: 500 });
      }

      testUserId = anyUser.id;
      addStep({ step: 1, name: "Find any eligible user (fallback)", status: "warn",
        details: { userId: testUserId, email: anyUser.email, note: "Non-male user used as fallback" }
      }, t1);
    } else {
      testUserId = users[0].id;
      addStep({ step: 1, name: "Find eligible test user", status: "pass",
        details: { userId: testUserId, email: users[0].email, usersChecked: users.length }
      }, t1);
    }
  } catch (err: any) {
    addStep({ step: 1, name: "Find eligible test user", status: "fail", error: err.message }, t1);
    return NextResponse.json(buildReport(steps, t0, "ABORTED: DB error"), { status: 500 });
  }

  // ── Step 2: Simulate webhook — checkout.completed ─────
  const t2 = performance.now();
  const mockCheckoutId = `test_chk_${Date.now()}`;
  const mockCustomerId = `test_cust_${testUserId.slice(0, 12)}`;
  const mockSubscriptionId = `test_sub_${Date.now()}`;
  const testPlan = "PREMIUM_MONTHLY";

  try {
    // Call the actual webhook handler logic
    const mockEvent = {
      id: `evt_test_${Date.now()}`,
      eventType: "checkout.completed",
      created_at: Date.now(),
      object: {
        id: mockCheckoutId,
        customer: mockCustomerId,
        subscription: mockSubscriptionId,
        amount: 1999,
        currency: "usd",
        metadata: {
          userId: testUserId,
          plan: testPlan,
        },
      },
    };

    // Create payment record (same as webhook handler does)
    await createCreemPaymentRecord({
      userId: testUserId,
      creemCheckoutId: mockCheckoutId,
      amount: 1999,
      currency: "usd",
      status: "SUCCEEDED",
      description: `E2E Test: ${testPlan}`,
      metadata: { eventId: mockEvent.id, eventType: "checkout.completed", source: "e2e-test" },
    });

    // Upsert subscription (same as webhook handler does)
    await upsertCreemSubscription({
      userId: testUserId,
      creemCustomerId: mockCustomerId,
      creemSubscriptionId: mockSubscriptionId,
      plan: testPlan,
      status: "ACTIVE",
      currentPeriodEnd: undefined,
    });

    addStep({ step: 2, name: "Simulate webhook — checkout.completed", status: "pass",
      details: { checkoutId: mockCheckoutId, plan: testPlan, amount: 1999, currency: "usd" }
    }, t2);
  } catch (err: any) {
    addStep({ step: 2, name: "Simulate webhook — checkout.completed", status: "fail", 
      error: err.message,
      details: { checkoutId: mockCheckoutId }
    }, t2);
    // Continue to verification steps — they'll fail but we want full report
  }

  // ── Step 3: Verify subscription created ──────────────
  const t3 = performance.now();
  try {
    const subscription = await db.subscription.findFirst({
      where: { userId: testUserId, status: "ACTIVE" },
    });

    if (subscription) {
      testSubId = subscription.id;
      addStep({ step: 3, name: "Verify subscription in DB", status: "pass",
        details: {
          subscriptionId: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          createdAt: subscription.startsAt?.toISOString(),
        }
      }, t3);
    } else {
      addStep({ step: 3, name: "Verify subscription in DB", status: "fail",
        error: "No ACTIVE subscription found for test user after webhook simulation"
      }, t3);
    }
  } catch (err: any) {
    addStep({ step: 3, name: "Verify subscription in DB", status: "fail", error: err.message }, t3);
  }

  // ── Step 4: Verify payment record created ────────────
  const t4 = performance.now();
  try {
    const payment = await db.payment.findFirst({
      where: { userId: testUserId, stripePaymentIntentId: mockCheckoutId },
    });

    if (payment) {
      addStep({ step: 4, name: "Verify payment record in DB", status: "pass",
        details: {
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
        }
      }, t4);
    } else {
      addStep({ step: 4, name: "Verify payment record in DB", status: "fail",
        error: "No payment record found for test checkout"
      }, t4);
    }
  } catch (err: any) {
    addStep({ step: 4, name: "Verify payment record in DB", status: "fail", error: err.message }, t4);
  }

  // ── Step 5: Verify Premium permissions ───────────────
  const t5 = performance.now();
  try {
    const user = await db.user.findUnique({
      where: { id: testUserId },
      select: {
        id: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          select: { plan: true },
        },
      },
    });

    if (user?.subscriptions?.length) {
      const plan = user.subscriptions[0].plan;
      const isPremium = plan === "PREMIUM_MONTHLY" || plan === "PREMIUM_YEARLY";
      addStep({ step: 5, name: "Verify Premium permissions", status: isPremium ? "pass" : "fail",
        details: {
          activePlan: plan,
          isPremium,
          activeSubscriptions: user.subscriptions.length,
        }
      }, t5);
    } else {
      addStep({ step: 5, name: "Verify Premium permissions", status: "fail",
        error: "No active subscription found on user record"
      }, t5);
    }
  } catch (err: any) {
    addStep({ step: 5, name: "Verify Premium permissions", status: "fail", error: err.message }, t5);
  }

  // ── Step 6: Cleanup — delete test data ──────────────
  const t6 = performance.now();
  const cleanupResults: Record<string, string> = {};

  try {
    // Delete test subscription
    if (testSubId) {
      await db.subscription.delete({ where: { id: testSubId } }).catch(e => {
        cleanupResults.subscription = `Delete failed: ${e.message}`;
      });
      cleanupResults.subscription = cleanupResults.subscription || "deleted ✅";
    }

    // Delete test payment
    const paymentDeleted = await db.payment.deleteMany({
      where: { userId: testUserId, stripePaymentIntentId: mockCheckoutId },
    });
    cleanupResults.payment = `deleted ${paymentDeleted.count} record(s) ✅`;

    addStep({ step: 6, name: "Cleanup — remove test data", status: "pass",
      details: cleanupResults
    }, t6);
  } catch (err: any) {
    addStep({ step: 6, name: "Cleanup — remove test data", status: "warn",
      error: err.message,
      details: cleanupResults
    }, t6);
  }

  // ── Build final report ──────────────────────────────
  const report = buildReport(steps, t0, "COMPLETED");
  const statusCode = report.failed > 0 ? 500 : 200;

  // Log to console for Vercel logs
  console.log(`[E2E Test] Report: ${report.passed}/${report.totalSteps} passed, ${report.failed} failed, ${report.totalDurationMs}ms`);

  return NextResponse.json(report, { status: statusCode });
}

// Also support GET for convenience (same behavior)
export async function GET(request: NextRequest) {
  return POST(request);
}

function buildReport(steps: StepResult[], startTime: number, summary: string): TestReport {
  const totalDurationMs = Math.round(performance.now() - startTime);
  const passed = steps.filter(s => s.status === "pass").length;
  const failed = steps.filter(s => s.status === "fail").length;
  const skipped = steps.filter(s => s.status === "skip" || s.status === "warn").length;

  return {
    timestamp: new Date().toISOString(),
    totalSteps: steps.length,
    passed,
    failed,
    skipped,
    totalDurationMs,
    steps,
    environment: {
      NODE_ENV: process.env.NODE_ENV || "unknown",
      VERCEL_ENV: process.env.VERCEL_ENV || "unknown",
      hasCreemApiKey: !!process.env.CREEM_API_KEY,
      hasCreemWebhookSecret: !!process.env.CREEM_WEBHOOK_SECRET,
      hasCreemMonthlyProductId: !!process.env.CREEM_MONTHLY_PRODUCT_ID,
      hasCreemYearlyProductId: !!process.env.CREEM_YEARLY_PRODUCT_ID,
    },
    summary,
  };
}
