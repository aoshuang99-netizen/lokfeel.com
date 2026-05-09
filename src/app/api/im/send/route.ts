import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleBotReply } from "@/lib/im/bot-reply";

// Pusher is optional - gracefully degrade if not configured
let pusherServer: any = null;
try {
  const mod = require("@/lib/pusher");
  pusherServer = mod.pusherServer;
} catch {
  console.warn("[IM Send] Pusher not available, messages will be stored in DB only");
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { conversationId, content, type = "TEXT" } = await req.json();

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

    // Atomic seq generation using interactive transaction (fixes TOCTOU race condition)
    const message = await prisma.$transaction(async (tx) => {
      const lastMessage = await tx.iMMessage.findFirst({
        where: { conversationId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      const nextSeq = (lastMessage?.seq || 0) + 1;

      return tx.iMMessage.create({
        data: {
          conversationId,
          senderId: userId,
          receiverId,
          seq: nextSeq,
          msgType: type,
          payload: content,
          encryptionMode: "SERVER",
          consentState: "CONSENT_NONE",
          mediaLevel: "L0_TEXT",
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
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        unreadCountA: conversation.userAId === receiverId ? { increment: 1 } : undefined,
        unreadCountB: conversation.userBId === receiverId ? { increment: 1 } : undefined,
      },
    });

    // Send real-time notification via Pusher (IM v2 format)
    // Pusher is optional - if not configured, polling will handle message delivery
    if (pusherServer) {
      try {
        const messagePayload = {
          msgId: message.id,
          clientMsgId: message.id,
          senderId: userId,
          receiverId,
          convId: conversationId,
          seq: message.seq,
          msgType: message.msgType,
          payload: message.payload,
          encryptionMode: "SERVER",
          complianceTags: [],
          consentState: "CONSENT_NONE",
          mediaLevel: "L0_TEXT",
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
