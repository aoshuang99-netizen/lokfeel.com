import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { getGoogleConfig } from "@/lib/auth/google-oauth";

/**
 * GET /api/debug/google-oauth-diagnostic
 * 
 * 超详细 Google OAuth 诊断
 * 检查所有配置和常见问题
 * 
 * ⚠️ ADMIN ONLY — Protected by requireAdminAuth
 */
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

  const protocol = request.nextUrl.protocol;
  const host = request.nextUrl.host;
  const baseUrl = `${protocol}//${host}`;
  
  const config = getGoogleConfig();
  
  // 构建预期的重定向URI
  const expectedRedirectUri = `${baseUrl}/api/auth/oauth/google/callback`;
  
  // 检查所有可能的配置问题
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      baseUrlFromRequest: baseUrl,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
    },
    googleConfig: {
      clientIdPresent: !!process.env.GOOGLE_CLIENT_ID,
      clientIdLength: process.env.GOOGLE_CLIENT_ID?.length || 0,
      clientIdPreview: process.env.GOOGLE_CLIENT_ID 
        ? `${process.env.GOOGLE_CLIENT_ID.substring(0, 15)}...` 
        : null,
      clientSecretPresent: !!process.env.GOOGLE_CLIENT_SECRET,
      clientSecretLength: process.env.GOOGLE_CLIENT_SECRET?.length || 0,
      configValid: config.valid,
    },
    nextAuthConfig: {
      AUTH_SECRET_PRESENT: !!process.env.AUTH_SECRET,
      AUTH_SECRET_LENGTH: process.env.AUTH_SECRET?.length || 0,
      AUTH_URL: process.env.AUTH_URL || null,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
    },
    redirectUri: {
      expected: expectedRedirectUri,
      note: "必须在 Google Cloud Console 的 '已授权的重定向URI' 中配置此URI",
      currentValueInCode: `${process.env.NEXT_PUBLIC_APP_URL || baseUrl}/api/auth/oauth/google/callback`,
    },
    commonIssues: [
      {
        issue: "Google Cloud Console 重定向URI不匹配",
        check: "确保 https://app.lokfeel.com/api/auth/oauth/google/callback 已添加到 Google Cloud Console",
        severity: "HIGH",
      },
      {
        issue: "AUTH_SECRET 未配置或格式错误",
        check: "必须是至少32字符的随机字符串",
        severity: "HIGH",
      },
      {
        issue: "NEXT_PUBLIC_APP_URL 未配置",
        check: "应该设置为 https://app.lokfeel.com",
        severity: "MEDIUM",
      },
      {
        issue: "Google OAuth 同意屏幕未配置",
        check: "需要在 Google Cloud Console 中配置 OAuth 同意屏幕",
        severity: "HIGH",
      },
    ],
    signinEndpoint: {
      path: "/api/auth/google/signin",
      method: "GET",
      expectedBehavior: "重定向到 Google 授权页面",
      testCommand: `curl -s -I "${baseUrl}/api/auth/google/signin" | head -5`,
    },
    callbackEndpoint: {
      path: "/api/auth/google/callback",
      method: "GET",
      expectedBehavior: "处理 Google 授权码并创建会话",
      note: "必须通过 Google 重定向访问，不能直接调用",
    },
    testSteps: [
      "1. 访问 https://app.lokfeel.com/login",
      "2. 点击 'Continue with Google' 按钮",
      "3. 如果被重定向到 Google，说明 signin 端点工作正常",
      "4. 如果在 Google 授权后出现错误，检查 Vercel 日志",
      "5. 查看浏览器控制台 (F12) 获取详细错误信息",
    ],
  };
  
  return NextResponse.json(diagnostics, { status: 200 });
}
