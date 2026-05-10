import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ═════════════════════════════════
// ANALYTICS API ROUTE
// ═════════════════════════════════

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth();
    const userId = user.id;

    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range") || "7d";

    // Calculate date range
    const now = new Date();
    const daysAgo = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const startDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    // Get current user's profile
    const profile = await prisma.profile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // ═══ Matches This Week
    const matchesThisWeek = await prisma.match.count({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        createdAt: { gte: startDate },
      },
    });

    const matchesLastWeek = await prisma.match.count({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        createdAt: {
          gte: new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000),
          lt: startDate,
        },
      },
    });

    const totalMatches = await prisma.match.count({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
    });

    // ═══ Profile Views (approximate from NEW_MATCH notifications)
    const profileViews = await prisma.notification.count({
      where: {
        userId,
        type: "NEW_MATCH",
        createdAt: { gte: startDate },
      },
    });

    const profileViewsLastWeek = await prisma.notification.count({
      where: {
        userId,
        type: "NEW_MATCH",
        createdAt: {
          gte: new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000),
          lt: startDate,
        },
      },
    });

    // ═══ Unread Messages
    const unreadMessages = await prisma.message.count({
      where: {
        room: {
          members: {
            some: { userId },
          },
        },
        senderId: { not: userId },
        isRead: false,
      },
    });

    const messagesThisWeek = await prisma.message.count({
      where: {
        room: {
          members: {
            some: { userId },
          },
        },
        createdAt: { gte: startDate },
      },
    });

    // ═══ Profile Completion
    const profileCompletion = calculateProfileCompletion(profile);

    // ═══ Match Quality Distribution
    const allMatches = await prisma.match.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: { include: { profile: true } },
        receiver: { include: { profile: true } },
      },
    });

    const matchScores = allMatches.map((m) => {
      const otherProfile = m.senderId === userId
        ? m.receiver?.profile
        : m.sender?.profile;
      return otherProfile ? calculateMatchScore(profile, otherProfile) : m.matchScore;
    });

    const distribution = [
      { score: "90-100", count: matchScores.filter((s) => s >= 90).length },
      { score: "80-89", count: matchScores.filter((s) => s >= 80 && s < 90).length },
      { score: "70-79", count: matchScores.filter((s) => s >= 70 && s < 80).length },
      { score: "60-69", count: matchScores.filter((s) => s >= 60 && s < 70).length },
      { score: "<60", count: matchScores.filter((s) => s < 60).length },
    ];

    const avgScore =
      matchScores.length > 0
        ? Math.round(matchScores.reduce((a, b) => a + b, 0) / matchScores.length)
        : 0;

    // ═══ Activity Trend (last 7 days)
    const activityTrend = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const date = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000);
        const dayStart = new Date(date.setHours(0, 0, 0, 0));
        const dayEnd = new Date(date.setHours(23, 59, 59, 999));

        return Promise.all([
          prisma.match.count({
            where: {
              OR: [{ senderId: userId }, { receiverId: userId }],
              createdAt: { gte: dayStart, lte: dayEnd },
            },
          }),
          prisma.notification.count({
            where: {
              userId,
              type: "PROFILE_VIEW",
              createdAt: { gte: dayStart, lte: dayEnd },
            },
          }),
        ]).then(([matches, views]) => ({
          label: dayStart.toLocaleDateString("en", { weekday: "short" }),
          matches,
          views,
        }));
      })
    );

    // ═══ Top Tags (from user's interests or bio)
    const topTags = extractTopTags(profile);

    // ═══ Calculate Trends
    const matchTrend =
      matchesLastWeek > 0
        ? Math.round(((matchesThisWeek - matchesLastWeek) / matchesLastWeek) * 100)
        : 0;

    const viewTrend =
      profileViewsLastWeek > 0
        ? Math.round(((profileViews - profileViewsLastWeek) / profileViewsLastWeek) * 100)
        : 0;

    return NextResponse.json({
      matches: {
        thisWeek: matchesThisWeek,
        lastWeek: matchesLastWeek,
        total: totalMatches,
        trend: matchTrend,
      },
      profileViews: {
        thisWeek: profileViews,
        lastWeek: profileViewsLastWeek,
        trend: viewTrend,
      },
      messages: {
        unread: unreadMessages,
        totalThisWeek: messagesThisWeek,
      },
      profileCompletion,
      matchQuality: {
        average: avgScore,
        distribution,
      },
      activityTrend: activityTrend.map((item) => ({
        label: item.label,
        value: item.matches,
      })),
      topTags,
    });
  } catch (error) {
    console.error("[Analytics API] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ═════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════

function calculateProfileCompletion(profile: any): number {
  let completed = 0;
  const total = 6;

  if (profile.displayName) completed++;
  if (profile.age) completed++;
  if (profile.gender) completed++;
  if (profile.avatar && profile.avatarType === "photo") completed++;
  if (profile.bio) completed++;
  if (profile.city) completed++;

  return Math.round((completed / total) * 100);
}

function calculateMatchScore(profile1: any, profile2: any): number {
  // Simplified match calculation
  let score = 50;

  // Age compatibility
  if (Math.abs(profile1.age - profile2.age) <= 5) score += 10;

  // Location proximity (simplified)
  if (profile1.city === profile2.city) score += 15;

  // Relationship goal match
  if (profile1.relationshipGoal === profile2.relationshipGoal) score += 10;

  // Attachment style compatibility
  const compatibleStyles: Record<string, string[]> = {
    Secure: ["Secure", "Anxious"],
    Anxious: ["Secure", "Avoidant"],
    Avoidant: ["Secure", "Anxious"],
    Fearful: ["Secure"],
  };

  const compatible = compatibleStyles[profile1.attachmentStyle] || [];
  if (compatible.includes(profile2.attachmentStyle)) score += 15;

  return Math.min(score, 100);
}

function extractTopTags(profile: any): { tag: string; count: number }[] {
  // Extract tags from bio or interests
  const tags: string[] = [];

  if (profile.bio) {
    const commonTags = ["Coffee", "Travel", "Yoga", "Reading", "Hiking", "Music", "Art", "Food"];
    commonTags.forEach((tag) => {
      if (profile.bio.toLowerCase().includes(tag.toLowerCase())) {
        tags.push(tag);
      }
    });
  }

  // Return top 5 tags with mock counts
  return tags.slice(0, 5).map((tag) => ({
    tag,
    count: Math.floor(Math.random() * 20) + 5,
  }));
}
