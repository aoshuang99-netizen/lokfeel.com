import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/discover/reset
 * 
 * Reset all match reactions for the current user (for testing purposes)
 * This allows users to see previously skipped/liked users again
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Delete all match reactions for this user
    const result = await prisma.matchReaction.deleteMany({
      where: {
        userId: userId,
      },
    });

    // Also delete matches where user is sender and status is PENDING
    // (these are "likes" that haven't been reciprocated)
    await prisma.match.deleteMany({
      where: {
        senderId: userId,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Discover feed reset successfully",
      deletedReactions: result.count,
    });

  } catch (error) {
    console.error("Reset discover error:", error);
    return NextResponse.json(
      { error: "Failed to reset discover feed" },
      { status: 500 }
    );
  }
}
