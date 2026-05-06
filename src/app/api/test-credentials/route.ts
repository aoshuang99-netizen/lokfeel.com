/**
 * [DEPRECATED] 凭证测试端点 — 安全修复: 端点已禁用
 * 修复 C1: 公开凭据测试 → 仅开发环境可用，生产环境404
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "This endpoint has been disabled for security reasons. Use the login API instead." },
    { status: 403 }
  );
}
