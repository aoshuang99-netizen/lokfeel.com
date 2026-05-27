/**
 * Creem 配置诊断端点
 * GET /api/debug/creem-config
 * 
 * 仅用于开发/内部诊断，不暴露密钥值
 * 生产环境应删除或加 IP 白名单
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const isVercelDev = process.env.VERCEL_ENV === "development";

  // 生产环境拒绝访问（简单保护）
  if (!isDev && !isVercelDev) {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const checks = {
    creem: {
      apiKey: {
        configured: !!process.env.CREEM_API_KEY,
        format: process.env.CREEM_API_KEY
          ? process.env.CREEM_API_KEY.startsWith("creem_")
            ? "✅ valid (creem_ prefix)"
            : "❌ invalid format (should start with 'creem_')"
          : "❌ not set",
        length: process.env.CREEM_API_KEY?.length ?? 0,
      },
      env: {
        configured: !!process.env.CREEM_ENV,
        value: process.env.CREEM_ENV ?? "(not set)",
        valid: ["production", "test"].includes(process.env.CREEM_ENV ?? ""),
      },
      webhookSecret: {
        configured: !!process.env.CREEM_WEBHOOK_SECRET,
        length: process.env.CREEM_WEBHOOK_SECRET?.length ?? 0,
      },
      monthlyProductId: {
        configured: !!process.env.CREEM_MONTHLY_PRODUCT_ID,
        format: process.env.CREEM_MONTHLY_PRODUCT_ID
          ? process.env.CREEM_MONTHLY_PRODUCT_ID.startsWith("prod_")
            ? "✅ valid (prod_ prefix)"
            : "❌ invalid format (should start with 'prod_')"
          : "❌ not set",
        value: process.env.CREEM_MONTHLY_PRODUCT_ID
          ? `${process.env.CREEM_MONTHLY_PRODUCT_ID.slice(0, 12)}...`
          : null,
      },
      yearlyProductId: {
        configured: !!process.env.CREEM_YEARLY_PRODUCT_ID,
        format: process.env.CREEM_YEARLY_PRODUCT_ID
          ? process.env.CREEM_YEARLY_PRODUCT_ID.startsWith("prod_")
            ? "✅ valid (prod_ prefix)"
            : "❌ invalid format (should start with 'prod_')"
          : "❌ not set",
        value: process.env.CREEM_YEARLY_PRODUCT_ID
          ? `${process.env.CREEM_YEARLY_PRODUCT_ID.slice(0, 12)}...`
          : null,
      },
      successUrl: {
        configured: !!process.env.CREEM_SUCCESS_URL,
        value: process.env.CREEM_SUCCESS_URL ?? "(not set)",
      },
    },
    app: {
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "(not set)",
      authSecret: !!process.env.AUTH_SECRET,
      dbUrl: !!process.env.DATABASE_URL,
    },
    // 尝试轻量 Creem API 连通性测试（不发真实请求）
    connectivity: {
      note: "Use /api/debug/creem-ping to test actual API connectivity",
    },
  };

  // 汇总
  const allConfigured =
    checks.creem.apiKey.configured &&
    checks.creem.webhookSecret.configured &&
    checks.creem.monthlyProductId.configured &&
    checks.creem.yearlyProductId.configured;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    allConfigured,
    checks,
    instructions: {
      ifNotConfigured: "Go to https://dashboard.creem.io to get API keys and create products",
      webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com"}/api/webhooks/creem`,
      nextStep: "After configuration, run: cd nexus-app && npx vercel deploy --prod --yes --force",
    },
  });
}
