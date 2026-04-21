"use client";

import { useState, ReactNode } from "react";
import SidebarV2 from "@/components/layout/sidebar-v2";
import BottomNav from "@/components/layout/bottom-nav";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardUI({ children }: DashboardLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <SidebarV2 onCollapseChange={setSidebarCollapsed} />

      {/* Main Content Area */}
      <div className={`transition-all duration-300 ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        {/* Page Content - 添加底部padding给移动端导航留空间 */}
        <main className="p-4 lg:p-8 pb-24 lg:pb-8 min-h-screen">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav />
    </div>
  );
}
