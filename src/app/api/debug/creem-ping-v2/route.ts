/**
 * Creem API 连通性测试 V2（绕过缓存）
 * GET /api/debug/creem-ping-v2
 * 
 * ⚠️ ADMIN ONLY — Protected by requireAdminAuth
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // ─── Admin Auth Gate ──────────────────────
  try {
    await requireAdminAuth();
  } catch {
    return NextResponse.json(
      { error: "Forbidden: Admin access required" },
      { status: 403 }
    );
  }

  const results: Record<string, any> = {
    version: "v2-20260524",
    timestamp: new Date().toISOString(),
  };

  const apiKey = process.env.CREEM_API_KEY;
  if (!apiKey) {
    results.error = "CREEM_API_KEY not configured";
    return NextResponse.json(results);
  }

  try {
    const baseUrl = "https://api.creem.io/v1";
    const searchUrl = `${baseUrl}/products/search?page_number=1&page_size=100`;
    
    const pingRes = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    results.status = pingRes.status;
    results.ok = pingRes.ok;

    if (pingRes.ok) {
      const data = await pingRes.json();
      const products = data.items || [];
      
      results.productCount = products.length;
      results.products = products.map((p: any) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        billingPeriod: p.billingPeriod,
        mode: p.mode,
        status: p.status,
      }));
      
      // ✅ 正确匹配逻辑（修复运算符优先级）
      const monthlyKeywords = ["month", "monthly"];
      const yearlyKeywords = ["year", "yearly", "annual"];
      
      const matchedMonthly = products.find((p: any) =>
        p.mode === "prod" && (
          (p.billingPeriod === "every-month" || p.billingPeriod === "monthly") ||
          (p.billingPeriod !== "once" && monthlyKeywords.some((kw: string) => p.name?.toLowerCase().includes(kw)))
        )
      );
      const matchedYearly = products.find((p: any) =>
        p.mode === "prod" && (
          (p.billingPeriod === "every-year" || p.billingPeriod === "yearly") ||
          (p.billingPeriod !== "once" && yearlyKeywords.some((kw: string) => p.name?.toLowerCase().includes(kw)))
        )
      );
      
      if (matchedMonthly) {
        results.detectedMonthlyProduct = {
          id: matchedMonthly.id,
          name: matchedMonthly.name,
          price: matchedMonthly.price,
          envVarShouldBe: `CREEM_MONTHLY_PRODUCT_ID="${matchedMonthly.id}"`,
        };
      }
      
      if (matchedYearly) {
        results.detectedYearlyProduct = {
          id: matchedYearly.id,
          name: matchedYearly.name,
          price: matchedYearly.price,
          envVarShouldBe: `CREEM_YEARLY_PRODUCT_ID="${matchedYearly.id}"`,
        };
      }
      
      results.hasMonthlyProduct = matchedMonthly?.id === process.env.CREEM_MONTHLY_PRODUCT_ID;
      results.hasYearlyProduct = matchedYearly?.id === process.env.CREEM_YEARLY_PRODUCT_ID;
    } else {
      const text = await pingRes.text().catch(() => "");
      results.errorBody = text.slice(0, 500);
    }
  } catch (err: any) {
    results.error = err.message;
  }

  return NextResponse.json(results);
}
