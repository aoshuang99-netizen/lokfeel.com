export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, notFound, serverError, forbidden } from "@/lib/api-response";
import type { PaginatedResponse, ChatRoomWithMembers } from "@/types";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  archived: z.coerce.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);

    const parseResult = querySchema.safeParse({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
      archived: searchParams.get("archived"),
    });

    if (!parseResult.success) {
      return badRequest("Invalid query parameters", parseResult.error.issues);
    }

    const { page, limit, archived } = parseResult.data;
    const skip = (page - 1) * limit;

    const chatRooms = await db.chatRoom.findMany({
      where: {
        members: {
          some: { userId: user.id },
        },
        ...(archived !== undefined && { isArchived: archived }),
      },
      include: {
        match: {
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                image: true,
                profile: {
                  select: {
                    displayName: true,
                    avatar: true,
                  },
                },
              },
            },
            receiver: {
              select: {
                id: true,
                name: true,
                image: true,
                profile: {
                  select: {
                    displayName: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    });

    // Calculate unread counts
    const roomsWithUnread = await Promise.all(
      chatRooms.map(async (room: any) => {
        const member = room.members.find((m: any) => m.userId === user.id);
        const lastReadAt = member?.lastReadAt || new Date(0);

        const unreadCount = await db.message.count({
          where: {
            roomId: room.id,
            createdAt: { gt: lastReadAt },
            senderId: { not: user.id },
            isRead: false,
          },
        });

        return {
          ...room,
          unreadCount,
          otherMember: room.members.find((m: any) => m.userId !== user.id)?.user,
        };
      })
    );

    const total = await db.chatRoom.count({
      where: {
        members: {
          some: { userId: user.id },
        },
        ...(archived !== undefined && { isArchived: archived }),
      },
    });

    const response: PaginatedResponse<ChatRoomWithMembers[]> = {
      success: true,
      data: roomsWithUnread as unknown as ChatRoomWithMembers[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + chatRooms.length < total,
      },
    };

    return success(response);
  } catch (error) {
    console.error("Error fetching chat rooms:", error);
    return serverError("Failed to fetch chat rooms");
  }
}

const createChatRoomSchema = z.object({
  matchId: z.string().min(1, "Match ID is required"),
});

export async function POST(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const body = await request.json();

    const parseResult = createChatRoomSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { matchId } = parseResult.data;

    // Get the match
    const match = await db.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      return notFound("Match not found");
    }

    // Verify user is part of this match
    if (match.senderId !== user.id && match.receiverId !== user.id) {
      return forbidden("You are not part of this match");
    }

    // Check if match is accepted
    if (match.status !== "ACCEPTED") {
      return badRequest("Match must be accepted before creating a chat room");
    }

    // Check if chat room already exists
    const existingRoom = await db.chatRoom.findUnique({
      where: { matchId },
    });

    if (existingRoom) {
      return success(existingRoom);
    }

    // Create chat room
    const chatRoom = await db.chatRoom.create({
      data: {
        matchId,
        members: {
          create: [
            { userId: match.senderId },
            { userId: match.receiverId },
          ],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
    });

    return success(chatRoom, 201);
  } catch (error) {
    console.error("Error creating chat room:", error);
    return serverError("Failed to create chat room");
  }
}
