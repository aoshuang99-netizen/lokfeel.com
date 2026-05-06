/**
 * [DEPRECATED] 管理后台权限测试端点 — 安全修复: 端点已禁用
 * 修复 C2: 公开管理员权限测试 → 仅开发环境可用
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "This endpoint has been disabled for security reasons. Use /api/admin/rbac/my-permissions instead." },
    { status: 403 }
  );
}
