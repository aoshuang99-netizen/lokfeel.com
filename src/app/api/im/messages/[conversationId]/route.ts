import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    const after = searchParams.get("after"); // For polling: get messages after this ID
    const limit = parseInt(searchParams.get("limit") || "50");

    // Build where clause
    const where: any = {
      conversationId,
      isDeleted: false,
    };

    // If "after" is provided, only get messages newer than that ID
    if (after) {
      const afterMsg = await prisma.iMMessage.findUnique({
        where: { id: after },
        select: { createdAt: true },
      });
      if (afterMsg) {
        where.createdAt = { gt: afterMsg.createdAt };
      }
    }

    const messages = await prisma.iMMessage.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: "desc" },
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

    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      content: msg.payload,
      type: msg.msgType,
      createdAt: msg.createdAt,
      sender: {
        id: msg.sender.id,
        name: msg.sender.profile?.displayName || msg.sender.name || "Unknown",
        avatar: msg.sender.profile?.avatar,
      },
      isFromMe: msg.senderId === userId,
      isRead: msg.receipts.length > 0 && msg.receipts[0].readAt !== null,
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
