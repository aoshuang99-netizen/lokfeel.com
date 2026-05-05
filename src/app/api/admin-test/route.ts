/**
 * 管理后台权限测试端点
 * 测试指定用户的API权限
 * GET /api/admin-test
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hasPermission } from "@/lib/with-permission";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // 硬编码的测试用户ID - 如果没有登录可以手动指定
  const userId = req.nextUrl.searchParams.get("userId") || "cmo9p57p8000204jsionbbrz7";
  const permission = req.nextUrl.searchParams.get("perm") || "analytics.view";

  const results: Record<string, unknown> = {
    testUserId: userId,
    testPermission: permission,
  };

  // 1. 检查用户是否存在于数据库
  try {
    const db = getDb();
    const user = await db.user.findUnique({ where: { id: userId } });
    results.user = user
      ? { id: user.id, email: user.email, role: user.role }
      : "NOT FOUND";
  } catch (e: any) {
    results.userError = e.message;
  }

  // 2. 检查用户在admin_user_role表中的角色
  try {
    const db = getDb();
    const roles = await db.adminUserRole.findMany({
      where: { userId },
      select: {
        role: true,
        customRole: {
          select: { name: true, permissions: true },
        },
        expiresAt: true,
      },
    });
    results.adminRoles = roles.map(r => ({
      role: r.role,
      customRole: r.customRole?.name || null,
      expiresAt: r.expiresAt,
    }));
  } catch (e: any) {
    results.rolesError = e.message;
  }

  // 3. 测试hasPermission函数
  try {
    const has = await hasPermission(userId, permission);
    results.permissionCheck = {
      permission,
      hasAccess: has,
    };
  } catch (e: any) {
    results.permissionError = e.message;
  }

  // 4. 测试analytics.view权限（管理员API使用的权限）
  const adminPermissions = [
    "analytics.view",
    "user.view",
    "settings.view",
    "rbac.view",
  ];
  try {
    const db = getDb();
    const permResults: Record<string, boolean> = {};
    for (const perm of adminPermissions) {
      permResults[perm] = await hasPermission(userId, perm);
    }
    results.adminPermissions = permResults;
  } catch (e: any) {
    results.adminPermError = e.message;
  }

  return NextResponse.json(results, { status: 200 });
}
