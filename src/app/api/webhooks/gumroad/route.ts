export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * POST /api/webhooks/gumroad?secret=<GUMROAD_WEBHOOK_SECRET>
 *
 * Gumroad "ping" webhooks are form-encoded and carry NO signature header, so
 * the shared secret in the endpoint URL is the only authenticator:
 *   - compared in constant time;
 *   - when GUMROAD_ACCESS_TOKEN is set we additionally re-fetch the sale and
 *     refuse anything the Gumroad API does not confirm.
 *
 * Three resources are subscribed (sale / cancellation / refund) and each has a
 * distinct idempotency key, because a refund reuses the original sale_id — a
 * single key would make the refund look like a duplicate and be swallowed.
 *
 * Unknown products / unknown buyers / test sales return 200 (acknowledged,
 * ignored) so a misconfiguration cannot become an endless retry loop.
 */

const PLAN_BY_PERMALINK: Record<string, { plan: "PREMIUM_MONTHLY" | "PREMIUM_YEARLY"; days: number }> = {
  "hlua-pass-monthly": { plan: "PREMIUM_MONTHLY", days: 30 },
  "hlua-pass-quarterly": { plan: "PREMIUM_MONTHLY", days: 92 },
  "hlua-pass-yearly": { plan: "PREMIUM_YEARLY", days: 365 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

type Kind = "sale" | "cancellation" | "refund";

interface GumroadPing {
  kind: Kind;
  saleId: string;
  email: string;
  permalink: string;
  priceCents: string;
  currency: string;
  subscriptionId: string;
  isTest: boolean;
  recurrence: string;
  productName: string;
}

function parsePing(params: URLSearchParams): GumroadPing {
  const cancelled = field(params, "cancelled") === "true" || field(params, "cancelled_at") !== "";
  const refunded = field(params, "refunded") === "true" || field(params, "refund") === "true";
  const kind: Kind = refunded ? "refund" : cancelled ? "cancellation" : "sale";

  return {
    kind,
    saleId: field(params, "sale_id"),
    email: field(params, "email").toLowerCase(),
    permalink: field(params, "product_permalink") || field(params, "permalink"),
    priceCents: field(params, "price"),
    currency: (field(params, "currency") || "usd").toLowerCase(),
    subscriptionId: field(params, "subscription_id"),
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

async function handleSale(ping: GumroadPing): Promise<NextResponse> {
  const mapping = PLAN_BY_PERMALINK[ping.permalink];
  if (!mapping) {
    console.info("[Gumroad Webhook] unknown product acknowledged (no state change)", {
      permalink: ping.permalink,
      product: ping.productName,
      saleId: ping.saleId,
    });
    return NextResponse.json({ ok: true, ignored: "product not mapped" });
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
  const idempotencyKey = `gumroad:sale:${ping.saleId}`;
  const already = await db.payment.findFirst({
    where: { stripePaymentIntentId: idempotencyKey },
    select: { id: true },
  });
  if (already) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + mapping.days * DAY_MS);

  const existing = await db.subscription.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (existing) {
    await db.subscription.update({
      where: { id: existing.id },
      data: {
        plan: mapping.plan,
        status: "ACTIVE",
        stripeCustomerId: ping.email,
        stripeSubscriptionId: ping.subscriptionId || undefined,
        stripeCurrentPeriodEnd: periodEnd,
        cancelledAt: null,
        endsAt: null,
      },
    });
  } else {
    await db.subscription.create({
      data: {
        userId: user.id,
        plan: mapping.plan,
        status: "ACTIVE",
        stripeCustomerId: ping.email,
        stripeSubscriptionId: ping.subscriptionId || null,
        stripeCurrentPeriodEnd: periodEnd,
      },
    });
  }

  await db.payment.create({
    data: {
      userId: user.id,
      stripePaymentIntentId: idempotencyKey,
      amount: centsToUsd(ping.priceCents),
      currency: ping.currency,
      status: "SUCCEEDED",
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

  console.info("[Gumroad Webhook] subscription activated", {
    userId: user.id,
    plan: mapping.plan,
    saleId: ping.saleId,
  });

  return NextResponse.json({ ok: true, plan: mapping.plan, status: "ACTIVE" });
}

/**
 * Cancellations may arrive with only a subscription_id (no sale_id, and often
 * no permalink), so they are resolved against the stored subscription instead
 * of the product map.
 */
async function handleCancellation(ping: GumroadPing): Promise<NextResponse> {
  if (!ping.subscriptionId && !ping.email) {
    return NextResponse.json({ ok: true, ignored: "no subscription_id / email" });
  }

  const now = new Date();
  const target = ping.subscriptionId
    ? await db.subscription.findFirst({
        where: { stripeSubscriptionId: ping.subscriptionId },
        select: { id: true },
      })
    : await db.user
        .findUnique({ where: { email: ping.email }, select: { id: true } })
        .then((u: { id: string } | null) =>
          u
            ? db.subscription.findFirst({ where: { userId: u.id }, select: { id: true } })
            : null,
        );

  if (!target) {
    return NextResponse.json({ ok: true, ignored: "no matching subscription" });
  }

  await db.subscription.update({
    where: { id: target.id },
    data: { status: "CANCELLED", cancelledAt: now, endsAt: now, stripeCurrentPeriodEnd: now },
  });

  console.info("[Gumroad Webhook] subscription cancelled", {
    subscriptionId: ping.subscriptionId,
    email: ping.email,
  });

  return NextResponse.json({ ok: true, status: "CANCELLED" });
}

/**
 * A refund reuses the original sale_id, so it must NOT share the sale
 * idempotency key. The original payment row is flipped to REFUNDED; no second
 * payment row is created. The subscription itself stays as-is: a refunded
 * cycle is not a cancellation, and Gumroad sends its own cancellation ping.
 */
async function handleRefund(ping: GumroadPing): Promise<NextResponse> {
  if (!ping.saleId) {
    return NextResponse.json({ ok: true, ignored: "no sale_id" });
  }

  const original = await db.payment.findFirst({
    where: { stripePaymentIntentId: `gumroad:sale:${ping.saleId}` },
    select: { id: true, status: true },
  });
  if (!original) {
    console.info("[Gumroad Webhook] refund for unknown sale (no state change)", { saleId: ping.saleId });
    return NextResponse.json({ ok: true, ignored: "sale not recorded locally" });
  }
  if (original.status === "REFUNDED") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await db.payment.update({ where: { id: original.id }, data: { status: "REFUNDED" } });

  console.info("[Gumroad Webhook] payment refunded", { saleId: ping.saleId });
  return NextResponse.json({ ok: true, status: "REFUNDED" });
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

  if (ping.isTest) {
    console.info("[Gumroad Webhook] test ping acknowledged (no state change)", { saleId: ping.saleId });
    return NextResponse.json({ ok: true, ignored: "test sale" });
  }

  if (ping.saleId) {
    const verdict = await verifySaleWithApi(ping.saleId);
    if (verdict === "rejected") {
      console.error("[Gumroad Webhook] Gumroad API does not recognise this sale", { saleId: ping.saleId });
      return NextResponse.json({ error: "Unknown sale" }, { status: 401 });
    }
  }

  switch (ping.kind) {
    case "refund":
      return handleRefund(ping);
    case "cancellation":
      return handleCancellation(ping);
    default:
      return handleSale(ping);
  }
}
