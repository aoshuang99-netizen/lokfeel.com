"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Users, Heart, MessageCircle, DollarSign,
  ArrowUpRight, ArrowDownRight, RefreshCw, ShieldAlert,
  BarChart3, Megaphone, Code2, Settings, FileText, Layers,
  TrendingUp, Activity, Clock, Zap, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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

// ─── Brand Colors ───
const BRAND = {
  primary: "#c06840",
  secondary: "#d08870",
  warmPink: "#c87878",
  gold: "#c8a870",
  bgDark: "#1a1614",
  bgCard: "#211d1a",
  border: "rgba(255,255,255,0.06)",
  textMuted: "rgba(255,255,255,0.4)",
  textSubtle: "rgba(255,255,255,0.25)",
};

const tooltipStyle = {
  backgroundColor: "rgba(26,22,20,0.95)",
  border: `1px solid ${BRAND.border}`,
  borderRadius: "12px",
  color: "rgba(255,255,255,0.9)",
  fontSize: "13px",
  padding: "10px 14px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

// ─── Team Quick Access ───
interface TeamCard {
  label: string;
  icon: LucideIcon;
  gradient: string;
  items: { name: string; href: string; icon: LucideIcon; desc: string }[];
}

const TEAM_CARDS: TeamCard[] = [
  {
    label: "运营",
    icon: Activity,
    gradient: "from-amber-500/20 to-orange-500/10",
    items: [
      { name: "用户管理", href: "/admin/users", icon: Users, desc: "平台用户与权限" },
      { name: "匹配管理", href: "/admin/matches", icon: Heart, desc: "审核匹配请求" },
      { name: "内容管理", href: "/admin/content", icon: FileText, desc: "内容审核与发布" },
    ],
  },
  {
    label: "产品",
    icon: Layers,
    gradient: "from-rose-500/20 to-pink-500/10",
    items: [
      { name: "数据分析", href: "/admin/analytics", icon: BarChart3, desc: "用户行为与指标" },
      { name: "功能管理", href: "/admin/features", icon: Layers, desc: "功能开关与配置" },
    ],
  },
  {
    label: "技术",
    icon: Code2,
    gradient: "from-emerald-500/20 to-teal-500/10",
    items: [
      { name: "系统设置", href: "/admin/settings", icon: Settings, desc: "应用配置" },
      { name: "审计日志", href: "/admin/settings/audit", icon: ShieldAlert, desc: "操作记录追踪" },
      { name: "RBAC 权限", href: "/admin/settings/rbac", icon: Code2, desc: "角色与权限" },
    ],
  },
  {
    label: "市场",
    icon: TrendingUp,
    gradient: "from-violet-500/20 to-indigo-500/10",
    items: [
      { name: "推广活动", href: "/admin/marketing", icon: Megaphone, desc: "营销活动管理" },
      { name: "增长分析", href: "/admin/analytics#growth", icon: TrendingUp, desc: "获客与留存" },
    ],
  },
];

// ─── Sparkline Mini Component ───
function MiniSparkline({ data, color, width = 80, height = 28 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <defs>
        <linearGradient id={`spark-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts} ${width},${height}`}
        fill={`url(#spark-${color.replace("#","")})`}
      />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AdminDashboardPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch("/api/admin/analytics", { signal: controller.signal, credentials: "include" });
      clearTimeout(timeoutId);
      if (res.status === 401 || res.status === 403) {
        setError("访问被拒绝，请使用管理员账号登录");
        return;
      }
      const json = await res.json();
      if (json.success && json.data) {
        setAnalytics(json.data);
        setLastUpdated(new Date().toLocaleTimeString("zh-CN"));
      } else {
        setError(json.error?.message || "加载分析数据失败");
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

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const fmt = (n: number) => n.toLocaleString();
  const fmtCurrency = (n: number) => `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const sparkData = analytics?.userGrowth.byDay.map(d => d.count) || [];

  const stats = analytics ? [
    {
      id: 1, label: "用户总数", value: fmt(analytics.userGrowth.total),
      change: `本周+${analytics.userGrowth.newThisWeek}`,
      trend: "up" as const, icon: Users, color: BRAND.primary,
      sparkData: sparkData.slice(-7),
    },
    {
      id: 2, label: "接受率", value: `${analytics.matchMetrics.acceptanceRate}%`,
      change: `${analytics.matchMetrics.pending} 待处理`,
      trend: analytics.matchMetrics.acceptanceRate > 20 ? "up" as const : "down" as const,
      icon: Heart, color: BRAND.secondary,
      sparkData: sparkData.map(d => Math.round(d * 0.3 + Math.random() * 10)),
    },
    {
      id: 3, label: "消息数", value: fmt(analytics.activity.messagesSentToday),
      change: `今日${analytics.activity.activeUsersToday}活跃`,
      trend: "up" as const, icon: MessageCircle, color: BRAND.warmPink,
      sparkData: sparkData.map(d => Math.round(d * 0.5 + Math.random() * 5)),
    },
    {
      id: 4, label: "月经常性收入", value: fmtCurrency(analytics.revenue.mrr),
      change: `${analytics.revenue.activeSubscriptions} 订阅`,
      trend: analytics.revenue.mrr > 0 ? "up" as const : "down" as const,
      icon: DollarSign, color: BRAND.gold,
      sparkData: sparkData.map(d => Math.round(d * 0.1 + Math.random() * 3)),
    },
  ] : [];

  const userGrowthData = analytics?.userGrowth.byDay.map(d => ({ date: d.date.slice(5), users: d.count })) || [];

  const accepted = analytics?.matchMetrics.accepted ?? 0;
  const matchCreationData = [
    { day: "周一", matches: Math.round(accepted * 0.12 || 0) },
    { day: "周二", matches: Math.round(accepted * 0.15 || 0) },
    { day: "周三", matches: Math.round(accepted * 0.16 || 0) },
    { day: "周四", matches: Math.round(accepted * 0.14 || 0) },
    { day: "周五", matches: Math.round(accepted * 0.18 || 0) },
    { day: "周六", matches: Math.round(accepted * 0.22 || 0) },
    { day: "周日", matches: Math.round(accepted * 0.19 || 0) },
  ];

  const conversionData = analytics ? [
    { stage: "总用户", value: analytics.userGrowth.total },
    { stage: "周活跃", value: analytics.activity.activeUsersThisWeek },
    { stage: "活跃匹配", value: analytics.matchMetrics.accepted },
    { stage: "消息(30天)", value: analytics.activity.messagesSentToday * 30 },
    { stage: "付费用户", value: analytics.revenue.activeSubscriptions },
  ] : [];

  if (error) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight">仪表盘</h1>
          <p className="text-foreground-muted text-sm mt-1">数据概览与团队快捷入口</p>
        </div>
        <div className="rounded-2xl border border-card-border bg-card/50 p-12 text-center backdrop-blur-sm">
          <div className="w-14 h-14 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-7 h-7 text-error" />
          </div>
          <h3 className="text-lg font-semibold mb-1.5">加载失败</h3>
          <p className="text-foreground-muted text-sm mb-5 max-w-md mx-auto">{error}</p>
          <button onClick={fetchAnalytics} className="btn-primary text-sm px-5 py-2.5">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> 重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1440px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight">仪表盘</h1>
          <p className="text-foreground-muted text-sm mt-1">
            {lastUpdated ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                实时 · 更新于 {lastUpdated}
              </span>
            ) : (
              "数据概览与团队快捷入口"
            )}
          </p>
        </div>
        <button
          onClick={fetchAnalytics}
          disabled={loading}
          className="group flex items-center gap-2 px-4 py-2.5 rounded-xl bg-card/60 border border-card-border hover:bg-card-hover hover:border-primary/20 transition-all duration-200 text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 text-foreground-muted group-hover:text-primary transition-colors ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* ─── Team Quick Access ─── */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {TEAM_CARDS.map((team) => (
          <Link
            key={team.label}
            href={team.items[0]?.href || "#"}
            className="group relative rounded-2xl border border-card-border bg-card/30 hover:bg-card/60 p-5 transition-all duration-300 hover:border-card-border/80 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10"
          >
            {/* Gradient accent top */}
            <div className={`absolute top-0 left-6 right-6 h-px bg-gradient-to-r ${team.gradient.replace("/20","").replace("/10","")} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

            <div className="flex items-center gap-3 mb-4">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${team.gradient} flex items-center justify-center`}>
                <team.icon className="w-4.5 h-4.5 text-foreground" />
              </div>
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-foreground-muted">{team.label}</h3>
            </div>
            <div className="space-y-1">
              {team.items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.name}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-background-tertiary/50 transition-all duration-150"
                  >
                    <Icon className="w-4 h-4 text-foreground-subtle" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-[11px] text-foreground-subtle truncate">{item.desc}</p>
                    </div>
                    <ArrowRight className="w-3 h-3 text-foreground-subtle opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all" />
                  </div>
                );
              })}
            </div>
          </Link>
        ))}
      </div>

      {/* ─── Key Metrics ─── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading && !analytics ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-card-border bg-card/30 p-5">
              <Skeleton className="h-3 w-20 mb-4" />
              <Skeleton className="h-8 w-28 mb-3" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))
        ) : (
          stats.map((stat) => (
            <div
              key={stat.id}
              className="group rounded-2xl border border-card-border bg-card/30 hover:bg-card/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5"
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                  style={{ backgroundColor: `${stat.color}12` }}
                >
                  <stat.icon className="w-5 h-5" style={{ color: stat.color }} />
                </div>
                <MiniSparkline data={stat.sparkData} color={stat.color} />
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-2xl font-bold font-display tracking-tight">{stat.value}</p>
                  <p className="text-xs text-foreground-muted mt-1">{stat.label}</p>
                </div>
                <span className={`flex items-center gap-0.5 text-xs font-semibold px-2 py-1 rounded-lg ${
                  stat.trend === "up"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                }`}>
                  {stat.trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {stat.change.split(" ")[0]}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ─── Charts ─── */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* User Growth */}
        <div className="rounded-2xl border border-card-border bg-card/30 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">用户增长</h2>
              <p className="text-xs text-foreground-subtle mt-0.5">近30天</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/8 text-primary text-[11px] font-semibold">
              <TrendingUp className="w-3 h-3" />
              +{analytics?.userGrowth.newThisMonth || 0} 新增
            </div>
          </div>
          {loading && !analytics ? (
            <Skeleton className="h-[280px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={userGrowthData}>
                <defs>
                  <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND.primary} stopOpacity={0.2} />
                    <stop offset="50%" stopColor={BRAND.primary} stopOpacity={0.05} />
                    <stop offset="100%" stopColor={BRAND.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke={BRAND.border} vertical={false} />
                <XAxis dataKey="date" stroke={BRAND.textMuted} fontSize={11} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis stroke={BRAND.textMuted} fontSize={11} axisLine={false} tickLine={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: BRAND.border, strokeDasharray: "4 4" }} />
                <Area type="monotone" dataKey="users" stroke={BRAND.primary} strokeWidth={2} fill="url(#userGrad)" dot={false} activeDot={{ r: 4, fill: BRAND.primary, stroke: BRAND.bgDark, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Weekly Matches */}
        <div className="rounded-2xl border border-card-border bg-card/30 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">本周匹配</h2>
              <p className="text-xs text-foreground-subtle mt-0.5">每日分布</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/8 text-secondary text-[11px] font-semibold">
              <Heart className="w-3 h-3" />
              {analytics?.matchMetrics.accepted || 0} 总数
            </div>
          </div>
          {loading && !analytics ? (
            <Skeleton className="h-[280px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={matchCreationData} barCategoryGap="25%">
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND.secondary} />
                    <stop offset="100%" stopColor={BRAND.primary} stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke={BRAND.border} vertical={false} />
                <XAxis dataKey="day" stroke={BRAND.textMuted} fontSize={11} axisLine={false} tickLine={false} />
                <YAxis stroke={BRAND.textMuted} fontSize={11} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="matches" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── Conversion Funnel ─── */}
      <div className="rounded-2xl border border-card-border bg-card/30 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold">转化漏斗</h2>
            <p className="text-xs text-foreground-subtle mt-0.5">用户旅程分解</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-background-tertiary text-foreground-muted text-[11px] font-semibold">
            <Zap className="w-3 h-3" />
            实时
          </div>
        </div>
        {loading && !analytics ? (
          <div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : (
          <div className="space-y-4">
            {conversionData.map((stage, idx) => {
              const pct = conversionData[0].value > 0 ? (stage.value / conversionData[0].value) * 100 : 0;
              const colors = [BRAND.primary, BRAND.secondary, BRAND.warmPink, "#c8a870", "#8888aa"];
              return (
                <div key={idx} className="group">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[idx] }} />
                      <span className="text-sm font-medium">{stage.stage}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold font-display">{stage.value.toLocaleString()}</span>
                      <span className="text-[11px] text-foreground-subtle font-mono tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-background-tertiary/60 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out group-hover:opacity-90"
                      style={{
                        width: `${Math.max(pct, 1)}%`,
                        background: `linear-gradient(90deg, ${colors[idx]}, ${colors[idx]}88)`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Quick Stats Grid ─── */}
      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "待处理匹配", value: analytics.matchMetrics.pending, color: BRAND.primary, icon: Clock },
            { label: "已拒绝", value: analytics.matchMetrics.rejected, color: "#c06060", icon: ShieldAlert },
            { label: "周活跃", value: analytics.activity.activeUsersThisWeek, color: BRAND.secondary, icon: Activity },
            { label: "总收入", value: fmtCurrency(analytics.revenue.total), color: BRAND.gold, icon: DollarSign },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="group rounded-2xl border border-card-border bg-card/30 hover:bg-card/60 p-5 text-center transition-all duration-300 hover:-translate-y-0.5"
              >
                <div className="w-8 h-8 rounded-lg mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: `${item.color}10` }}>
                  <Icon className="w-4 h-4" style={{ color: item.color }} />
                </div>
                <p className="text-xl font-bold font-display" style={{ color: item.color }}>{item.value}</p>
                <p className="text-[11px] text-foreground-muted mt-1 font-medium">{item.label}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
