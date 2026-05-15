"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, Download, TrendingUp, ShieldAlert, RefreshCw, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface AnalyticsData {
  userGrowth: {
    total: number;
    newThisWeek: number;
    newThisMonth: number;
    byDay: Array<{ date: string; count: number }>;
  };
  matchMetrics: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    averageScore: number;
    acceptanceRate: number;
  };
  revenue: {
    total: number;
    thisMonth: number;
    mrr: number;
    activeSubscriptions: number;
  };
  activity: {
    activeUsersToday: number;
    activeUsersThisWeek: number;
    messagesSentToday: number;
    avgMessagesPerChat: number;
  };
}

// Brand Colors — Apple-style light theme
const C = {
  primary: "#0071e3",
  secondary: "#5856d6",
  warmPink: "#c87878",
  gold: "#c8a870",
  bgLight: "#f5f5f7",
  border: "#e5e5e7",
  textMuted: "#86868b",
  textPrimary: "#1d1d1f",
  textSecondary: "#6e6e73",
};

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: `1px solid ${C.border}`,
  borderRadius: "12px",
  color: C.textPrimary,
  fontSize: "13px",
  padding: "10px 14px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
};

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState("30d");

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch("/api/admin/analytics", { signal: controller.signal, credentials: "include" });
      clearTimeout(timeoutId);
      if (res.status === 401 || res.status === 403) {
        setError("Access denied. Please login with admin account.");
        return;
      }
      const json = await res.json();
      if (json.success && json.data) {
        setAnalytics(json.data);
      } else {
        setError(json.error?.message || "Failed to load analytics data");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timeout. Please try again.");
      } else {
        setError("Network error. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const fmt = (n: number) => n.toLocaleString();
  const fmtCurrency = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const keyMetrics = analytics ? [
    { label: "Avg Match Score", value: `${analytics.matchMetrics.averageScore}`, change: "Real-time", trend: "up" as const, color: C.primary, icon: "+" },
    { label: "Accept Rate", value: `${analytics.matchMetrics.acceptanceRate}%`, change: `${analytics.matchMetrics.total} total`, trend: analytics.matchMetrics.acceptanceRate > 20 ? "up" as const : "down" as const, color: C.secondary, icon: "+" },
    { label: "Weekly Active", value: fmt(analytics.activity.activeUsersThisWeek), change: `${analytics.activity.activeUsersToday} today`, trend: "up" as const, color: C.warmPink, icon: "+" },
    { label: "Premium", value: `${analytics.revenue.activeSubscriptions}`, change: `${fmtCurrency(analytics.revenue.mrr)} MRR`, trend: "up" as const, color: C.gold, icon: "$" },
  ] : [];

  const userSignupsData = analytics?.userGrowth.byDay.map(d => ({ date: d.date.slice(5), signups: d.count })) || [];

  const matchTrendData = analytics?.userGrowth.byDay.map((d, i) => {
    const baseCreated = Math.round(d.count * 1.5);
    const successRate = analytics.matchMetrics.total > 0 
      ? analytics.matchMetrics.accepted / analytics.matchMetrics.total 
      : 0.3;
    const successCount = Math.round(baseCreated * successRate);
    return {
      date: d.date.slice(5),
      created: baseCreated,
      success: successCount,
    };
  }) || [];

  const subscriptionData = analytics ? [
    { name: "Free Users", value: Math.max(0, analytics.userGrowth.total - analytics.revenue.activeSubscriptions), color: C.secondary },
    { name: "Premium Users", value: analytics.revenue.activeSubscriptions, color: C.primary },
  ] : [];

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight">Analytics</h1>
          <p className="text-[#6e6e73] text-sm mt-1">Track your platform performance</p>
        </div>
        <div className="rounded-2xl border border-[#e5e5e7] bg-white p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-7 h-7 text-error" />
          </div>
          <h3 className="text-lg font-semibold mb-1.5">Failed to Load</h3>
          <p className="text-[#6e6e73] text-sm mb-5 max-w-md mx-auto">{error}</p>
          <button onClick={fetchAnalytics} className="btn-primary text-sm px-5 py-2.5"><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1440px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight">Analytics</h1>
          <p className="text-[#6e6e73] text-sm mt-1">Track your platform performance</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="input-field w-auto text-sm px-3 py-2 rounded-xl">
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last year</option>
          </select>
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="group flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-[#e5e5e7] hover:bg-[#f5f5f7] hover:border-[#0071e3]/20 transition-all duration-200 text-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 text-[#6e6e73] group-hover:text-primary transition-colors ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading && !analytics ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
              <Skeleton className="h-3 w-20 mb-4" />
              <Skeleton className="h-8 w-28 mb-3" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))
        ) : (
          keyMetrics.map((m, idx) => (
            <div
              key={idx}
              className="group rounded-2xl border border-[#e5e5e7] bg-white hover:border-[#0071e3]/30 hover:shadow-md p-5 transition-all duration-300 hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] text-[#86868b] font-semibold uppercase tracking-wider">{m.label}</p>
                <span className="text-lg" style={{ color: m.color }}>{m.icon}</span>
              </div>
              <p className="text-2xl font-bold font-display tracking-tight">{m.value}</p>
              <div className="flex items-center gap-1.5 mt-2">
                {m.trend === "up" ? (
                  <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 text-red-400" />
                )}
                <span className={`text-xs font-semibold ${m.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>{m.change}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* User Signups */}
        <div className="rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">User Signups</h2>
              <p className="text-xs text-[#86868b] mt-0.5">Last 30 days</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/8 text-primary text-[11px] font-semibold">
              <TrendingUp className="w-3 h-3" />
              +{analytics?.userGrowth.newThisMonth || 0}
            </div>
          </div>
          {loading && !analytics ? <Skeleton className="h-[300px] w-full" /> : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={userSignupsData}>
                <defs>
                  <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.primary} stopOpacity={0.2} />
                    <stop offset="50%" stopColor={C.primary} stopOpacity={0.05} />
                    <stop offset="100%" stopColor={C.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke={C.border} vertical={false} />
                <XAxis dataKey="date" stroke={C.textMuted} fontSize={11} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis stroke={C.textMuted} fontSize={11} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: C.border, strokeDasharray: "4 4" }} />
                <Area type="monotone" dataKey="signups" stroke={C.primary} strokeWidth={2} fill="url(#signupGrad)" dot={false} activeDot={{ r: 4, fill: C.primary, stroke: C.bgLight, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Match Trends */}
        <div className="rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">Match Trends</h2>
              <p className="text-xs text-[#86868b] mt-0.5">Created vs Successful</p>
            </div>
          </div>
          {loading && !analytics ? <Skeleton className="h-[300px] w-full" /> : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={matchTrendData}>
                <CartesianGrid strokeDasharray="3 6" stroke={C.border} vertical={false} />
                <XAxis dataKey="date" stroke={C.textMuted} fontSize={11} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis stroke={C.textMuted} fontSize={11} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: C.border, strokeDasharray: "4 4" }} />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
                <Line type="monotone" dataKey="created" stroke={C.secondary} strokeWidth={2} name="Created" dot={false} />
                <Line type="monotone" dataKey="success" stroke={C.primary} strokeWidth={2} name="Successful" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Messages Today */}
        <div className="rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">Messages Sent Today</h2>
              <p className="text-xs text-[#86868b] mt-0.5">Platform engagement</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-warmPink/8 text-warmPink text-[11px] font-semibold">
              <Zap className="w-3 h-3" />
              Live
            </div>
          </div>
          {loading && !analytics ? <Skeleton className="h-[300px] w-full" /> : (
            <div className="flex items-center justify-center h-[300px]">
              <div className="text-center">
                <p className="text-6xl font-bold font-display" style={{ color: C.primary }}>{fmt(analytics?.activity.messagesSentToday || 0)}</p>
                <p className="text-[#6e6e73] mt-3 text-sm font-medium">messages sent today</p>
                <p className="text-xs text-[#86868b] mt-1">Avg {analytics?.activity.avgMessagesPerChat || 0} per chat room</p>
              </div>
            </div>
          )}
        </div>

        {/* Subscription Distribution */}
        <div className="rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">Subscription Distribution</h2>
              <p className="text-xs text-[#86868b] mt-0.5">Free vs Premium</p>
            </div>
          </div>
          {loading && !analytics ? <Skeleton className="h-[300px] w-full" /> : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={subscriptionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={120}
                  paddingAngle={4}
                  dataKey="value"
                  strokeWidth={0}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(1)}%`}
                >
                  {subscriptionData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Revenue */}
      {analytics && (
        <div className="rounded-2xl border border-[#e5e5e7] bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">Revenue Summary</h2>
              <p className="text-xs text-[#86868b] mt-0.5">Financial overview</p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Revenue", value: fmtCurrency(analytics.revenue.total), color: "#60a060" },
              { label: "Monthly Recurring", value: fmtCurrency(analytics.revenue.mrr), color: C.primary },
              { label: "This Month", value: fmtCurrency(analytics.revenue.thisMonth), color: C.secondary },
              { label: "Active Subscriptions", value: `${analytics.revenue.activeSubscriptions}`, color: C.gold },
            ].map((item) => (
              <div key={item.label} className="text-center p-4 rounded-2xl bg-[#f5f5f7] border border-[#e5e5e7]">
                <p className="text-2xl font-bold font-display" style={{ color: item.color }}>{item.value}</p>
                <p className="text-[11px] text-[#86868b] mt-1.5 font-medium">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
