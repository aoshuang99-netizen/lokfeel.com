"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Users, Heart, MessageCircle, DollarSign, Clock,
  ArrowUpRight, ArrowDownRight, RefreshCw, ShieldAlert,
  BarChart3, TrendingUp, Activity, Zap, ArrowRight,
} from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard } from "@/components/admin/kpi-card";
import { HealthBoard } from "@/components/admin/health-board";
import { ActionItemsBar } from "@/components/admin/action-items-bar";

// ─── Light Theme Colors ───
const THEME = {
  primary: "#0071e3",
  success: "#34c759",
  warning: "#ff9500",
  danger: "#ff3b30",
  text: "#1d1d1f",
  textSecondary: "#6e6e73",
  textMuted: "#86868b",
  border: "#e5e5e7",
  bg: "#f5f5f7",
  card: "#ffffff",
};

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: `1px solid ${THEME.border}`,
  borderRadius: "8px",
  color: THEME.text,
  fontSize: "12px",
  padding: "8px 12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

interface DashboardSummary {
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
    recentAuditLogs: number;
    activeSubscriptions: number;
  };
  charts: {
    userGrowth: Array<{ date: string; count: number }>;
    revenueTrend: Array<{ month: string; revenue: number }>;
  };
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch("/api/admin/dashboard/summary", { signal: controller.signal, credentials: "include" });
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
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">仪表盘</h1>
          <p className="text-[#86868b] text-sm mt-1">数据概览与业务监控</p>
        </div>
        <div className="rounded-xl border border-[#e5e5e7] bg-white p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-[#ff3b3010] flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-7 h-7 text-[#ff3b30]" />
          </div>
          <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1.5">加载失败</h3>
          <p className="text-[#86868b] text-sm mb-5 max-w-md mx-auto">{error}</p>
          <button
            onClick={fetchSummary}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0071e3] text-white text-sm font-medium hover:bg-[#0077ed] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重试
          </button>
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">仪表盘</h1>
          <p className="text-[#86868b] text-sm mt-0.5">
            {lastUpdated ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
                实时 · 更新于 {lastUpdated}
              </span>
            ) : (
              "数据概览与业务监控"
            )}
          </p>
        </div>
        <button
          onClick={fetchSummary}
          disabled={loading}
          className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-[#e5e5e7] hover:border-[#0071e3]/30 transition-all duration-200 text-sm font-medium text-[#1d1d1f]"
        >
          <RefreshCw className={`w-4 h-4 text-[#86868b] group-hover:text-[#0071e3] transition-colors ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* ─── KPI Row ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {loading && !data ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[#e5e5e7] bg-white p-4">
              <Skeleton className="h-3 w-16 mb-3" />
              <Skeleton className="h-8 w-24 mb-2" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))
        ) : kpiData ? (
          <>
            <KpiCard
              label="总用户数"
              value={kpiData.totalUsers.value}
              change={kpiData.totalUsers.change}
              trend={kpiData.totalUsers.trend}
              icon={Users}
              href="/admin/users"
              sparkData={data?.charts.userGrowth.map((d) => d.count)}
            />
            <KpiCard
              label="日活跃用户"
              value={kpiData.dau.value}
              change={kpiData.dau.change}
              trend={kpiData.dau.trend}
              icon={Activity}
              href="/admin/analytics"
            />
            <KpiCard
              label="匹配接受率"
              value={kpiData.acceptanceRate.value}
              change={kpiData.acceptanceRate.change}
              trend={kpiData.acceptanceRate.trend}
              icon={Heart}
              href="/admin/matches"
              suffix="%"
            />
            <KpiCard
              label="月收入"
              value={kpiData.mrr.value}
              change={kpiData.mrr.change}
              trend={kpiData.mrr.trend}
              icon={DollarSign}
              href="/admin/subscriptions"
              prefix="¥"
            />
            <KpiCard
              label="待处理匹配"
              value={kpiData.pendingMatches.value}
              change={kpiData.pendingMatches.change}
              trend={kpiData.pendingMatches.trend}
              icon={Clock}
              href="/admin/matches"
            />
          </>
        ) : null}
      </div>

      {/* ─── Charts + Health Boards ─── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* User Growth Chart */}
        <div className="lg:col-span-2 rounded-xl border border-[#e5e5e7] bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#1d1d1f]">用户增长趋势</h2>
              <p className="text-xs text-[#86868b] mt-0.5">近30天新增用户</p>
            </div>
            <Link
              href="/admin/analytics"
              className="flex items-center gap-1 text-[11px] font-medium text-[#0071e3] hover:underline"
            >
              详情 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading && !data ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data?.charts.userGrowth}>
                <defs>
                  <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={THEME.primary} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={THEME.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="#e5e5e7" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke={THEME.textMuted}
                  fontSize={11}
                  interval="preserveStartEnd"
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis stroke={THEME.textMuted} fontSize={11} axisLine={false} tickLine={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "#e5e5e7", strokeDasharray: "4 4" }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={THEME.primary}
                  strokeWidth={2}
                  fill="url(#userGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: THEME.primary, stroke: "#fff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Health Boards */}
        <div className="rounded-xl border border-[#e5e5e7] bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#1d1d1f]">业务板块健康度</h2>
          </div>
          {loading && !data ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <HealthBoard boards={healthData} />
          )}
        </div>
      </div>

      {/* ─── Action Items ─── */}
      {data?.actions && (
        <ActionItemsBar items={data.actions} />
      )}

      {/* ─── Revenue Chart ─── */}
      <div className="rounded-xl border border-[#e5e5e7] bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[#1d1d1f]">收入趋势</h2>
            <p className="text-xs text-[#86868b] mt-0.5">近12个月</p>
          </div>
          <Link
            href="/admin/subscriptions"
            className="flex items-center gap-1 text-[11px] font-medium text-[#0071e3] hover:underline"
          >
            详情 <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {loading && !data ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data?.charts.revenueTrend} barCategoryGap="20%">
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={THEME.primary} />
                  <stop offset="100%" stopColor={THEME.primary} stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" stroke="#e5e5e7" vertical={false} />
              <XAxis
                dataKey="month"
                stroke={THEME.textMuted}
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis
                stroke={THEME.textMuted}
                fontSize={11}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v) => `¥${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "rgba(0,113,227,0.03)" }}
                formatter={(value) => [`¥${Number(value).toLocaleString()}`, "收入"]
                }
              />
              <Bar dataKey="revenue" fill="url(#revGrad)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
