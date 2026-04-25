"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Home,
  Search,
  MessageCircle,
  Bell,
  User,
  LogOut,
} from "lucide-react";
import { useApiGet } from "@/hooks/use-api";
import { signOut } from "next-auth/react";

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
  { name: "Logout", href: "#", icon: LogOut, label: "Logout", isLogout: true },
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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

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
      {/* Gradient background mask — uses design system background */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none" />

      {/* Nav container — glass morphism aligned with design system */}
      <div className="relative bg-background-secondary/90 backdrop-blur-xl border-t border-card-border">
        <div className="flex items-center justify-around py-1.5" style={{ paddingBottom: "env(safe-area-inset-bottom, 8px)" }}>
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            const badgeCount = item.badgeKey ? badgeMap[item.badgeKey] || 0 : 0;

            const isLogoutItem = (item as any).isLogout;

            return isLogoutItem ? (
              <button
                key={item.name}
                onClick={() => setShowLogoutConfirm(true)}
                className="relative flex flex-col items-center gap-0.5 px-2 py-1.5 min-w-[56px]"
              >
                <div className="relative p-1.5 rounded-xl text-foreground-subtle hover:text-red-500 transition-colors">
                  <Icon className="w-5 h-5" strokeWidth={1.8} />
                </div>
                <span className="text-[9px] font-medium text-foreground-subtle">
                  {item.label}
                </span>
              </button>
            ) : (
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
                      className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-primary rounded-full text-[9px] font-bold text-foreground flex items-center justify-center"
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

      {/* ── Logout Confirmation Modal ── */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: "rgba(20,10,5,0.5)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="bg-background rounded-2xl p-6 max-w-xs w-full shadow-2xl border border-card-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-foreground mb-2 font-display">Sign out?</h3>
            <p className="text-sm text-foreground-muted mb-5">
              Are you sure you want to leave LokFeel?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-foreground-faint text-foreground-muted hover:bg-foreground-subtle transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
