"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer
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
  month: string;
  revenue: number;
}

export function RevenueChart({ data }: { data: DataPoint[] }) {
  const periodLabel = useMemo(() => "本月", []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">{periodLabel}收入趋势</h2>
          <p className="text-xs text-zinc-500 mt-0.5">月度收入走势 · 面积图</p>
        </div>
        <a href="/admin/subscriptions" className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:underline">
          详情 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </a>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="revAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="month"
            stroke="#71717a"
            fontSize={11}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis
            stroke="#71717a"
            fontSize={11}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v: number) => v >= 1000 ? `¥${(v / 1000).toFixed(1)}k` : `¥${v}`}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [`¥${Number(value).toLocaleString()}`, "收入"]}
            cursor={{ stroke: "rgba(255,255,255,0.1)" }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#22c55e"
            strokeWidth={2.5}
            fill="url(#revAreaGrad)"
            dot={{ fill: "#22c55e", strokeWidth: 2, stroke: "#18181b" }}
            activeDot={{ r: 5, fill: "#22c55e", stroke: "#18181b", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
