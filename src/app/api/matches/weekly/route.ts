export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, requireAdminAuth } from "@/lib/auth/auth";
import { success, badRequest, serverError, forbidden } from "@/lib/api-response";
import { findWeeklyMatches } from "@/lib/matching/engine";

export async function GET(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();

    // Get start and end of current week
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const matches = await db.match.findMany({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        createdAt: {
          gte: startOfWeek,
          lt: endOfWeek,
        },
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
            profile: {
              select: {
                id: true,
                displayName: true,
                age: true,
                gender: true,
                avatar: true,
                city: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            profile: {
              select: {
                id: true,
                displayName: true,
                age: true,
                gender: true,
                avatar: true,
                city: true,
              },
            },
          },
        },
        chatRoom: {
          select: { id: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return success({
      weekStart: startOfWeek.toISOString(),
      weekEnd: endOfWeek.toISOString(),
      matches,
      count: matches.length,
    });
  } catch (error) {
    console.error("Error fetching weekly matches:", error);
    return serverError("Failed to fetch weekly matches");
  }
}

const triggerSchema = z.object({
  limitPerUser: z.coerce.number().min(1).max(10).default(5),
});

export async function POST(request: NextRequest) {
  try {
    // Allow both admin and authenticated users (for cron jobs)
    

    const { user } = await requireAuth();

    // Only admins can trigger match generation
    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return forbidden("Admin access required");
    }

    return triggerMatchGeneration(request);
  } catch (error) {
    console.error("Error in weekly match trigger:", error);
    return serverError("Failed to trigger weekly matches");
  }
}

async function triggerMatchGeneration(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limitPerUser = body.limitPerUser || 5;

    const results = await findWeeklyMatches(limitPerUser);

    return success({
      message: "Weekly match generation completed",
      results,
      totalMatches: Array.isArray(results) ? results.length : 0,
    }, 201);
  } catch (error) {
    console.error("Error generating weekly matches:", error);
    return serverError("Failed to generate weekly matches");
  }
}
