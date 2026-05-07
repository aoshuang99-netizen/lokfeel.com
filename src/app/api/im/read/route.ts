import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { conversationId, messageIds } = await req.json();

    if (!conversationId || !Array.isArray(messageIds)) {
      return NextResponse.json(
        { error: "Conversation ID and message IDs required" },
        { status: 400 }
      );
    }

    // Prevent unbounded transactions — cap at 100 messages per request
    if (messageIds.length === 0 || messageIds.length > 100) {
      return NextResponse.json(
        { error: "messageIds must be an array of 1-100 IDs" },
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

    const now = new Date();

    // Create or update receipts
    await prisma.$transaction(
      messageIds.map((messageId) =>
        prisma.messageReceipt.upsert({
          where: {
            messageId_userId: {
              messageId,
              userId,
            },
          },
          update: {
            readAt: now,
          },
          create: {
            messageId,
            conversationId,
            userId,
            deliveredAt: now,
            readAt: now,
          },
        })
      )
    );

    // Reset unread count for this user
    await prisma.conversation.update({
      where: { id: conversationId },
      data: conversation.userAId === userId
        ? { unreadCountA: 0 }
        : { unreadCountB: 0 },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[IM] Mark read error:", error);
    return NextResponse.json(
      { error: "Failed to mark messages as read" },
      { status: 500 }
    );
  }
}
