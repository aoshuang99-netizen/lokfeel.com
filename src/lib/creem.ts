/**
 * Creem.io Payment Client Library
 *
 * Docs: https://docs.creem.io
 * Base URL (prod): https://api.creem.io/v1
 * Base URL (test): https://test-api.creem.io/v1
 */

import { Creem } from "creem";
import crypto from "crypto";
import { db } from "./db";

// ── Configuration ──────────────────────────────────────

interface CreemConfig {
  apiKey: string;
  webhookSecret: string;
  env: "production" | "test";
  appUrl: string;
}

// ── Singleton Creem SDK instance ────────────────────────────
// Creem class constructor: new Creem({ apiKey, serverIdx })
//   serverIdx: 0 = production, 1 = test

let _creemClient: InstanceType<typeof Creem> | null = null;

export function getCreemClient(): InstanceType<typeof Creem> {
  if (_creemClient) return _creemClient;

  const apiKey = process.env.CREEM_API_KEY;
  if (!apiKey) throw new Error("CREEM_API_KEY is not configured");

  const env = (process.env.CREEM_ENV ?? "production") as "production" | "test";
  const serverIdx = env === "test" ? 1 : 0;

  _creemClient = new Creem({
    apiKey,
    serverIdx, // 0 = production, 1 = test
  });

  return _creemClient;
}

// ── Plan Config (aligned with existing Stripe plan amounts) ──

export const CREEM_PLAN_CONFIG = {
  PREMIUM_MONTHLY: {
    name: "LokFeel Premium Monthly",
    description: "Full power for serious seekers — monthly billing",
    price: 1999,        // $19.99 (Creem API 字段名是 price，单位：分)
    currency: "usd",
    billingPeriod: "monthly" as const,  // Creem API 字段名是 billing_period
    perks: { weeklyLimit: 999, canInitiateChat: true, canViewFullProfile: true },
  },
  PREMIUM_YEARLY: {
    name: "LokFeel Premium Yearly",
    description: "Full power for serious seekers — yearly billing (save 37%)",
    price: 14999,       // $149.99/year (Creem API 字段名是 price，单位：分)
    currency: "usd",
    billingPeriod: "yearly" as const,
    perks: { weeklyLimit: 999, canInitiateChat: true, canViewFullProfile: true },
  },
} as const;

export type CreemPlan = keyof typeof CREEM_PLAN_CONFIG;

// ── Webhook Signature Verification ─────────────────────────
//
// Creem signs webhooks with HMAC-SHA256 using the webhook secret.
// The signature is sent in the `creem-signature` header.
//
// IMPORTANT: Must verify against the RAW request body (Buffer),
// NOT the parsed JSON object.
//

export function verifyCreemWebhookSignature(
  rawBody: Buffer,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

// ── Create Checkout Session ────────────────────────────────
//
// Uses the Creem SDK to create a hosted checkout session.
// Returns the checkout URL to redirect the user.
//

export async function createCreemCheckout(params: {
  userId: string;
  userEmail: string;
  plan: CreemPlan;
  requestId?: string;
}): Promise<{ checkoutUrl: string; checkoutId: string }> {
  const creem = getCreemClient();
  const config = CREEM_PLAN_CONFIG[params.plan];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.lokfeel.com";

  // productId is required — use env var or fall back to placeholder
  const productId =
    params.plan === "PREMIUM_MONTHLY"
      ? process.env.CREEM_MONTHLY_PRODUCT_ID
      : process.env.CREEM_YEARLY_PRODUCT_ID;

  if (!productId) {
    throw new Error(
      `CREEM_${params.plan === "PREMIUM_MONTHLY" ? "MONTHLY" : "YEARLY"}_PRODUCT_ID is not configured`,
    );
  }

  const checkout = await creem.checkouts.create({
    productId,
    requestId: params.requestId ?? `order_${params.userId}_${Date.now()}`,
    successUrl: `${appUrl}/dashboard/subscription/success?provider=creem`,
    customer: { email: params.userEmail },
    metadata: {
      userId: params.userId,
      plan: params.plan,
    },
  });

  const checkoutUrl = (checkout as any)?.checkoutUrl || (checkout as any)?.checkout_url;
  // BUG-3: guard against an empty/invalid checkoutUrl so callers fail loudly
  if (!checkoutUrl || typeof checkoutUrl !== "string") {
    throw new Error("Creem checkout did not return a valid checkoutUrl");
  }
  return {
    checkoutUrl,
    checkoutId: checkout.id,
  };
}

// ── Upsert Subscription after Webhook ───────────────────────
//
// Subscription.userId is NOT unique in the Prisma schema,
// so we use findFirst + update/create instead of upsert with userId.
//

export async function upsertCreemSubscription(params: {
  userId: string;
  creemCustomerId: string;
  creemSubscriptionId: string;
  plan: CreemPlan;
  status: "ACTIVE" | "CANCELLED" | "PAST_DUE" | "TRIALING";
  currentPeriodEnd?: Date;
}) {
  const config = CREEM_PLAN_CONFIG[params.plan];

  // Find existing subscription by userId (findFirst since userId is not unique)
  const existing = await db.subscription.findFirst({
    where: { userId: params.userId },
  });

  if (existing) {
    return db.subscription.update({
      where: { id: existing.id },
      data: {
        plan: params.plan,
        status: mapCreemStatusToSubscriptionStatus(params.status),
        stripeCustomerId: params.creemCustomerId,   // reuse field
        stripeSubscriptionId: params.creemSubscriptionId,
        weeklyMatchLimit: config.perks.weeklyLimit,
        canInitiateChat: config.perks.canInitiateChat,
        canViewFullProfile: config.perks.canViewFullProfile,
        stripeCurrentPeriodEnd: params.currentPeriodEnd,
      },
    });
  } else {
    return db.subscription.create({
      data: {
        userId: params.userId,
        plan: params.plan,
        status: mapCreemStatusToSubscriptionStatus(params.status),
        stripeCustomerId: params.creemCustomerId,
        stripeSubscriptionId: params.creemSubscriptionId,
        weeklyMatchLimit: config.perks.weeklyLimit,
        canInitiateChat: config.perks.canInitiateChat,
        canViewFullProfile: config.perks.canViewFullProfile,
        stripeCurrentPeriodEnd: params.currentPeriodEnd,
      },
    });
  }
}

// ── Create Payment Record ───────────────────────────────────

export async function createCreemPaymentRecord(params: {
  userId: string;
  creemCheckoutId: string;
  amount: number;       // amount in cents from Creem
  currency?: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  return db.payment.create({
    data: {
      userId: params.userId,
      stripePaymentIntentId: params.creemCheckoutId,  // reuse field
      amount: params.amount / 100,                    // Creem amount is in cents, Payment.amount is in dollars
      currency: params.currency ?? "usd",
      status: mapCreemStatusToPaymentStatus(params.status),
      description: params.description,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}

// ── Status Mappers ─────────────────────────────────────────

function mapCreemStatusToSubscriptionStatus(
  status: string,
): "ACTIVE" | "CANCELLED" | "EXPIRED" | "PAST_DUE" | "TRIALING" {
  switch (status) {
    case "ACTIVE":    return "ACTIVE";
    case "CANCELLED": return "CANCELLED";
    case "PAST_DUE":  return "PAST_DUE";
    case "TRIALING":  return "TRIALING";
    default:           return "ACTIVE";
  }
}

function mapCreemStatusToPaymentStatus(
  status: string,
): "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED" {
  switch (status) {
    case "SUCCEEDED": return "SUCCEEDED";
    case "FAILED":    return "FAILED";
    case "REFUNDED":  return "REFUNDED";
    default:          return "PENDING";
  }
}
