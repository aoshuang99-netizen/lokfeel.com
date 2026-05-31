/**
 * 诊断端点：检查关键环境变量配置
 * GET /api/debug/config-check
 * 
 * 返回（不暴露敏感信息）：
 * - NEXT_PUBLIC_APP_URL
 * - NODE_ENV
 * - GOOGLE_CLIENT_ID 长度
 * - AUTH_SECRET 是否存在
 * - DATABASE_URL 是否存在
 * 
 * 安全：仅允许管理员访问（requireAdminAuth）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from '@/lib/auth';

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // ─── 强制管理员认证 ──────────────────────
  try {
    await requireAdminAuth();
  } catch {
    return NextResponse.json(
      { error: "Forbidden: Admin access required" },
      { status: 403 }
    );
  }

  const config = {
    environment: {
      NODE_ENV: process.env.NODE_ENV || "not set",
      VERCEL_ENV: process.env.VERCEL_ENV || "not set (not on Vercel)",
    },
    urls: {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "not set",
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || "not set",
      NEXTAUTH_AUTH_URL: process.env.NEXTAUTH_AUTH_URL || "not set",
    },
    google: {
      hasClientId: !!process.env.GOOGLE_CLIENT_ID,
      clientIdLength: process.env.GOOGLE_CLIENT_ID?.length || 0,
      clientIdPreview: process.env.GOOGLE_CLIENT_ID 
        ? `${process.env.GOOGLE_CLIENT_ID.substring(0, 20)}...` 
        : "not set",
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasNextPublicGoogleOAuthClientId: !!process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    },
    auth: {
      hasAuthSecret: !!process.env.AUTH_SECRET,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(config);
}
