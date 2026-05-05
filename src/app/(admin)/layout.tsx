/**
 * Admin Layout — Server Component with Auth Guard
 *
 * Architecture:
 * - This is a SERVER COMPONENT → can use auth() to check session
 * - Redirects to /login if not authenticated
 * - Renders AdminUI (client component) with auth context
 */
import { auth } from "@/lib/auth/auth";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/layout/admin-sidebar";
import { CommandPalette } from "@/components/admin";
import { AdminToastProvider } from "@/components/admin/toast-provider";
import { ReactNode } from "react";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Server-side auth check — redirects to login if not authenticated
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main Content Area */}
      <div className="lg:pl-[260px] transition-all duration-300">
        {/* Top Header */}
        <header className="sticky top-0 z-sticky backdrop-blur-2xl bg-background/60 border-b border-card-border/50">
          <div className="h-14 flex items-center justify-between px-4 lg:px-6">
            {/* Left: Environment */}
            <div className="flex items-center gap-3">
              <a
                href="https://admin.lokfeel.com"
                className="flex items-center gap-2 text-foreground-subtle hover:text-foreground-muted transition-colors group"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                </svg>
                <span className="text-[13px] font-medium hidden sm:inline">admin.lokfeel.com</span>
              </a>
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/8 border border-emerald-500/15 text-emerald-400 text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Production
              </div>
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-1">
              {/* Back to App */}
              <a
                href="/dashboard"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-background-tertiary/60 text-foreground-subtle hover:text-foreground-muted transition-all duration-200 text-[13px] group"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                <span className="hidden md:inline">App</span>
              </a>

              {/* Admin Profile */}
              <a
                href="/admin/settings/admins"
                className="flex items-center gap-2 p-1 rounded-xl hover:bg-background-tertiary/60 transition-all duration-200 ml-0.5"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-[11px] font-bold shadow-sm shadow-primary/20">
                  {(session.user?.name?.[0] || session.user?.email?.[0] || "A").toUpperCase()}
                </div>
              </a>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>

      {/* Global Components */}
      <CommandPalette />
      <AdminToastProvider />
    </div>
  );
}
