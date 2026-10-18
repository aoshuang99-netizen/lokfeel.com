import { NextRequest } from "next/server";
import { getCreemClient } from "@/lib/creem";
import { isPaymentChannelReady } from "@/lib/payments/availability";
import { paymentNotConfigured } from "@/lib/payments/not-configured";

/**
 * GET /api/payments/creem/products
 *
 * Public endpoint — 返回格式化后的 Creem 产品列表
 * 供 Subscription 页面动态渲染价格，不再硬编码
 *
 * 未接入支付时：**503 + PAYMENT_NOT_CONFIGURED**（此前是 500 + SDK 原始报错）。
 * 为什么重要：订阅页靠 `data.error` 是否命中 "not configured" 决定显示哪句文案；
 * 500 + 原始报错会让它退化成「Failed to load plans」——
 * 把「还没接支付」误导成「支付坏了」。
 */
export async function GET(_req: NextRequest) {
  if (!isPaymentChannelReady("creem.checkout")) {
    return paymentNotConfigured("creem.checkout", {
      error: "Subscription plans are temporarily unavailable. Please check back soon.",
    });
  }

  try {
    const creem = getCreemClient();
    // ✅ 正确用法：search(page_number, page_size)
    // creem SDK v1.13 起返回 PageIterator<{ result: ProductListEntity }>，
    // 商品数组在 `.result.items`（旧版直接挂在返回值上）。
    const page = await creem.products.search(1, 100);
    const products = page.result;

    // 格式化为前端友好的结构
    const formatted = (products?.items || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      price: p.price,           // 单位：分
      priceDisplay: `$${(p.price / 100).toFixed(2)}`,
      currency: p.currency || "USD",
      billingPeriod: p.billing_period || p.billingPeriod || "month",
      mode: p.mode,
      status: p.status,
      isSubscription: !p.one_time,
    }));

    return Response.json({
      ok: true,
      products: formatted,
      count: formatted.length,
    });
  } catch (err) {
    // 已配置凭据但 provider 调用失败 ⇒ 这是**真实的上游故障**，
    // 用 502（坏网关）而不是 500，与「未接入」明确区分；
    // 同时不再把 SDK 的原始错误回给浏览器。
    console.error("[Creem Products API]", err);
    return Response.json(
      {
        ok: false,
        code: "PAYMENT_PROVIDER_ERROR",
        error: "Failed to load subscription plans from the payment provider.",
      },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
