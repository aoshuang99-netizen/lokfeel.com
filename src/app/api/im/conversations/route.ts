import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// DEPRECATED: Use /api/chat instead (merged ChatRoom + IM chat list)

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        state: { not: "ARCHIVED" },
      },
      include: {
        userA: {
          select: {
            id: true,
            name: true,
            image: true,
            isBot: true,
            profile: {
              select: {
                displayName: true,
                avatar: true,
              },
            },
          },
        },
        userB: {
          select: {
            id: true,
            name: true,
            image: true,
            isBot: true,
            profile: {
              select: {
                displayName: true,
                avatar: true,
              },
            },
          },
        },
        imMessages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            payload: true,
            msgType: true,
            createdAt: true,
            senderId: true,
          },
        },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    const formattedConversations = conversations.map((conv) => {
      const otherUser = conv.userAId === userId ? conv.userB : conv.userA;
      const unreadCount = conv.userAId === userId ? conv.unreadCountA : conv.unreadCountB;
      const lastMessage = conv.imMessages[0];

      return {
        id: conv.id,
        otherUser: {
          id: otherUser.id,
          name: otherUser.profile?.displayName || otherUser.name || "Unknown",
          avatar: otherUser.profile?.avatar || otherUser.image || null,
          isBot: otherUser.isBot || false,
        },
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              content: lastMessage.payload?.slice?.(0, 100) || '',
              type: lastMessage.msgType,
              createdAt: lastMessage.createdAt,
              isFromMe: lastMessage.senderId === userId,
            }
          : null,
        unreadCount,
        updatedAt: conv.updatedAt,
      };
    });

    return NextResponse.json({ conversations: formattedConversations });
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
      return NextResponse.json({ conversation: existingConv });
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

    return NextResponse.json({ conversation });
  } catch (error) {
    console.error("[IM] Create conversation error:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
