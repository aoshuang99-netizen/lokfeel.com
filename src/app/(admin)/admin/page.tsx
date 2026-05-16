"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Users, Heart, DollarSign, Clock, Activity,
  ArrowRight, RefreshCw, ShieldAlert, BarChart3,
  TrendingUp, ArrowUpRight, Settings, Bell, Eye,
  UserCheck, MessageSquare, CreditCard
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthBoard } from "@/components/admin/health-board";
import { ConversionFunnel } from "@/components/admin/conversion-funnel";
import { TimeRangeSelector, type TimeRange } from "@/components/admin/time-range-selector";

// ─── Dark Theme Colors (方案C风格) ───
const THEME = {
  bg: "#09090b",
  bgElevated: "#18181b",
  bgCard: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.08)",
  borderHover: "rgba(255,255,255,0.15)",
  text: "#fafafa",
  textSecondary: "#a1a1aa",
  textMuted: "#71717a",
  primary: "#3b82f6",
  primaryHover: "#2563eb",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  purple: "#a855f7",
};

// Tooltip style for dark theme
const tooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#fafafa",
  fontSize: "12px",
  padding: "10px 14px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
};

interface DashboardSummary {
  timeRange: TimeRange;
  periodLabel: string;
  kpi: {
    totalUsers: { value: number; change: string; trend: "up" | "down" | "warning" | "neutral"; suffix?: string };
    dau: { value: number; change: string; trend: "up" | "down" | "warning" | "neutral"; suffix?: string };
    acceptanceRate: { value: number; change: string; trend: "up" | "down" | "warning" | "neutral"; suffix?: string };
    mrr: { value: number; change: string; trend: "up" | "down" | "warning" | "neutral"; prefix?: string; suffix?: string };
    pendingMatches: { value: number; change: string; trend: "up" | "down" | "warning" | "neutral"; suffix?: string };
  };
  health: {
    operations: { label: string; status: "good" | "warning" | "critical" | "neutral"; metrics: Array<{ label: string; value: string }>; href: string };
    product: { label: string; status: "good" | "warning" | "critical" | "neutral"; metrics: Array<{ label: string; value: string }>; href: string };
    tech: { label: string; status: "good" | "warning" | "critical" | "neutral"; metrics: Array<{ label: string; value: string }>; href: string };
    marketing: { label: string; status: "good" | "warning" | "critical" | "neutral"; metrics: Array<{ label: string; value: string }>; href: string };
  };
  actions: {
    pendingMatches: number;
    pendingContent: number;
    refundRequests: number;
    failedPayments: number;
    recentAuditLogs: number;
    activeSubscriptions: number;
  };
  charts: {
    userGrowth: Array<{ date: string; count: number }>;
    revenueTrend: Array<{ month: string; revenue: number }>;
  };
  funnel: Array<{ stage: string; count: number; pct: number }>;
}

// ─── KPI Card Component ───
function KpiCardDark({
  label, value, change, trend, icon: Icon, href, prefix, suffix, sparkData
}: {
  label: string;
  value: number;
  change: string;
  trend: "up" | "down" | "warning" | "neutral";
  icon: any;
  href: string;
  prefix?: string;
  suffix?: string;
  sparkData?: number[];
}) {
  const trendColors = {
    up: "text-emerald-400",
    down: "text-red-400",
    warning: "text-amber-400",
    neutral: "text-zinc-400",
  };

  const iconBgColors: Record<string, string> = {
    up: "bg-emerald-500/15",
    down: "bg-red-500/15",
    warning: "bg-amber-500/15",
    neutral: "bg-zinc-500/15",
  };

  const iconColors: Record<string, string> = {
    Users: "text-blue-400",
    Activity: "text-emerald-400",
    Heart: "text-amber-400",
    DollarSign: "text-emerald-400",
    Clock: "text-red-400",
  };

  return (
    <Link href={href} className="block">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 backdrop-blur-sm hover:border-zinc-700/50 transition-all duration-200 group">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium text-zinc-500">{label}</span>
          <div className={`w-10 h-10 rounded-xl ${iconBgColors[trend]} flex items-center justify-center`}>
            <Icon className={`w-5 h-5 ${iconColors[Icon.name] || "text-zinc-400"}`} />
          </div>
        </div>
        <div className="text-3xl font-bold text-white mb-1.5 tracking-tight">
          {prefix}{typeof value === "number" ? value.toLocaleString() : value}{suffix}
        </div>
        <div className={`text-xs font-medium ${trendColors[trend]} flex items-center gap-1`}>
          {trend === "up" ? <ArrowUpRight className="w-3.5 h-3.5" /> : null}
          {change}
        </div>
        {sparkData && sparkData.length > 0 && (
          <div className="mt-4 h-10">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData.map((v, i) => ({ value: v }))}>
                <defs>
                  <linearGradient id={`sparkGrad-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={THEME.primary} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={THEME.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={THEME.primary}
                  strokeWidth={2}
                  fill={`url(#sparkGrad-${label})`}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── User Source Data ───
const userSourceData = [
  { name: "自然流量", value: 42, color: "#3b82f6" },
  { name: "推荐", value: 28, color: "#22c55e" },
  { name: "广告投放", value: 18, color: "#f59e0b" },
  { name: "社交媒体", value: 12, color: "#a855f7" },
];

// ─── Activity Radar Data ───
const activityRadarData = [
  { time: "0-3时", value: 15 },
  { time: "3-6时", value: 8 },
  { time: "6-9时", value: 25 },
  { time: "9-12时", value: 65 },
  { time: "12-15时", value: 45 },
  { time: "15-18时", value: 70 },
  { time: "18-21时", value: 90 },
  { time: "21-24时", value: 75 },
];

// ─── Match Type Data ───
const matchTypeData = [
  { type: "性格匹配", value: 85 },
  { type: "兴趣匹配", value: 72 },
  { type: "价值观匹配", value: 65 },
  { type: "生活方式", value: 45 },
  { type: "职业背景", value: 38 },
];

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [timeRange, setTimeRange] = useState<TimeRange>("month");

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`/api/admin/dashboard/summary?timeRange=${timeRange}`, { signal: controller.signal, credentials: "include" });
      clearTimeout(timeoutId);

      if (res.status === 401 || res.status === 403) {
        setError("访问被拒绝，请使用管理员账号登录");
        return;
      }
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        setLastUpdated(new Date().toLocaleTimeString("zh-CN"));
      } else {
        setError(json.error?.message || "加载数据失败");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("请求超时，请重试");
      } else {
        setError("网络错误，请检查连接");
      }
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const periodLabel = data?.periodLabel || "本月";

  if (error) {
    return (
      <div className="min-h-screen bg-[#09090b] p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white">仪表盘</h1>
              <p className="text-zinc-500 text-sm mt-1">数据概览与业务监控</p>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center backdrop-blur-sm">
            <div className="w-14 h-14 rounded-xl bg-red-500/15 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-7 h-7 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-1.5">加载失败</h3>
            <p className="text-zinc-400 text-sm mb-5 max-w-md mx-auto">{error}</p>
            <button
              onClick={fetchSummary}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  const kpiData = data?.kpi;
  const healthData = data ? [
    data.health.operations,
    data.health.product,
    data.health.tech,
    data.health.marketing,
  ] : [];

  return (
    <div className="min-h-screen bg-[#09090b] p-4 lg:p-6 space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">仪表盘</h1>
          <p className="text-zinc-500 text-sm mt-0.5 flex items-center gap-2">
            {lastUpdated ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {periodLabel} · 更新于 {lastUpdated}
              </>
            ) : (
              "数据概览与业务监控"
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          <button
            onClick={fetchSummary}
            disabled={loading}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600 transition-all duration-200 text-sm font-medium text-zinc-300"
          >
            <RefreshCw className={`w-4 h-4 text-zinc-500 group-hover:text-blue-400 transition-colors ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {loading && !data ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <Skeleton className="h-3 w-16 mb-4" />
              <Skeleton className="h-8 w-24 mb-2" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))
        ) : kpiData ? (
          <>
            <KpiCardDark
              label={`${periodLabel}新用户`}
              value={kpiData.totalUsers.value}
              change={kpiData.totalUsers.change}
              trend={kpiData.totalUsers.trend}
              icon={Users}
              href="/admin/users"
              sparkData={data?.charts.userGrowth.map((d) => d.count)}
            />
            <KpiCardDark
              label={`${periodLabel}活跃用户`}
              value={kpiData.dau.value}
              change={kpiData.dau.change}
              trend={kpiData.dau.trend}
              icon={Activity}
              href="/admin/analytics"
              sparkData={data?.charts.userGrowth.map((d) => d.count * 0.7)}
            />
            <KpiCardDark
              label="匹配接受率"
              value={kpiData.acceptanceRate.value}
              change={kpiData.acceptanceRate.change}
              trend={kpiData.acceptanceRate.trend}
              icon={Heart}
              href="/admin/matches"
              suffix="%"
            />
            <KpiCardDark
              label={`${periodLabel}收入`}
              value={kpiData.mrr.value}
              change={kpiData.mrr.change}
              trend={kpiData.mrr.trend}
              icon={DollarSign}
              href="/admin/subscriptions"
              prefix="¥"
              sparkData={data?.charts.revenueTrend.map((d) => d.revenue)}
            />
            <KpiCardDark
              label="待审核匹配"
              value={kpiData.pendingMatches.value}
              change={kpiData.pendingMatches.change}
              trend={kpiData.pendingMatches.trend}
              icon={Clock}
              href="/admin/matches"
            />
          </>
        ) : null}
      </div>

      {/* ─── Charts Grid ─── */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* User Growth Trend - Line Chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">{periodLabel}用户增长</h2>
              <p className="text-xs text-zinc-500 mt-0.5">每日新增用户趋势 · 折线图</p>
            </div>
            <Link href="/admin/analytics" className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:underline">
              详情 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading && !data ? (
            <Skeleton className="h-[260px] w-full rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data?.charts.userGrowth}>
                <defs>
                  <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#71717a"
                  fontSize={11}
                  interval="preserveStartEnd"
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis stroke="#71717a" fontSize={11} axisLine={false} tickLine={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.1)", strokeDasharray: "4 4" }} />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2.5} fill="url(#lineGrad)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Revenue Trend - Area Chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">{periodLabel}收入趋势</h2>
              <p className="text-xs text-zinc-500 mt-0.5">月度收入走势 · 面积图</p>
            </div>
            <Link href="/admin/subscriptions" className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:underline">
              详情 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading && !data ? (
            <Skeleton className="h-[260px] w-full rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data?.charts.revenueTrend}>
                <defs>
                  <linearGradient id="revAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="month" stroke="#71717a" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
                <YAxis stroke="#71717a" fontSize={11} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `¥${(v / 1000).toFixed(1)}k` : `¥${v}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`¥${Number(value).toLocaleString()}`, "收入"]} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />
                <Area type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2.5} fill="url(#revAreaGrad)" dot={{ fill: "#22c55e", strokeWidth: 2, stroke: "#18181b" }} activeDot={{ r: 5, fill: "#22c55e", stroke: "#18181b", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* User Source Distribution - Pie Chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">用户来源分布</h2>
              <p className="text-xs text-zinc-500 mt-0.5">渠道构成 · 环形图</p>
            </div>
          </div>
          <div className="flex items-center">
            <div className="relative w-48 h-48 mx-auto">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={userSourceData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                    {userSourceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-white">12.3K</span>
                <span className="text-xs text-zinc-500">总用户</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 ml-4">
              {userSourceData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-xs text-zinc-400">{item.name}</span>
                  <span className="text-xs font-medium text-white ml-auto">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Activity Radar - Radar Chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">用户活跃时段</h2>
              <p className="text-xs text-zinc-500 mt-0.5">24小时分布 · 雷达图</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={activityRadarData}>
              <PolarGrid stroke="rgba(255,255,255,0.1)" />
              <PolarAngleAxis dataKey="time" tick={{ fill: "#71717a", fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#71717a", fontSize: 9 }} />
              <Radar name="活跃度" dataKey="value" stroke="#a855f7" fill="#a855f7" fillOpacity={0.2} strokeWidth={2} />
              <Tooltip contentStyle={tooltipStyle} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Match Types - Horizontal Bar */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">匹配类型分布</h2>
              <p className="text-xs text-zinc-500 mt-0.5">各类型占比 · 条形图</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={matchTypeData} layout="vertical" barSize={16}>
              <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="type" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, "占比"]} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {[...matchTypeData].reverse().map((_, index) => (
                  <Cell key={`cell-${index}`} fill={["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ef4444"][index]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Conversion Funnel */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">用户转化漏斗</h2>
              <p className="text-xs text-zinc-500 mt-0.5">注册到付费 · 漏斗图</p>
            </div>
          </div>
          {data?.funnel && data.funnel.length > 0 && (
            <ConversionFunnel stages={data.funnel} />
          )}
        </div>
      </div>

      {/* ─── Health Boards ─── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
        <h2 className="text-sm font-semibold text-white mb-4">业务板块健康度</h2>
        {loading && !data ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <HealthBoard boards={healthData} />
        )}
      </div>

      {/* ─── Action Items ─── */}
      {data?.actions && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">待处理事项</h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {data.actions.pendingMatches > 0 && (
              <Link href="/admin/matches" className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600/50 transition-all group">
                <div className="w-10 h-10 rounded-lg bg-red-500/15 flex items-center justify-center">
                  <Heart className="w-5 h-5 text-red-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{data.actions.pendingMatches}</p>
                  <p className="text-xs text-zinc-500">待审核匹配</p>
                </div>
              </Link>
            )}
            {data.actions.pendingContent > 0 && (
              <Link href="/admin/content" className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600/50 transition-all group">
                <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Eye className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{data.actions.pendingContent}</p>
                  <p className="text-xs text-zinc-500">待审核内容</p>
                </div>
              </Link>
            )}
            {data.actions.refundRequests > 0 && (
              <Link href="/admin/subscriptions" className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600/50 transition-all group">
                <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{data.actions.refundRequests}</p>
                  <p className="text-xs text-zinc-500">退款申请</p>
                </div>
              </Link>
            )}
            {data.actions.failedPayments > 0 && (
              <Link href="/admin/subscriptions" className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600/50 transition-all group">
                <div className="w-10 h-10 rounded-lg bg-red-500/15 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-red-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{data.actions.failedPayments}</p>
                  <p className="text-xs text-zinc-500">失败支付</p>
                </div>
              </Link>
            )}
            {data.actions.recentAuditLogs > 0 && (
              <Link href="/admin/audit" className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600/50 transition-all group">
                <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{data.actions.recentAuditLogs}</p>
                  <p className="text-xs text-zinc-500">审计日志</p>
                </div>
              </Link>
            )}
            {data.actions.activeSubscriptions > 0 && (
              <Link href="/admin/subscriptions" className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600/50 transition-all group">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <UserCheck className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">{data.actions.activeSubscriptions}</p>
                  <p className="text-xs text-zinc-500">活跃订阅</p>
                </div>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ─── Quick Actions ─── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
        <h2 className="text-sm font-semibold text-white mb-4">快捷操作</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href="/admin/users" className="flex items-center gap-3 p-3.5 rounded-lg border border-zinc-700/30 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">用户管理</p>
              <p className="text-xs text-zinc-500">查看和管理用户</p>
            </div>
          </Link>
          <Link href="/admin/matches" className="flex items-center gap-3 p-3.5 rounded-lg border border-zinc-700/30 hover:border-purple-500/30 hover:bg-purple-500/5 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
              <Heart className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-purple-400 transition-colors">匹配管理</p>
              <p className="text-xs text-zinc-500">审核和管理匹配</p>
            </div>
          </Link>
          <Link href="/admin/subscriptions" className="flex items-center gap-3 p-3.5 rounded-lg border border-zinc-700/30 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-emerald-400 transition-colors">订阅管理</p>
              <p className="text-xs text-zinc-500">管理订阅和收入</p>
            </div>
          </Link>
          <Link href="/admin/settings" className="flex items-center gap-3 p-3.5 rounded-lg border border-zinc-700/30 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
              <Settings className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-amber-400 transition-colors">系统设置</p>
              <p className="text-xs text-zinc-500">配置平台参数</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
