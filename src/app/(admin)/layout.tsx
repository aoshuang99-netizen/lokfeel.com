/**
 * Admin Layout — Server Component with Auth Guard
 *
 * Architecture:
 * - This is a SERVER COMPONENT → checks admin_session cookie via getAdminSession()
 * - Falls back to NextAuth for database admin users
 * - IMPORTANT: /admin/login is handled by middleware bypass — this layout
 *   will NOT wrap /admin/login because the page is served from src/app/admin/login/
 *   (outside the (admin) route group)
 *
 * For authenticated admin pages, this layout:
 * 1. Verifies admin_session cookie
 * 2. Falls back to NextAuth session
 * 3. Renders the admin dashboard shell
 */
import { auth } from "@/lib/auth/auth";
import { getAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/layout/admin-sidebar";
import { CommandPalette } from "@/components/admin";
import { AdminToastProvider } from "@/components/admin/toast-provider";
import { ReactNode } from "react";
import { Users, Heart, BarChart3, Settings } from "lucide-react";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Server-side auth check — check admin_session cookie FIRST
  const adminSession = await getAdminSession();

  // Fallback to NextAuth session (for database admin users logged in via OAuth/NextAuth)
  let nextAuthSession = null;
  if (!adminSession) {
    try {
      nextAuthSession = await auth();
    } catch {
      // auth() may fail in edge cases — continue with admin_session only
    }
  }

  if (!adminSession && !nextAuthSession?.user) {
    // Redirect to admin login (NOT the main /login page)
    redirect("/admin/login");
  }

  // Determine display info
  const displayName = adminSession
    ? (adminSession.username || adminSession.email || "Admin")
    : (nextAuthSession?.user?.name || nextAuthSession?.user?.email || "Admin");

  return (
    <div className="min-h-screen bg-[#09090b]">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main Content Area */}
      <div className="lg:pl-[260px] transition-all duration-300">
        {/* Top Header */}
        <header className="sticky top-0 z-sticky bg-[#09090b]/90 backdrop-blur-xl border-b border-zinc-800">
          <div className="h-14 flex items-center justify-between px-4 lg:px-6">
            {/* Left: Environment */}
            <div className="flex items-center gap-3">
              <a
                href="https://admin.lokfeel.com"
                className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors group"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0 3-4.03 3-9s1.343-9-3-9" />
                </svg>
                <span className="text-[13px] font-medium hidden sm:inline">admin.lokfeel.com</span>
              </a>
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Production
              </div>
            </div>

            {/* Center: Quick Access */}
            <div className="hidden lg:flex items-center gap-0.5">
              <Link
                href="/admin/users"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-all duration-200 text-[13px]"
                title="用户管理"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="font-medium">用户</span>
              </Link>
              <Link
                href="/admin/matches"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-all duration-200 text-[13px]"
                title="匹配管理"
              >
                <Heart className="w-3.5 h-3.5" />
                <span className="font-medium">匹配</span>
              </Link>
              <Link
                href="/admin/analytics"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-all duration-200 text-[13px]"
                title="数据分析"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span className="font-medium">分析</span>
              </Link>
              <Link
                href="/admin/settings"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-all duration-200 text-[13px]"
                title="系统设置"
              >
                <Settings className="w-3.5 h-3.5" />
                <span className="font-medium">设置</span>
              </Link>
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-1">
              {/* Back to App */}
              <a
                href="/dashboard"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-all duration-200 text-[13px] group"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                <span className="hidden md:inline">App</span>
              </a>

              {/* Admin Profile */}
              <a
                href="/admin/settings/admins"
                className="flex items-center gap-2 p-1 rounded-xl hover:bg-zinc-800/50 transition-all duration-200 ml-0.5"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-[11px] font-bold shadow-sm">
                  {(displayName?.[0] || "A").toUpperCase()}
                </div>
              </a>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="min-h-[calc(100vh-3.5rem)]">
          {children}
        </main>
      </div>

      {/* Global Components */}
      <CommandPalette />
      <AdminToastProvider />
    </div>
  );
}
