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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

const navigation = [
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Matches", href: "/admin/matches", icon: Heart },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { name: "Content", href: "/admin/content", icon: FileText },
  { name: "Settings", href: "/admin/settings", icon: Settings },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed left-0 top-0 h-screen bg-background-secondary border-r border-card-border transition-all duration-300 z-fixed ${
          isCollapsed ? "w-20" : "w-64"
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-card-border">
          <Link href="/admin" className="flex items-center gap-2">
            <Shield className="w-7 h-7 text-secondary" />
            {!isCollapsed && (
              <span className="text-xl font-bold">Admin</span>
            )}
          </Link>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg hover:bg-background-tertiary transition-colors text-foreground-subtle hover:text-foreground"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Admin Badge */}
        {!isCollapsed && (
          <div className="px-4 py-3">
            <span className="badge badge-secondary">Super Admin</span>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                  isActive
                    ? "bg-gradient-to-r from-secondary/20 to-primary/20 text-foreground border border-secondary/30"
                    : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
                } ${isCollapsed ? "justify-center" : ""}`}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 ${
                    isActive ? "text-secondary" : "text-foreground-subtle group-hover:text-foreground"
                  }`}
                />
                {!isCollapsed && (
                  <span className="font-medium">{item.name}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Back to App */}
        <div className="p-4 border-t border-card-border">
          <Link
            href="/dashboard"
            className={`flex items-center gap-3 text-foreground-subtle hover:text-foreground transition-colors ${
              isCollapsed ? "justify-center" : ""
            }`}
          >
            <Shield className="w-4 h-4" />
            {!isCollapsed && <span className="text-sm">Back to App</span>}
          </Link>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      <aside className="lg:hidden fixed inset-0 z-fixed">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="absolute left-0 top-0 h-full w-72 bg-background-secondary border-r border-card-border p-6 pt-20">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-7 h-7 text-secondary" />
            <span className="text-xl font-bold">Admin</span>
          </div>
          <span className="badge badge-secondary mb-6">Super Admin</span>

          {/* Navigation */}
          <nav className="space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    isActive
                      ? "bg-gradient-to-r from-secondary/20 to-primary/20 text-foreground border border-secondary/30"
                      : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? "text-secondary" : ""}`} />
                  <span className="font-medium">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Back to App */}
          <Link
            href="/dashboard"
            className="flex items-center gap-3 mt-6 text-foreground-subtle hover:text-foreground transition-colors"
          >
            <Shield className="w-4 h-4" />
            <span className="text-sm">Back to App</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
