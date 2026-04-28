import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

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

    // Get current user's profile with preferences
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { profile: true },
    });

    if (!currentUser?.profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const profile = currentUser.profile;

    // Get IDs of users to exclude (already matched)
    const existingMatches = await prisma.match.findMany({
      where: {
        OR: [
          { senderId: session.user.id },
          { receiverId: session.user.id },
        ],
      },
      select: {
        senderId: true,
        receiverId: true,
      },
    });

    const userId = session.user.id;
    const matchedUserIds = existingMatches.map((m) =>
      m.senderId === userId ? m.receiverId : m.senderId
    );

    // Get IDs of users already reacted to (via MatchReaction)
    const existingReactions = await prisma.matchReaction.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        match: {
          select: {
            senderId: true,
            receiverId: true,
          },
        },
      },
    });

    const reactedUserIds = existingReactions.map((r) =>
      r.match.senderId === userId ? r.match.receiverId : r.match.senderId
    );

    let excludeIds = [...new Set([...matchedUserIds, ...reactedUserIds, session.user.id])];

    // Build where clause - RELAXED to show more users
    // Only require: has profile, not current user, not already matched/reacted
    // Prisma 7 requires nested filter fields wrapped in `is:`
    let whereClause: any = {
      id: { notIn: excludeIds },
      profile: {
        is: {
          onboardingStep: { gte: 4 },
        },
      },
    };

    // Add gender preference filter (optional) - RELAXED for homepage display
    // Map various gender preference formats to standard values
    // Note: preferredGender may be null for new users who haven't completed onboarding
    const preferredGender = profile.preferredGender?.toUpperCase() || null;
    console.log('[Discover API] Raw preferredGender:', profile.preferredGender, 'Upper:', preferredGender);
    
    if (preferredGender && preferredGender !== "EVERYONE") {
      const genderMap: Record<string, string> = {
        'MALE': 'MALE',
        'MAN': 'MALE',
        'FEMALE': 'FEMALE',
        'WOMAN': 'FEMALE',
      };
      const targetGender = genderMap[preferredGender];
      if (targetGender) {
        whereClause.profile.is.gender = targetGender;
        console.log('[Discover API] Filtering by gender:', targetGender);
      } else {
        console.log('[Discover API] No gender filter applied, unknown preferredGender:', preferredGender);
      }
    } else {
      console.log('[Discover API] No gender filter applied (EVERYONE or empty)');
    }

    // Add age range filter (optional) - RELAXED
    if (profile.preferredAgeMin || profile.preferredAgeMax) {
      whereClause.profile.is.age = {
        gte: profile.preferredAgeMin || 18,
        lte: profile.preferredAgeMax || 99,
      };
    }

    // Debug logging
    console.log('[Discover API] Current user:', userId, 'Profile:', profile.id);
    console.log('[Discover API] Excluding IDs:', excludeIds.length, excludeIds.slice(0, 10));
    console.log('[Discover API] Where clause:', JSON.stringify(whereClause, null, 2));

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

    console.log('[Discover API] Found users (first pass):', users.length);

    // ═══ FALLBACK: If no users found, try with relaxed conditions ═══
    let finalUsers = users;
    
    if (users.length === 0) {
      console.log('[Discover API] No users found with strict filters, trying fallback...');
      
      // Fallback: Only exclude current user and already matched users (allow reacted users)
      const fallbackExcludeIds = [...new Set([...matchedUserIds, session.user.id])];
      
      const fallbackWhereClause: any = {
        id: { notIn: fallbackExcludeIds },
        profile: {
          is: {
            onboardingStep: { gte: 4 },
          },
        },
      };
      
      // Remove gender filter in fallback
      console.log('[Discover API] Fallback where clause:', JSON.stringify(fallbackWhereClause, null, 2));
      
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
      
      console.log('[Discover API] Found users (fallback):', fallbackUsers.length);
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

    return NextResponse.json({ users: formattedUsers });
  } catch (error) {
    console.error("Discover API error:", error);
    return NextResponse.json(
      { error: "Failed to load discover users", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
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
