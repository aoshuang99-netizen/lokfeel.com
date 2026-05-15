export const dynamic = 'force-dynamic';
import { NextRequest } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { db } from "@/lib/db";
import { success, serverError } from "@/lib/api-response";
import { subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from "date-fns";

export const GET = withPermission('analytics.view')(async (request: NextRequest) => {
  try {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const thirtyDaysAgo = subDays(now, 29);

    // ─── KPI Data (parallel) ───
    const [
      totalUsers,
      newThisWeek,
      newThisMonth,
      totalMatches,
      pendingMatches,
      acceptedMatches,
      rejectedMatches,
      matchScoreAvg,
      activeSubscriptions,
      monthlyPlanCount,
      yearlyPlanCount,
      totalRevenue,
      monthRevenue,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: weekStart, lte: weekEnd } } }),
      db.user.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      db.match.count(),
      db.match.count({ where: { status: "PENDING" } }),
      db.match.count({ where: { status: "ACCEPTED" } }),
      db.match.count({ where: { status: "REJECTED" } }),
      db.match.aggregate({ _avg: { matchScore: true } }),
      db.subscription.count({ where: { status: "ACTIVE" } }),
      db.subscription.count({ where: { status: "ACTIVE", plan: "PREMIUM_MONTHLY" } }),
      db.subscription.count({ where: { status: "ACTIVE", plan: "PREMIUM_YEARLY" } }),
      db.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amount: true } }),
      db.payment.aggregate({ where: { status: "SUCCEEDED", createdAt: { gte: monthStart, lte: monthEnd } }, _sum: { amount: true } }),
    ]);

    // Activity metrics
    const [messagesToday, chatCount, totalMessages] = await Promise.all([
      db.message.count({ where: { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } } }),
      db.chatRoom.count(),
      db.message.count(),
    ]);

    const activeToday = await db.message.findMany({
      where: { createdAt: { gte: startOfDay(now) } },
      select: { senderId: true },
      distinct: ['senderId'],
    });
    const activeThisWeek = await db.message.findMany({
      where: { createdAt: { gte: weekStart } },
      select: { senderId: true },
      distinct: ['senderId'],
    });

    // Calculate MRR
    const planPrices = { PREMIUM_MONTHLY: 29.99, PREMIUM_YEARLY: 199.99 / 12 };
    const mrr = (monthlyPlanCount * planPrices.PREMIUM_MONTHLY) + (yearlyPlanCount * planPrices.PREMIUM_YEARLY);

    const acceptanceRate = totalMatches > 0
      ? ((acceptedMatches + rejectedMatches) > 0 ? (acceptedMatches / (acceptedMatches + rejectedMatches)) * 100 : 0)
      : 0;

    // ─── Daily Growth for Charts ───
    const dailyUsers = await db.user.findMany({
      where: { createdAt: { gte: startOfDay(thirtyDaysAgo) } },
      select: { createdAt: true },
    });

    const dailyGrowthMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const day = subDays(now, i);
      dailyGrowthMap.set(day.toISOString().split("T")[0], 0);
    }
    dailyUsers.forEach((u: any) => {
      const key = u.createdAt.toISOString().split("T")[0];
      dailyGrowthMap.set(key, (dailyGrowthMap.get(key) || 0) + 1);
    });
    const dailyGrowth = Array.from(dailyGrowthMap.entries()).map(([date, count]) => ({ date, count }));

    // ─── Revenue Trend (last 12 months) ───
    const revenueTrend = [];
    for (let i = 11; i >= 0; i--) {
      const monthStartDate = startOfMonth(subMonths(now, i));
      const monthEndDate = endOfMonth(subMonths(now, i));
      const monthRevenueData = await db.payment.aggregate({
        where: { status: "SUCCEEDED", createdAt: { gte: monthStartDate, lte: monthEndDate } },
        _sum: { amount: true },
      });
      revenueTrend.push({
        month: monthStartDate.toISOString().slice(0, 7),
        revenue: monthRevenueData._sum.amount || 0,
      });
    }

    // ─── Conversion Funnel ───
    const [usersWithProfile, usersWithMessages, usersWithMatches] = await Promise.all([
      db.profile.count({ where: { profileStatus: "APPROVED" } }),
      db.message.findMany({ select: { senderId: true }, distinct: ['senderId'] }).then(rows => rows.length),
      db.match.findMany({ select: { senderId: true }, distinct: ['senderId'] }).then(rows => rows.length),
    ]);

    const funnel = [
      { stage: "注册用户", count: totalUsers, pct: 100 },
      { stage: "完善资料", count: usersWithProfile, pct: totalUsers > 0 ? Math.round((usersWithProfile / totalUsers) * 100) : 0 },
      { stage: "发起匹配", count: usersWithMatches, pct: totalUsers > 0 ? Math.round((usersWithMatches / totalUsers) * 100) : 0 },
      { stage: "发送消息", count: usersWithMessages, pct: totalUsers > 0 ? Math.round((usersWithMessages / totalUsers) * 100) : 0 },
      { stage: "付费订阅", count: activeSubscriptions, pct: totalUsers > 0 ? Math.round((activeSubscriptions / totalUsers) * 100) : 0 },
    ];

    // ─── Action Items ───
    const [recentAuditLogs] = await Promise.all([
      db.auditLog?.count?.({ where: { createdAt: { gte: subDays(now, 7) } } }) ?? Promise.resolve(0),
    ]);

    // ─── Health Board Data ───
    const userGrowthRate = totalUsers > 0 ? (newThisMonth / totalUsers) * 100 : 0;
    const avgMessagesPerChat = chatCount > 0 ? totalMessages / chatCount : 0;

    const summary = {
      kpi: {
        totalUsers: { value: totalUsers, change: `+${newThisWeek} 本周`, trend: newThisWeek > 0 ? "up" : "neutral" as const },
        dau: { value: activeToday.length, change: `+${activeThisWeek.length} 本周`, trend: activeToday.length > 0 ? "up" : "neutral" as const },
        acceptanceRate: { value: Math.round(acceptanceRate * 10) / 10, change: `${pendingMatches} 待处理`, trend: acceptanceRate > 50 ? "up" : "down" as const, suffix: "%" },
        mrr: { value: Math.round(mrr * 100) / 100, change: `${activeSubscriptions} 订阅`, trend: mrr > 0 ? "up" : "neutral" as const, prefix: "¥" },
        pendingMatches: { value: pendingMatches, change: "需审核", trend: pendingMatches > 20 ? "down" : pendingMatches > 0 ? "warning" : "up" as const },
      },
      health: {
        operations: {
          label: "运营",
          status: pendingMatches > 20 ? "warning" : "good" as const,
          metrics: [
            { label: "用户增长率", value: `${userGrowthRate.toFixed(1)}%` },
            { label: "待审核内容", value: "0" },
            { label: "周活跃用户", value: String(activeThisWeek.length) },
          ],
          href: "/admin/users",
        },
        product: {
          label: "产品",
          status: "good" as const,
          metrics: [
            { label: "平均匹配分", value: `${Math.round(matchScoreAvg._avg.matchScore || 0)}` },
            { label: "接受率", value: `${Math.round(acceptanceRate)}%` },
            { label: "总匹配数", value: String(totalMatches) },
          ],
          href: "/admin/analytics",
        },
        tech: {
          label: "技术",
          status: recentAuditLogs > 0 ? "good" : "neutral" as const,
          metrics: [
            { label: "系统状态", value: "正常" },
            { label: "审计日志", value: `${recentAuditLogs} 条/周` },
            { label: "平均消息", value: `${Math.round(avgMessagesPerChat * 10) / 10}/聊天` },
          ],
          href: "/admin/settings",
        },
        marketing: {
          label: "市场",
          status: monthRevenue._sum.amount && monthRevenue._sum.amount > 0 ? "good" : "neutral" as const,
          metrics: [
            { label: "月收入", value: `¥${Math.round((monthRevenue._sum.amount || 0) * 100) / 100}` },
            { label: "总收入", value: `¥${Math.round((totalRevenue._sum.amount || 0) * 100) / 100}` },
            { label: "订阅数", value: String(activeSubscriptions) },
          ],
          href: "/admin/marketing",
        },
      },
      actions: {
        pendingMatches,
        pendingContent: 0,
        recentAuditLogs,
        activeSubscriptions,
      },
      charts: {
        userGrowth: dailyGrowth,
        revenueTrend,
      },
      funnel,
    };

    return success(summary);
  } catch (error: any) {
    console.error("Dashboard summary API error:", error);
    return serverError("加载仪表盘数据失败: " + (error.message || "未知错误"));
  }
});
