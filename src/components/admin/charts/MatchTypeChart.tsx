"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

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
  type: string;
  value: number;
}

const BAR_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ef4444"];

export function MatchTypeChart({ data }: { data: DataPoint[] }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">匹配类型分布</h2>
          <p className="text-xs text-zinc-500 mt-0.5">各类型占比 · 条形图</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={[...data].reverse()} layout="vertical" barSize={16}>
          <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickFormatter={(v: number) => `${v}%`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="type"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={80}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [`${value}%`, "占比"]}
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {[...data].reverse().map((_, index) => (
              <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
