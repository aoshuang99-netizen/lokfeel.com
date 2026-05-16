"use client";

import { useState } from "react";
import { Calendar, type LucideIcon } from "lucide-react";

export type TimeRange = "day" | "week" | "month" | "year";

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  className?: string;
}

const ranges: { value: TimeRange; label: string; shortLabel: string }[] = [
  { value: "day", label: "今日", shortLabel: "日" },
  { value: "week", label: "本周", shortLabel: "周" },
  { value: "month", label: "本月", shortLabel: "月" },
  { value: "year", label: "本年", shortLabel: "年" },
];

export function TimeRangeSelector({ value, onChange, className = "" }: TimeRangeSelectorProps) {
  return (
    <div className={`flex items-center gap-1 p-1 rounded-lg bg-[#f5f5f7] border border-[#e5e5e7] ${className}`}>
      <div className="flex items-center gap-1 px-2">
        <Calendar className="w-3.5 h-3.5 text-[#86868b]" />
      </div>
      {ranges.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          className={`
            px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200
            ${
              value === range.value
                ? "bg-white text-[#0071e3] shadow-sm border border-[#e5e5e7]"
                : "text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-white/50"
            }
          `}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

// Date range helpers for API
export function getDateRange(range: TimeRange): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const start = new Date(now);

  switch (range) {
    case "day":
      start.setHours(0, 0, 0, 0);
      break;
    case "week":
      const dayOfWeek = start.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday as start
      start.setDate(start.getDate() - diff);
      start.setHours(0, 0, 0, 0);
      break;
    case "month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
  }

  return { start, end };
}
