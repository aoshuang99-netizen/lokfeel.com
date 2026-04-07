export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdminAuth as requireAdmin } from "@/lib/auth/auth"
import { success, notFound, serverError, badRequest } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user: adminUser } = await requireAdmin();
    const { id } = await params;
    const body = await request.json();

    const match = await db.match.findUnique({
      where: { id },
    });

    if (!match) {
      return notFound("Match not found");
    }

    const updateData: Record<string, unknown> = {
      reviewedBy: adminUser?.id,
    };

    if (body.status) {
      updateData.status = body.status;
    }

    if (body.reviewNotes) {
      updateData.reviewNotes = body.reviewNotes;
    }

    const updatedMatch = await db.match.update({
      where: { id },
      data: updateData,
    });

    // Log admin action
    await db.adminLog.create({
      data: {
        authorId: adminUser?.id,
        action: "match.update",
        targetId: id,
        targetType: "Match",
        details: JSON.stringify({ status: body.status, reviewNotes: body.reviewNotes }),
      },
    });

    return success(updatedMatch);
  } catch (error) {
    console.error("Error updating match:", error);
    return serverError("Failed to update match");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user: adminUser } = await requireAdmin();
    const { id } = await params;

    // Get cancellation reason from body
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || "Cancelled by admin";

    const match = await db.match.findUnique({
      where: { id },
    });

    if (!match) {
      return notFound("Match not found");
    }

    // Update match status
    await db.match.update({
      where: { id },
      data: {
        status: "CANCELLED",
        reviewNotes: reason,
        reviewedBy: adminUser?.id,
      },
    });

    // Log admin action
    await db.adminLog.create({
      data: {
        authorId: adminUser?.id,
        action: "match.cancel",
        targetId: id,
        targetType: "Match",
        details: JSON.stringify({ reason }),
      },
    });

    // Notify users
    await db.notification.createMany({
      data: [
        {
          userId: match.senderId,
          type: "MATCH_REJECTED",
          title: "匹配已取消",
          body: "管理员已取消此匹配",
        },
        {
          userId: match.receiverId,
          type: "MATCH_REJECTED",
          title: "匹配已取消",
          body: "管理员已取消此匹配",
        },
      ],
    });

    return success({ message: "Match cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling match:", error);
    return serverError("Failed to cancel match");
  }
}
