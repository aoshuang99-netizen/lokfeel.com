export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, badRequest, notFound, serverError } from "@/lib/api-response";
import type { PaginatedResponse, MatchWithProfiles } from "@/types";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(10),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]).optional(),
  matchType: z.enum(["WEEKLY", "BOOSTED", "MANUAL", "AI_SUGGESTED"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);

    const parseResult = querySchema.safeParse({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
      status: searchParams.get("status"),
      matchType: searchParams.get("matchType"),
    });

    if (!parseResult.success) {
      return badRequest("Invalid query parameters", parseResult.error.issues);
    }

    const { page, limit, status, matchType } = parseResult.data;
    const skip = (page - 1) * limit;

    const whereClause: Record<string, unknown> = {
      OR: [{ senderId: user.id }, { receiverId: user.id }],
    };

    if (status) {
      whereClause.status = status;
    }

    if (matchType) {
      whereClause.matchType = matchType;
    }

    const [matches, total] = await Promise.all([
      db.match.findMany({
        where: whereClause,
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
        skip,
        take: limit,
      }),
      db.match.count({ where: whereClause }),
    ]);

    const response: PaginatedResponse<MatchWithProfiles[]> = {
      success: true,
      data: matches as unknown as MatchWithProfiles[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + matches.length < total,
      },
    };

    return success(response);
  } catch (error) {
    console.error("Error fetching matches:", error);
    return serverError("Failed to fetch matches");
  }
}

const createMatchSchema = z.object({
  receiverId: z.string().min(1, "Receiver ID is required"),
  matchType: z.enum(["WEEKLY", "BOOSTED", "MANUAL", "AI_SUGGESTED"]).default("MANUAL"),
});

export async function POST(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const body = await request.json();

    const parseResult = createMatchSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { receiverId, matchType } = parseResult.data;

    // Check if both users have approved profiles
    const [senderProfile, receiverProfile] = await Promise.all([
      db.profile.findUnique({
        where: { userId: user.id },
      }),
      db.profile.findUnique({
        where: { userId: receiverId },
      }),
    ]);

    if (!senderProfile?.isApproved || !receiverProfile?.isApproved) {
      return badRequest("Both users must have approved profiles");
    }

    if (senderProfile.profileStatus !== "APPROVED" || receiverProfile.profileStatus !== "APPROVED") {
      return badRequest("Both profiles must be approved for matching");
    }

    // Check if match already exists
    const existingMatch = await db.match.findFirst({
      where: {
        OR: [
          { senderId: user.id, receiverId },
          { senderId: receiverId, receiverId: user.id },
        ],
      },
    });

    if (existingMatch) {
      return badRequest("A match already exists between these users");
    }

    // Generate compatibility
    const { calculateCompatibility } = await import("@/lib/matching/engine");
    const compatibility = await calculateCompatibility(senderProfile.id, receiverProfile.id);

    // Create match
    const match = await db.match.create({
      data: {
        senderId: user.id,
        receiverId,
        matchScore: compatibility.scores.overall,
        matchReason: compatibility.explanation.summary,
        conflictWarnings: JSON.stringify(compatibility.warnings),
        attachmentCompat: compatibility.scores.attachment,
        communicationCompat: compatibility.scores.communication,
        conflictCompat: compatibility.scores.conflict,
        valuesCompat: compatibility.scores.values,
        lifestyleCompat: compatibility.scores.lifestyle,
        matchType: matchType as "WEEKLY" | "BOOSTED" | "MANUAL" | "AI_SUGGESTED",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
      },
    });

    // Create notification for receiver
    await db.notification.create({
      data: {
        userId: receiverId,
        type: "NEW_MATCH",
        title: "新匹配来了！",
        body: "有人向你发送了一个新匹配，快来看看吧！",
        data: JSON.stringify({ matchId: match.id }),
      },
    });

    return success(match, 201);
  } catch (error) {
    console.error("Error creating match:", error);
    return serverError("Failed to create match");
  }
}
