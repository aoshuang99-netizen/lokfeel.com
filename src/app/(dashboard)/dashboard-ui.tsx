"use client";

import { useState, ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import SidebarV2 from "@/components/layout/sidebar-v2";
import BottomNav from "@/components/layout/bottom-nav";
import DashboardFooter from "@/components/layout/dashboard-footer";

interface DashboardLayoutProps {
  children: ReactNode;
}

// Routes that are ALWAYS accessible even with incomplete profile
const ALLOWED_ROUTES_WHEN_INCOMPLETE = [
  "/dashboard/onboarding",
  "/dashboard/profile",
  "/dashboard/settings",
  "/dashboard/explore",
];

function isAllowedWhenIncomplete(path: string): boolean {
  return ALLOWED_ROUTES_WHEN_INCOMPLETE.some((allowed) =>
    path === allowed || path.startsWith(allowed + "/")
  );
}

export default function DashboardUI({ children }: DashboardLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Profile completion state
  const [profileCheck, setProfileCheck] = useState<{
    loading: boolean;
    complete: boolean;
    needsBlueprint: boolean;
    needsProfile: boolean;
    profile: any;
  }>({
    loading: true,
    complete: false,
    needsBlueprint: false,
    needsProfile: false,
    profile: null,
  });

  // Fetch profile status on mount
  useEffect(() => {
    async function checkProfile() {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) {
          setProfileCheck((p) => ({ ...p, loading: false }));
          return;
        }
        const data = await res.json();
        const profile = data.profile;

        const onboardingStep = profile?.onboardingStep || 0;
        const isOnboardingComplete = onboardingStep >= 9 || profile?.profileStatus === "ACTIVE";

        // Blueprint check
        const needsBlueprint = !profile?.attachmentStyle && !profile?.relationshipGoal;

        // Profile fields check
        const needsProfile =
          !profile?.avatar || !profile?.displayName || !profile?.age || !profile?.gender || !profile?.city;

        const complete = isOnboardingComplete && !needsBlueprint && !needsProfile;

        setProfileCheck({
          loading: false,
          complete,
          needsBlueprint,
          needsProfile,
          profile,
        });
      } catch {
        setProfileCheck((p) => ({ ...p, loading: false }));
      }
    }
    checkProfile();
  }, []);

  // Auto-redirect incomplete users away from locked pages
  useEffect(() => {
    if (profileCheck.loading) return;
    if (profileCheck.complete) return;
    if (isAllowedWhenIncomplete(pathname)) return;

    // User is incomplete and on a locked page → redirect to explore
    router.replace("/dashboard/explore");
  }, [profileCheck, pathname, router]);

  // Determine what to show
  const isLocked = !profileCheck.loading && !profileCheck.complete && !isAllowedWhenIncomplete(pathname);
  const isDashboard = pathname === "/dashboard" || pathname === "/dashboard/" || pathname === "/dashboard/explore" || pathname === "/dashboard/explore/";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Desktop Sidebar */}
      <SidebarV2 onCollapseChange={setSidebarCollapsed} />

      {/* Main Content Area */}
      <div className={`transition-all duration-300 flex-1 flex flex-col ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        {/* Page Content */}
        <main className="p-4 lg:p-8 pb-24 lg:pb-8 flex-1 relative">
          {/* ── Global Lock Overlay (non-dashboard locked pages) ── */}
          {isLocked && !isDashboard && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in"
              style={{
                background: "rgba(10, 10, 10, 0.92)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div
                className="glass-card p-8 max-w-md mx-4 text-center border-primary/30 shadow-lg animate-slideUp"
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-primary flex items-center justify-center mx-auto mb-5">
                  <AlertTriangle className="w-8 h-8 text-amber-400" />
                </div>
                <h2 className="text-xl font-bold text-foreground mb-2 font-display">
                  Complete Your Setup First
                </h2>
                <p className="text-sm text-foreground-muted mb-6 leading-relaxed">
                  You need to finish your profile before accessing this feature.
                </p>
                <Link
                  href="/dashboard/explore"
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  Go to Explore
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}

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
