export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, notFound, serverError, forbidden } from "@/lib/api-response";
import type { PaginatedResponse } from "@/types";

interface RouteParams {
  params: Promise<{ roomId: string }>;
}

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  before: z.string().optional(), // Message ID for loading older messages
});

const sendMessageSchema = z.object({
  content: z.string().min(1, "Message content is required").max(2000),
  messageType: z.enum(["TEXT", "IMAGE", "SYSTEM", "VOICE"]).default("TEXT"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user } = await requireAuth();
    const { roomId } = await params;
    const { searchParams } = new URL(request.url);

    // Verify user is a member of this room
    const membership = await db.chatRoomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: user.id,
        },
      },
    });

    if (!membership) {
      return forbidden("You are not a member of this chat room");
    }

    const parseResult = querySchema.safeParse({
      cursor: searchParams.get("cursor"),
      limit: searchParams.get("limit"),
      before: searchParams.get("before"),
    });

    if (!parseResult.success) {
      return badRequest("Invalid query parameters", parseResult.error.issues);
    }

    const { limit, before } = parseResult.data;

    // Build query
    const whereClause: Record<string, unknown> = { roomId };

    // If 'before' is specified, get messages before that message
    if (before) {
      const beforeMessage = await db.message.findUnique({
        where: { id: before },
      });
      if (beforeMessage) {
        whereClause.createdAt = { lt: beforeMessage.createdAt };
      }
    }

    const messages = await db.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Reverse to get chronological order
    const chronologicalMessages = messages.reverse();

    // Get the next cursor (last message ID)
    const nextCursor = messages.length === limit ? messages[0]?.id : undefined;

    // Mark messages as read
    await db.message.updateMany({
      where: {
        roomId,
        senderId: { not: user.id },
        isRead: false,
        createdAt: {
          // Only mark as read if they were sent before the cursor position
          ...(before && {
            gt: messages[messages.length - 1]?.createdAt || new Date(),
          }),
        },
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // Update user's last read timestamp
    await db.chatRoomMember.update({
      where: {
        roomId_userId: {
          roomId,
          userId: user.id,
        },
      },
      data: {
        lastReadAt: new Date(),
      },
    });

    return success({
      data: chronologicalMessages,
      pagination: {
        nextCursor,
        hasMore: messages.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return serverError("Failed to fetch messages");
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user } = await requireAuth();
    const { roomId } = await params;
    const body = await request.json();

    const parseResult = sendMessageSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { content, messageType, metadata } = parseResult.data;

    // Verify user is a member of this room
    const membership = await db.chatRoomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: user.id,
        },
      },
    });

    if (!membership) {
      return forbidden("You are not a member of this chat room");
    }

    // Check if room is archived
    const room = await db.chatRoom.findUnique({
      where: { id: roomId },
    });

    if (room?.isArchived) {
      return badRequest("Cannot send messages to archived chat room");
    }

    // Check if user is muted
    if (membership.isMuted) {
      return forbidden("You are muted in this chat room");
    }

    // Create message
    const message = await db.message.create({
      data: {
        roomId,
        senderId: user.id,
        content,
        messageType: messageType as "TEXT" | "IMAGE" | "SYSTEM" | "VOICE",
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    // Update chat room's last message timestamp
    await db.chatRoom.update({
      where: { id: roomId },
      data: {
        lastMessageAt: new Date(),
      },
    });

    // Create notification for other members
    const otherMembers = await db.chatRoomMember.findMany({
      where: {
        roomId,
        userId: { not: user.id },
        isMuted: false,
      },
    });

    if (otherMembers.length > 0) {
      await db.notification.createMany({
        data: otherMembers.map((member: any) => ({
          userId: member.userId,
          type: "NEW_MESSAGE",
          title: "新消息",
          body: content.substring(0, 100),
          data: JSON.stringify({ roomId, messageId: message.id }),
          actionUrl: `/chat/${roomId}`,
        })),
      });
    }

    return success(message, 201);
  } catch (error) {
    console.error("Error sending message:", error);
    return serverError("Failed to send message");
  }
}
