"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Home,
  Search,
  MessageCircle,
  Bell,
  User,
} from "lucide-react";
import { useApiGet } from "@/hooks/use-api";

// ══════════════════════════════════════
// 5-ENTRY NAVIGATION — UX Redesign Spec
// Home / Discover / Messages / Activity / Profile
// ══════════════════════════════════════

const navItems = [
  { name: "Home", href: "/dashboard", icon: Home, label: "Home" },
  { name: "Discover", href: "/dashboard/discover", icon: Search, label: "Discover" },
  { name: "Messages", href: "/dashboard/chat", icon: MessageCircle, label: "Messages", badgeKey: "unreadMessages" },
  { name: "Activity", href: "/dashboard/activity", icon: Bell, label: "Activity", badgeKey: "unreadMatches" },
  { name: "Profile", href: "/dashboard/profile", icon: User, label: "Profile" },
];

// Design tokens
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface UnreadData {
  unreadCount: number;
  totalChats?: number;
}

interface MatchesData {
  matches: Array<{ myReaction: string | null }>;
}

export default function BottomNav() {
  const pathname = usePathname();

  // Fetch unread message count
  const { data: unreadMessagesData } = useApiGet<UnreadData>("/api/chats/unread-count");
  const { data: matchesData } = useApiGet<MatchesData>("/api/matches?status=PENDING&limit=10");

  const unreadMessages = unreadMessagesData?.unreadCount || 0;
  const unreadMatches = matchesData?.matches?.filter((m) => m.myReaction === null).length || 0;

  const badgeMap: Record<string, number> = {
    unreadMessages,
    unreadMatches,
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/dashboard/";
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      {/* Gradient background mask */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0d0c11] via-[#0d0c11]/95 to-transparent pointer-events-none" />

      {/* Nav container */}
      <div className="relative bg-[#13121a]/90 backdrop-blur-xl border-t border-white/5">
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
                    className="absolute -top-1 w-8 h-0.5 bg-gradient-to-r from-primary to-secondary rounded-full"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}

                {/* Icon container */}
                <div
                  className={`relative p-1.5 rounded-xl transition-all duration-200 ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-white/40 hover:text-white/60"
                  }`}
                  style={{ transitionTimingFunction: EASING }}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 1.8} />

                  {/* Unread badge */}
                  {badgeCount > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-primary rounded-full text-[9px] font-bold text-white flex items-center justify-center"
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </motion.span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={`text-[9px] font-medium transition-colors ${
                    active ? "text-white" : "text-white/40"
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
