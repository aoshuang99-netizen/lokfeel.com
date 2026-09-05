import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeRequestBody } from "@/lib/safe-json";
import { handleBotReply } from "@/lib/im/bot-reply";
import { isFemaleGender } from "@/lib/gender-utils";
import { IMMessageType } from "@/generated";

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
    // BUG-630: typed msgType (enum) with a safe default so Prisma accepts it
    const msgType: IMMessageType = (body.msgType as IMMessageType) || IMMessageType.TEXT;

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

    // ── MESSAGE GATE (mirror legacy /api/chat/[id]/messages) ──
    // Premium / Lady Free / female: unlimited. Free male: 2 messages / conversation.
    // Non-premium must verify card after 3 total messages.
    const [userWithSub, userProfile, activeSubs] = await Promise.all([
      prisma.user.findFirst({ where: { id: userId }, select: { cardVerified: true } }),
      prisma.profile.findUnique({ where: { userId }, select: { gender: true } }),
      prisma.subscription.findMany({ where: { userId, status: "ACTIVE" }, take: 1 }),
    ]);
    const hasActiveSub = activeSubs.length > 0;
    const isFemale = isFemaleGender(userProfile?.gender);
    const cardVerified = userWithSub?.cardVerified ?? false;

    if (!hasActiveSub && !isFemale) {
      const perConversation = await prisma.iMMessage.count({ where: { conversationId, senderId: userId } });
      if (perConversation >= 2) {
        return NextResponse.json(
          {
            message: "Free users can send up to 2 messages per conversation. Upgrade to Premium for unlimited messaging.",
            code: "UPGRADE_REQUIRED",
            upgradeUrl: "/dashboard/subscription",
          },
          { status: 403 }
        );
      }
    }
    const isPremiumPlan = hasActiveSub && ["PREMIUM_MONTHLY", "PREMIUM_YEARLY", "LIFETIME"].includes(activeSubs[0]?.plan);
    if (!isPremiumPlan) {
      const totalMessages = await prisma.iMMessage.count({ where: { senderId: userId } });
      if (!cardVerified && totalMessages >= 3) {
        return NextResponse.json(
          {
            message: "Please verify your card to continue messaging. Identity verification only — no charges.",
            code: "CARD_VERIFICATION_REQUIRED",
          },
          { status: 403 }
        );
      }
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
