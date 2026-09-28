import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { countUnreadForUser, countUserConversations } from "@/lib/im/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/chats/unread-count
 * 获取用户所有会话的未读消息总数（底部导航徽章）。
 *
 * ── P1-6 阶段 5 迁移说明（2026-09-28）────────────────────────────────────
 *
 * 1. 本路由原先**直接查 Legacy 三表**（`ChatRoom` + `Message`），是 B9 阻断点。
 *    现收敛到 `src/lib/im/stats.ts` —— 该模块是全项目统计口径的单一数据源，
 *    删表后自动退化为纯 IM 查询。
 *
 * 2. 🔴 顺带修掉一个**用户可见的计数缺陷（G-14）**：原实现是
 *
 *        const unreadCount = legacyUnread + imUnread        // ← 求和 = 重复计数
 *
 *    而迁移是 **1:1 复制**（`IMMessage.legacyMessageId` ↔ `Message.id`），
 *    两侧是**包含关系**而非并列关系。在双写期（`CHAT_TWIN_WRITE=1`）同一条消息
 *    同时存在于两表，求和会让徽章**凭空翻倍**。正确口径是 `max`，
 *    与 `stats.ts` 模块头部那张对照表一致。
 *
 *    为什么之前没被发现：Legacy 侧靠 `isRead` 布尔、IM 侧靠 `unreadCountA/B`
 *    缓存列，两者在**只跑单侧**的开发环境里看起来都对 —— 只有双写期才暴露。
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const [unreadCount, totalChats] = await Promise.all([
      countUnreadForUser(userId),
      countUserConversations(userId),
    ]);

    return NextResponse.json({ unreadCount, totalChats });
  } catch (error) {
    console.error("Unread count API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch unread count" },
      { status: 500 }
    );
  }
}
