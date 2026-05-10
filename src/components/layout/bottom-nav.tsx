"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Compass,
  Heart,
  MessageSquare,
  Bell,
  User,
} from "lucide-react";
import { useApiGet } from "@/hooks/use-api";

// ═════════════════════════════════════
// REDESIGNED NAVIGATION — 5-ENTRY OPTIMIZED
// Profile / Explore / Connections / Chats / Notifications
// ═════════════════════════════════════

const navItems = [
  { name: "Profile", href: "/dashboard/profile", icon: User, label: "Profile", badgeKey: null },
  { name: "Explore", href: "/dashboard/explore", icon: Compass, label: "Explore", badgeKey: null },
  { name: "Connections", href: "/dashboard/connections", icon: Heart, label: "Connections", badgeKey: "unreadLikes" },
  { name: "Chats", href: "/dashboard/chats", icon: MessageSquare, label: "Chats", badgeKey: "unreadMessages" },
  { name: "Notifications", href: "/dashboard/notifications", icon: Bell, label: "Notifications", badgeKey: "unreadNotifications" },
];

// Design tokens
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface UnreadData {
  unreadCount: number;
  totalChats?: number;
}

interface ConnectionsData {
  likes: Array<{ id: string }>;
}

interface NotificationsData {
  unreadCount: number;
}

export default function BottomNav() {
  const pathname = usePathname();

  // Fetch unread message count
  const { data: unreadMessagesData } = useApiGet<UnreadData>("/api/chats/unread-count");
  
  // Fetch connections (likes + matches + pending) — use who-liked-me API
  const { data: connectionsData } = useApiGet<ConnectionsData>("/api/who-liked-me?limit=50");
  
  // Fetch notifications unread count
  const { data: notificationsData } = useApiGet<NotificationsData>("/api/notifications?unread=true");

  const unreadMessages = unreadMessagesData?.unreadCount || 0;
  const unreadLikes = connectionsData?.likes?.length || 0;
  const unreadNotifications = notificationsData?.unreadCount || 0;

  const badgeMap: Record<string, number> = {
    unreadMessages,
    unreadLikes,
    unreadNotifications,
  };

  const isActive = (href: string) => {
    if (href === "/dashboard/explore") {
      return pathname === "/dashboard/explore" || pathname === "/dashboard/explore/";
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      {/* Gradient background mask */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none" />

      {/* Nav container — Cool Blue glass morphism */}
      <div className="relative bg-[#081020]/90 backdrop-blur-xl border-t border-blue-500/10">
        <div className="flex items-center justify-around py-1.5" style={{ paddingBottom: "env(safe-area-inset-bottom, 8px)" }}>
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            const badgeCount = item.badgeKey ? badgeMap[item.badgeKey] || 0 : 0;

            return (
              <Link
                key={item.name}
                href={item.href}
                className="relative flex flex-col items-center gap-0.5 px-2 py-1.5 min-w-[56px]"
              >
                {/* Active indicator */}
                {active && (
                  <motion.div
                    layoutId="bottomNavIndicator"
                    className="absolute -top-1 w-8 h-0.5 bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}

                {/* Icon container */}
                <div
                  className={`relative p-1.5 rounded-xl transition-all duration-200 ${
                    active
                      ? "bg-blue-500/15 text-blue-400"
                      : "text-foreground-subtle hover:text-foreground-muted"
                  }`}
                  style={{ transitionTimingFunction: EASING }}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 1.8} />

                  {/* Unread badge */}
                  {badgeCount > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-blue-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </motion.span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={`text-[9px] font-medium transition-colors ${
                    active ? "text-foreground" : "text-foreground-subtle"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
