"use client";

/**
 * Admin KPI Card — Dashboard metric card with trend comparison
 *
 * @example
 * <KpiCard
 *   title="Total Users"
 *   value={1523}
 *   trend={{ value: 12.5, direction: "up" }}
 *   icon={Users}
 *   isLoading={false}
 * />
 */

import { LucideIcon } from "lucide-react";
import { SkeletonStatCard } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: number | string;
  trend?: {
    value: number;
    direction: "up" | "down" | "neutral";
    label?: string;
  };
  icon?: LucideIcon;
  isLoading?: boolean;
  className?: string;
  onClick?: () => void;
}

export function KpiCard({
  title,
  value,
  trend,
  icon: Icon,
  isLoading = false,
  className = "",
  onClick,
}: KpiCardProps) {
  if (isLoading) {
    return <SkeletonStatCard className={className} />;
  }

  const trendColor = trend?.direction === "up"
    ? "text-green-500"
    : trend?.direction === "down"
      ? "text-red-500"
      : "text-foreground-muted";

  const TrendIcon = trend?.direction === "up"
    ? TrendingUp
    : trend?.direction === "down"
      ? TrendingDown
      : Minus;

  return (
    <div
      className={`glass-card p-5 ${onClick ? "cursor-pointer hover:bg-card-hover transition-colors" : ""} ${className}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-foreground-muted">{title}</span>
        {Icon && (
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        )}
      </div>

      <div className="flex items-end gap-3">
        <span className="text-2xl font-bold text-foreground">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>

        {trend && (
          <div className={`flex items-center gap-1 text-xs ${trendColor}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            <span className="font-medium">
              {Math.abs(trend.value).toFixed(1)}%
            </span>
            {trend.label && (
              <span className="text-foreground-muted">
                {trend.label}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// KPI Card Grid
// ============================================================================

interface KpiGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
}

export function KpiGrid({ children, columns = 4 }: KpiGridProps) {
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={`grid ${gridCols[columns]} gap-4`}>
      {children}
    </div>
  );
}
