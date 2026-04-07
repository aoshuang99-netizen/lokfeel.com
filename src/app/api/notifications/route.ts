export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";
import type { PaginatedResponse, NotificationWithData } from "@/types";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);

    const parseResult = querySchema.safeParse({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
      unreadOnly: searchParams.get("unreadOnly"),
    });

    if (!parseResult.success) {
      return badRequest("Invalid query parameters", parseResult.error.issues);
    }

    const { page, limit, unreadOnly } = parseResult.data;
    const skip = (page - 1) * limit;

    const whereClause: Record<string, unknown> = {
      userId: user.id,
    };

    if (unreadOnly) {
      whereClause.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.notification.count({ where: whereClause }),
      db.notification.count({
        where: { userId: user.id, isRead: false },
      }),
    ]);

    const response: PaginatedResponse<NotificationWithData[]> = {
      success: true,
      data: notifications as unknown as NotificationWithData[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + notifications.length < total,
      },
    };

    return success({
      ...response,
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return serverError("Failed to fetch notifications");
  }
}

const markReadSchema = z.object({
  notificationIds: z.array(z.string()).min(1).optional(),
  markAllRead: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const body = await request.json();

    const parseResult = markReadSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { notificationIds, markAllRead } = parseResult.data;

    if (markAllRead) {
      // Mark all unread notifications as read
      await db.notification.updateMany({
        where: {
          userId: user.id,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      return success({ message: "All notifications marked as read" });
    }

    if (notificationIds && notificationIds.length > 0) {
      // Mark specific notifications as read
      await db.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId: user.id,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      return success({ message: "Notifications marked as read" });
    }

    return badRequest("Either notificationIds or markAllRead is required");
  } catch (error) {
    console.error("Error marking notifications as read:", error);
    return serverError("Failed to mark notifications as read");
  }
}
