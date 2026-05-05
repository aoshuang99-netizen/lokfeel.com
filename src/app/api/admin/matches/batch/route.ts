export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, badRequest, serverError } from "@/lib/api-response";
import { auditMatchAction } from "@/lib/admin-audit";

/**
 * POST /api/admin/matches/batch
 * 批量操作匹配（取消/删除）
 */
export const POST = withPermission('match.edit', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const body = await request.json();
    const { action, matchIds, reason } = body;

    if (!action || !matchIds || !Array.isArray(matchIds) || matchIds.length === 0) {
      return badRequest("缺少必要参数: action, matchIds (数组)");
    }

    const validActions = ["cancel", "delete"];
    if (!validActions.includes(action)) {
      return badRequest(`无效的操作类型: ${action}。有效值: ${validActions.join(", ")}`);
    }

    const results: { matchId: string; success: boolean; error?: string }[] = [];

    for (const matchId of matchIds) {
      try {
        switch (action) {
          case "cancel": {
            const match = await db.match.findUnique({ where: { id: matchId } });
            if (!match) {
              results.push({ matchId, success: false, error: "匹配不存在" });
              continue;
            }

            await db.match.update({
              where: { id: matchId },
              data: {
                status: "CANCELLED",
                reviewNotes: reason || "管理员批量取消",
                reviewedBy: adminId,
              },
            });

            // 发送通知
            await db.notification.createMany({
              data: [
                {
                  userId: match.senderId,
                  type: "MATCH_REJECTED",
                  title: "匹配已取消",
                  body: reason || "管理员已取消此匹配",
                },
                {
                  userId: match.receiverId,
                  type: "MATCH_REJECTED",
                  title: "匹配已取消",
                  body: reason || "管理员已取消此匹配",
                },
              ],
            });

            await auditMatchAction(
              adminId,
              "match.batch_cancel",
              matchId,
              { before: { status: match.status }, after: { status: "CANCELLED" } },
              reason,
              request
            );
            break;
          }
          case "delete": {
            const match = await db.match.findUnique({ where: { id: matchId } });
            if (!match) {
              results.push({ matchId, success: false, error: "匹配不存在" });
              continue;
            }

            await db.match.delete({ where: { id: matchId } });

            await auditMatchAction(
              adminId,
              "match.batch_delete",
              matchId,
              { before: match, after: null },
              reason,
              request
            );
            break;
          }
        }
        results.push({ matchId, success: true });
      } catch (err: any) {
        results.push({ matchId, success: false, error: err.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return success({
      action,
      total: matchIds.length,
      success: successCount,
      failed: failCount,
      results,
    });
  } catch (error) {
    console.error("Batch match action error:", error);
    return serverError("批量操作失败");
  }
});
