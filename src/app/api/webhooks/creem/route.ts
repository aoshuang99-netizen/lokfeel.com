export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyCreemWebhookSignature } from "@/lib/creem";
import { db } from "@/lib/db";
import {
  isPaymentChannelReady,
  missingForChannel,
} from "@/lib/payments/availability";
import { paymentNotConfigured } from "@/lib/payments/not-configured";
import {
  classifyCreemEvent,
  creemObjectOf,
  customerIdOf,
  idempotencyKeyOf,
  isMonetaryKind,
  isStaleDowngrade,
  periodEndOf,
  planOf,
  statusForKind,
  subscriptionIdOf,
  transactionIdOf,
  userIdOf,
} from "@/lib/payments/creem-events";

/**
 * POST /api/webhooks/creem
 *
 * 载荷：`{ id, eventType, created_at, object }`（Creem 用 `object`，不是 Stripe 的 `data.object`）
 * 签名：`creem-signature` = HMAC-SHA256(raw body, webhook secret)
 *
 * V17（WB17-02）重写要点：
 *   1. 只处理**官方目录里真实存在**的事件。原实现里的 `subscription.created` /
 *      `subscription.cancelled`（英式拼写）/ `payment.succeeded` / `payment.failed`
 *      都不在目录内，是永远不会触发的死分支，已删除。
 *   2. 补上 `subscription.paid` —— **续费**走这个事件。原实现完全没处理，
 *      首月收钱、次月静默丢失。
 *   3. 幂等键按事件性质选：续费 `creem:tran:<交易id>`、开通 `creem:checkout:<id>`、
 *      退款 `creem:refund:<id>`。原实现一律用 `object.id`（订阅 id），
 *      会让第二期续费与首期同键而被判成重复。
 *   4. 乱序保护：降级类事件若周期早于当前周期，视为陈旧并忽略。
 */

const SUPPORTED_PLAN_VALUES = new Set([
  "PREMIUM_MONTHLY",
  "PREMIUM_YEARLY",
  "LIFETIME",
  "FREE",
  "LADY_FREE",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = process.env.CREEM_WEBHOOK_SECRET;
    const isMock = request.headers.get("creem-signature") === "mock_signature_for_testing";

    // SECURITY (BUG-625 P0): mock 旁路绝不在生产、或已配置真实密钥时生效。
    const isProd = process.env.NODE_ENV === "production";
    const allowMock = !isProd && !webhookSecret;
    if (isMock && !allowMock) {
      console.error("[Creem Webhook] Mock bypass rejected (production or secret configured)");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    if (!isPaymentChannelReady("creem.webhook") && !allowMock) {
      // 503（不是 500）：这是「尚未接入」，不是「代码坏了」。
      console.error(
        `[Creem Webhook] creem.webhook channel is not configured (missing: ${missingForChannel("creem.webhook").join(", ")})`,
      );
      return paymentNotConfigured("creem.webhook", {
        error: "Webhook secret not configured",
      });
    }

    const rawBodyBuffer = Buffer.from(await request.arrayBuffer());
    const rawBodyText = rawBodyBuffer.toString("utf8");
    const signature = request.headers.get("creem-signature");

    if (isMock) {
      console.log("[Creem Webhook] MOCK mode: skipping signature verification");
    } else {
      if (!signature) {
        console.error("[Creem Webhook] Missing creem-signature header");
        return NextResponse.json({ error: "Missing signature" }, { status: 400 });
      }
      if (!verifyCreemWebhookSignature(rawBodyBuffer, signature, webhookSecret!)) {
        console.error("[Creem Webhook] Signature verification failed");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const event = JSON.parse(rawBodyText) as Record<string, unknown>;
    const eventType = event.eventType;
    const eventId =
      typeof event.id === "string" && event.id ? event.id : `${String(eventType)}_${Date.now()}`;
    const obj = creemObjectOf(event);
    const kind = classifyCreemEvent(eventType);

    console.log(`[Creem Webhook] Received: ${String(eventType)} → ${kind}`, { eventId });

    // 不在官方目录里：不返回 4xx（否则 Creem 会按失败重试 5 次），记录后 200。
    if (kind === "unknown") {
      console.warn(`[Creem Webhook] Unknown event type (not in Creem catalog): ${String(eventType)}`);
      return NextResponse.json({ received: true, ignored: "unknown_event" });
    }

    // 已知但不影响订阅状态（credits / update / dispute）：明确忽略，不走 default。
    if (kind === "ignored") {
      console.log(`[Creem Webhook] Ignored by design: ${String(eventType)}`);
      return NextResponse.json({ received: true, ignored: eventType });
    }

    // ── 身份解析：metadata.userId 优先；缺失时按订阅 id 回查本地记录 ──
    const subId = subscriptionIdOf(obj);
    let userId = userIdOf(obj);
    let existing = subId
      ? await db.subscription.findFirst({ where: { stripeSubscriptionId: subId } })
      : null;

    if (!userId && existing) userId = existing.userId;
    if (!userId) {
      // 没有本地账号可归属：200 丢回执，避免 Creem 无限重试（数据在 Creem 侧仍在）。
      console.warn("[Creem Webhook] Cannot resolve userId", { eventId, subId });
      return NextResponse.json({ received: true, ignored: "no_user" });
    }

    if (!existing) {
      existing = await db.subscription.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    }

    // ── 退款：只翻原账单，不改订阅状态（退一期不等于退订） ──
    if (kind === "refund") {
      const tran = transactionIdOf(obj);
      const key = tran ? `creem:tran:${tran}` : null;
      if (key) {
        const original = await db.payment.findFirst({ where: { stripePaymentIntentId: key } });
        if (original) {
          await db.payment.update({
            where: { id: original.id },
            data: {
              status: "REFUNDED",
              description: `${original.description ?? "Creem payment"} (refunded)`,
            },
          });
          console.log(`[Creem Webhook] Payment ${original.id} marked REFUNDED`);
        } else {
          console.warn("[Creem Webhook] Refund without matching payment", { eventId, key });
        }
      }
      return NextResponse.json({ received: true, kind, refunded: Boolean(tran) });
    }

    // ── 乱序保护 ──
    const incomingPeriodEnd = periodEndOf(obj);
    const currentPeriodEnd = existing?.stripeCurrentPeriodEnd ?? null;
    if (isStaleDowngrade(kind, incomingPeriodEnd, currentPeriodEnd)) {
      console.warn(
        `[Creem Webhook] Stale downgrade ignored: ${kind} periodEnd=${incomingPeriodEnd?.toISOString()} < current=${currentPeriodEnd?.toISOString()}`,
      );
      return NextResponse.json({ received: true, ignored: "stale" });
    }

    // ── 账务：同一笔交易只入账一次 ──
    const paymentKey = isMonetaryKind(kind) ? idempotencyKeyOf(kind, event, obj) : null;
    if (paymentKey) {
      const already = await db.payment.findFirst({
        where: { stripePaymentIntentId: paymentKey },
      });
      if (already) {
        console.log(`[Creem Webhook] Duplicate ${kind}, payment already recorded: ${paymentKey}`);
        return NextResponse.json({ received: true, duplicate: true });
      }

      const rawAmount = typeof obj.amount === "number" ? obj.amount : 0;
      const currency = typeof obj.currency === "string" ? obj.currency : "usd";
      await db.payment.create({
        data: {
          userId,
          stripePaymentIntentId: paymentKey,
          amount: rawAmount / 100, // Creem 用分，Payment.amount 用元
          currency,
          status: "SUCCEEDED",
          description:
            kind === "renew"
              ? `Creem renewal: ${String(planOf(obj) ?? existing?.plan ?? "subscription")}`
              : `Creem checkout: ${String(planOf(obj) ?? existing?.plan ?? "subscription")}`,
          metadata: JSON.stringify({ eventId, eventType, kind, subId }),
        },
      });
      console.log(
        `[Creem Webhook] Payment recorded: ${paymentKey} (${rawAmount / 100} ${currency})`,
      );
    }

    // ── 状态迁移 ──
    const nextStatus = statusForKind(kind);
    if (!nextStatus) {
      return NextResponse.json({ received: true, kind });
    }

    const rawPlan = planOf(obj);
    const plan =
      rawPlan && SUPPORTED_PLAN_VALUES.has(rawPlan)
        ? (rawPlan as "FREE" | "LADY_FREE" | "PREMIUM_MONTHLY" | "PREMIUM_YEARLY" | "LIFETIME")
        : existing?.plan ?? "PREMIUM_MONTHLY";

    const customerId = customerIdOf(obj);

    if (existing) {
      await db.subscription.update({
        where: { id: existing.id },
        data: {
          plan,
          status: nextStatus,
          ...(customerId ? { stripeCustomerId: customerId } : {}),
          ...(subId ? { stripeSubscriptionId: subId } : {}),
          // 只前进不后退：迟到事件不得把周期改短
          ...(incomingPeriodEnd && (!currentPeriodEnd || incomingPeriodEnd > currentPeriodEnd)
            ? { stripeCurrentPeriodEnd: incomingPeriodEnd, endsAt: incomingPeriodEnd }
            : {}),
          ...(kind === "cancel" ? { cancelledAt: new Date() } : {}),
        },
      });
      console.log(`[Creem Webhook] ${kind} → ${nextStatus} for user ${userId}`);
    } else if (kind === "activate" || kind === "renew") {
      // 首购但本地还没有订阅记录（例如 checkout 与 webhook 竞态）：补建
      await db.subscription.create({
        data: {
          userId,
          plan,
          status: nextStatus,
          ...(customerId ? { stripeCustomerId: customerId } : {}),
          ...(subId ? { stripeSubscriptionId: subId } : {}),
          ...(incomingPeriodEnd
            ? { stripeCurrentPeriodEnd: incomingPeriodEnd, endsAt: incomingPeriodEnd }
            : {}),
        },
      });
      console.log(`[Creem Webhook] Subscription created for user ${userId} (${plan})`);
    } else {
      console.warn(`[Creem Webhook] ${kind} without local subscription for user ${userId}`);
    }

    return NextResponse.json({ received: true, kind, status: nextStatus });
  } catch (error) {
    console.error("[Creem Webhook] Error:", error);
    return NextResponse.json(
      { error: `Webhook handler failed: ${errorMessage(error)}` },
      { status: 500 },
    );
  }
}
