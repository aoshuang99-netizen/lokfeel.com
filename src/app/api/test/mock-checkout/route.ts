/**
 * Creem Mock Checkout API
 * 
 * 模拟 Creem 支付流程，用于端到端测试，不依赖真实 Creem Product ID。
 * 
 * 流程:
 *   1. 创建 mock checkout session
 *   2. 返回 mock checkout URL (指向本地 mock 支付页)
 *   3. 用户点击"完成支付" → 触发 mock webhook
 *   4. Webhook 处理 → 更新订阅状态
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, badRequest } from "@/lib/api-response";

const checkoutSchema = z.object({
  plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY"]),
});

// ── In-memory store for mock checkout sessions ─────────────
// In production, use Redis or DB. For testing, Map is fine.
const mockSessions = new Map<string, MockCheckoutSession>();

interface MockCheckoutSession {
  id: string;
  userId: string;
  userEmail: string;
  plan: "PREMIUM_MONTHLY" | "PREMIUM_YEARLY";
  status: "pending" | "completed" | "failed";
  createdAt: number;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    let user;
    try {
      ({ user } = await requireAuth());
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = checkoutSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parseResult.error.issues },
        { status: 400 },
      );
    }

    const { plan } = parseResult.data;

    // 2. Guard: Female users
    const userProfile = await db.profile.findFirst({
      where: { userId: user.id },
      select: { gender: true },
    });
    if (userProfile?.gender === "FEMALE") {
      return NextResponse.json(
        { error: "Women already have premium-level access for free via Lady Free plan" },
        { status: 403 },
      );
    }

    // 3. Guard: existing active subscription
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });
    if (existingSub?.plan === "PREMIUM_MONTHLY" || existingSub?.plan === "PREMIUM_YEARLY") {
      return NextResponse.json(
        { error: "You already have an active Premium subscription" },
        { status: 400 },
      );
    }

    // 4. Create mock checkout session
    const sessionId = `mock_chk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com";

    const session: MockCheckoutSession = {
      id: sessionId,
      userId: user.id,
      userEmail: user.email || "",
      plan,
      status: "pending",
      createdAt: Date.now(),
    };
    mockSessions.set(sessionId, session);

    // 5. Return mock checkout URL
    const checkoutUrl = `${appUrl}/test/mock-payment?session_id=${sessionId}`;

    console.log(`[Mock Checkout] Created session ${sessionId} for user ${user.id}, plan: ${plan}`);

    return NextResponse.json({
      success: true,
      checkoutUrl,
      checkoutId: sessionId,
      mock: true,
      message: "This is a MOCK checkout for testing. No real payment will be made.",
    });
  } catch (error: any) {
    console.error("[Mock Checkout] Error:", error);
    return NextResponse.json(
      { error: `Mock checkout failed: ${error.message}` },
      { status: 500 },
    );
  }
}

// ── GET: Retrieve mock session (for mock payment page) ─────
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const session = mockSessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Mock session not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: session.id,
    plan: session.plan,
    status: session.status,
    userEmail: session.userEmail,
    createdAt: session.createdAt,
  });
}

// ── PATCH: Simulate payment completion ─────────────
// Called by the mock payment page when user clicks "Complete Payment"
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, action } = body; // action: "complete" | "fail"

    if (!session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    const session = mockSessions.get(session_id);
    if (!session) {
      return NextResponse.json({ error: "Mock session not found" }, { status: 404 });
    }

    if (action === "complete") {
      session.status = "completed";
      mockSessions.set(session_id, session);

      // Simulate webhook event to local webhook endpoint
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const webhookUrl = `${appUrl}/api/webhooks/creem`;

      // Build mock Creem webhook payload
      const mockEvent = {
        id: `evt_mock_${Date.now()}`,
        eventType: "checkout.completed",
        created_at: Date.now(),
        object: {
          id: session_id,
          customer: `cust_mock_${session.userId}`,
          subscription: `sub_mock_${Date.now()}`,
          amount: session.plan === "PREMIUM_MONTHLY" ? 1999 : 14999,
          currency: "usd",
          metadata: {
            userId: session.userId,
            plan: session.plan,
          },
        },
      };

      // Await webhook delivery so it's processed before returning
      console.log(`[Mock Checkout] Sending mock webhook to ${webhookUrl}...`);
      try {
        const webhookResp = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "creem-signature": "mock_signature_for_testing",
          },
          body: JSON.stringify(mockEvent),
        });
        console.log(`[Mock Checkout] Webhook responded: ${webhookResp.status}`);
      } catch (err: any) {
        console.error("[Mock Checkout] Failed to send mock webhook:", err.message);
      }

      console.log(`[Mock Checkout] Session ${session_id} completed. Mock webhook sent to ${webhookUrl}`);

      return NextResponse.json({
        success: true,
        message: "Payment completed (mock). Webhook sent.",
        redirectUrl: `${appUrl}/dashboard/subscription/success?provider=creem&mock=true`,
      });
    }

    if (action === "fail") {
      session.status = "failed";
      mockSessions.set(session_id, session);
      return NextResponse.json({ success: true, message: "Payment failed (mock)." });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("[Mock Checkout] PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── Export mockSessions for webhook handler to use ────────
export { mockSessions };
