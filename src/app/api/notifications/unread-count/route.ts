export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, serverError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();

    const unreadCount = await db.notification.count({
      where: {
        userId: user.id,
        isRead: false,
      },
    });

    return success({ unreadCount });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    return serverError("Failed to fetch unread count");
  }
}
