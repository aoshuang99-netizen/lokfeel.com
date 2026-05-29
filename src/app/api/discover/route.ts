import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { cache } from "@/lib/cache";
import { NextRequest, NextResponse } from "next/server";
import { isMaleGender, isFemaleGender, getOppositeGenders } from "@/lib/gender-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/discover
 * 
 * Returns a list of users for the Discover page (card swiping interface)
 * Excludes:
 * - Current user
 * - Users already matched
 * - Users already liked/passed
 * - Users outside preferences
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const minOnboardingStep = parseInt(searchParams.get("minOnboardingStep") || "4");

    // ★ New: Explicit filter params (override profile preferences when provided)
    const filterGender = searchParams.get("preferredGender") || null;
    const filterAgeMin = searchParams.get("preferredAgeMin") ? parseInt(searchParams.get("preferredAgeMin")!) : null;
    const filterAgeMax = searchParams.get("preferredAgeMax") ? parseInt(searchParams.get("preferredAgeMax")!) : null;
    const filterDistance = searchParams.get("preferredDistance") ? parseInt(searchParams.get("preferredDistance")!) : null;
    const filterRelationshipGoal = searchParams.get("relationshipGoal") || null;
    const filterAttachmentStyle = searchParams.get("attachmentStyle") || null;
    const filterCity = searchParams.get("city") || null;

    const userId = session.user.id;

    // ═══ Redis-backed caching of expensive prerequisite queries ═══
    // Cache current user profile (300s TTL — profiles change rarely)
    const profile = await cache.get(
      `discover:profile:${userId}`,
      async () => {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { profile: true },
        });
        if (!user?.profile) return null;
        return user.profile;
      },
      300
    );

    if (!profile) {
      const res = NextResponse.json({ error: "Profile not found" }, { status: 404 });
      res.headers.set('Cache-Control', 'no-cache');
      return res;
    }

    // Cache match history + reactions (30s TTL — changes on each swipe)
    const excludeIdsResult = await cache.get(
      `discover:exclude:${userId}`,
      async () => {
        // Get IDs of users to exclude (already matched)
        const existingMatches = await prisma.match.findMany({
          where: {
            OR: [
              { senderId: userId },
              { receiverId: userId },
            ],
          },
          select: { senderId: true, receiverId: true },
        });

        const matchedUserIds = existingMatches.map((m) =>
          m.senderId === userId ? m.receiverId : m.senderId
        );

        // Get IDs of users already reacted to (via MatchReaction)
        const existingReactions = await prisma.matchReaction.findMany({
          where: { userId },
          select: {
            match: {
              select: { senderId: true, receiverId: true },
            },
          },
        });

        const reactedUserIds = existingReactions.map((r) =>
          r.match.senderId === userId ? r.match.receiverId : r.match.senderId
        );

        return [...new Set([...matchedUserIds, ...reactedUserIds, userId])];
      },
      30
    );

    let excludeIds = excludeIdsResult;

    // Build where clause - RELAXED to show more users
    // Only require: has profile, not current user, not already matched/reacted
    // 🔴 BUG FIX: Must filter out bot users (isBot=false)!
    // Prisma 7 requires nested filter fields wrapped in `is:`
    let whereClause: any = {
      id: { notIn: excludeIds },
      isBot: { not: true },  // BUG-01 FIX: 兼容 SQLite Boolean (false + null)
      profile: {
        is: {
          onboardingStep: { gte: minOnboardingStep },
        },
      },
    };

    // Add gender preference filter (optional)
    // ★ Use explicit filter param if provided, else use profile preference
    const effectiveGender = filterGender || profile.preferredGender?.toUpperCase() || null;

    if (effectiveGender && effectiveGender !== "EVERYONE") {
      const targetGenders = getOppositeGenders(effectiveGender);
      if (targetGenders.length > 0 && targetGenders.length < 5) {
        // Use IN clause to match both MALE/FEMALE and MAN/WOMAN
        whereClause.profile.is.gender = { in: targetGenders };
      }
      // If "everyone" or non-binary, no gender filter applied
    }

    // Add age range filter (optional)
    // ★ Use explicit filter param if provided, else use profile preference
    const effectiveAgeMin = filterAgeMin ?? profile.preferredAgeMin;
    const effectiveAgeMax = filterAgeMax ?? profile.preferredAgeMax;
    if (effectiveAgeMin || effectiveAgeMax) {
      whereClause.profile.is.age = {
        gte: effectiveAgeMin || 18,
        lte: effectiveAgeMax || 99,
      };
    }

    // ★ New: Add relationship goal filter
    if (filterRelationshipGoal) {
      whereClause.profile.is.relationshipGoal = filterRelationshipGoal;
    }

    // ★ New: Add attachment style filter
    if (filterAttachmentStyle) {
      whereClause.profile.is.attachmentStyle = filterAttachmentStyle;
    }

    // ★ New: Add city filter
    if (filterCity) {
      whereClause.profile.is.city = filterCity;
    }

    // ★ New: Add distance filter (future: actually calculate distance)
    if (filterDistance) {
      // Distance is stored in profile, for now skip if no geo-coords
      // This can be enhanced with lat/lon calculation
    }

    // Fetch potential matches
    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        profile: {
          select: {
            id: true,
            displayName: true,
            age: true,
            avatar: true,
            avatarType: true,
            city: true,
            bio: true,
            relationshipGoal: true,
            attachmentStyle: true,
            gender: true,
            onboardingStep: true,
            profileStatus: true,
          },
        },
      },
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
    });

    // ═══ FALLBACK: If no users found, try with relaxed conditions ═══
    let finalUsers = users;

    if (users.length === 0) {
      // Fallback: Only exclude current user (most relaxed — no match/reaction exclusions)
      const fallbackExcludeIds = [session.user.id];
      
      const fallbackWhereClause: any = {
        id: { notIn: fallbackExcludeIds },
        isBot: { not: true },  // BUG-01 FIX: 兼容 SQLite Boolean (false + null)
        profile: {
          is: {
            onboardingStep: { gte: Math.min(minOnboardingStep, 2) },
          },
        },
      };
      
      // Remove gender filter in fallback

      const fallbackUsers = await prisma.user.findMany({
        where: fallbackWhereClause,
        include: {
          profile: {
            select: {
              id: true,
              displayName: true,
              age: true,
              avatar: true,
              avatarType: true,
              city: true,
              bio: true,
              relationshipGoal: true,
              attachmentStyle: true,
              gender: true,
              onboardingStep: true,
              profileStatus: true,
            },
          },
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      });
      finalUsers = fallbackUsers;
    }

    // Calculate match scores and format response
    const formattedUsers = finalUsers.map((user) => {
      const matchScore = calculateMatchScore(profile, user.profile);
      return {
        id: user.id,
        name: user.profile?.displayName || user.name || "Anonymous",
        age: user.profile?.age || 25,
        avatar: user.profile?.avatar,
        avatarType: user.profile?.avatarType,
        gender: user.profile?.gender,
        city: user.profile?.city,
        bio: user.profile?.bio,
        relationshipGoal: user.profile?.relationshipGoal,
        attachmentStyle: user.profile?.attachmentStyle,
        matchScore,
        matchReason: generateMatchReason(profile, user.profile, matchScore),
        prompts: [],
        verified: user.profile?.avatarType === "photo",
      };
    });

    // Sort by match score
    formattedUsers.sort((a, b) => b.matchScore - a.matchScore);

    const res = NextResponse.json({ users: formattedUsers });
    res.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res;
    } catch (error) {
    console.error("Discover API error:", error);
    const res = NextResponse.json(
      { error: "Failed to load discover users", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
    res.headers.set('Cache-Control', 'no-cache');
    return res;
  }
}

/**
 * Calculate match score between two profiles
 */
function calculateMatchScore(userProfile: any, targetProfile: any): number {
  if (!userProfile || !targetProfile) return 50;

  let score = 50; // Base score

  // Attachment style compatibility
  if (userProfile.attachmentStyle && targetProfile.attachmentStyle) {
    const attachmentScore = getAttachmentCompatibility(
      userProfile.attachmentStyle,
      targetProfile.attachmentStyle
    );
    score += attachmentScore * 0.2;
  }

  // Communication style
  if (userProfile.communicationStyle && targetProfile.communicationStyle) {
    if (userProfile.communicationStyle === targetProfile.communicationStyle) {
      score += 10;
    } else {
      score += 5;
    }
  }

  // Conflict resolution
  if (userProfile.conflictResolution && targetProfile.conflictResolution) {
    const conflictScore = getConflictCompatibility(
      userProfile.conflictResolution,
      targetProfile.conflictResolution
    );
    score += conflictScore * 0.15;
  }

  // Love language
  if (userProfile.loveLanguage && targetProfile.loveLanguage) {
    if (userProfile.loveLanguage === targetProfile.loveLanguage) {
      score += 8;
    } else {
      score += 4;
    }
  }

  // Relationship goal alignment
  if (userProfile.relationshipGoal && targetProfile.relationshipGoal) {
    if (userProfile.relationshipGoal === targetProfile.relationshipGoal) {
      score += 15;
    } else if (
      (userProfile.relationshipGoal === "MONOGAMY" &&
        targetProfile.relationshipGoal === "CASUAL_DATING") ||
      (userProfile.relationshipGoal === "CASUAL_DATING" &&
        targetProfile.relationshipGoal === "MONOGAMY")
    ) {
      score += 8;
    }
  }

  // Normalize score
  const normalizedScore = Math.min(99, Math.max(40, Math.round(score)));
  return normalizedScore;
}

function getAttachmentCompatibility(style1: string, style2: string): number {
  const compatibilityMap: Record<string, Record<string, number>> = {
    Secure: { Secure: 95, Anxious: 85, Avoidant: 80, Fearful: 75 },
    Anxious: { Secure: 90, Anxious: 70, Avoidant: 50, Fearful: 60 },
    Avoidant: { Secure: 85, Anxious: 45, Avoidant: 65, Fearful: 55 },
    Fearful: { Secure: 80, Anxious: 60, Avoidant: 55, Fearful: 50 },
  };

  const s1 = style1.replace("-Preoccupied", "").replace("-Avoidant", "");
  const s2 = style2.replace("-Preoccupied", "").replace("-Avoidant", "");

  return compatibilityMap[s1]?.[s2] || 60;
}

function getConflictCompatibility(style1: string, style2: string): number {
  if (style1 === "Collaborative" || style2 === "Collaborative") return 90;
  if (
    (style1 === "Avoiding" && style2 === "Competing") ||
    (style1 === "Competing" && style2 === "Avoiding")
  )
    return 40;
  if (style1 === style2) return 70;
  return 60;
}

function generateMatchReason(
  userProfile: any,
  targetProfile: any,
  score: number
): string {
  const reasons: string[] = [];

  if (score >= 90) {
    reasons.push("Exceptional compatibility");
  } else if (score >= 80) {
    reasons.push("Highly compatible");
  } else if (score >= 70) {
    reasons.push("Good match");
  } else {
    reasons.push("Interesting connection");
  }

  if (
    userProfile.relationshipGoal &&
    targetProfile.relationshipGoal &&
    userProfile.relationshipGoal === targetProfile.relationshipGoal
  ) {
    reasons.push("similar relationship goals");
  }

  if (
    userProfile.attachmentStyle &&
    targetProfile.attachmentStyle &&
    (userProfile.attachmentStyle === "Secure" ||
      targetProfile.attachmentStyle === "Secure")
  ) {
    reasons.push("healthy attachment dynamic");
  }

  if (reasons.length > 1) {
    return `${reasons[0]} with ${reasons.slice(1).join(" and ")}`;
  }

  return reasons[0] || "Based on your relationship blueprint";
}
