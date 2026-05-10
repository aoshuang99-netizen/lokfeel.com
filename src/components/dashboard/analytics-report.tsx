"use client";

import { useEffect, useState } from "react";
import {
  MessageCircle,
  Heart,
  TrendingUp,
  Users,
  BarChart3,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ═════════════════════════════════════
// TYPES
// ═════════════════════════════════════

interface AnalyticsData {
  matches: {
    thisWeek: number;
    lastWeek: number;
    total: number;
    trend: number; // percentage change
  };
  profileViews: {
    thisWeek: number;
    lastWeek: number;
    trend: number;
  };
  messages: {
    unread: number;
    totalThisWeek: number;
  };
  profileCompletion: number;
  matchQuality: {
    average: number;
    distribution: { score: string; count: number }[];
  };
  activityTrend: {
    date: string;
    matches: number;
    views: number;
  }[];
  topTags: { tag: string; count: number }[];
}

interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

// ═════════════════════════════════════
// MINI CHART COMPONENT (No dependencies)
// ═════════════════════════════════════

function MiniBarChart({ data, height = 60 }: { data: ChartDataPoint[]; height?: number }) {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="flex items-end gap-1" style={{ height: `${height}px` }}>
      {data.map((point, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all duration-300 hover:opacity-80"
          style={{
            height: `${(point.value / maxValue) * 100}%`,
            backgroundColor: point.color || "#6366f1",
            minHeight: "4px",
          }}
          title={`${point.label}: ${point.value}`}
        />
      ))}
    </div>
  );
}

function MiniLineChart({ data, height = 60 }: { data: ChartDataPoint[]; height?: number }) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const minValue = Math.min(...data.map(d => d.value), 0);
  const range = maxValue - minValue || 1;

  const points = data.map((point, i) => ({
    x: (i / (data.length - 1)) * 100,
    y: 100 - ((point.value - minValue) / range) * 100,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  return (
    <div className="relative" style={{ height: `${height}px` }}>
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
        <path
          d={pathD}
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={`${pathD} L 100 100 L 0 100 Z`}
          fill="url(#gradient)"
          opacity="0.2"
        />
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* Hover tooltip would go here */}
      <div className="absolute inset-0 flex items-end">
        {data.map((point, i) => (
          <div
            key={i}
            className="flex-1 text-center"
            style={{ fontSize: "8px" }}
          >
            <span className="text-foreground-muted">{point.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════
// STAT CARD
// ═════════════════════════════════════

function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendLabel,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: number;
  trendLabel?: string;
}) {
  return (
    <Card className="bg-[#111111] border-white/5 hover:border-primary/30 transition-all duration-300">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            {icon}
          </div>

          {trend !== undefined && (
            <Badge
              variant={trend >= 0 ? "default" : "destructive"}
              className="text-[10px]"
            >
              {trend >= 0 ? "+" : ""}{trend}%
            </Badge>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-foreground-muted">{title}</p>
          {subtitle && (
            <p className="text-[11px] text-foreground-subtle">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ═════════════════════════════════════
// MATCH QUALITY DISTRIBUTION
// ═════════════════════════════════════

function MatchQualityChart({ distribution }: { distribution: { score: string; count: number }[] }) {
  const total = distribution.reduce((sum, d) => sum + d.count, 0);
  const colors: Record<string, string> = {
    "90-100": "#fbbf24",
    "80-89": "#a855f7",
    "70-79": "#6366f1",
    "60-69": "#60a5fa",
    "<60": "#6b7280",
  };

  return (
    <div className="space-y-2">
      {distribution.map((item) => (
        <div key={item.score} className="flex items-center gap-3">
          <div className="w-16 text-xs text-foreground-muted text-right">
            {item.score}
          </div>
          <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${total > 0 ? (item.count / total) * 100 : 0}%`,
                backgroundColor: colors[item.score] || "#6366f1",
              }}
            />
          </div>
          <div className="w-8 text-xs text-foreground-subtle text-right">
            {item.count}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════
// TOP TAGS
// ═════════════════════════════════════

function TopTags({ tags }: { tags: { tag: string; count: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((item, i) => (
        <Badge
          key={item.tag}
          variant="secondary"
          className={`text-[11px] ${
            i === 0 ? "bg-primary/20 text-primary" : "bg-white/5 text-foreground-muted"
          }`}
        >
          {item.tag} ({item.count})
        </Badge>
      ))}
    </div>
  );
}

// ═════════════════════════════════════
// MAIN ANALYTICS REPORT COMPONENT
// ═════════════════════════════════════

export function AnalyticsReport() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("7d");

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    try {
      setIsLoading(true);

      // TODO: Replace with real API call
      // const res = await fetch(`/api/dashboard/analytics?range=${timeRange}`);
      // const data = await res.json();

      // Demo data
      setTimeout(() => {
        setData({
          matches: {
            thisWeek: 12,
            lastWeek: 8,
            total: 45,
            trend: 50,
          },
          profileViews: {
            thisWeek: 89,
            lastWeek: 124,
            trend: -28,
          },
          messages: {
            unread: 3,
            totalThisWeek: 28,
          },
          profileCompletion: 92,
          matchQuality: {
            average: 82,
            distribution: [
              { score: "90-100", count: 8 },
              { score: "80-89", count: 15 },
              { score: "70-79", count: 12 },
              { score: "60-69", count: 5 },
              { score: "<60", count: 2 },
            ],
          },
          activityTrend: [
            { date: "Mon", matches: 3, views: 45 },
            { date: "Tue", matches: 5, views: 52 },
            { date: "Wed", matches: 2, views: 38 },
            { date: "Thu", matches: 4, views: 61 },
            { date: "Fri", matches: 6, views: 89 },
            { date: "Sat", matches: 8, views: 124 },
            { date: "Sun", matches: 5, views: 97 },
          ],
          topTags: [
            { tag: "Coffee", count: 12 },
            { tag: "Hiking", count: 9 },
            { tag: "Travel", count: 8 },
            { tag: "Yoga", count: 7 },
            { tag: "Reading", count: 6 },
          ],
        });
        setIsLoading(false);
      }, 500);
    } catch (error) {
      console.error("Failed to load analytics:", error);
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-white/5 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white/5 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8">
        <p className="text-foreground-muted">Failed to load analytics</p>
        <Button variant="outline" size="sm" onClick={loadAnalytics} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Analytics Overview</h2>
            <p className="text-[11px] text-foreground-subtle">
              Last 7 days
            </p>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {(["7d", "30d", "90d"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                timeRange === range
                  ? "bg-primary text-white"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="New Matches"
          value={data.matches.thisWeek}
          subtitle={`${data.matches.total} total matches`}
          icon={<Heart className="w-5 h-5 text-primary" />}
          trend={data.matches.trend}
          trendLabel="vs last week"
        />
        <StatCard
          title="Profile Views"
          value={data.profileViews.thisWeek}
          subtitle="This week"
          icon={<Users className="w-5 h-5 text-accent" />}
          trend={data.profileViews.trend}
          trendLabel="vs last week"
        />
        <StatCard
          title="Messages"
          value={data.messages.totalThisWeek}
          subtitle={`${data.messages.unread} unread`}
          icon={<MessageCircle className="w-5 h-5 text-green-500" />}
        />
        <StatCard
          title="Profile Completion"
          value={`${data.profileCompletion}%`}
          subtitle="Complete your profile"
          icon={<TrendingUp className="w-5 h-5 text-primary" />}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Activity Trend */}
        <Card className="bg-[#111111] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-foreground-muted">
              Activity Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <MiniLineChart
                data={data.activityTrend.map(p => ({ label: p.date, value: p.matches }))}
                height={180}
              />
            </div>
            <div className="flex justify-between mt-4 text-xs text-foreground-muted">
              {data.activityTrend.map((point) => (
                <span key={point.date}>{point.date}</span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Match Quality Distribution */}
        <Card className="bg-[#111111] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-foreground-muted">
              Match Quality
            </CardTitle>
            <p className="text-xs text-foreground-subtle">
              Average: {data.matchQuality.average}%
            </p>
          </CardHeader>
          <CardContent>
            <MatchQualityChart distribution={data.matchQuality.distribution} />
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-xs text-foreground-muted mb-2">Top Tags</p>
              <TopTags tags={data.topTags} />
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ═════════════════════════════════════
// EXPORT: Analytics API Route
// ═════════════════════════════════════
// Create file: /nexus-app/src/app/api/dashboard/analytics/route.ts
/*
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "7d";

  // TODO: Query database for real analytics
  // - Count matches in date range
  // - Count profile views
  // - Calculate profile completion
  // - Get match quality distribution

  return NextResponse.json({
    matches: { ... },
    profileViews: { ... },
    messages: { ... },
    profileCompletion: 92,
    matchQuality: { ... },
    activityTrend: [...],
    topTags: [...],
  });
}
*/
