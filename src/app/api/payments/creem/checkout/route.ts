export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, badRequest, serverError, forbidden } from "@/lib/api-response";
import {
  getCreemClient,
} from "@/lib/creem";
import { isFemaleGender } from "@/lib/gender-utils";
import { isPaymentChannelReady } from "@/lib/payments/availability";
import { paymentNotConfigured } from "@/lib/payments/not-configured";
import {
  checkoutRequestId,
  resolveCheckoutTarget,
} from "@/lib/payments/creem-plan-resolve";

// ── Checkout Schema ──────────────────────────────
// 支持两种方式：plan（兼容旧版）或 productId（动态）
// ⚠️ B-18：原来用 `.refine(d => { if (!...) return { message } })` —— 回调返回真值对象，
// zod 视为“通过”，该约束**从未生效**（只剩错误信息丢失的副作用）。改用 superRefine。
const checkoutSchema = z
  .object({
    plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY"]).optional(),
    productId: z.string().min(1).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.plan && !data.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan"],
        message: "Must provide either 'plan' or 'productId'",
      });
    }
  });

// ── POST /api/payments/creem/checkout ──────────────────────
export async function POST(request: NextRequest) {
  try {
    // ── 1. Authenticate ──────────────────────────────
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
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 },
      );
    }

    const { plan, productId } = parseResult.data;

    // ── 2. Guard: Female users get Lady Free ─────────────────
    const userProfile = await db.profile.findFirst({
      where: { userId: user.id },
      select: { gender: true },
    });

    if (isFemaleGender(userProfile?.gender)) {
      return NextResponse.json(
        { error: "Women already have premium-level access for free via Lady Free plan" },
        { status: 403 },
      );
    }

    // ── 3. Guard: Check existing active subscription ─────
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });

    if (
      existingSub &&
      (existingSub.plan === "PREMIUM_MONTHLY" || existingSub.plan === "PREMIUM_YEARLY")
    ) {
      return NextResponse.json(
        { error: "You already have an active Premium subscription" },
        { status: 400 },
      );
    }

    // ── 4. Guard: 支付通道就绪（单一判定来源）───────────────
    // 未接入时回 503 + PAYMENT_NOT_CONFIGURED；body 仍保留扁平 `error`
    // 以兼容订阅页现有的 `data.error` 文案分支。
    if (!isPaymentChannelReady("creem.checkout")) {
      console.error("[Creem Checkout] creem.checkout channel is not configured");
      return paymentNotConfigured("creem.checkout", {
        error: "Payment system is not configured. Please try again later.",
      });
    }

    // ── 5. 解析结算目标（B-16：套餐只能由本地 env 决定，前端不得自报）────
    // 旧实现在 productId 分支直接透传前端字符串 ⇒ 可购买任意商品；
    // 且只传 productId 时 metadata.plan 写死 `"dynamic"` ⇒ webhook 白名单不认 ⇒ 年付记成月付。
    const target = resolveCheckoutTarget(
      { plan, productId },
      {
        CREEM_MONTHLY_PRODUCT_ID: process.env.CREEM_MONTHLY_PRODUCT_ID,
        CREEM_YEARLY_PRODUCT_ID: process.env.CREEM_YEARLY_PRODUCT_ID,
      },
    );

    if (!target.ok) {
      console.error(`[Creem Checkout] Rejected (${target.reason}): ${target.message}`);
      // 配置缺失属服务端问题（503），前端参数问题属 400。
      if (target.reason === 'unknown_product' && target.message.includes('is not configured')) {
        return NextResponse.json(
          { error: "Payment system is not configured. Please try again later." },
          { status: 503 },
        );
      }
      return badRequest(target.message);
    }

    const resolvedProductId = target.productId;
    const resolvedPlan = target.plan;

    // ── 6. Get user email for Creem customer ─────────────
    const userRecord = await db.user.findUnique({
      where: { id: user.id },
      select: { email: true, name: true },
    });
    if (!userRecord) return badRequest("User not found");

    // ── 7. Create Creem checkout session ─────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.lokfeel.com";

    const creem = getCreemClient();
    const checkout = await creem.checkouts.create({
      productId: resolvedProductId,
      // B-17：幂等键按 15 分钟窗口分桶 —— 窗口内双击/重试复用同一 checkout，
      // 跨窗口可新建（放弃支付后仍能重试）。原来裸 `Date.now()` ⇒ 判重永远失效。
      requestId: checkoutRequestId(user.id, resolvedPlan, Date.now()),
      successUrl: `${appUrl}/dashboard/subscription/success?provider=creem`,
      customer: { email: userRecord.email },
      metadata: {
        userId: user.id,
        // 不再写 "dynamic"：webhook 用真实套餐名，年付不会被记成月付
        plan: resolvedPlan,
        productId: resolvedProductId,
      },
    });

    return NextResponse.json({
      success: true,
      checkoutUrl: (checkout as any).checkoutUrl || (checkout as any).checkout_url,
      checkoutId: checkout.id,
    });

  } catch (error: any) {
    console.error("[Creem Checkout] Error:", error);
    return NextResponse.json(
      { error: `Checkout failed: ${error.message}` },
      { status: 500 },
    );
  }
}
