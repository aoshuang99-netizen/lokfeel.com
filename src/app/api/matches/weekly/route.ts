import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireAdminAuth } from "@/lib/auth";
import { generateMatchesForUser, generateAllWeeklyMatches } from "@/lib/matching";

export const dynamic = "force-dynamic";

// GET /api/matches/weekly — Get current week's matches
export async function GET() {
  try {
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
  } catch (error: any) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching weekly matches:", error);
    return NextResponse.json({ message: "Failed to fetch weekly matches" }, { status: 500 });
  }
}

// POST /api/matches/weekly — Trigger weekly match generation (admin only)
export async function POST(request: NextRequest) {
  try {
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
  } catch (error: any) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (error.message === "Forbidden: Admin access required") {
      return NextResponse.json({ message: "Admin access required" }, { status: 403 });
    }
    console.error("Error generating weekly matches:", error);
    return NextResponse.json({ message: "Failed to generate weekly matches" }, { status: 500 });
  }
}
