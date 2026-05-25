import { NextRequest } from "next/server";
import { getCreemClient } from "@/lib/creem";

/**
 * GET /api/payments/creem/products
 * 
 * Public endpoint — 返回格式化后的 Creem 产品列表
 * 供 Subscription 页面动态渲染价格，不再硬编码
 */
export async function GET(_req: NextRequest) {
  try {
    const creem = getCreemClient();
    // ✅ 正确用法：search(page_number, page_size)
    const products = await creem.products.search(1, 100);

    // 格式化为前端友好的结构
    const formatted = (products.items || []).map((p: any) => ({
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
  } catch (err: any) {
    console.error("[Creem Products API]", err);
    return Response.json(
      { ok: false, error: err.message || "Failed to fetch products" },
      { status: 500 },
    );
  }
}
