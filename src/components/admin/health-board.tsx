"use client";

import Link from "next/link";
import { ArrowRight, Activity, Layers, Code2, TrendingUp } from "lucide-react";

interface HealthMetric {
  label: string;
  value: string;
}

interface HealthBoardData {
  label: string;
  status: "good" | "warning" | "critical" | "neutral";
  metrics: HealthMetric[];
  href: string;
}

const STATUS_CONFIG = {
  good: { color: "#34c759", bg: "#34c75910", label: "正常" },
  warning: { color: "#ff9500", bg: "#ff950010", label: "注意" },
  critical: { color: "#ff3b30", bg: "#ff3b3010", label: "紧急" },
  neutral: { color: "#86868b", bg: "#86868b10", label: "无数据" },
};

const ICON_MAP = {
  运营: Activity,
  产品: Layers,
  技术: Code2,
  市场: TrendingUp,
};

interface HealthBoardProps {
  boards: HealthBoardData[];
}

export function HealthBoard({ boards }: HealthBoardProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {boards.map((board) => {
        const status = STATUS_CONFIG[board.status];
        const Icon = ICON_MAP[board.label as keyof typeof ICON_MAP] || Activity;

        return (
          <Link
            key={board.label}
            href={board.href}
            className="group block rounded-xl border border-[#e5e5e7] bg-white p-4 transition-all duration-200 hover:border-[#0071e3]/30 hover:shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: status.bg }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: status.color }} />
                </div>
                <span className="text-sm font-semibold text-[#1d1d1f]">{board.label}</span>
              </div>
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ backgroundColor: status.bg, color: status.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                {status.label}
              </div>
            </div>

            <div className="space-y-2">
              {board.metrics.map((metric) => (
                <div key={metric.label} className="flex items-center justify-between">
                  <span className="text-xs text-[#86868b]">{metric.label}</span>
                  <span className="text-xs font-semibold text-[#1d1d1f]">{metric.value}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1 mt-3 text-[11px] font-medium text-[#0071e3] opacity-0 group-hover:opacity-100 transition-opacity">
              查看详情 <ArrowRight className="w-3 h-3" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
