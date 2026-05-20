"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

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
  name: string;
  value: number;
  color: string;
}

export function UserSourceChart({ data, totalUsers }: { data: DataPoint[]; totalUsers?: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">用户来源分布</h2>
          <p className="text-xs text-zinc-500 mt-0.5">渠道构成 · 环形图</p>
        </div>
      </div>
      <div className="flex items-center">
        <div className="relative w-48 h-48 mx-auto">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white">{totalUsers?.toLocaleString() || "12.3K"}</span>
            <span className="text-xs text-zinc-500">总用户</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 ml-4">
          {data.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-xs text-zinc-400">{item.name}</span>
              <span className="text-xs font-medium text-white ml-auto">{item.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
