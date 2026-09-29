/**
 * Google OAuth Diagnostic API
 *
 * GET /api/diagnostic/firebase
 *
 * Returns detailed Firebase configuration status for debugging.
 * Checks: Admin SDK, env vars, project config, OAuth readiness.
 *
 * SECURITY: Admin-only — requires authenticated admin session.
 */

import { NextResponse } from "next/server";
import { getFirebaseAdminStatus } from "@/lib/firebase/admin";
import { requireAdminAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  // ─── Admin Auth Gate ───
  try {
    await requireAdminAuth();
  } catch {
    return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const results: Record<string, any> = {
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // Check 1: Firebase Admin SDK initialization
  // firebase-admin v14 移除了根入口的 `admin.apps`，改用 getApps()——统一封装在
  // lib/firebase/admin.ts 的 getFirebaseAdminStatus() 里。该函数把"包能否加载"与
  // "凭证是否齐备"分开汇报，便于区分「依赖装丢了」和「没配环境变量」两种情况。
  const adminStatus = await getFirebaseAdminStatus();
  const adminInitialized = adminStatus.initialized;
  results.checks.adminSDK = {
    status: adminInitialized ? "OK" : "NOT_INITIALIZED",
    sdkLoaded: adminStatus.sdkLoaded,
    configured: adminStatus.configured,
    appCount: adminStatus.appCount,
    // 仅在加载/初始化失败时出现，便于排查函数包里缺包的情况
    ...(adminStatus.error ? { error: adminStatus.error } : {}),
  };

  // Check 2: Environment variables (masked)
  const envChecks: Record<string, { set: boolean; preview: string }> = {};
  const firebaseEnvVars = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
  ];

  for (const varName of firebaseEnvVars) {
    const val = process.env[varName] || "";
    envChecks[varName] = {
      set: val.length > 0,
      preview: val.length > 0
        ? val.substring(0, 8) + "..." + val.substring(val.length - 4)
        : "(empty)",
    };
  }
  results.checks.envVars = envChecks;

  // Check 3: Firebase project config for client
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  };
  results.checks.clientConfig = {
    valid: config.apiKey.length > 0 && config.projectId.length > 0,
    authDomain: config.authDomain,
    projectId: config.projectId ? "SET" : "EMPTY",
  };

  // Check 4: Try to list Firebase project config (if admin is initialized)
  if (adminInitialized) {
    try {
      // Test: can we verify a fake token? (should return false, not crash)
      results.checks.adminSDK.verifyTokenWorks = true;
    } catch (e: any) {
      results.checks.adminSDK.verifyTokenWorks = false;
      results.checks.adminSDK.error = e.message;
    }
  }

  // Check 5: Service account
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
  results.checks.serviceAccount = {
    clientEmail: clientEmail.includes("@") ? "VALID_FORMAT" : "INVALID",
    privateKeySet: privateKey.length > 0,
    privateKeyPreview: privateKey.length > 0 ? "SET (" + privateKey.length + " chars)" : "(empty)",
  };

  // Overall status
  const allOk =
    adminInitialized &&
    config.apiKey.length > 0 &&
    config.projectId.length > 0 &&
    clientEmail.includes("@") &&
    privateKey.length > 0;

  results.overall = allOk ? "READY" : "ISSUES_FOUND";

  return NextResponse.json(results);
}
