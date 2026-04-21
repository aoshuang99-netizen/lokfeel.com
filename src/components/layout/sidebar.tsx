"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageCircle,
  User,
  CreditCard,
  Settings,
  Heart,
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Users,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";

interface SidebarProps {
  onCollapseChange?: (collapsed: boolean) => void;
}

const mainNavigation = [
  { name: "Home", href: "/dashboard", icon: LayoutDashboard },
  { name: "Discover", href: "/dashboard/square", icon: Users },
  { name: "My Matches", href: "/dashboard/matches", icon: Heart },
  { name: "Messages", href: "/dashboard/chat", icon: MessageCircle },
  { name: "Alerts", href: "/dashboard/notifications", icon: Bell },
];

// 🆕 折叠到"My"菜单下的子菜单
const mySubmenuItems = [
  { name: "My Profile", href: "/dashboard/profile", icon: User },
  { name: "Membership", href: "/dashboard/subscription", icon: CreditCard },
  { name: "Preferences", href: "/dashboard/settings", icon: Settings },
];

export default function Sidebar({ onCollapseChange }: SidebarProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMyMenuOpen, setIsMyMenuOpen] = useState(false);
  const { data: session, status } = useSession();

  const user = session?.user;
  const displayName = user?.name || "New User";
  const userRole = (user as any)?.role || "USER";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleToggle = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    onCollapseChange?.(newCollapsed);
  };

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed left-0 top-0 h-screen bg-background-secondary border-r border-white/10 transition-all duration-300 z-fixed ${
          isCollapsed ? "w-20" : "w-64"
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Heart className="w-7 h-7 text-primary" />
            {!isCollapsed && (
              <span className="text-xl font-bold text-gradient">LokFeel</span>
            )}
          </Link>
          <button
            onClick={handleToggle}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {!isCollapsed && (
            <p className="text-xs font-medium text-white/30 uppercase tracking-wider px-3 mb-3">
              Main
            </p>
          )}
          {mainNavigation.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                  active
                    ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                } ${isCollapsed ? "justify-center" : ""}`}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 ${
                    active ? "text-primary" : "text-white/40 group-hover:text-white"
                  }`}
                />
                {!isCollapsed && (
                  <span className="font-medium">{item.name}</span>
                )}
              </Link>
            );
          })}

          {/* Divider */}
          <div className="my-4 border-t border-white/10" />

          {/* 🆕 My Menu - 折叠菜单 */}
          {!isCollapsed && (
            <div className="mb-2">
              <button
                onClick={() => setIsMyMenuOpen(!isMyMenuOpen)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 group text-white/60 hover:text-white hover:bg-white/5`}
              >
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 flex-shrink-0 text-white/40 group-hover:text-white" />
                  <span className="font-medium">My</span>
                </div>
                {isMyMenuOpen ? (
                  <ChevronUp className="w-4 h-4 text-white/40" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-white/40" />
                )}
              </button>
              
              {/* Submenu */}
              {isMyMenuOpen && (
                <div className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-3">
                  {mySubmenuItems.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 text-sm ${
                          active
                            ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
                            : "text-white/60 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 flex-shrink-0 ${
                            active ? "text-primary" : "text-white/40"
                          }`}
                        />
                        <span>{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          
          {/* Collapsed state - show icons only */}
          {isCollapsed && (
            <div className="space-y-1">
              {mySubmenuItems.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center justify-center px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                      active
                        ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                    title={item.name}
                  >
                    <Icon
                      className={`w-5 h-5 flex-shrink-0 ${
                        active ? "text-primary" : "text-white/40 group-hover:text-white"
                      }`}
                    />
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        {/* User Profile */}
        <div className={`p-4 border-t border-white/10 ${isCollapsed ? "text-center" : ""}`}>
          <div className={`flex items-center gap-3 ${isCollapsed ? "justify-center" : ""}`}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-semibold text-sm">
              {initials}
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                <p className="text-xs text-white/40 truncate">
                  {userRole === "ADMIN" || userRole === "SUPER_ADMIN"
                    ? "Admin"
                    : "Free Plan"}
                </p>
              </div>
            )}
          </div>
          {!isCollapsed && (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="mt-3 flex items-center gap-2 text-white/40 hover:text-white/60 text-sm transition-colors w-full px-1"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Sidebar */}
      <aside
        className={`lg:hidden fixed inset-0 z-fixed transition-opacity duration-300 ${
          pathname.startsWith("/dashboard") ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="absolute left-0 top-0 h-full w-72 bg-background-secondary border-r border-white/10 p-6 pt-20">
          {/* Logo */}
          <div className="flex items-center justify-between mb-8">
            <Link href="/dashboard" className="flex items-center gap-2">
              <Heart className="w-7 h-7 text-primary" />
              <span className="text-xl font-bold text-gradient">Nexus</span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="space-y-1">
            <p className="text-xs font-medium text-white/30 uppercase tracking-wider px-3 mb-3">
              Main
            </p>
            {mainNavigation.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} />
                  <span className="font-medium">{item.name}</span>
                </Link>
              );
            })}

            <div className="my-4 border-t border-white/10" />

            {/* 🆕 Mobile My Menu */}
            <p className="text-xs font-medium text-white/30 uppercase tracking-wider px-3 mb-3">
              My
            </p>
            {mySubmenuItems.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} />
                  <span className="font-medium">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* User Info */}
          <div className="absolute bottom-8 left-6 right-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-semibold text-sm">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                <p className="text-xs text-white/40 truncate">Free Plan</p>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 text-white/40 hover:text-white/60 text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
