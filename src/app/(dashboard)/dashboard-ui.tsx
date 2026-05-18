"use client";

import { useState, ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Toaster } from "sonner";
import SidebarV2 from "@/components/layout/sidebar-v2";
import BottomNav from "@/components/layout/bottom-nav";
import DashboardFooter from "@/components/layout/dashboard-footer";

interface DashboardLayoutProps {
  children: ReactNode;
}

// Routes that are ALWAYS accessible even with incomplete profile
// NOTE: Core user features (chats, connections, notifications) should always
// be accessible — blocking them creates a dead-end experience where users
// can't use the app at all. Only lock truly premium/advanced features.
const ALLOWED_ROUTES_WHEN_INCOMPLETE = [
  "/dashboard/onboarding",
  "/dashboard/profile",
  "/dashboard/settings",
  "/dashboard/explore",
  "/dashboard/chats",
  "/dashboard/connections",
  "/dashboard/notifications",
  "/dashboard/subscription",
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
        // Onboarding is complete if step >= 9, or profileStatus is APPROVED/ACTIVE
        // NOTE: Onboarding sets profileStatus to "APPROVED" (not "ACTIVE"),
        // so we must check both values.
        const isOnboardingComplete = onboardingStep >= 9
          || profile?.profileStatus === "ACTIVE"
          || profile?.profileStatus === "APPROVED";

        // Blueprint check — only flag if onboarding is NOT complete
        // Once onboarding finishes, these fields are guaranteed populated
        const needsBlueprint = !isOnboardingComplete
          && !profile?.attachmentStyle
          && !profile?.relationshipGoal;

        // Profile fields check — only flag if onboarding is NOT complete
        // Once onboarding finishes (step >= 9), the user has provided all
        // required data. Don't re-lock them over optional fields like city.
        const needsProfile = !isOnboardingComplete
          && (!profile?.avatar || !profile?.displayName || !profile?.age || !profile?.gender);

        const complete = isOnboardingComplete;

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
  // Instead of forcing to explore, redirect to onboarding/profile
  useEffect(() => {
    if (profileCheck.loading) return;
    if (profileCheck.complete) return;
    if (isAllowedWhenIncomplete(pathname)) return;

    // User is incomplete and on a locked page → redirect to profile completion
    const target = profileCheck.needsProfile
      ? "/dashboard/onboarding"
      : "/dashboard/profile";
    router.replace(target);
  }, [profileCheck, pathname, router]);

  // Determine what to show
  const isLocked = !profileCheck.loading && !profileCheck.complete && !isAllowedWhenIncomplete(pathname);
  const isDashboard = pathname === "/dashboard" || pathname === "/dashboard/" || pathname === "/dashboard/explore" || pathname === "/dashboard/explore/";

  // Determine where to direct the user for profile completion
  const completionTarget = profileCheck.needsProfile
    ? "/dashboard/onboarding"
    : "/dashboard/profile";

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Cool Blue gradient orbs — atmospheric depth */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/5 rounded-full blur-[120px] animate-breathe" />
        <div className="absolute top-1/2 -left-20 w-72 h-72 bg-secondary/5 rounded-full blur-[100px] animate-breathe" style={{ animationDelay: "2s" }} />
        <div className="absolute -bottom-32 right-1/4 w-80 h-80 bg-cyan-500/3 rounded-full blur-[110px] animate-breathe" style={{ animationDelay: "4s" }} />
      </div>

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
                background: "rgba(5, 10, 24, 0.92)",
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
                  Complete your five-dimension card to unlock all features.
                </p>
                <Link
                  href={completionTarget}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  Complete Profile
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

      {/* Sonner Toast — renders all toast notifications for dashboard pages */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: "glass-card border",
            title: "text-foreground font-medium",
            description: "text-foreground-muted text-sm",
          },
        }}
        richColors
        closeButton
      />
    </div>
  );
}
