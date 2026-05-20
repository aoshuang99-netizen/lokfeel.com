"use client";

import { useMemo } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip, ResponsiveContainer } from "recharts";

const tooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#fafafa",
  fontSize: "12px",
  padding: "10px 14px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
};

interface DataPoint {
  time: string;
  value: number;
}

export function ActivityRadarChart({ data }: { data: DataPoint[] }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">用户活跃时段</h2>
          <p className="text-xs text-zinc-500 mt-0.5">24小时分布 · 雷达图</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={data}>
          <PolarGrid stroke="rgba(255,255,255,0.1)" />
          <PolarAngleAxis dataKey="time" tick={{ fill: "#71717a", fontSize: 10 }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#71717a", fontSize: 9 }} />
          <Radar name="活跃度" dataKey="value" stroke="#a855f7" fill="#a855f7" fillOpacity={0.2} strokeWidth={2} />
          <Tooltip contentStyle={tooltipStyle} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
