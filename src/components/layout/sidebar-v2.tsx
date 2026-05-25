"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Compass,
  Heart,
  MessageSquare,
  Bell,
  User,
  Settings,
  Gift,
  Sparkles,
} from "lucide-react";
import { InvitePanel } from "@/components/invite/invite-panel";
import { useSession } from "next-auth/react";

/* ── Nav items ─────────────────────────────── */
const mainNavItems = [
  { name: "Profile",       href: "/dashboard/profile",       icon: User,         label: "Profile",       badge: false },
  { name: "Explore",       href: "/dashboard/explore",       icon: Compass,      label: "Explore",       badge: false },
  { name: "Connections",   href: "/dashboard/connections",   icon: Heart,         label: "Connections",   badge: true  },
  { name: "Chats",        href: "/dashboard/chats",          icon: MessageSquare,  label: "Chats",        badge: true  },
  { name: "Notifications", href: "/dashboard/notifications",  icon: Bell,          label: "Notifications", badge: true  },
];

interface SidebarProps {
  onCollapseChange?: (collapsed: boolean) => void;
}

export default function SidebarV2({ onCollapseChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  const avatarUrl  = session?.user?.image || "";
  const displayName = session?.user?.name || "User";

  const toggleCollapse = () => {
    const ns = !collapsed;
    setCollapsed(ns);
    onCollapseChange?.(ns);
  };

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

  /* ── Collapse‑aware label class ────────────── */
  const labelCls = `
    whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300
    ${collapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100 ml-3"}
  `;

  return (
    <aside
      className={`
        fixed left-0 top-0 h-screen
        bg-background-secondary border-r border-card-border
        transition-[width] duration-300
        z-40 hidden lg:flex lg:flex-col
        ${collapsed ? "w-20" : "w-64"}
      `}
    >
      {/* ── Logo / Avatar area ────────────────── */}
      <button
        type="button"
        onClick={toggleCollapse}
        className="
          h-16 flex items-center gap-3 px-4
          border-b border-border/10
          hover:bg-background-tertiary/50
          transition-colors cursor-pointer w-full text-left
        "
      >
        <div className="
          w-10 h-10 rounded-xl overflow-hidden
          bg-gradient-to-br from-primary to-secondary
          flex items-center justify-center flex-shrink-0
          ring-2 ring-primary/20
        ">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            <User className="w-5 h-5 text-foreground" />
          )}
        </div>

        <span className={labelCls}>
          <span className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            LokFeel
          </span>
        </span>
      </button>

      {/* ── Main navigation ────────────────────── */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {mainNavItems.map((item) => {
          const active = isActive(item.href);
          const Icon  = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                relative flex items-center gap-3
                px-3 py-2.5 rounded-xl
                transition-all duration-200 group
                ${active
                  ? "bg-primary/10 text-primary"
                  : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"}
              `}
            >
              {/* Active left bar indicator */}
              {active && (
                <span className="
                  absolute left-0 top-1/2 -translate-y-1/2
                  w-[3px] h-8
                  bg-gradient-to-b from-primary to-secondary
                  rounded-r-full
                " />
              )}

              <div className={`
                relative p-2 rounded-lg transition-colors duration-200
                ${active ? "bg-primary/15" : "group-hover:bg-background-tertiary"}
              `}>
                <Icon
                  className={`w-5 h-5 ${active ? "text-primary" : ""}`}
                  strokeWidth={active ? 2.5 : 2}
                />

                {/* Unread badge placeholder — JS‑driven */}
                {item.badge && (
                  <span className="
                    absolute -top-0.5 -right-0.5
                    min-w-[16px] h-4 px-1
                    bg-primary rounded-full
                    text-[9px] font-bold text-background
                    flex items-center justify-center
                  " />
                )}
              </div>

              <span className={`font-medium text-sm ${labelCls}`}>
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* ── Separator ────────────────────────── */}
        <div className="my-3 border-t border-border/10" />

        {/* Settings */}
        <Link
          href="/dashboard/settings"
          className={`
            flex items-center gap-3 px-3 py-2.5 rounded-xl
            transition-all duration-200
            ${isActive("/dashboard/settings")
              ? "bg-background-tertiary text-foreground"
              : "text-foreground-subtle hover:text-foreground-muted hover:bg-background-tertiary"}
          `}
        >
          <div className="p-2 rounded-lg">
            <Settings className="w-4 h-4" />
          </div>
          <span className={labelCls}>Settings</span>
        </Link>

        {/* Invite Friends */}
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="
            flex items-center gap-3 w-full px-3 py-2.5 rounded-xl
            text-sm font-medium transition-all duration-200
            text-foreground-muted hover:text-foreground hover:bg-background-tertiary
          "
          title="Invite Friends"
        >
          <Gift className="w-5 h-5" />
          <span className={labelCls}>Invite Friends</span>
        </button>
      </nav>

      {/* ── Bottom: Upgrade to Premium ─────────── */}
      <div className="p-3 border-t border-border/10">
        <Link
          href="/dashboard/subscription"
          className="
            flex items-center gap-3 px-3 py-2.5 rounded-xl
            bg-gradient-to-r from-primary/10 to-secondary/10
            border border-primary/15
            hover:border-primary/30
            transition-all duration-300 group
          "
        >
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
          <div className={labelCls}>
            <p className="text-sm font-medium text-foreground">Premium</p>
            <p className="text-xs text-foreground-muted">Unlock all features</p>
          </div>
        </Link>
      </div>

      {/* Invite panel (portal) */}
      <InvitePanel isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
    </aside>
  );
}
