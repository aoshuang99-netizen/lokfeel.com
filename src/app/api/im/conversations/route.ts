/**
 * ✅ [P1-6 TARGET — KEEP] 统一会话列表接口（阶段 4 起为**唯一**列表数据源）。
 *
 * 方案 A（2026-09-27 确认，见 docs/CHAT-MERGE-AUDIT.md §4）：IM 为终局模型。
 *
 * 阶段 4 变更（2026-09-27）：
 *   · GET 改为调用 `buildConversationList()`（`@/lib/im/list`）—— 与 `/api/chat` 共用同一实现，
 *     消除两侧各自拼装导致的字段漂移。
 *   · 列表项 `id` **恒为 Conversation.id**（历史遗留房间除外），修复 D1「同一会话两个主键」。
 *     这是前端能够稳定走 IM 数据通路的**前提条件**。
 *   · 补回改造前 IM 侧缺失的富化字段：`matchId`/`matchScore`/`age`/`isVault`/`vaultExpiresAt`/
 *     `vaultStatus`。此前若前端改用本接口会**丢失匹配分徽章与 Vault 徽章**（功能回退）。
 *
 * ⚠️ 本文件此前标注为 "DEPRECATED: Use /api/chat instead"，该注释方向错误，已于
 *    2026-09-27 移除。在本方案下 `/api/chat` 才是待废弃的兼容层，IM 侧为终局保留。
 *    请勿据旧注释删除本文件。
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildConversationList, toPublicChatItems } from "@/lib/im/list";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const items = await buildConversationList(session.user.id);

    // 同时返回 `conversations`（本接口的规范字段）与 `chats`（前端既有消费字段的别名）。
    // 别名是为了让阶段 4 的前端切换可以"一个字段一个字段地"逐步验证，而非一次性跳变。
    const payload = toPublicChatItems(items);
    return NextResponse.json({
      conversations: payload,
      chats: payload,
      count: payload.length,
    });
  } catch (error) {
    console.error("[IM] Get conversations error:", error);
    return NextResponse.json(
      { error: "Failed to get conversations" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { participantId } = await req.json();
    if (!participantId) {
      return NextResponse.json(
        { error: "Participant ID required" },
        { status: 400 }
      );
    }

    const userId = session.user.id;

    // Check if conversation already exists
    const existingConv = await prisma.conversation.findFirst({
      where: {
        OR: [
          { userAId: userId, userBId: participantId },
          { userAId: participantId, userBId: userId },
        ],
      },
    });

    if (existingConv) {
      return NextResponse.json({ conversation: existingConv, conversationId: existingConv.id });
    }

    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        userAId: userId,
        userBId: participantId,
        initiatorId: userId,
        controllingUserId: userId, // Default to initiator
      },
    });

    return NextResponse.json({ conversation, conversationId: conversation.id });
  } catch (error) {
    console.error("[IM] Create conversation error:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
