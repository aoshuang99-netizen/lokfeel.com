export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, paginated, badRequest, serverError } from "@/lib/api-response";
import { createMeta } from "@/lib/api-response";
import { auditMatchAction } from "@/lib/admin-audit";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]).optional(),
  matchType: z.enum(["WEEKLY", "BOOSTED", "MANUAL", "AI_SUGGESTED"]).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const GET = withPermission('match.view')(async (request: NextRequest, { userId }) => {
  const { searchParams } = new URL(request.url);

  const parseResult = querySchema.safeParse({
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize") || searchParams.get("limit"),
    status: searchParams.get("status"),
    matchType: searchParams.get("matchType"),
    minScore: searchParams.get("minScore"),
    maxScore: searchParams.get("maxScore"),
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
  });

  if (!parseResult.success) {
    return badRequest("Invalid query parameters", parseResult.error.issues);
  }

  const { page, pageSize, status, matchType, minScore, maxScore, dateFrom, dateTo } = parseResult.data;
  const skip = (page - 1) * pageSize;

  // Build where clause
  const whereClause: Record<string, unknown> = {};

  if (status) {
    whereClause.status = status;
  }

  if (matchType) {
    whereClause.matchType = matchType;
  }

  if (minScore !== undefined || maxScore !== undefined) {
    whereClause.matchScore = {
      ...(minScore !== undefined && { gte: minScore }),
      ...(maxScore !== undefined && { lte: maxScore }),
    };
  }

  if (dateFrom || dateTo) {
    whereClause.createdAt = {
      ...(dateFrom && { gte: new Date(dateFrom) }),
      ...(dateTo && { lte: new Date(dateTo) }),
    };
  }

  const [matches, total] = await Promise.all([
    db.match.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            profile: {
              select: {
                displayName: true,
                avatar: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            profile: {
              select: {
                displayName: true,
                avatar: true,
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
      take: pageSize,
    }),
    db.match.count({ where: whereClause }),
  ]);

  return paginated(matches, createMeta(page, pageSize, total));
});

const createMatchSchema = z.object({
  senderId: z.string().min(1, "Sender ID is required"),
  receiverId: z.string().min(1, "Receiver ID is required"),
  matchType: z.enum(["WEEKLY", "BOOSTED", "MANUAL", "AI_SUGGESTED"]).default("MANUAL"),
});

export const POST = withPermission('match.manual')(async (request: NextRequest, { userId: adminId }) => {
  const body = await request.json();

  const parseResult = createMatchSchema.safeParse(body);
  if (!parseResult.success) {
    return badRequest("Invalid request body", parseResult.error.issues);
  }

  const { senderId, receiverId, matchType } = parseResult.data;

  // Verify both users exist and have approved profiles
  const [sender, receiver] = await Promise.all([
    db.user.findUnique({
      where: { id: senderId },
      include: { profile: true },
    }),
    db.user.findUnique({
      where: { id: receiverId },
      include: { profile: true },
    }),
  ]);

  if (!sender || !receiver) {
    return badRequest("One or both users not found");
  }

  if (!sender.profile?.isApproved || !receiver.profile?.isApproved) {
    return badRequest("Both users must have approved profiles");
  }

  // Check if match already exists
  const existingMatch = await db.match.findFirst({
    where: {
      OR: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    },
  });

  if (existingMatch) {
    return badRequest("A match already exists between these users");
  }

  // Generate compatibility using the matching engine
  const { calculateMatchScore } = await import("@/lib/matching/engine");
  const senderProfile = sender.profile ? {
    id: sender.id,
    attachmentStyle: sender.profile.attachmentStyle,
    communicationStyle: sender.profile.communicationStyle,
    conflictResolution: sender.profile.conflictResolution,
    loveLanguage: sender.profile.loveLanguage,
    lifePriorities: sender.profile.lifePriorities,
    relationshipGoal: sender.profile.relationshipGoal,
    boundaries: sender.profile.boundaries,
    dealbreakers: sender.profile.dealbreakers,
    emotionalAvailability: sender.profile.emotionalAvailability,
    preferredAgeMin: sender.profile.preferredAgeMin,
    preferredAgeMax: sender.profile.preferredAgeMax,
    preferredGender: sender.profile.preferredGender,
    preferredDistance: sender.profile.preferredDistance,
    age: sender.profile.age,
    gender: sender.profile.gender,
    city: sender.profile.city,
    country: sender.profile.country,
  } as any : undefined;

  const receiverProfile = receiver.profile ? {
    id: receiver.id,
    attachmentStyle: receiver.profile.attachmentStyle,
    communicationStyle: receiver.profile.communicationStyle,
    conflictResolution: receiver.profile.conflictResolution,
    loveLanguage: receiver.profile.loveLanguage,
    lifePriorities: receiver.profile.lifePriorities,
    relationshipGoal: receiver.profile.relationshipGoal,
    boundaries: receiver.profile.boundaries,
    dealbreakers: receiver.profile.dealbreakers,
    emotionalAvailability: receiver.profile.emotionalAvailability,
    preferredAgeMin: receiver.profile.preferredAgeMin,
    preferredAgeMax: receiver.profile.preferredAgeMax,
    preferredGender: receiver.profile.preferredGender,
    preferredDistance: receiver.profile.preferredDistance,
    age: receiver.profile.age,
    gender: receiver.profile.gender,
    city: receiver.profile.city,
    country: receiver.profile.country,
  } as any : undefined;

  if (!senderProfile || !receiverProfile) {
    return badRequest("Both users must have completed profiles");
  }

  const compatibility = calculateMatchScore(senderProfile, receiverProfile);

  // Create match
  const match = await db.match.create({
    data: {
      senderId,
      receiverId,
      matchScore: compatibility.total,
      matchReason: compatibility.reason,
      conflictWarnings: compatibility.conflictWarnings.length > 0 ? JSON.stringify(compatibility.conflictWarnings) : null,
      attachmentCompat: compatibility.attachment,
      communicationCompat: compatibility.communication,
      conflictCompat: compatibility.conflict,
      valuesCompat: compatibility.values,
      lifestyleCompat: compatibility.lifestyle,
      matchType: matchType as "WEEKLY" | "BOOSTED" | "MANUAL" | "AI_SUGGESTED",
      status: "PENDING",
      reviewedBy: adminId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Create notifications
  await db.notification.createMany({
    data: [
      {
        userId: senderId,
        type: "NEW_MATCH",
        title: "新匹配！",
        body: "管理员为你匹配了一个新用户",
        data: JSON.stringify({ matchId: match.id }),
      },
      {
        userId: receiverId,
        type: "NEW_MATCH",
        title: "新匹配！",
        body: "管理员为你匹配了一个新用户",
        data: JSON.stringify({ matchId: match.id }),
      },
    ],
  });

  // Unified audit log
  await auditMatchAction(adminId, "match.manual_create", match.id, {
    after: { senderId, receiverId, matchType, compatibilityScore: compatibility.total },
  }, undefined, request);

  return success(match, undefined, 201);
});
