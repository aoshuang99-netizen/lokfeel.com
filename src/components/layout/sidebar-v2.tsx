"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Home,
  Search,
  MessageCircle,
  Bell,
  User,
  Heart,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Gift,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { InvitePanel } from "@/components/invite/invite-panel";
import { useState as useStateHook } from "react";

interface SidebarProps {
  onCollapseChange?: (collapsed: boolean) => void;
}

// Primary navigation — 4 entry design
const mainNavItems = [
  { name: "Home", href: "/dashboard", icon: Home, label: "Home" },
  { name: "Discover", href: "/dashboard/discover", icon: Search, label: "Discover" },
  { name: "Messages", href: "/dashboard/chat", icon: MessageCircle, label: "Messages", badge: true },
  { name: "Activity", href: "/dashboard/activity", icon: Bell, label: "Activity" },
];

// Secondary navigation — Matches hidden (merged into Activity)
const secondaryNavItems = [
  { name: "Settings", href: "/dashboard/settings", icon: Settings, label: "Settings" },
  { name: "Profile", href: "/dashboard/profile", icon: User, label: "Profile" },
];

// Invite button (separate, not in nav list)
const InviteButton = ({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-all w-full text-left ${
      collapsed ? "justify-center" : ""
    }`}
  >
    <Gift className="w-4 h-4" />
    <AnimatePresence>
      {!collapsed && (
        <motion.span
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          className="text-sm whitespace-nowrap"
        >
          Invite Friends
        </motion.span>
      )}
    </AnimatePresence>
  </button>
);

export default function SidebarV2({ onCollapseChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [inviteOpen, setInviteOpen] = useStateHook(false);
  const pathname = usePathname();

  const toggleCollapse = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    onCollapseChange?.(newState);
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/dashboard/";
    }
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-background-secondary border-r border-card-border transition-all duration-300 z-40 hidden lg:flex flex-col ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Logo区域 */}
      <div className="h-16 flex items-center px-4 border-b border-card-border">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
            <Heart className="w-5 h-5 text-foreground" fill="white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="text-xl font-bold text-gradient whitespace-nowrap"
              >
                LokFeel
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      </div>

      {/* 主导航 */}
      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        {mainNavItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative ${
                active
                  ? "bg-gradient-to-r from-primary/10 to-secondary/10 text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
              }`}
            >
              {/* 活跃指示条 */}
              {active && (
                <motion.div
                  layoutId="sidebarIndicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-primary to-secondary rounded-r-full"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}

              <div className={`relative p-2 rounded-lg transition-colors ${
                active ? "bg-primary/20" : "group-hover:bg-background-tertiary"
              }`}>
                <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} strokeWidth={active ? 2.5 : 2} />
                
                {/* 未读红点 */}
                {item.badge && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-primary rounded-full border-2 border-surface" />
                )}
              </div>

              <AnimatePresence>
                {!collapsed && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="flex-1 flex items-center justify-between"
                  >
                    <span className="font-medium whitespace-nowrap">{item.label}</span>
                    {active && (
                      <motion.div
                        layoutId="activeDot"
                        className="w-1.5 h-1.5 rounded-full bg-primary"
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {/* 分隔线 */}
        <div className="my-4 border-t border-card-border" />

        {/* 辅助导航 */}
        {secondaryNavItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                active
                  ? "bg-background-tertiary text-foreground"
                  : "text-foreground-subtle hover:text-foreground-muted hover:bg-background-tertiary"
              }`}
            >
              <Icon className="w-4 h-4" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="text-sm whitespace-nowrap"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {/* Invite Button */}
        <InviteButton collapsed={collapsed} onClick={() => setInviteOpen(true)} />
      </nav>

      {/* 底部操作区 */}
      <div className="p-3 border-t border-card-border space-y-1">
        {/* 升级Premium */}
        <Link
          href="/dashboard/subscription"
          className={`flex items-center gap-3 px-3 py-3 rounded-xl bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20 hover:border-primary/40 transition-all group ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Sparkles className="w-5 h-5 text-primary" />
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex-1"
              >
                <p className="text-sm font-medium text-foreground">Premium</p>
                <p className="text-xs text-foreground-muted">Unlock all features</p>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>

        {/* 登出 */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-foreground-subtle hover:text-foreground-muted hover:bg-background-tertiary transition-all w-full ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogOut className="w-4 h-4" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="text-sm whitespace-nowrap"
              >
                Sign Out
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* 折叠按钮 */}
      <button
        onClick={toggleCollapse}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-background-secondary border border-card-border flex items-center justify-center text-foreground-subtle hover:text-foreground hover:border-card-border transition-all shadow-lg"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronLeft className="w-3 h-3" />
        )}
      </button>

      {/* Invite Panel */}
      <InvitePanel isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
    </aside>
  );
}
