"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Compass,
  Heart,
  MessageSquare,
  Bell,
  User,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Gift,
} from "lucide-react";
import { InvitePanel } from "@/components/invite/invite-panel";
import { useSession } from "next-auth/react";

// ─── Primary navigation — Profile first, then core features
const mainNavItems = [
  { name: "Profile", href: "/dashboard/profile", icon: User, label: "Profile", badge: false },
  { name: "Explore", href: "/dashboard/explore", icon: Compass, label: "Explore", badge: true },
  { name: "Connections", href: "/dashboard/connections", icon: Heart, label: "Connections", badge: true },
  { name: "Chats", href: "/dashboard/chats", icon: MessageSquare, label: "Chats", badge: true },
  { name: "Notifications", href: "/dashboard/notifications", icon: Bell, label: "Notifications", badge: true },
];

// Design tokens
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface SidebarProps {
  onCollapseChange?: (collapsed: boolean) => void;
}

export default function SidebarV2({ onCollapseChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  const avatarUrl = session?.user?.image || "";
  const displayName = session?.user?.name || "User";

  const toggleCollapse = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    onCollapseChange?.(newState);
  };

  const isActive = (href: string) => {
    if (href === "/dashboard/explore") {
      return pathname === "/dashboard/explore" || pathname === "/dashboard/explore/" || pathname === "/dashboard" || pathname === "/dashboard/";
    }
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-gradient-to-b from-background-secondary to-[#081020] border-r border-card-border transition-all duration-300 z-40 hidden lg:flex flex-col ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Logo区域 — 用户头像作为 Logo，点击触发折叠/展开 */}
      <div
        className="h-16 flex items-center px-4 border-b border-blue-500/10 cursor-pointer"
        onClick={toggleCollapse}
      >
        <div className="w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-500 flex items-center justify-center flex-shrink-0 ring-2 ring-blue-500/30">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <User className="w-5 h-5 text-white" />
          )}
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="text-xl font-bold text-gradient whitespace-nowrap ml-3"
            >
              LokFee!
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* 主导航 */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {mainNavItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative ${
                active
                  ? "bg-gradient-to-r from-blue-500/10 to-indigo-500/10 text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
              }`}
            >
              {/* 活跃指示条 */}
              {active && (
                <motion.div
                  layoutId="sidebarIndicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-blue-500 to-indigo-400 rounded-r-full"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}

              <div className={`relative p-2 rounded-lg transition-colors ${
                active ? "bg-blue-500/15" : "group-hover:bg-background-tertiary"
              }`}>
                <Icon className={`w-5 h-5 ${active ? "text-blue-400" : ""}`} strokeWidth={active ? 2.5 : 2} />
                
                {/* 未读红点 */}
                {item.badge && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-blue-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center" />
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
                        className="w-1.5 h-1.5 rounded-full bg-blue-400"
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {/* 分隔线 */}
        <div className="my-3 border-t border-blue-500/10" />

        {/* Settings link */}
        <Link
          href="/dashboard/settings"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
            isActive("/dashboard/settings")
              ? "bg-background-tertiary text-foreground"
              : "text-foreground-subtle hover:text-foreground-muted hover:bg-background-tertiary"
          }`}
        >
          <div className="relative p-2 rounded-lg">
            <Settings className="w-4 h-4" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="text-sm whitespace-nowrap"
              >
                Settings
              </motion.span>
            )}
          </AnimatePresence>
        </Link>

        {/* Invite Button */}
        <InviteButton collapsed={collapsed} onClick={() => setInviteOpen(true)} />
      </nav>

      {/* 底部操作区 — 升级Premium（头像折叠已移到顶部 Logo 区域） */}
      <div className="p-3 border-t border-blue-500/10 space-y-2">
        {/* 升级Premium */}
        <Link
          href="/dashboard/subscription"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-blue-600/10 to-indigo-500/10 border border-blue-500/15 hover:border-blue-500/30 transition-all group ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Sparkles className="w-4 h-4 text-blue-400" />
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
      </div>

      {/* Invite Panel */}
      <InvitePanel isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
    </aside>
  );
}
