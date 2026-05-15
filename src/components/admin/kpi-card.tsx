"use client";

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, type LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  change: string;
  trend: "up" | "down" | "warning" | "neutral";
  icon: LucideIcon;
  href: string;
  prefix?: string;
  suffix?: string;
  sparkData?: number[];
}

export function KpiCard({ label, value, change, trend, icon: Icon, href, prefix = "", suffix = "", sparkData = [] }: KpiCardProps) {
  const trendConfig = {
    up: { color: "#34c759", bg: "#34c75915", icon: ArrowUpRight },
    down: { color: "#ff3b30", bg: "#ff3b3015", icon: ArrowDownRight },
    warning: { color: "#ff9500", bg: "#ff950015", icon: ArrowDownRight },
    neutral: { color: "#86868b", bg: "#86868b15", icon: Minus },
  };

  const config = trendConfig[trend];
  const TrendIcon = config.icon;

  // Mini sparkline
  const sparkline = sparkData.length > 1 ? (() => {
    const max = Math.max(...sparkData);
    const min = Math.min(...sparkData);
    const range = max - min || 1;
    const w = 64;
    const h = 24;
    const pts = sparkData.map((v, i) => {
      const x = (i / (sparkData.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    }).join(" ");
    return (
      <svg width={w} height={h} className="flex-shrink-0 opacity-60">
        <polyline points={pts} fill="none" stroke={config.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  })() : null;

  return (
    <Link
      href={href}
      className="group block rounded-xl border border-[#e5e5e7] bg-white p-4 transition-all duration-200 hover:border-[#0071e3]/30 hover:shadow-sm"
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: config.bg }}
        >
          <Icon className="w-4.5 h-4.5" style={{ color: config.color }} />
        </div>
        {sparkline}
      </div>

      <div className="mb-2">
        <p className="text-[11px] font-medium text-[#86868b] uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-[#1d1d1f] tracking-tight mt-0.5">
          {prefix}{typeof value === "number" ? value.toLocaleString() : value}{suffix}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold"
          style={{ backgroundColor: config.bg, color: config.color }}
        >
          <TrendIcon className="w-3 h-3" />
          {change}
        </div>
      </div>
    </Link>
  );
}
