/**
 * 认证诊断端点 - 帮助排查管理后台认证问题
 * GET /api/admin-check
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getToken } from "next-auth/jwt";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      AUTH_SECRET_exists: !!process.env.AUTH_SECRET,
      AUTH_SECRET_length: (process.env.AUTH_SECRET || "").length,
      AUTH_URL: process.env.AUTH_URL,
    },
  };

  // 1. Check cookies
  const cookies = req.cookies.getAll();
  results.cookies = {
    count: cookies.length,
    names: cookies.map(c => c.name),
    nextAuthCookie: cookies.find(c => c.name.includes("next-auth"))?.name || null,
  };

  // 2. Test getToken() from next-auth/jwt
  try {
    // Try both cookie names
    for (const cookieName of ["next-auth.session-token", "__Secure-next-auth.session-token"]) {
      const token = await getToken({ req, secret: process.env.AUTH_SECRET, cookieName });
      if (token) {
        results.getToken = {
          success: true,
          hasId: !!token.id,
          id: token.id,
          role: token.role,
          email: token.email,
          sub: token.sub,
          // 完整token字段
          tokenKeys: Object.keys(token),
        };
        break;
      }
    }
    if (!results.getToken) {
      results.getToken = { success: false, reason: "No token found with either cookie name" };
    }
  } catch (e: any) {
    results.getToken = { success: false, error: e.message };
  }

  // 3. Test auth() from next-auth
  try {
    const sess = await auth();
    results.auth = {
      success: true,
      hasUser: !!sess?.user,
      userId: sess?.user?.id,
      userRole: (sess?.user as any)?.role,
      userEmail: sess?.user?.email,
      hasSession: !!sess,
    };
  } catch (e: any) {
    results.auth = { success: false, error: e.message };
  }

  // 4. Test Prisma DB access
  try {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const userCount = await db.user.count();
    results.db = { success: true, userCount };
  } catch (e: any) {
    results.db = { success: false, error: e.message };
  }

  return NextResponse.json(results, { status: 200 });
}
