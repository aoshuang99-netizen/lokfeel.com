export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyCreemWebhookSignature, upsertCreemSubscription, createCreemPaymentRecord } from "@/lib/creem";
import { db } from "@/lib/db";

// BUG-632: Idempotency — skip processing if a payment record for this Creem
// object/event id already exists (protects against webhook replay duplicates).
async function creemPaymentAlreadyProcessed(key: string): Promise<boolean> {
  if (!key) return false;
  const existing = await db.payment.findFirst({ where: { stripePaymentIntentId: key } });
  return !!existing;
}

// ── POST /api/webhooks/creem ────────────────────────────
//
// Creem webhook event payload structure (from official docs):
// {
//   "id": "evt_xxx",
//   "eventType": "checkout.completed",
//   "created_at": 1728734325927,
//   "object": { ... }   // actual data here (NOT data.object like Stripe)
// }
//
// Signature header: creem-signature (HMAC-SHA256 of raw body)
//

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = process.env.CREEM_WEBHOOK_SECRET;
    const isMock = request.headers.get("creem-signature") === "mock_signature_for_testing";

    // SECURITY (BUG-625 P0): the "mock" bypass must NEVER be honored in production,
    // nor when a real webhook secret is configured. In those cases it would let any
    // attacker forge subscription/payment events with a single static header value.
    const isProd = process.env.NODE_ENV === "production";
    const allowMock = !isProd && !webhookSecret;
    if (isMock && !allowMock) {
      console.error("[Creem Webhook] Mock bypass rejected (production or secret configured)");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    if (!webhookSecret && !allowMock) {
      console.error("[Creem Webhook] CREEM_WEBHOOK_SECRET not configured");
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
    }

    // Read raw body as Buffer for signature verification
    const rawBody = await request.arrayBuffer();
    const rawBodyBuffer = Buffer.from(rawBody);
    const rawBodyText = rawBodyBuffer.toString("utf8");

    const signature = request.headers.get("creem-signature");

    // Mock mode: skip signature verification
    if (isMock) {
      console.log("[Creem Webhook] MOCK mode: skipping signature verification");
    } else {
      if (!signature) {
        console.error("[Creem Webhook] Missing creem-signature header");
        return NextResponse.json({ error: "Missing signature" }, { status: 400 });
      }

      const signatureValid = verifyCreemWebhookSignature(rawBodyBuffer, signature, webhookSecret!);
      if (!signatureValid) {
        console.error("[Creem Webhook] Signature verification failed");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const event = JSON.parse(rawBodyText);
    const eventType = event.eventType;  // camelCase per Creem docs
    const eventId = event.id || `${eventType}_${Date.now()}`;
    const obj = event.object || {};

    console.log(`[Creem Webhook] Received: ${eventType}`, { eventId });

    // ── Event Routing ─────────────────────────────────────

    switch (eventType) {

      // ── Checkout completed → create/activate subscription ──
      case "checkout.completed": {
        const metadata = obj.metadata || {};
        const userId = metadata.userId;
        const plan = metadata.plan as "PREMIUM_MONTHLY" | "PREMIUM_YEARLY" | undefined;

        if (!userId || !plan) {
          console.warn("[Creem Webhook] Missing userId or plan in checkout metadata", { metadata });
          break;
        }

        const customerId = obj.customer || obj.customer_id || "";
        const subscriptionId = obj.subscription || obj.subscription_id || obj.id || "";
        const amount = obj.amount || 0;
        const currency = obj.currency || "usd";

        // BUG-632: idempotency — skip if this event was already processed
        if (await creemPaymentAlreadyProcessed(obj.id || eventId)) {
          console.log(`[Creem Webhook] Already processed ${eventId}, skipping`);
          break;
        }

        // Create payment record
        try {
          await createCreemPaymentRecord({
            userId,
            creemCheckoutId: obj.id || eventId,
            amount,
            currency,
            status: "SUCCEEDED",
            description: `Creem checkout: ${plan}`,
            metadata: { eventId, eventType, obj },
          });
          console.log(`[Creem Webhook] Payment record created for user ${userId}`);
        } catch (err) {
          console.error("[Creem Webhook] Failed to create payment record:", err);
        }

        // Upsert subscription
        try {
          await upsertCreemSubscription({
            userId,
            creemCustomerId: customerId,
            creemSubscriptionId: subscriptionId,
            plan,
            status: "ACTIVE",
            currentPeriodEnd: undefined,  // Creem may not provide this
          });
          console.log(`[Creem Webhook] Subscription activated for user ${userId}, plan: ${plan}`);
        } catch (err) {
          console.error("[Creem Webhook] Failed to upsert subscription:", err);
        }

        break;
      }

      // ── Subscription events ──────────────────────────────
      case "subscription.active":
      case "subscription.created": {
        const metadata = obj.metadata || {};
        const userId = metadata.userId;
        const plan = metadata.plan as "PREMIUM_MONTHLY" | "PREMIUM_YEARLY" | undefined;

        if (!userId || !plan) {
          console.warn("[Creem Webhook] Missing userId or plan in subscription metadata", { metadata });
          break;
        }

        try {
          await upsertCreemSubscription({
            userId,
            creemCustomerId: obj.customer || obj.customer_id || "",
            creemSubscriptionId: obj.id || "",
            plan,
            status: "ACTIVE",
            currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : undefined,
          });
          console.log(`[Creem Webhook] Subscription active for user ${userId}`);
        } catch (err) {
          console.error("[Creem Webhook] Failed to upsert subscription:", err);
        }
        break;
      }

      case "subscription.cancelled":
      case "subscription.canceled": {
        const metadata = obj.metadata || {};
        const userId = metadata.userId;

        if (!userId) {
          console.warn("[Creem Webhook] Missing userId in subscription cancellation");
          break;
        }

        try {
          const existing = await db.subscription.findFirst({ where: { userId } });
          if (existing) {
            await db.subscription.update({
              where: { id: existing.id },
              data: { status: "CANCELLED", cancelledAt: new Date() },
            });
            console.log(`[Creem Webhook] Subscription cancelled for user ${userId}`);
          }
        } catch (err) {
          console.error("[Creem Webhook] Failed to cancel subscription:", err);
        }
        break;
      }

      case "subscription.past_due": {
        const metadata = obj.metadata || {};
        const userId = metadata.userId;

        if (!userId) break;

        try {
          const existing = await db.subscription.findFirst({ where: { userId } });
          if (existing) {
            await db.subscription.update({
              where: { id: existing.id },
              data: { status: "PAST_DUE" },
            });
            console.log(`[Creem Webhook] Subscription past due for user ${userId}`);
          }
        } catch (err) {
          console.error("[Creem Webhook] Failed to update subscription:", err);
        }
        break;
      }

      // ── Payment events ───────────────────────────────────
      case "payment.succeeded": {
        const metadata = obj.metadata || {};
        const userId = metadata.userId;

        if (userId) {
          // BUG-632: idempotency
          if (await creemPaymentAlreadyProcessed(obj.id || eventId)) {
            console.log(`[Creem Webhook] Already processed ${eventId}, skipping`);
            break;
          }
          try {
            await createCreemPaymentRecord({
              userId,
              creemCheckoutId: obj.id || eventId,
              amount: obj.amount || 0,
              currency: obj.currency || "usd",
              status: "SUCCEEDED",
              description: `Creem payment: ${obj.description || eventType}`,
              metadata: { eventId, eventType, obj },
            });
            console.log(`[Creem Webhook] Payment succeeded for user ${userId}`);
          } catch (err) {
            console.error("[Creem Webhook] Failed to create payment record:", err);
          }
        }
        break;
      }

      case "payment.failed": {
        const metadata = obj.metadata || {};
        const userId = metadata.userId;

        if (userId) {
          // BUG-632: idempotency
          if (await creemPaymentAlreadyProcessed(obj.id || eventId)) {
            console.log(`[Creem Webhook] Already processed ${eventId}, skipping`);
            break;
          }
          try {
            await createCreemPaymentRecord({
              userId,
              creemCheckoutId: obj.id || eventId,
              amount: obj.amount || 0,
              currency: obj.currency || "usd",
              status: "FAILED",
              description: `Creem payment failed: ${obj.failure_reason || "unknown"}`,
              metadata: { eventId, eventType, obj },
            });
            console.log(`[Creem Webhook] Payment failed for user ${userId}`);
          } catch (err) {
            console.error("[Creem Webhook] Failed to create payment record:", err);
          }
        }
        break;
      }

      // ── Unhandled events ────────────────────────────────
      default: {
        console.log(`[Creem Webhook] Unhandled event type: ${eventType}`);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("[Creem Webhook] Error:", error);
    return NextResponse.json({ error: `Webhook handler failed: ${error.message}` }, { status: 500 });
  }
}
