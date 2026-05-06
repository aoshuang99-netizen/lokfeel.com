/**
 * [DEPRECATED] Automated Test API — 安全修复: 需要管理员权限
 * 修复 H8: 仅登录用户可触发 → 需要ADMIN权限
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminAuth();
    return NextResponse.json(
      { error: "Automated test endpoint has been deprecated. Use CLI-based testing." },
      { status: 410 }
    );
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

export async function POST() {
  try {
    await requireAdminAuth();
    return NextResponse.json(
      { error: "Automated test endpoint has been deprecated. Use CLI-based testing." },
      { status: 410 }
    );
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}
