"use client";

import { useState, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Bell, Menu, X, LogOut, LayoutDashboard, MessageCircle, User, CreditCard, Settings } from "lucide-react";
import { signOut } from "next-auth/react";
import Sidebar from "@/components/layout/sidebar";
import VerificationBanner from "@/components/verification-banner";

interface DashboardLayoutProps {
  children: ReactNode;
}

const mainNavigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Matches", href: "/dashboard/matches", icon: Heart },
  { name: "Chat", href: "/dashboard/chat", icon: MessageCircle },
];

const accountNavigation = [
  { name: "Profile", href: "/dashboard/profile", icon: User },
  { name: "Subscription", href: "/dashboard/subscription", icon: CreditCard },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardUI({ children }: DashboardLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [notifications] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar onCollapseChange={setSidebarCollapsed} />
      </div>

      {/* Main Content Area */}
      <div className={`transition-all duration-300 ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        {/* Verification Banner (shows if email not verified) */}
        <VerificationBanner />

        {/* Top Header */}
        <header className="sticky top-0 z-sticky glass-strong">
          <div className="h-16 flex items-center justify-between px-4 lg:px-6">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-white/60 hover:text-white transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
            <Link href="/dashboard" className="lg:hidden flex items-center gap-2">
              <Heart className="w-6 h-6 text-primary" />
              <span className="text-lg font-bold text-gradient">LokFeel</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/dashboard/notifications" className="relative p-2 rounded-xl hover:bg-white/5 transition-colors text-white/60 hover:text-white">
                <Bell className="w-5 h-5" />
                {notifications > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center">{notifications}</span>
                )}
              </Link>
              <Link href="/dashboard/profile" className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/5 transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-sm font-semibold">U</div>
              </Link>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8 pb-24 lg:pb-8">{children}</main>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-72 bg-surface border-r border-white/10 z-50 lg:hidden">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setIsMobileMenuOpen(false)}>
                <Heart className="w-7 h-7 text-primary" />
                <span className="text-xl font-bold text-gradient">LokFeel</span>
              </Link>
              <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 rounded-lg hover:bg-white/5 text-white/60"><X className="w-5 h-5" /></button>
            </div>
            <nav className="py-4 px-3">
              <p className="text-xs font-medium text-white/30 uppercase tracking-wider px-3 mb-3">Main</p>
              {mainNavigation.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (<Link key={item.name} href={item.href} onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? "bg-gradient-to-r from-primary/20 to-secondary/20 border border-primary/30 text-white" : "text-white/60 hover:text-white hover:bg-white/5"}`}>
                  <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} /><span className="font-medium">{item.name}</span>
                </Link>);
              })}
              <div className="my-4 border-t border-white/10" />
              <p className="text-xs font-medium text-white/30 uppercase tracking-wider px-3 mb-3">Account</p>
              {accountNavigation.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (<Link key={item.name} href={item.href} onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? "bg-gradient-to-r from-primary/20 to-secondary/20 border border-primary/30 text-white" : "text-white/60 hover:text-white hover:bg-white/5"}`}>
                  <Icon className={`w-5 h-5 ${active ? "text-primary" : ""}`} /><span className="font-medium">{item.name}</span>
                </Link>);
              })}
            </nav>
            <div className="absolute bottom-8 left-6 right-6">
              <button onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-2 text-white/40 hover:text-white/60 text-sm">
                <LogOut className="w-4 h-4" />Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-background-secondary/95 backdrop-blur-lg border-t border-white/10 z-sticky">
        <div className="flex items-center justify-around py-2">
          {mainNavigation.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (<Link key={item.name} href={item.href} className={`flex flex-col items-center gap-1 px-4 py-2 ${active ? "text-primary" : "text-white/40"}`}>
              <Icon className="w-5 h-5" /><span className="text-[10px] font-medium">{item.name}</span>
            </Link>);
          })}
        </div>
      </nav>
    </div>
  );
}
