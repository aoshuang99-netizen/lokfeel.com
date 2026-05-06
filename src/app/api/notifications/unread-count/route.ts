export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { handleApiError } from "@/lib/api-handler";
import { success } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();

    const unreadCount = await db.notification.count({
      where: {
        userId: user.id,
        isRead: false,
      },
    });

    return success({ unreadCount });
  });
}
