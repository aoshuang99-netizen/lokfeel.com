export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { db } from "@/lib/db";
import { success, serverError } from "@/lib/api-response";
import type { AdminAnalytics } from "@/types";
import { subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";

export const GET = withPermission('analytics.view')(async (request: NextRequest, { userId }) => {
  try {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // User growth metrics (parallel)
    const [totalUsers, newThisWeek, newThisMonth] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: weekStart, lte: weekEnd } } }),
      db.user.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
    ]);

    // Daily user growth - optimized single query
    const thirtyDaysAgo = subDays(now, 29);
    const dailyUsers = await db.user.findMany({
      where: { createdAt: { gte: startOfDay(thirtyDaysAgo) } },
      select: { createdAt: true },
    });

    // Group by date in JS (much faster than 30 separate queries)
    const dailyGrowthMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const day = subDays(now, i);
      const key = day.toISOString().split("T")[0];
      dailyGrowthMap.set(key, 0);
    }
    dailyUsers.forEach((u: any) => {
      const key = u.createdAt.toISOString().split("T")[0];
      dailyGrowthMap.set(key, (dailyGrowthMap.get(key) || 0) + 1);
    });
    const dailyGrowth = Array.from(dailyGrowthMap.entries()).map(([date, count]) => ({ date, count }));

    // Match metrics (parallel)
    const [totalMatches, pendingMatches, acceptedMatches, rejectedMatches, matchScoreAvg] = await Promise.all([
      db.match.count(),
      db.match.count({ where: { status: "PENDING" } }),
      db.match.count({ where: { status: "ACCEPTED" } }),
      db.match.count({ where: { status: "REJECTED" } }),
      db.match.aggregate({ _avg: { matchScore: true } }),
    ]);

    const acceptanceRate = totalMatches > 0
      ? ((acceptedMatches + rejectedMatches) > 0 ? (acceptedMatches / (acceptedMatches + rejectedMatches)) * 100 : 0)
      : 0;

    // Revenue metrics (parallel)
    const planPrices: Record<string, number> = { PREMIUM_MONTHLY: 29.99, PREMIUM_YEARLY: 199.99 / 12 };
    const [totalRevenue, monthRevenue, activeSubscriptions, planCounts] = await Promise.all([
      db.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amount: true } }),
      db.payment.aggregate({ where: { status: "SUCCEEDED", createdAt: { gte: monthStart, lte: monthEnd } }, _sum: { amount: true } }),
      db.subscription.count({ where: { status: "ACTIVE" } }),
      db.subscription.groupBy({ by: ['plan'], where: { status: "ACTIVE" }, _count: { plan: true } }),
    ]);

    // Calculate MRR from grouped counts
    const mrr = planCounts.reduce((sum, group) => {
      return sum + (planPrices[group.plan] || 0) * group._count.plan;
    }, 0);

    // Activity metrics (simplified to avoid timeout)
    const [messagesToday, chatCount, totalMessages] = await Promise.all([
      db.message.count({ where: { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } } }),
      db.chatRoom.count(),
      db.message.count(),
    ]);
    const activeToday = await db.message.groupBy({ by: ["senderId"], where: { createdAt: { gte: startOfDay(now) } } });
    const activeThisWeek = await db.message.groupBy({ by: ["senderId"], where: { createdAt: { gte: weekStart } } });

    const avgMessagesPerChat = chatCount > 0 ? totalMessages / chatCount : 0;

    const analytics: AdminAnalytics = {
      userGrowth: { total: totalUsers, newThisWeek, newThisMonth, byDay: dailyGrowth },
      matchMetrics: {
        total: totalMatches, pending: pendingMatches, accepted: acceptedMatches, rejected: rejectedMatches,
        averageScore: matchScoreAvg._avg.matchScore || 0, acceptanceRate: Math.round(acceptanceRate * 100) / 100,
      },
      revenue: {
        total: totalRevenue._sum.amount || 0, thisMonth: monthRevenue._sum.amount || 0,
        mrr: Math.round(mrr * 100) / 100, activeSubscriptions,
      },
      activity: {
        activeUsersToday: activeToday.length, activeUsersThisWeek: activeThisWeek.length,
        messagesSentToday: messagesToday, avgMessagesPerChat: Math.round(avgMessagesPerChat * 10) / 10,
      },
    };

    return success(analytics);
  } catch (error: any) {
    console.error("Analytics API error:", error);
    return serverError("加载分析数据失败: " + (error.message || "未知错误"));
  }
});
