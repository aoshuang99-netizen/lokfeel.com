export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdminAuth as requireAdmin } from "@/lib/auth/auth"
import { success, notFound, serverError, badRequest } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
      include: {
        profile: true,
        sentMatches: {
          take: 10,
          orderBy: { createdAt: "desc" },
          include: {
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
        receivedMatches: {
          take: 10,
          orderBy: { createdAt: "desc" },
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
          },
        },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        notifications: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!user) {
      return notFound("User not found");
    }

    return success(user);
  } catch (error) {
    console.error("Error fetching user details:", error);
    return serverError("Failed to fetch user details");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user: adminUser } = await requireAdmin();
    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
    });

    if (!user) {
      return notFound("User not found");
    }

    // Prevent self-deletion
    if (id === adminUser?.id) {
      return badRequest("Cannot deactivate your own account");
    }

    // Get deactivation reason from query params
    const { searchParams } = new URL(request.url);
    const reason = searchParams.get("reason");

    // Deactivate user profile
    await db.profile.update({
      where: { userId: id },
      data: {
        profileStatus: "DEACTIVATED",
        adminNotes: reason || "Account deactivated by admin",
      },
    });

    // Log admin action
    await db.adminLog.create({
      data: {
        authorId: adminUser?.id,
        action: "user.deactivate",
        targetId: id,
        targetType: "User",
        details: JSON.stringify({ reason }),
      },
    });

    // Create notification for user
    await db.notification.create({
      data: {
        userId: id,
        type: "SYSTEM_ANNOUNCEMENT",
        title: "账号已停用",
        body: "您的账号已被管理员停用。如有疑问，请联系客服。",
      },
    });

    return success({ message: "User deactivated successfully" });
  } catch (error) {
    console.error("Error deactivating user:", error);
    return serverError("Failed to deactivate user");
  }
}
