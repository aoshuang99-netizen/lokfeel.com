"use client";

import { useMemo } from "react";
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Area
} from "recharts";

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
  date: string;
  count: number;
}

export function UserGrowthChart({ data }: { data: DataPoint[] }) {
  const periodLabel = useMemo(() => "本月", []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">{periodLabel}用户增长</h2>
          <p className="text-xs text-zinc-500 mt-0.5">每日新增用户趋势 · 折线图</p>
        </div>
        <a href="/admin/analytics" className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:underline">
          详情 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </a>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
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
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis stroke="#71717a" fontSize={11} axisLine={false} tickLine={false} width={36} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.1)", strokeDasharray: "4 4" }} />
          <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2.5} fill="url(#lineGrad)" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
