"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Heart,
  MessageSquare,
  Bell,
  User,
} from "lucide-react";
import { useApiGet } from "@/hooks/use-api";

/* ── Nav items ─────────────────────────────── */
const navItems = [
  { name: "Profile",       href: "/dashboard/profile",       icon: User,         label: "Profile",       badgeKey: null as null },
  { name: "Explore",       href: "/dashboard/explore",       icon: Compass,      label: "Explore",       badgeKey: null as null },
  { name: "Connections",   href: "/dashboard/connections",   icon: Heart,         label: "Connections",   badgeKey: "likes" as const },
  { name: "Chats",        href: "/dashboard/chats",          icon: MessageSquare,  label: "Chats",        badgeKey: "messages" as const },
  { name: "Notifications", href: "/dashboard/notifications",  icon: Bell,          label: "Notifications", badgeKey: "notifs" as const },
];

/* ── Types ─────────────────────────────────── */
interface UnreadData  { unreadCount: number; totalChats?: number }
interface LikesData    { likes: Array<{ id: string }> }
interface NotifData    { unreadCount: number }

/* ── Component ─────────────────────────────── */
export default function BottomNav() {
  const pathname = usePathname();

  /* Data fetches */
  const { data: msgData  } = useApiGet<UnreadData>("/api/chats/unread-count");
  const { data: likeData } = useApiGet<LikesData>("/api/who-liked-me?limit=50");
  const { data: notifData } = useApiGet<NotifData>("/api/notifications?unread=true");

  const badgeMap = {
    messages: msgData?.unreadCount  || 0,
    likes:    likeData?.likes?.length || 0,
    notifs:   notifData?.unreadCount  || 0,
  } as const;

  /* Active route check */
  const isActive = (href: string) => {
    if (href === "/dashboard/explore") {
      return (
        pathname === "/dashboard/explore" ||
        pathname === "/dashboard/explore/" ||
        pathname === "/dashboard" ||
        pathname === "/dashboard/"
      );
    }
    return pathname.startsWith(href);
  };

  /* ── Render ──────────────────────────────── */
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      {/* Gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none" />

      {/* Nav rail — glass morphism */}
      <div className="relative bg-background/95 backdrop-blur-xl border-t border-card-border">
        <div
          className="flex items-stretch justify-around py-1.5 px-1"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
        >
          {navItems.map((item) => {
            const active     = isActive(item.href);
            const Icon       = item.icon;
            const badgeCount = item.badgeKey ? badgeMap[item.badgeKey] : 0;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`
                  relative flex flex-col items-center justify-center
                  gap-0.5 px-2 py-1.5 min-w-[56px] flex-1
                  transition-colors duration-200
                  ${active ? "text-primary" : "text-foreground-subtle hover:text-foreground-muted"}
                `}
              >
                {/* Active top bar — pure CSS */}
                <span
                  className={`
                    absolute top-0 left-1/2 -translate-x-1/2
                    h-[3px] rounded-b-full
                    bg-gradient-to-r from-primary to-secondary
                    transition-[width,opacity] duration-300
                    ${active ? "w-8 opacity-100" : "w-0 opacity-0"}
                  `}
                />

                {/* Icon wrapper */}
                <span className={`p-1 rounded-xl transition-colors duration-200 ${active ? "bg-primary-muted" : ""}`}>
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 1.8} />
                </span>

                {/* Label */}
                <span className={`text-[10px] font-medium leading-tight ${active ? "text-foreground" : "text-foreground-subtle"}`}>
                  {item.label}
                </span>

                {/* Unread badge */}
                {badgeCount > 0 && (
                  <span
                    className="
                      absolute top-0.5 right-[calc(50%-24px)]
                      min-w-[16px] h-4 px-1
                      bg-primary rounded-full
                      text-[9px] font-bold text-background
                      flex items-center justify-center
                      animate-[scale-in_200ms_ease-out]
                    "
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
