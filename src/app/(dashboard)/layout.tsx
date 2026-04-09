"use client";

import { useState, ReactNode } from "react";
import Link from "next/link";
import { Heart, Bell, Menu, X, LogOut } from "lucide-react";
import Sidebar from "@/components/layout/sidebar";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [notifications] = useState(0); // Will be replaced with real data
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <Sidebar onCollapseChange={setSidebarCollapsed} />

      {/* Main Content Area */}
      <div className={`transition-all duration-300 ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        {/* Top Header */}
        <header className="sticky top-0 z-sticky glass-strong">
          <div className="h-16 flex items-center justify-between px-4 lg:px-6">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-white/60 hover:text-white transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>

            {/* Mobile Logo */}
            <Link href="/dashboard" className="lg:hidden flex items-center gap-2">
              <Heart className="w-6 h-6 text-primary" />
              <span className="text-lg font-bold text-gradient">Nexus</span>
            </Link>

            {/* Right Side Actions */}
            <div className="flex items-center gap-3">
              {/* Notifications */}
              <Link
                href="/dashboard/notifications"
                className="relative p-2 rounded-xl hover:bg-white/5 transition-colors text-white/60 hover:text-white"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                {notifications > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {notifications > 9 ? "9+" : notifications}
                  </span>
                )}
              </Link>

              {/* Logout */}
              <button
                className="p-2 rounded-xl hover:bg-white/5 transition-colors text-white/60 hover:text-white"
                aria-label="Sign out"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.location.href = "/api/auth/signout";
                  }
                }}
              >
                <LogOut className="w-5 h-5" />
              </button>

              {/* Profile */}
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-sm font-semibold">
                  N
                </div>
              </Link>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">
          {children}
        </main>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-dropdown lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 bg-background-secondary border-r border-white/10 p-6 pt-20">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute top-4 right-4 p-2 text-white/60 hover:text-white transition-colors"
              aria-label="Close menu"
            >
              <X className="w-6 h-6" />
            </button>
            {/* Mobile nav links rendered by the Sidebar component */}
          </div>
        </div>
      )}
    </div>
  );
}
