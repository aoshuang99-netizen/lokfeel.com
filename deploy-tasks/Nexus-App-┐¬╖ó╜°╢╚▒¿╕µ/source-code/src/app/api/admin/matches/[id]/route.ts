export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, notFound, badRequest } from "@/lib/api-response";
import { auditMatchAction } from "@/lib/admin-audit";

export const PATCH = withPermission('match.edit')(async (request: NextRequest, { params, userId: adminId }) => {
  const { id } = await params;
  const body = await request.json();

  const match = await db.match.findUnique({
    where: { id },
  });

  if (!match) {
    return notFound("Match not found");
  }

  const changes = {
    before: { status: match.status, reviewNotes: match.reviewNotes },
    after: { status: body.status, reviewNotes: body.reviewNotes },
  };

  const updatedMatch = await db.match.update({
    where: { id },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.reviewNotes && { reviewNotes: body.reviewNotes }),
      reviewedBy: adminId,
    },
  });

  // Unified audit log
  await auditMatchAction(adminId, "match.update", id, changes, undefined, request);

  return success(updatedMatch);
});

export const DELETE = withPermission('match.cancel', { dangerous: true })(async (request: NextRequest, { params, userId: adminId }) => {
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

  const changes = {
    before: { status: match.status },
    after: { status: "CANCELLED", reason },
  };

  // Update match status
  await db.match.update({
    where: { id },
    data: {
      status: "CANCELLED",
      reviewNotes: reason,
      reviewedBy: adminId,
    },
  });

  // Unified audit log
  await auditMatchAction(adminId, "match.cancel", id, changes, reason, request);

  // Notify users
  await db.notification.createMany({
    data: [
      {
        userId: match.senderId,
        type: "MATCH_REJECTED",
        title: "ƥ����ȡ��",
        body: "����Ա��ȡ����ƥ��",
      },
      {
        userId: match.receiverId,
        type: "MATCH_REJECTED",
        title: "ƥ����ȡ��",
        body: "����Ա��ȡ����ƥ��",
      },
    ],
  });

  return success({ message: "Match cancelled successfully" });
});
