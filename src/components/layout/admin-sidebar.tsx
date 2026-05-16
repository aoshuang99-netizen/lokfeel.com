"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Heart,
  BarChart3,
  FileText,
  Settings,
  Shield,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Code2,
  Layers,
  TrendingUp,
  Activity,
  Funnel,
  Clock,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

// ─── Navigation Group Definition ───
interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  badgeColor?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "运营",
    items: [
      { name: "用户管理", href: "/admin/users", icon: Users },
      { name: "匹配管理", href: "/admin/matches", icon: Heart },
      { name: "内容管理", href: "/admin/content", icon: FileText },
      { name: "用户审核", href: "/admin/review", icon: ShieldAlert, badge: "NEW", badgeColor: "#ff3b30" },
    ],
  },
  {
    label: "产品",
    items: [
      { name: "数据分析", href: "/admin/analytics", icon: BarChart3 },
      { name: "漏斗分析", href: "/admin/analytics/funnel", icon: Funnel, badge: "NEW", badgeColor: "#34c759" },
      { name: "留存分析", href: "/admin/analytics/retention", icon: Clock, badge: "NEW", badgeColor: "#34c759" },
      { name: "实时监控", href: "/admin/analytics/realtime", icon: Activity, badge: "NEW", badgeColor: "#34c759" },
      { name: "事件分析", href: "/admin/analytics/events", icon: Activity },
      { name: "功能管理", href: "/admin/features", icon: Layers },
    ],
  },
  {
    label: "技术",
    items: [
      { name: "系统设置", href: "/admin/settings", icon: Settings },
      { name: "审计日志", href: "/admin/settings/audit", icon: Shield },
      { name: "RBAC 权限", href: "/admin/settings/rbac", icon: Code2 },
    ],
  },
  {
    label: "运维",
    items: [
      { name: "告警系统", href: "/admin/alerts", icon: Bell, badge: "NEW", badgeColor: "#ff9500" },
    ],
  },
  {
    label: "市场",
    items: [
      { name: "推广活动", href: "/admin/marketing", icon: Megaphone },
      { name: "增长分析", href: "/admin/analytics#growth", icon: TrendingUp },
    ],
  },
];

// Top-level items (shown outside groups)
const TOP_NAV: NavItem[] = [
  { name: "总览", href: "/admin", icon: LayoutDashboard },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  // Initialize expanded groups on client-side only to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
    const initial: Record<string, boolean> = {};
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (pathname === item.href || pathname.startsWith(item.href + "/")) {
          initial[group.label] = true;
          break;
        }
      }
    }
    setExpandedGroups(initial);
  }, []);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* ─── Desktop Sidebar ─── */}
      <aside
        className={`hidden lg:flex flex-col fixed left-0 top-0 h-screen bg-[#1a1a2e] border-r border-[#2a2a3e] transition-all duration-300 z-fixed ${
          isCollapsed ? "w-[72px]" : "w-[260px]"
        }`}
      >
        {/* Logo */}
        <div className={`h-16 flex items-center ${isCollapsed ? "justify-center px-0" : "justify-between px-5"} border-b border-[#2a2a3e]`}>
          <Link href="/admin" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0071e3] to-[#34c759] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#0071e3]/20 transition-transform duration-200 group-hover:scale-105">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="text-[15px] font-bold tracking-tight leading-tight text-white">LokFeel</span>
                <span className="text-[10px] text-[#86868b] leading-tight font-medium tracking-wide">ADMIN PANEL</span>
              </div>
            )}
          </Link>
          {!isCollapsed && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-all duration-200 text-[#86868b] hover:text-white"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto scrollbar-thin">
          {/* Top-level nav */}
          <div className="mb-6">
            {TOP_NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href) && item.href === "/admin" && pathname === "/admin";
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                    active
                      ? "bg-[#0071e3]/15 text-white shadow-sm"
                      : "text-[#a0a0b0] hover:text-white hover:bg-white/5"
                  } ${isCollapsed ? "justify-center" : ""}`}
                  title={isCollapsed ? item.name : undefined}
                >
                  <Icon
                    className={`w-5 h-5 flex-shrink-0 transition-colors duration-200 ${
                      active ? "text-[#0071e3]" : "text-[#86868b] group-hover:text-white"
                    }`}
                  />
                  {!isCollapsed && (
                    <>
                      <span className="font-semibold text-[13px]">{item.name}</span>
                      {active && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#0071e3] animate-pulse" />
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Grouped nav */}
          <div className="space-y-1">
            {NAV_GROUPS.map((group) => {
              const hasActive = mounted && group.items.some((item) => isActive(item.href));
              const isExpanded = expandedGroups[group.label] ?? false;

              return (
                <div key={group.label}>
                  {/* Group Header */}
                  {!isCollapsed && (
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-bold text-[#86868b] uppercase tracking-[0.15em] hover:text-[#a0a0b0] transition-colors"
                    >
                      <span>{group.label}</span>
                      <ChevronRight
                        className={`w-3 h-3 transition-transform duration-200 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      />
                    </button>
                  )}

                  {/* Group Items */}
                  {(isCollapsed || isExpanded) && (
                    <div className={`space-y-0.5 ${isCollapsed ? "" : "mt-0.5 mb-4"}`}>
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        return (
                          <Link
                            key={item.name}
                            href={item.href}
                            className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 group ${
                              active
                                ? "bg-[#0071e3]/10 text-white"
                                : "text-[#a0a0b0] hover:text-white hover:bg-white/5"
                            } ${isCollapsed ? "justify-center" : ""}`}
                            title={isCollapsed ? item.name : undefined}
                          >
                            <Icon
                              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors duration-200 ${
                                active ? "text-[#0071e3]" : "text-[#86868b] group-hover:text-white"
                              }`}
                            />
                            {!isCollapsed && (
                              <span className="text-[13px]">{item.name}</span>
                            )}
                            {active && !isCollapsed && (
                              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#0071e3]" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* Bottom: Expand button (when collapsed) + Back to App */}
        <div className="p-3 border-t border-[#2a2a3e]">
          {isCollapsed && (
            <button
              onClick={() => setIsCollapsed(false)}
              className="flex items-center justify-center w-full px-3 py-2.5 mb-1 rounded-xl text-[#86868b] hover:text-white hover:bg-white/5 transition-all duration-200"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          <Link
            href="/dashboard"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[#86868b] hover:text-white hover:bg-white/5 transition-all duration-200 ${
              isCollapsed ? "justify-center" : ""
            }`}
            title={isCollapsed ? "返回应用" : undefined}
          >
            <Shield className="w-4 h-4" />
            {!isCollapsed && <span className="text-[13px]">返回应用</span>}
          </Link>
        </div>
      </aside>

      {/* ─── Mobile Sidebar Overlay ─── */}
      <aside className="lg:hidden fixed inset-0 z-fixed">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="absolute left-0 top-0 h-full w-[280px] bg-background-secondary border-r border-card-border overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-card-border/50">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-[15px] font-bold tracking-tight leading-tight">LokFee!</span>
              <span className="text-[10px] text-foreground-subtle leading-tight font-medium tracking-wide">ADMIN PANEL</span>
            </div>
          </div>

          <nav className="p-4 space-y-1">
            {/* Top nav */}
            {TOP_NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href) && item.href === "/admin" && pathname === "/admin";
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    active
                      ? "bg-primary/10 text-foreground"
                      : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary/60"
                  }`}
                >
                  <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} />
                  <span className="font-semibold text-[13px]">{item.name}</span>
                </Link>
              );
            })}

            {/* Groups */}
            {NAV_GROUPS.map((group) => {
              const hasActive = mounted && group.items.some((item) => isActive(item.href));
              const isExpanded = expandedGroups[group.label] ?? false;

              return (
                <div key={group.label} className="mt-5">
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="flex items-center justify-between w-full px-4 py-2 text-[10px] font-bold text-foreground-subtle uppercase tracking-[0.15em]"
                  >
                    <span>{group.label}</span>
                    <ChevronRight
                      className={`w-3 h-3 transition-transform duration-200 ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </button>
                  {isExpanded && (
                    <div className="mt-1 space-y-0.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        return (
                          <Link
                            key={item.name}
                            href={item.href}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 ${
                              active
                                ? "bg-primary/8 text-foreground"
                                : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary/60"
                            }`}
                          >
                            <Icon className={`w-[18px] h-[18px] ${active ? "text-primary" : ""}`} />
                            <span className="text-[13px]">{item.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Back to App */}
          <div className="p-4 border-t border-card-border/50">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 px-4 py-3 text-foreground-subtle hover:text-foreground transition-colors"
            >
              <Shield className="w-4 h-4" />
              <span className="text-[13px]">返回应用</span>
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
