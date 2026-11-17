import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  shouldRedactIncomingMedia,
  MEDIA_REDACTED_PLACEHOLDER,
} from "@/lib/im/consent-guard";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { conversationId } = await params;

    // Verify user is part of conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const cursor = searchParams.get("cursor");
    const afterSeq = searchParams.get("afterSeq"); // P2-3: Seq-based polling (replaces 'after' param)
    const limit = parseInt(searchParams.get("limit") || "50");

    // Build where clause
    // V25.2：消除存量 any —— 显式声明实际用到的过滤字段形状。
    const where: {
      conversationId: string;
      isDeleted: boolean;
      seq?: { gt: number };
    } = {
      conversationId,
      isDeleted: false,
    };

    // If "afterSeq" is provided, only get messages with seq > afterSeq
    // This replaces the old "after" param which used createdAt comparison (could miss same-ms messages)
    if (afterSeq) {
      const parsedSeq = parseInt(afterSeq);
      if (!isNaN(parsedSeq)) {
        where.seq = { gt: parsedSeq };
      }
    }

    const messages = await prisma.iMMessage.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { seq: "desc" }, // P1-1: Fixed — was createdAt, now seq for strict ordering
      include: {
        sender: {
          include: {
            profile: {
              select: {
                displayName: true,
                avatar: true,
              },
            },
          },
        },
        receipts: {
          where: { userId },
          select: { readAt: true },
        },
      },
    });

    // ── V25.2 P0-SEC-03：读取侧授权复核 ──
    // 写侧门禁只防"未授权发送"，不能保证"撤销后历史读取"仍受控。
    // 对方发的媒体消息在每次读取时按当前 ConsentGrant 复核；撤销/过期
    // ⇒ 用占位符替换 payload（元数据/seq 保留，媒体原文不再返回）。
    // 注意：已送达并留在接收设备本地的副本技术上无法远程收回，此处只保证
    // 未来经本 API 的受控读取遵循新策略。
    const formattedMessages = await Promise.all(messages.map(async (msg) => {
      const redact = await shouldRedactIncomingMedia(
        { senderId: msg.senderId, mediaLevel: msg.mediaLevel },
        userId,
        conversationId,
      );
      return {
        id: msg.id,
        content: redact ? MEDIA_REDACTED_PLACEHOLDER : msg.payload,
        type: msg.msgType,
        createdAt: msg.createdAt,
        sender: {
          id: msg.sender.id,
          name: msg.sender.profile?.displayName || msg.sender.name || "Unknown",
          avatar: msg.sender.profile?.avatar,
        },
        isFromMe: msg.senderId === userId,
        isRead: msg.receipts.length > 0 && msg.receipts[0].readAt !== null,
        seq: msg.seq,
        // 读取侧脱敏标记，供前端避免把占位符当图片 URL 渲染
        mediaRedacted: redact,
      };
    }));

    return NextResponse.json({
      messages: formattedMessages.reverse(),
      nextCursor: messages.length === limit ? messages[messages.length - 1].id : undefined,
    });
  } catch (error) {
    console.error("[IM] Get messages error:", error);
    return NextResponse.json(
      { error: "Failed to get messages" },
      { status: 500 }
    );
  }
}
