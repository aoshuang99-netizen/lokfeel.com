import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireAdminAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-handler";
import { generateMatchesForUser, generateAllWeeklyMatches } from "@/lib/matching";

export const dynamic = "force-dynamic";

// GET /api/matches/weekly — Get current week's matches
export async function GET() {
  return handleApiError(async () => {
    const { user } = await requireAuth();

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const matches = await db.match.findMany({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        createdAt: { gte: startOfWeek, lt: endOfWeek },
      },
      include: {
        sender: {
          select: {
            id: true, name: true, image: true,
            profile: { select: { displayName: true, age: true, avatar: true, city: true } },
          },
        },
        receiver: {
          select: {
            id: true, name: true, image: true,
            profile: { select: { displayName: true, age: true, avatar: true, city: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      weekStart: startOfWeek.toISOString(),
      weekEnd: endOfWeek.toISOString(),
      matches,
      count: matches.length,
    });
  });
}

// POST /api/matches/weekly — Trigger weekly match generation (admin only)
export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    await requireAdminAuth();

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "all";
    const limit = parseInt(searchParams.get("limit") || "5");

    if (scope === "all") {
      const results = await generateAllWeeklyMatches();
      return NextResponse.json({
        message: "Weekly match generation completed",
        results,
      }, { status: 201 });
    }

    return NextResponse.json({ message: "Use ?scope=all for admin batch generation" }, { status: 400 });
  });
}
