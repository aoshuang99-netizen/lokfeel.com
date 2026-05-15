"use client";

import { TrendingDown } from "lucide-react";

interface FunnelStage {
  stage: string;
  count: number;
  pct: number;
}

interface ConversionFunnelProps {
  stages: FunnelStage[];
}

const STAGE_COLORS = [
  { fill: "#0071e3", bg: "#0071e310" },  // Blue - Register
  { fill: "#5856d6", bg: "#5856d610" },  // Purple - Profile
  { fill: "#34c759", bg: "#34c75910" },  // Green - Match
  { fill: "#ff9500", bg: "#ff950010" },  // Orange - Message
  { fill: "#ff3b30", bg: "#ff3b3010" },  // Red - Subscribe
];

export function ConversionFunnel({ stages }: ConversionFunnelProps) {
  if (!stages || stages.length === 0) {
    return (
      <div className="rounded-xl border border-[#e5e5e7] bg-white p-5 flex items-center justify-center h-40">
        <p className="text-sm text-[#86868b]">暂无漏斗数据</p>
      </div>
    );
  }

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="rounded-xl border border-[#e5e5e7] bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-[#ff9500]" />
          <h2 className="text-sm font-semibold text-[#1d1d1f]">用户转化漏斗</h2>
        </div>
        <span className="text-[11px] text-[#86868b]">注册 → 付费</span>
      </div>

      <div className="space-y-3">
        {stages.map((stage, idx) => {
          const widthPct = Math.max((stage.count / maxCount) * 100, 2);
          const colors = STAGE_COLORS[idx % STAGE_COLORS.length];
          const dropRate = idx > 0
            ? stages[idx - 1].count > 0
              ? Math.round(((stages[idx - 1].count - stage.count) / stages[idx - 1].count) * 100)
              : 0
            : 0;

          return (
            <div key={stage.stage} className="relative">
              {/* Stage label row */}
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colors.fill }}
                  />
                  <span className="text-sm font-medium text-[#1d1d1f]">{stage.stage}</span>
                </div>
                <div className="flex items-center gap-3">
                  {idx > 0 && dropRate > 0 && (
                    <span className="text-[11px] text-[#ff3b30] font-medium">
                      -{dropRate}%
                    </span>
                  )}
                  <span className="text-sm font-semibold text-[#1d1d1f] tabular-nums">
                    {stage.count.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-[#86868b] tabular-nums w-10 text-right">
                    {stage.pct}%
                  </span>
                </div>
              </div>

              {/* Funnel bar */}
              <div
                className="h-8 rounded-lg relative overflow-hidden transition-all duration-500"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: colors.bg,
                }}
              >
                <div
                  className="absolute inset-0 rounded-lg transition-all duration-700 ease-out"
                  style={{
                    width: "100%",
                    backgroundColor: colors.fill,
                    opacity: 0.25,
                  }}
                />
                {/* Animated fill from left */}
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-1000 ease-out"
                  style={{
                    width: `${stage.pct}%`,
                    backgroundColor: colors.fill,
                    opacity: 0.6,
                  }}
                />
              </div>

              {/* Drop arrow between stages */}
              {idx < stages.length - 1 && (
                <div className="flex justify-center py-0.5">
                  <svg width="12" height="8" viewBox="0 0 12 8" className="text-[#e5e5e7]">
                    <path d="M6 8L0 0h12z" fill="currentColor" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
