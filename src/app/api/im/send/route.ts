import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeRequestBody } from "@/lib/safe-json";
import { handleBotReply } from "@/lib/im/bot-reply";
import { checkSendPermission } from "@/lib/im/message-guards";
import { IMMessageType } from "@/generated";

/** 客户端被允许声明的消息类型白名单。SYSTEM 等枚举绝不可由客户端指定。 */
const CLIENT_ALLOWED_MSG_TYPES: readonly string[] = ["TEXT", "IMAGE", "VOICE"];

// Pusher is optional - gracefully degrade if not configured
import { getPusherServer } from "@/lib/pusher";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    // BUG-630: safe parse — return 400 instead of 500 on malformed body
    const body = await safeRequestBody<{
      conversationId?: string;
      content?: string;
      msgType?: string;
      clientMsgId?: string;
    }>(req);
    if (!body) {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }
    const { conversationId, content, clientMsgId } = body;
    // BUG-630: typed msgType (enum) with a safe default so Prisma accepts it.
    // P1-6 阶段 4 加固：客户端此前可直接指定任意 IMMessageType（如 SYSTEM），
    // 从而在会话里伪造"匹配成功""系统通知"之类的消息。改为白名单校验，
    // 非白名单值一律降级为 TEXT（而非报错，保持向后兼容）。
    const requestedType = (body.msgType || "").toUpperCase();
    const msgType: IMMessageType = CLIENT_ALLOWED_MSG_TYPES.includes(requestedType)
      ? (requestedType as IMMessageType)
      : IMMessageType.TEXT;

    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "Conversation ID and content required" },
        { status: 400 }
      );
    }

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

    const receiverId = conversation.userAId === userId ? conversation.userBId : conversation.userAId;

    // ── IDEMPOTENCY: persist + dedup clientMsgId ──
    // The column is @unique. On a flaky-network retry the client resends the
    // same clientMsgId; return the original message instead of creating a dup.
    if (clientMsgId) {
      const existing = await prisma.iMMessage.findFirst({
        where: { clientMsgId, conversationId },
        include: {
          sender: {
            include: {
              profile: { select: { displayName: true, avatar: true } },
            },
          },
        },
      });
      if (existing) {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: {
            id: existing.id,
            clientMsgId: existing.clientMsgId,
            content: existing.payload,
            type: existing.msgType,
            createdAt: existing.createdAt,
            sender: {
              id: existing.sender.id,
              name: existing.sender.profile?.displayName || existing.sender.name || "Unknown",
              avatar: existing.sender.profile?.avatar,
            },
            seq: existing.seq,
          },
        });
      }
    }

    // ── MESSAGE GATE ──
    // Premium / Lady Free / female: unlimited. Free male: 2 messages / conversation.
    // Non-premium must verify card after 3 total messages.
    //
    // P1-6 阶段 4：改用 `@/lib/im/message-guards` 的共享守卫，不再本地重算。
    // 原因（这是一个真实的绕过风险，不只是重构）：
    //   本文件原先只统计 `iMMessage`。但在阶段 3 的迁移过渡期内，用户的历史消息
    //   仍可能在 Legacy `Message` 表里（尚未迁移或只迁了一半）。此时 IM 侧计数偏小，
    //   **免费用户可通过本端点多发消息**，绕过 2 条/会话 与 卡片验证 两道限制。
    //   共享守卫对两套表取 max()，在"迁移前 / 双写期 / 阶段 4 之后"三个时期都成立。
    const verdict = await checkSendPermission({
      userId,
      conversationId,
      chatRoomId: conversation.chatRoomId ?? null,
    });
    if (!verdict.ok) {
      return NextResponse.json(verdict.body, { status: verdict.status });
    }

    // Atomic transaction: create message + update conversation (prevents data inconsistency)
    const message = await prisma.$transaction(async (tx) => {
      const lastMessage = await tx.iMMessage.findFirst({
        where: { conversationId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      const nextSeq = (lastMessage?.seq || 0) + 1;

      const msg = await tx.iMMessage.create({
        data: {
          conversationId,
          senderId: userId,
          receiverId,
          clientMsgId: clientMsgId || null,
          seq: nextSeq,
          msgType,
          payload: content,
          encryptionMode: "SERVER",
          consentState: "CONSENT_NONE",
          mediaLevel: msgType === "IMAGE" ? "L1_IMAGE" : msgType === "VOICE" ? "L2_VOICE" : "L0_TEXT",
          ruleResult: "PASS",
        },
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
        },
      });

      // Update conversation INSIDE the transaction (was previously outside — caused P0-2 data inconsistency)
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
          // Increment unread count for the receiver
          ...(conversation.userAId === receiverId && { unreadCountA: { increment: 1 } }),
          ...(conversation.userBId === receiverId && { unreadCountB: { increment: 1 } }),
        },
      });

      return msg;
    });

    // Send real-time notification via Pusher (IM v2 format)
    // Pusher is optional - if not configured, polling will handle message delivery
    const pusherServer = getPusherServer();
    if (pusherServer) {
      try {
        const messagePayload = {
          msgId: message.id,
          // BUG-4/7: echo the client-generated id so the frontend can dedupe
          // optimistic vs. realtime messages (prevents duplicate rendering)
          clientMsgId: clientMsgId || message.id,
          senderId: userId,
          receiverId,
          convId: conversationId,
          seq: message.seq,
          msgType: message.msgType,
          payload: message.payload,
          encryptionMode: "SERVER",
          complianceTags: [],
          consentState: "CONSENT_NONE",
          mediaLevel: message.msgType === "IMAGE" ? "L1_IMAGE" : message.msgType === "VOICE" ? "L2_VOICE" : "L0_TEXT",
          ruleResult: "PASS",
          isEdited: false,
          isDeleted: false,
          status: "DELIVERED",
          timestamp: new Date(message.createdAt).getTime(),
          sender: {
            id: message.sender.id,
            name: message.sender.profile?.displayName || message.sender.name || "Unknown",
            avatar: message.sender.profile?.avatar,
          },
        };

        // Broadcast to conversation channel (IM v2 naming)
        await pusherServer.trigger(
          `private-im-conv-${conversationId}`,
          "im:message",
          { message: messagePayload }
        );

        // Also notify receiver's personal channel (IM v2 naming)
        await pusherServer.trigger(
          `private-im-user-${receiverId}`,
          "im:message",
          { message: messagePayload }
        );
      } catch (pusherError) {
        console.warn("[IM] Pusher push failed (message saved in DB):", pusherError);
      }
    }

    // Trigger bot auto-reply if receiver is a bot
    // IMPORTANT: Must await — bot reply must be written to DB BEFORE we return,
    // otherwise Vercel Serverless will kill the process and the reply never gets saved.
    try {
      await handleBotReply(conversationId, userId, receiverId, content);
    } catch (botErr) {
      console.error("[IM] Bot reply error (message still saved):", botErr);
    }

    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        clientMsgId: clientMsgId || message.id,
        content: message.payload,
        type: message.msgType,
        createdAt: message.createdAt,
        sender: {
          id: message.sender.id,
          name: message.sender.profile?.displayName || message.sender.name || "Unknown",
          avatar: message.sender.profile?.avatar,
        },
        seq: message.seq,
      },
    });
  } catch (error) {
    console.error("[IM] Send message error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
