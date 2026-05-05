export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { success, badRequest, serverError } from "@/lib/api-response";
import { auditUserAction } from "@/lib/admin-audit";

/**
 * POST /api/admin/users/batch
 * 批量操作用户（封禁/解封/删除）
 */
export const POST = withPermission('user.edit', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const body = await request.json();
    const { action, userIds, reason } = body;

    if (!action || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return badRequest("缺少必要参数: action, userIds (数组)");
    }

    const validActions = ["ban", "unban", "deactivate"];
    if (!validActions.includes(action)) {
      return badRequest(`无效的操作类型: ${action}。有效值: ${validActions.join(", ")}`);
    }

    const results: { userId: string; success: boolean; error?: string }[] = [];

    for (const userId of userIds) {
      try {
        switch (action) {
          case "ban": {
            await db.profile.updateMany({
              where: { userId },
              data: {
                profileStatus: "BANNED",
                adminNotes: reason || "账号已被管理员封禁",
              },
            });
            await auditUserAction(
              adminId,
              "user.ban",
              userId,
              { before: { profileStatus: "APPROVED" }, after: { profileStatus: "BANNED" } },
              reason,
              request
            );
            break;
          }
          case "unban": {
            await db.profile.updateMany({
              where: { userId },
              data: {
                profileStatus: "APPROVED",
              },
            });
            await auditUserAction(
              adminId,
              "user.unban",
              userId,
              { before: { profileStatus: "BANNED" }, after: { profileStatus: "APPROVED" } },
              reason || "账号已解除封禁",
              request
            );
            break;
          }
          case "deactivate": {
            await db.profile.updateMany({
              where: { userId },
              data: {
                profileStatus: "DEACTIVATED",
                adminNotes: reason || "账号已被管理员停用",
              },
            });
            await auditUserAction(
              adminId,
              "user.deactivate",
              userId,
              { before: { profileStatus: "APPROVED" }, after: { profileStatus: "DEACTIVATED" } },
              reason,
              request
            );
            break;
          }
        }
        results.push({ userId, success: true });
      } catch (err: any) {
        results.push({ userId, success: false, error: err.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return success({
      action,
      total: userIds.length,
      success: successCount,
      failed: failCount,
      results,
    });
  } catch (error) {
    console.error("Batch user action error:", error);
    return serverError("批量操作失败");
  }
});
