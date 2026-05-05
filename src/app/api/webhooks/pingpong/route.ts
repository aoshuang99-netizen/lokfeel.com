import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createPingPongClient } from "@/lib/pingpong";

/**
 * POST /api/webhooks/pingpong
 *
 * Receives webhook notifications from PingPong Checkout
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("X-Signature") || "";

    console.log("[PingPong Webhook] Received:", body);

    // Verify Webhook Signature
    const pingpong = createPingPongClient();
    const isValid = pingpong.verifyWebhookSignature(body, signature);

    if (!isValid) {
      console.error("[PingPong Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse Webhook Payload
    const payload = JSON.parse(body);

    const {
      eventType,
      merchantTransactionId,
      transactionId,
      amount,
      currency,
      status,
    } = payload;

    console.log(`[PingPong Webhook] Event: ${eventType}, Transaction: ${merchantTransactionId}`);

    switch (eventType) {
      case "PAYMENT_SUCCESS":
      case "PAYMENT_COMPLETED": {
        const payment = await db.payment.findFirst({
          where: {
            description: { contains: merchantTransactionId },
          },
        });

        if (payment) {
          await db.payment.update({
            where: { id: payment.id },
            data: {
              status: "SUCCEEDED",
              metadata: JSON.stringify({
                ...JSON.parse(payment.metadata || "{}"),
                transactionId,
                completedAt: new Date().toISOString(),
              }),
            },
          });

          // Create/Update Subscription
          const metadata = JSON.parse(payment.metadata || "{}");
          const plan = metadata.plan || "PREMIUM_MONTHLY";

          const existingSub = await db.subscription.findFirst({
            where: { userId: payment.userId },
          });

          const now = new Date();
          const endsAt = new Date();
          if (plan === "PREMIUM_YEARLY") {
            endsAt.setFullYear(endsAt.getFullYear() + 1);
          } else {
            endsAt.setMonth(endsAt.getMonth() + 1);
          }

          if (existingSub) {
            await db.subscription.update({
              where: { id: existingSub.id },
              data: {
                status: "ACTIVE",
                plan,
                startsAt: now,
                endsAt,
              },
            });
          } else {
            await db.subscription.create({
              data: {
                userId: payment.userId,
                status: "ACTIVE",
                plan,
                startsAt: now,
                endsAt,
              },
            });
          }

          console.log(`[PingPong Webhook] Payment success, user ${payment.userId} upgraded to Premium`);
        }
        break;
      }

      case "PAYMENT_FAILED":
      case "PAYMENT_CANCELED": {
        const failedPayment = await db.payment.findFirst({
          where: {
            description: { contains: merchantTransactionId },
          },
        });

        if (failedPayment) {
          await db.payment.update({
            where: { id: failedPayment.id },
            data: {
              status: "FAILED",
              metadata: JSON.stringify({
                ...JSON.parse(failedPayment.metadata || "{}"),
                failureReason: status,
                failedAt: new Date().toISOString(),
              }),
            },
          });
        }
        break;
      }

      case "REFUND_SUCCESS": {
        const refundPayment = await db.payment.findFirst({
          where: {
            description: { contains: merchantTransactionId },
          },
        });

        if (refundPayment) {
          await db.payment.update({
            where: { id: refundPayment.id },
            data: {
              status: "REFUNDED",
            },
          });

          // Cancel Subscription
          await db.subscription.updateMany({
            where: { userId: refundPayment.userId },
            data: { status: "CANCELLED" },
          });
        }
        break;
      }

      default: {
        console.log(`[PingPong Webhook] Unhandled event type: ${eventType}`);
      }
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error("[PingPong Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
