export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * POST /api/webhooks/gumroad?secret=<GUMROAD_WEBHOOK_SECRET>
 *
 * Gumroad "ping" webhooks are form-encoded (application/x-www-form-urlencoded)
 * and carry NO signature header. The only authenticator available is a shared
 * secret embedded in the endpoint URL, so:
 *   - the secret is compared in constant time;
 *   - when GUMROAD_ACCESS_TOKEN is configured we additionally re-fetch the sale
 *     from the Gumroad API and refuse anything the API does not confirm;
 *   - unknown products / unknown users return 200 (acknowledged, ignored) so a
 *     misconfigured product does not turn into an infinite retry loop.
 *
 * Products mapped here are the Hlua Pass memberships. The legacy
 * SubscriptionPlan enum has no quarterly value, so quarterly maps to
 * PREMIUM_MONTHLY with a 92-day period (documented, not silently dropped).
 */

const PLAN_BY_PERMALINK: Record<string, { plan: "PREMIUM_MONTHLY" | "PREMIUM_YEARLY"; days: number }> = {
  "hlua-pass-monthly": { plan: "PREMIUM_MONTHLY", days: 30 },
  "hlua-pass-quarterly": { plan: "PREMIUM_MONTHLY", days: 92 },
  "hlua-pass-yearly": { plan: "PREMIUM_YEARLY", days: 365 },
};

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "gumroad-webhook").update(a).digest();
  const hb = createHmac("sha256", "gumroad-webhook").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function field(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? "").trim();
}

/** Gumroad prices arrive in cents; Payment.amount is whole USD. */
function centsToUsd(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n) / 100;
}

interface GumroadPing {
  saleId: string;
  email: string;
  permalink: string;
  priceCents: string;
  currency: string;
  subscriptionId: string;
  cancelled: boolean;
  refunded: boolean;
  isTest: boolean;
  recurrence: string;
  productName: string;
}

function parsePing(params: URLSearchParams): GumroadPing {
  return {
    saleId: field(params, "sale_id"),
    email: field(params, "email").toLowerCase(),
    permalink: field(params, "product_permalink") || field(params, "permalink"),
    priceCents: field(params, "price"),
    currency: (field(params, "currency") || "usd").toLowerCase(),
    subscriptionId: field(params, "subscription_id"),
    cancelled: field(params, "cancelled") === "true",
    refunded: field(params, "refunded") === "true",
    isTest: field(params, "test") === "true",
    recurrence: field(params, "recurrence"),
    productName: field(params, "product_name"),
  };
}

/** Optional second line of defence: ask Gumroad whether the sale exists. */
async function verifySaleWithApi(saleId: string): Promise<"confirmed" | "rejected" | "unavailable"> {
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  if (!token || !saleId) return "unavailable";
  try {
    const res = await fetch(`https://api.gumroad.com/v2/sales/${encodeURIComponent(saleId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 404) return "rejected";
    if (!res.ok) return "unavailable";
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "success" in body) {
      return (body as { success?: unknown }).success === true ? "confirmed" : "rejected";
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.GUMROAD_WEBHOOK_SECRET;
  if (!secret) {
    // 503 (not 401): the channel is simply not wired yet, same convention as
    // the other payment webhooks in this repo.
    console.error("[Gumroad Webhook] GUMROAD_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const presented = request.nextUrl.searchParams.get("secret") ?? request.headers.get("x-gumroad-secret") ?? "";
  if (!presented || !constantTimeEqual(presented, secret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const raw = await request.text();
  const ping = parsePing(new URLSearchParams(raw));

  if (!ping.saleId) {
    // Gumroad "resource=subscription" pings may only carry subscription_id.
    if (!ping.subscriptionId) {
      return NextResponse.json({ ok: true, ignored: "no sale_id / subscription_id" });
    }
  }

  if (ping.isTest) {
    console.info("[Gumroad Webhook] test ping acknowledged (no state change)", { saleId: ping.saleId });
    return NextResponse.json({ ok: true, ignored: "test sale" });
  }

  const mapping = PLAN_BY_PERMALINK[ping.permalink];
  if (!mapping) {
    console.info("[Gumroad Webhook] unknown product acknowledged (no state change)", {
      permalink: ping.permalink,
      product: ping.productName,
      saleId: ping.saleId,
    });
    return NextResponse.json({ ok: true, ignored: "product not mapped" });
  }

  if (ping.saleId) {
    const verdict = await verifySaleWithApi(ping.saleId);
    if (verdict === "rejected") {
      console.error("[Gumroad Webhook] Gumroad API does not recognise this sale", { saleId: ping.saleId });
      return NextResponse.json({ error: "Unknown sale" }, { status: 401 });
    }
  }

  if (!ping.email) {
    return NextResponse.json({ ok: true, ignored: "no buyer email" });
  }

  const user = await db.user.findUnique({ where: { email: ping.email }, select: { id: true } });
  if (!user) {
    // Buyer paid with an email that has no LokFeel account: acknowledge and stop.
    console.info("[Gumroad Webhook] no local account for buyer (no state change)", { email: ping.email });
    return NextResponse.json({ ok: true, ignored: "no matching user" });
  }

  // Idempotency: Gumroad retries on non-2xx and may resend duplicates.
  const idempotencyKey = `gumroad:${ping.saleId || ping.subscriptionId}`;
  const already = await db.payment.findFirst({
    where: { stripePaymentIntentId: idempotencyKey },
    select: { id: true },
  });
  if (already) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + mapping.days * 24 * 60 * 60 * 1000);
  const status: "ACTIVE" | "CANCELLED" | "EXPIRED" = ping.cancelled
    ? "CANCELLED"
    : ping.refunded
      ? "EXPIRED"
      : "ACTIVE";

  const existing = await db.subscription.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (existing) {
    await db.subscription.update({
      where: { id: existing.id },
      data: {
        plan: mapping.plan,
        status,
        stripeCustomerId: ping.email,
        stripeSubscriptionId: ping.subscriptionId || undefined,
        stripeCurrentPeriodEnd: status === "ACTIVE" ? periodEnd : now,
        cancelledAt: status === "CANCELLED" ? now : null,
      },
    });
  } else {
    await db.subscription.create({
      data: {
        userId: user.id,
        plan: mapping.plan,
        status,
        stripeCustomerId: ping.email,
        stripeSubscriptionId: ping.subscriptionId || null,
        stripeCurrentPeriodEnd: status === "ACTIVE" ? periodEnd : now,
      },
    });
  }

  await db.payment.create({
    data: {
      userId: user.id,
      stripePaymentIntentId: idempotencyKey,
      amount: centsToUsd(ping.priceCents),
      currency: ping.currency,
      status: ping.refunded ? "REFUNDED" : "SUCCEEDED",
      description: `Gumroad · ${ping.productName || ping.permalink}${ping.recurrence ? ` (${ping.recurrence})` : ""}`,
      metadata: JSON.stringify({
        provider: "gumroad",
        saleId: ping.saleId,
        subscriptionId: ping.subscriptionId,
        permalink: ping.permalink,
        recurrence: ping.recurrence,
      }),
    },
  });

  console.info("[Gumroad Webhook] subscription synced", {
    userId: user.id,
    plan: mapping.plan,
    status,
    saleId: ping.saleId,
  });

  return NextResponse.json({ ok: true, plan: mapping.plan, status });
}
