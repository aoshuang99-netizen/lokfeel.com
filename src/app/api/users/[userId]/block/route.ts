import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/auth";
import { handleApiError } from "@/lib/api-handler";
import { db } from "@/lib/db";

// POST /api/users/[userId]/block — Block a user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { userId: targetUserId } = await params;

    if (user.id === targetUserId) {
      return NextResponse.json({ error: "Cannot block yourself" }, { status: 400 });
    }

    // Check if target user exists
    const targetUser = await db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Use upsert to handle duplicate block gracefully (unique constraint: unique_block_pair)
    try {
      await db.block.create({
        data: { blockerId: user.id, blockedId: targetUserId },
      });
    } catch (e: any) {
      // P2002 = Unique constraint violation — already blocked
      if (e.code === "P2002") {
        return NextResponse.json({ success: true, message: "User already blocked" });
      }
      throw e;
    }

    return NextResponse.json({ success: true, message: "User blocked" });
  });
}

// DELETE /api/users/[userId]/block — Unblock a user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { userId: targetUserId } = await params;

    const result = await db.block.deleteMany({
      where: { blockerId: user.id, blockedId: targetUserId },
    });

    if (result.count === 0) {
      return NextResponse.json({ message: "User was not blocked" });
    }

    return NextResponse.json({ success: true, message: "User unblocked" });
  });
}
