"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { Heart, Bell, Shield } from "lucide-react";
import AdminSidebar from "@/components/layout/admin-sidebar";

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const notifications = 2; // Mock notification count

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main Content Area */}
      <div className="lg:pl-64">
        {/* Top Header */}
        <header className="sticky top-0 z-sticky glass-strong">
          <div className="h-16 flex items-center justify-between px-4 lg:px-6">
            {/* Admin Title */}
            <div className="flex items-center gap-3">
              <div className="hidden lg:flex items-center gap-2">
                <Shield className="w-5 h-5 text-secondary" />
                <span className="font-semibold text-white">Admin Dashboard</span>
              </div>
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-3">
              {/* Back to App */}
              <Link
                href="/dashboard"
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/60 hover:text-white text-sm"
              >
                <Heart className="w-4 h-4" />
                <span>Back to App</span>
              </Link>

              {/* Notifications */}
              <Link
                href="/admin/notifications"
                className="relative p-2 rounded-xl hover:bg-white/5 transition-colors text-white/60 hover:text-white"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                {notifications > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-secondary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {notifications}
                  </span>
                )}
              </Link>

              {/* Admin Profile */}
              <Link
                href="/admin/users/1"
                className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-secondary to-primary flex items-center justify-center text-white text-sm font-semibold">
                  A
                </div>
                <span className="hidden md:block text-sm text-white/80">Admin</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
