import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/chats
 * Get user's chat list
 * 
 * Fix: Replaced prisma.message.groupBy() with individual count queries
 * because Turso/libSQL has limited groupBy support which caused 500 errors.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get all chat rooms for the user
    const chatRooms = await prisma.chatRoom.findMany({
      where: {
        members: {
          some: {
            userId: userId,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                profile: {
                  select: {
                    age: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            content: true,
            createdAt: true,
            senderId: true,
            messageType: true,
          },
        },
        match: {
          select: {
            sender: {
              select: {
                id: true,
                name: true,
              },
            },
            receiver: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Get unread counts — batch query instead of N+1 per room
    // (Turso/libSQL has limited groupBy support)
    const unreadMap = new Map<string, number>();

    if (chatRooms.length > 0) {
      // Run all count queries in parallel instead of sequentially to reduce latency
      const countPromises = chatRooms.map(async (room) => {
        try {
          const count = await prisma.message.count({
            where: {
              roomId: room.id,
              senderId: { not: userId },
              isRead: false,
            },
          });
          if (count > 0) {
            return { roomId: room.id, count };
          }
        } catch {
          // If count fails for a room, just skip it (unread = 0)
        }
        return null;
      });

      const results = await Promise.all(countPromises);
      for (const r of results) {
        if (r) unreadMap.set(r.roomId, r.count);
      }
    }

    // Format chat list
    const formattedChats = chatRooms.map((room) => {
      // Find the other user
      const otherMember = room.members.find(m => m.userId !== userId);
      const otherUser = otherMember?.user;
      const lastMessage = room.messages[0];
      const isVaultExpired = room.vaultExpiry ? new Date(room.vaultExpiry) < new Date() : false;

      return {
        id: room.id,
        otherUser: {
          id: otherUser?.id || "unknown",
          name: otherUser?.name || "Someone",
          age: otherUser?.profile?.age || 0,
          avatar: otherUser?.profile?.avatar || null,
        },
        lastMessage: lastMessage
          ? {
              content: lastMessage.messageType === "SYSTEM" 
                ? lastMessage.content 
                : lastMessage.content,
              timestamp: lastMessage.createdAt.toISOString(),
              isFromMe: lastMessage.senderId === userId,
            }
          : null,
        unreadCount: unreadMap.get(room.id) || 0,
        vaultExpiry: room.vaultExpiry?.toISOString() || null,
        isVaultExpired,
        createdAt: room.createdAt.toISOString(),
        updatedAt: room.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({
      chats: formattedChats,
    });

  } catch (error) {
    console.error("Chats API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch chats" },
      { status: 500 }
    );
  }
}
