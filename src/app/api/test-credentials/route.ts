/**
 * 凭证测试端点 - 测试指定账号的登录
 * GET /api/test-credentials?email=xxx&password=yyy
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") || "user_admin";
  const password = req.nextUrl.searchParams.get("password") || "admin123";

  const results: Record<string, unknown> = {
    email,
    password: password.substring(0, 2) + "***",
  };

  try {
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { profile: true },
    });

    if (!user) {
      results.error = "User not found";
      return NextResponse.json(results, { status: 404 });
    }

    results.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      hasPassword: !!(user as any).password,
    };

    if (!(user as any).password) {
      results.error = "User has no password (OAuth-only account)";
      return NextResponse.json(results, { status: 401 });
    }

    const isValid = await verifyPassword(password, (user as any).password);
    results.passwordMatch = isValid;

    if (!isValid) {
      results.error = "Invalid password";
      return NextResponse.json(results, { status: 401 });
    }

    // Login successful
    results.success = true;
    return NextResponse.json(results, { status: 200 });
  } catch (e: any) {
    results.error = e.message;
    return NextResponse.json(results, { status: 500 });
  }
}
