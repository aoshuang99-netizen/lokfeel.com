export const dynamic = 'force-dynamic';
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, notFound, badRequest } from "@/lib/api-response";
import { auditUserAction } from "@/lib/admin-audit";

export const GET = withPermission("user.view_detail")(async (request: NextRequest, { params }) => {
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
});

export const DELETE = withPermission("user.delete", { dangerous: true })(async (request: NextRequest, { params, userId: adminId }) => {
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    include: { profile: true },
  });

  if (!user) {
    return notFound("User not found");
  }

  // Prevent self-deletion
  if (id === adminId) {
    return badRequest("Cannot deactivate your own account");
  }

  // Get deactivation reason from query params
  const { searchParams } = new URL(request.url);
  const reason = searchParams.get("reason") || "Account deactivated by admin";

  const changes = {
    before: { profileStatus: user.profile?.profileStatus },
    after: { profileStatus: "DEACTIVATED", adminNotes: reason },
  };

  // Deactivate user profile
  await db.profile.update({
    where: { userId: id },
    data: {
      profileStatus: "DEACTIVATED",
      adminNotes: reason,
    },
  });

  // Unified audit log
  await auditUserAction(adminId, "user.deactivate", id, changes, reason, request);

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
});
