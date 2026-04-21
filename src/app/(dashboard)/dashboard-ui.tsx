"use client";

import { useState, ReactNode } from "react";
import SidebarV2 from "@/components/layout/sidebar-v2";
import BottomNav from "@/components/layout/bottom-nav";
import DashboardFooter from "@/components/layout/dashboard-footer";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardUI({ children }: DashboardLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Desktop Sidebar */}
      <SidebarV2 onCollapseChange={setSidebarCollapsed} />

      {/* Main Content Area */}
      <div className={`transition-all duration-300 flex-1 flex flex-col ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        {/* Page Content - 添加底部padding给移动端导航留空间 */}
        <main className="p-4 lg:p-8 pb-24 lg:pb-8 flex-1">
          {children}
        </main>

        {/* Dashboard Footer (桌面端) */}
        <DashboardFooter />
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav />
    </div>
  );
}
