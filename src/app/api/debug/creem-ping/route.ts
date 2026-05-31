/**
 * Creem API 连通性测试 + 产品列表提取端点
 * GET /api/debug/creem-ping
 * 
 * 用配置的 API Key 调用 Creem API，获取产品列表并提取 Monthly/Yearly 产品 ID
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
    timestamp: new Date().toISOString(),
  };

  // ── 1. 检查环境变量 ──────────────────────
  results.envCheck = {
    CREEM_API_KEY: !!process.env.CREEM_API_KEY,
    CREEM_ENV: process.env.CREEM_ENV ?? "(not set)",
    CREEM_MONTHLY_PRODUCT_ID: !!process.env.CREEM_MONTHLY_PRODUCT_ID,
    CREEM_YEARLY_PRODUCT_ID: !!process.env.CREEM_YEARLY_PRODUCT_ID,
    CREEM_WEBHOOK_SECRET: !!process.env.CREEM_WEBHOOK_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "(not set)",
  };

  // ── 2. 测试 Creem API 连通性（获取产品列表）───
  const apiKey = process.env.CREEM_API_KEY;
  if (!apiKey) {
    results.apiPing = {
      status: "❌ SKIPPED",
      reason: "CREEM_API_KEY not configured",
    };
    return NextResponse.json(results);
  }

  try {
    // ✅ 直接用 fetch 调用 Creem API（不依赖 SDK 内部结构）
    const baseUrl =
      (process.env.CREEM_ENV ?? "production") === "test"
        ? "https://test-api.creem.io/v1"
        : "https://api.creem.io/v1";
    
    // ✅ 正确端点: GET /v1/products/search?page_number=1&page_size=100
    const searchUrl = `${baseUrl}/products/search?page_number=1&page_size=100`;
    
    const pingRes = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    
    results.apiPing = {
      status: pingRes.status,
      statusText: pingRes.statusText,
      ok: pingRes.ok,
      url: searchUrl,
    };
    
    if (pingRes.ok) {
      const data = await pingRes.json();
      // ✅ 正确字段名：items（不是 products）
      const products = data.items || [];
      
      results.apiPing.productCount = products.length;
      results.apiPing.products = products.map((p: any) => ({
        id: p.id,
        name: p.name,
        price: p.price,           // ✅ price（不是 amount）
        currency: p.currency,
        billingPeriod: p.billingPeriod, // ✅ billingPeriod（不是 interval）
        mode: p.mode,
        status: p.status,
      }));
      
      // ✅ 优先用 billingPeriod 精确匹配，其次用 name 关键词（过滤一次性产品）
      // ⚠️ 注意运算符优先级：&& 高于 ||，必须加括号！
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
        results.apiPing.detectedMonthlyProduct = {
          id: matchedMonthly.id,
          name: matchedMonthly.name,
          price: matchedMonthly.price,
          envVarShouldBe: `CREEM_MONTHLY_PRODUCT_ID="${matchedMonthly.id}"`,
        };
      }
      
      if (matchedYearly) {
        results.apiPing.detectedYearlyProduct = {
          id: matchedYearly.id,
          name: matchedYearly.name,
          price: matchedYearly.price,
          envVarShouldBe: `CREEM_YEARLY_PRODUCT_ID="${matchedYearly.id}"`,
        };
      }
      
      // 检查当前配置的产品 ID 是否匹配
      results.apiPing.hasMonthlyProduct = matchedMonthly?.id === process.env.CREEM_MONTHLY_PRODUCT_ID;
      results.apiPing.hasYearlyProduct = matchedYearly?.id === process.env.CREEM_YEARLY_PRODUCT_ID;
      
    } else {
      const text = await pingRes.text().catch(() => "");
      results.apiPing.errorBody = text.slice(0, 500);
    }
  } catch (err: any) {
    results.apiPing = {
      status: "❌ ERROR",
      error: err.message,
      hint: err.name === "TimeoutError" ? "API timeout (10s)" : err.message,
    };
  }

  // ── 3. 检查 Webhook Secret 格式 ─────────
  if (process.env.CREEM_WEBHOOK_SECRET) {
    results.webhookSecretCheck = {
      length: process.env.CREEM_WEBHOOK_SECRET.length,
      format: "OK",
    };
  }

  // ── 汇总 ──────────────────────────────────
  const allOk =
    results.envCheck.CREEM_API_KEY &&
    results.envCheck.CREEM_MONTHLY_PRODUCT_ID &&
    results.envCheck.CREEM_YEARLY_PRODUCT_ID &&
    results.apiPing?.ok;

  results.summary = {
    allConfigured: allOk,
    readyForCheckout: allOk,
    nextStep: allOk
      ? "✅ 配置完成！可以端到端测试了"
      : "❌ 请先完成上述缺失的配置",
  };

  return NextResponse.json(results);
}
