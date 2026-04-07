export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAuth as requireAdmin } from "@/lib/auth/auth"
import { success, serverError } from "@/lib/api-response";
import type { AdminAnalytics } from "@/types";
import { subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // User growth metrics
    const [totalUsers, newThisWeek, newThisMonth] = await Promise.all([
      db.user.count(),
      db.user.count({
        where: {
          createdAt: { gte: weekStart, lte: weekEnd },
        },
      }),
      db.user.count({
        where: {
          createdAt: { gte: monthStart, lte: monthEnd },
        },
      }),
    ]);

    // Daily user growth for last 30 days
    const dailyGrowth: Array<{ date: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const day = subDays(now, i);
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);

      const count = await db.user.count({
        where: {
          createdAt: { gte: dayStart, lte: dayEnd },
        },
      });

      dailyGrowth.push({
        date: day.toISOString().split("T")[0],
        count,
      });
    }

    // Match metrics
    const [
      totalMatches,
      pendingMatches,
      acceptedMatches,
      rejectedMatches,
      matchScoreAvg,
    ] = await Promise.all([
      db.match.count(),
      db.match.count({ where: { status: "PENDING" } }),
      db.match.count({ where: { status: "ACCEPTED" } }),
      db.match.count({ where: { status: "REJECTED" } }),
      db.match.aggregate({
        _avg: { matchScore: true },
      }),
    ]);

    const acceptanceRate = totalMatches > 0
      ? ((acceptedMatches + rejectedMatches) > 0
          ? (acceptedMatches / (acceptedMatches + rejectedMatches)) * 100
          : 0)
      : 0;

    // Revenue metrics
    const [
      totalRevenue,
      monthRevenue,
      activeSubscriptions,
    ] = await Promise.all([
      db.payment.aggregate({
        where: { status: "SUCCEEDED" },
        _sum: { amount: true },
      }),
      db.payment.aggregate({
        where: {
          status: "SUCCEEDED",
          createdAt: { gte: monthStart, lte: monthEnd },
        },
        _sum: { amount: true },
      }),
      db.subscription.count({ where: { status: "ACTIVE" } }),
    ]);

    // Calculate MRR (Monthly Recurring Revenue)
    const subscriptions = await db.subscription.findMany({
      where: { status: "ACTIVE" },
      select: { plan: true },
    });

    const planPrices: Record<string, number> = {
      PREMIUM_MONTHLY: 29.99,
      PREMIUM_YEARLY: 199.99 / 12,
    };

    const mrr = subscriptions.reduce((sum: number, sub: any) => {
      return sum + (planPrices[sub.plan] || 0);
    }, 0);

    // Activity metrics
    const [activeToday, activeThisWeek, messagesToday] = await Promise.all([
      db.analyticsEvent.groupBy({
        by: ["userId"],
        where: {
          createdAt: { gte: startOfDay(now), lte: endOfDay(now) },
        },
      }),
      db.analyticsEvent.groupBy({
        by: ["userId"],
        where: {
          createdAt: { gte: weekStart, lte: weekEnd },
        },
      }),
      db.message.count({
        where: {
          createdAt: { gte: startOfDay(now), lte: endOfDay(now) },
        },
      }),
    ]);

    // Calculate average messages per chat
    const chatCount = await db.chatRoom.count();
    const totalMessages = await db.message.count();
    const avgMessagesPerChat = chatCount > 0 ? totalMessages / chatCount : 0;

    const analytics: AdminAnalytics = {
      userGrowth: {
        total: totalUsers,
        newThisWeek,
        newThisMonth,
        byDay: dailyGrowth,
      },
      matchMetrics: {
        total: totalMatches,
        pending: pendingMatches,
        accepted: acceptedMatches,
        rejected: rejectedMatches,
        averageScore: matchScoreAvg._avg.matchScore || 0,
        acceptanceRate: Math.round(acceptanceRate * 100) / 100,
      },
      revenue: {
        total: totalRevenue._sum.amount || 0,
        thisMonth: monthRevenue._sum.amount || 0,
        mrr: Math.round(mrr * 100) / 100,
        activeSubscriptions,
      },
      activity: {
        activeUsersToday: activeToday.length,
        activeUsersThisWeek: activeThisWeek.length,
        messagesSentToday: messagesToday,
        avgMessagesPerChat: Math.round(avgMessagesPerChat * 10) / 10,
      },
    };

    return success(analytics);
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return serverError("Failed to fetch analytics");
  }
}
