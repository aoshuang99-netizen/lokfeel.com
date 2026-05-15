"use client";

import Link from "next/link";
import { AlertCircle, Heart, FileText, Shield, CreditCard, type LucideIcon } from "lucide-react";

interface ActionItem {
  label: string;
  count: number;
  href: string;
  icon: LucideIcon;
  severity: "critical" | "warning" | "info";
}

interface ActionItemsBarProps {
  items: {
    pendingMatches: number;
    pendingContent: number;
    recentAuditLogs: number;
    activeSubscriptions: number;
  };
}

export function ActionItemsBar({ items }: ActionItemsBarProps) {
  const actionItems: ActionItem[] = [
    {
      label: "待审核匹配",
      count: items.pendingMatches,
      href: "/admin/matches",
      icon: Heart,
      severity: items.pendingMatches > 20 ? "critical" : items.pendingMatches > 5 ? "warning" : "info",
    },
    {
      label: "待审核内容",
      count: items.pendingContent,
      href: "/admin/content",
      icon: FileText,
      severity: items.pendingContent > 10 ? "critical" : items.pendingContent > 0 ? "warning" : "info",
    },
    {
      label: "审计日志",
      count: items.recentAuditLogs,
      href: "/admin/settings/audit",
      icon: Shield,
      severity: "info",
    },
    {
      label: "活跃订阅",
      count: items.activeSubscriptions,
      href: "/admin/subscriptions",
      icon: CreditCard,
      severity: "info",
    },
  ];

  const severityConfig = {
    critical: { color: "#ff3b30", bg: "#ff3b3010", border: "#ff3b3030" },
    warning: { color: "#ff9500", bg: "#ff950010", border: "#ff950030" },
    info: { color: "#0071e3", bg: "#0071e310", border: "#0071e330" },
  };

  const hasActions = actionItems.some((item) => item.count > 0);

  if (!hasActions) {
    return (
      <div className="rounded-xl border border-[#e5e5e7] bg-white p-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#34c75910] flex items-center justify-center">
          <AlertCircle className="w-4 h-4 text-[#34c759]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f]">所有事项已处理完毕</p>
          <p className="text-xs text-[#86868b]">当前没有需要关注的事项</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#e5e5e7] bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-4 h-4 text-[#ff9500]" />
        <h3 className="text-sm font-semibold text-[#1d1d1f]">待处理事项</h3>
        <span className="text-[11px] text-[#86868b]">需要关注</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {actionItems.map((item) => {
          const config = severityConfig[item.severity];
          const Icon = item.icon;

          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 hover:shadow-sm"
              style={{ backgroundColor: config.bg, borderColor: config.border }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(255,255,255,0.8)" }}
              >
                <Icon className="w-4 h-4" style={{ color: config.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight" style={{ color: config.color }}>
                  {item.count}
                </p>
                <p className="text-[11px] text-[#6e6e73] truncate">{item.label}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
