export const dynamic = 'force-dynamic';
import { NextRequest } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { db } from "@/lib/db";
import { success, serverError } from "@/lib/api-response";
import { subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from "date-fns";

type TimeRange = "day" | "week" | "month" | "year";

function getDateRange(range: TimeRange) {
  const now = new Date();
  const end = endOfDay(now);
  
  let start: Date;
  let chartUnit: "day" | "week" | "month";
  
  switch (range) {
    case "day":
      start = startOfDay(now);
      chartUnit = "day";
      break;
    case "week":
      start = startOfWeek(now);
      chartUnit = "day";
      break;
    case "month":
      start = startOfMonth(now);
      chartUnit = "day";
      break;
    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      chartUnit = "month";
      break;
    default:
      start = startOfMonth(now);
      chartUnit = "day";
  }
  
  return { start, end, chartUnit };
}

export const GET = withPermission('analytics.view')(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const timeRange = (searchParams.get("timeRange") as TimeRange) || "month";
    
    const { start, end, chartUnit } = getDateRange(timeRange);
    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // ─── KPI Data (parallel) ───
    const [
      totalUsers,
      newInPeriod,
      totalMatches,
      pendingMatches,
      acceptedMatches,
      rejectedMatches,
      matchScoreAvg,
      activeSubscriptions,
      monthlyPlanCount,
      yearlyPlanCount,
      totalRevenue,
      periodRevenue,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: start, lte: end } } }),
      db.match.count({ where: { createdAt: { gte: start, lte: end } } }),
      db.match.count({ where: { status: "PENDING" } }),
      db.match.count({ where: { status: "ACCEPTED", createdAt: { gte: start, lte: end } } }),
      db.match.count({ where: { status: "REJECTED", createdAt: { gte: start, lte: end } } }),
      db.match.aggregate({ _avg: { matchScore: true } }),
      db.subscription.count({ where: { status: "ACTIVE" } }),
      db.subscription.count({ where: { status: "ACTIVE", plan: "PREMIUM_MONTHLY" } }),
      db.subscription.count({ where: { status: "ACTIVE", plan: "PREMIUM_YEARLY" } }),
      db.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amount: true } }),
      db.payment.aggregate({ where: { status: "SUCCEEDED", createdAt: { gte: start, lte: end } }, _sum: { amount: true } }),
    ]);

    // Activity metrics - period based
    const [messagesInPeriod, activeUsersInPeriod] = await Promise.all([
      db.message.count({ where: { createdAt: { gte: start, lte: end } } }),
      db.message.findMany({
        where: { createdAt: { gte: start, lte: end } },
        select: { senderId: true },
        distinct: ['senderId'],
      }).then(rows => rows.length),
    ]);

    // Previous period for comparison
    const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const prevStart = subDays(start, periodDays);
    const prevEnd = subDays(end, periodDays);
    
    const [newInPrevPeriod, revenueInPrevPeriod] = await Promise.all([
      db.user.count({ where: { createdAt: { gte: prevStart, lte: prevEnd } } }),
      db.payment.aggregate({ where: { status: "SUCCEEDED", createdAt: { gte: prevStart, lte: prevEnd } }, _sum: { amount: true } }),
    ]);

    // Calculate MRR
    const planPrices = { PREMIUM_MONTHLY: 29.99, PREMIUM_YEARLY: 199.99 / 12 };
    const mrr = (monthlyPlanCount * planPrices.PREMIUM_MONTHLY) + (yearlyPlanCount * planPrices.PREMIUM_YEARLY);

    // Calculate change percentage
    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? "+100%" : "0%";
      const change = ((current - previous) / previous) * 100;
      return change >= 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`;
    };

    const newUsersChange = calculateChange(newInPeriod, newInPrevPeriod);
    const revenueChange = calculateChange(periodRevenue._sum.amount || 0, revenueInPrevPeriod._sum.amount || 0);

    // ─── Chart Data ───
    let chartData: Array<{ date: string; count: number } | { month: string; revenue: number }>;
    
    if (chartUnit === "month") {
      // Year view: monthly revenue
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
      chartData = revenueTrend;
    } else {
      // Day/Week/Month view: daily user growth
      const days = eachDayOfInterval({ start, end });
      const dailyGrowthMap = new Map<string, number>();
      days.forEach(day => {
        dailyGrowthMap.set(day.toISOString().split("T")[0], 0);
      });
      
      const usersInRange = await db.user.findMany({
        where: { createdAt: { gte: start, lte: end } },
        select: { createdAt: true },
      });
      
      usersInRange.forEach((u: any) => {
        const key = u.createdAt.toISOString().split("T")[0];
        dailyGrowthMap.set(key, (dailyGrowthMap.get(key) || 0) + 1);
      });
      
      chartData = Array.from(dailyGrowthMap.entries()).map(([date, count]) => ({ date, count }));
    }

    // ─── Conversion Funnel (period-based) ───
    const [usersWithProfile, usersWithMessages, usersWithMatches] = await Promise.all([
      db.profile.count({ where: { profileStatus: "APPROVED" } }),
      db.message.findMany({ where: { createdAt: { gte: start, lte: end } }, select: { senderId: true }, distinct: ['senderId'] }).then(rows => rows.length),
      db.match.findMany({ where: { createdAt: { gte: start, lte: end } }, select: { senderId: true }, distinct: ['senderId'] }).then(rows => rows.length),
    ]);

    const funnel = [
      { stage: "注册用户", count: newInPeriod, pct: 100 },
      { stage: "发起匹配", count: usersWithMatches, pct: newInPeriod > 0 ? Math.round((usersWithMatches / newInPeriod) * 100) : 0 },
      { stage: "发送消息", count: usersWithMessages, pct: newInPeriod > 0 ? Math.round((usersWithMessages / newInPeriod) * 100) : 0 },
    ];

    // ─── Action Items ───
    const [recentAuditLogs, refundRequests, failedPayments, chatCount, totalMessages] = await Promise.all([
      db.auditLog?.count?.({ where: { createdAt: { gte: subDays(now, 7) } } }) ?? Promise.resolve(0),
      db.subscription.count({ where: { status: "CANCELLED" } }),
      db.payment.count({ where: { status: "FAILED" } }),
      db.chatRoom.count(),
      db.message.count(),
    ]);

    // ─── Health Board Data ───
    const userGrowthRate = totalUsers > 0 ? (newInPeriod / totalUsers) * 100 : 0;
    const avgMessagesPerChat = chatCount > 0 ? totalMessages / chatCount : 0;

    const periodLabels = { day: "今日", week: "本周", month: "本月", year: "本年" };

    const summary = {
      timeRange,
      periodLabel: periodLabels[timeRange],
      kpi: {
        totalUsers: { 
          value: newInPeriod, 
          change: newUsersChange, 
          trend: newInPeriod > newInPrevPeriod ? "up" : newInPeriod < newInPrevPeriod ? "down" : "neutral" as const,
          suffix: " 新用户"
        },
        dau: { 
          value: activeUsersInPeriod, 
          change: `${messagesInPeriod} 条消息`, 
          trend: activeUsersInPeriod > 0 ? "up" : "neutral" as const 
        },
        acceptanceRate: { 
          value: (acceptedMatches + rejectedMatches) > 0 
            ? Math.round((acceptedMatches / (acceptedMatches + rejectedMatches)) * 1000) / 10 
            : 0, 
          change: `${pendingMatches} 待处理`, 
          trend: acceptedMatches >= rejectedMatches ? "up" : "down" as const, 
          suffix: "%" 
        },
        mrr: { 
          value: Math.round(mrr * 100) / 100, 
          change: revenueChange,
          trend: (periodRevenue._sum.amount || 0) > 0 ? "up" : "neutral" as const, 
          prefix: "¥" 
        },
        pendingMatches: { 
          value: pendingMatches, 
          change: "需审核", 
          trend: pendingMatches > 20 ? "down" : pendingMatches > 0 ? "warning" : "up" as const 
        },
      },
      health: {
        operations: {
          label: "运营",
          status: pendingMatches > 20 ? "warning" : "good" as const,
          metrics: [
            { label: "用户增长", value: `${userGrowthRate.toFixed(1)}%` },
            { label: "新用户", value: String(newInPeriod) },
            { label: "活跃用户", value: String(activeUsersInPeriod) },
          ],
          href: "/admin/users",
        },
        product: {
          label: "产品",
          status: "good" as const,
          metrics: [
            { label: "平均匹配分", value: `${Math.round(matchScoreAvg._avg.matchScore || 0)}` },
            { label: "总匹配数", value: String(totalMatches) },
            { label: "待审核", value: String(pendingMatches) },
          ],
          href: "/admin/analytics",
        },
        tech: {
          label: "技术",
          status: recentAuditLogs > 0 ? "good" : "neutral" as const,
          metrics: [
            { label: "系统状态", value: "正常" },
            { label: "审计日志", value: `${recentAuditLogs} 条` },
            { label: "消息数", value: `${Math.round(avgMessagesPerChat * 10) / 10}/聊` },
          ],
          href: "/admin/settings",
        },
        marketing: {
          label: "市场",
          status: (periodRevenue._sum.amount || 0) > 0 ? "good" : "neutral" as const,
          metrics: [
            { label: "周期收入", value: `¥${Math.round((periodRevenue._sum.amount || 0) * 100) / 100}` },
            { label: "总收入", value: `¥${Math.round((totalRevenue._sum.amount || 0) * 100) / 100}` },
            { label: "订阅数", value: String(activeSubscriptions) },
          ],
          href: "/admin/marketing",
        },
      },
      actions: {
        pendingMatches,
        pendingContent: 0,
        refundRequests,
        failedPayments,
        recentAuditLogs,
        activeSubscriptions,
      },
      charts: {
        userGrowth: chartUnit === "month" ? [] : chartData as Array<{ date: string; count: number }>,
        revenueTrend: chartUnit === "month" ? chartData as Array<{ month: string; revenue: number }> : [],
      },
      funnel,
    };

    return success(summary);
  } catch (error: any) {
    console.error("Dashboard summary API error:", error);
    return serverError("加载仪表盘数据失败: " + (error.message || "未知错误"));
  }
});
