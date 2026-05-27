import { NextRequest, NextResponse } from "next/server";
import { getGoogleConfig } from "@/lib/auth/google-oauth";

/**
 * GET /api/debug/google-oauth-check
 * 
 * 检查 Google OAuth 配置状态
 */
export async function GET(request: NextRequest) {
  const config = getGoogleConfig();
  
  // 检查环境变量（不暴露敏感信息）
  const checks = {
    GOOGLE_CLIENT_ID: {
      present: !!process.env.GOOGLE_CLIENT_ID,
      length: process.env.GOOGLE_CLIENT_ID?.length || 0,
      preview: process.env.GOOGLE_CLIENT_ID 
        ? process.env.GOOGLE_CLIENT_ID.substring(0, 10) + "..." 
        : null,
    },
    GOOGLE_CLIENT_SECRET: {
      present: !!process.env.GOOGLE_CLIENT_SECRET,
      length: process.env.GOOGLE_CLIENT_SECRET?.length || 0,
      // 不暴露 secret 内容
    },
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: {
      present: !!process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
      preview: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID 
        ? process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.substring(0, 10) + "..." 
        : null,
    },
    AUTH_SECRET: {
      present: !!process.env.AUTH_SECRET,
      length: process.env.AUTH_SECRET?.length || 0,
    },
    NODE_ENV: process.env.NODE_ENV,
  };

  // 检查重定向URI配置
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com";
  const expectedRedirectUri = `${baseUrl}/api/auth/oauth/google/callback`;

  // 测试 Google OAuth 配置
  const configValid = config.valid;
  const configDetails = {
    clientIdLength: config.clientId.length,
    clientSecretLength: config.clientSecret.length,
    valid: configValid,
  };

  // 检查 NextAuth 配置
  const nextAuthConfig = {
    AUTH_URL: process.env.AUTH_URL || null,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
  };

  const allConfigured = configValid && 
    !!process.env.AUTH_SECRET &&
    !!process.env.NEXT_PUBLIC_APP_URL;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    envChecks: checks,
    googleConfig: configDetails,
    nextAuthConfig,
    expectedRedirectUri,
    summary: {
      allConfigured,
      readyForOAuth: allConfigured,
      nextStep: allConfigured 
        ? "✅ Google OAuth 已配置，可以测试登录" 
        : "❌ Google OAuth 配置不完整，请检查环境变量",
    },
  });
}
