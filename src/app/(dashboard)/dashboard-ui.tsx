"use client";

import { useState, ReactNode, useEffect, createContext, useContext, Suspense } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Toaster } from "sonner";
import { SessionProvider } from "next-auth/react";
// 直接 import — 导航组件体积小，SSG 首屏必须可见，禁用 SSR 会导致"导航丢失"
import SidebarV2 from "@/components/layout/sidebar-v2";
import BottomNav from "@/components/layout/bottom-nav";
import DashboardFooter from "@/components/layout/dashboard-footer";
import { fetchWithRetry, getAdaptiveTimeout } from "@/lib/api";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Server-side session from auth() — preloads SessionProvider, skipping /api/auth/session fetch */
  session?: any;
}

// ══════════════════════════════════════════════════
// PROFILE CONTEXT — 全局共享profile数据，消除重复API请求
// dashboard-ui.tsx 和 page.tsx 共享同一份数据
// ══════════════════════════════════════════════════
interface ProfileContextType {
  profile: any;
  user: any;
  loading: boolean;
  complete: boolean;
  refetch: () => void;
}

const ProfileContext = createContext<ProfileContextType>({
  profile: null,
  user: null,
  loading: true,
  complete: false,
  refetch: () => {},
});

export function useProfileContext() {
  return useContext(ProfileContext);
}

// Routes that are ALWAYS accessible even with incomplete profile
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

// ══════════════════════════════════════════════════
// 模块级profile请求去重 — 确保全局只发一次 /api/profile
// ══════════════════════════════════════════════════
let profilePromise: Promise<any> | null = null;

function fetchProfileOnce(): Promise<any> {
  if (profilePromise) return profilePromise;
  
  const timeout = getAdaptiveTimeout(10000); // 根据网络状况自适应超时
  
  profilePromise = fetchWithRetry("/api/profile", {
    timeout,
    retries: 3,
    retryDelay: 1000,
    onRetry: (attempt, error) => {
      console.warn(`[Profile] Retry ${attempt}/3 after error:`, error.message);
    },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Error ${res.status}`);
      return res.json();
    })
    .finally(() => {
      // Allow re-fetch after 5s (for retry scenarios)
      setTimeout(() => { profilePromise = null; }, 5000);
    });
  
  return profilePromise;
}

export default function DashboardUI({ children, session }: DashboardLayoutProps) {
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
    user: any;
  }>({
    loading: true,
    complete: false,
    needsBlueprint: false,
    needsProfile: false,
    profile: null,
    user: null,
  });

  // Fetch profile status on mount — 使用去重fetch
  useEffect(() => {
    async function checkProfile() {
      try {
        const data = await fetchProfileOnce();
        const profile = data.profile;
        const user = data.user;

        const onboardingStep = profile?.onboardingStep || 0;
        const isOnboardingComplete = onboardingStep >= 9
          || profile?.profileStatus === "ACTIVE"
          || profile?.profileStatus === "APPROVED";

        const needsBlueprint = !isOnboardingComplete
          && !profile?.attachmentStyle
          && !profile?.relationshipGoal;

        const needsProfile = !isOnboardingComplete
          && (!profile?.avatar || !profile?.displayName || !profile?.age || !profile?.gender);

        const complete = isOnboardingComplete;

        setProfileCheck({
          loading: false,
          complete,
          needsBlueprint,
          needsProfile,
          profile,
          user,
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

  // Profile context value — 共享给子组件
  const profileContextValue: ProfileContextType = {
    profile: profileCheck.profile,
    user: profileCheck.user,
    loading: profileCheck.loading,
    complete: profileCheck.complete,
    refetch: () => {
      profilePromise = null; // 清除缓存，允许重新fetch
      setProfileCheck({
        loading: true,
        complete: false,
        needsBlueprint: false,
        needsProfile: false,
        profile: null,
        user: null,
      });
    },
  };

  return (
    <SessionProvider session={session} refetchInterval={5 * 60} refetchOnWindowFocus={false}>
    <ProfileContext.Provider value={profileContextValue}>
      <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
        {/* Lightweight background gradient — no heavy animations */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/5" />
          <div className="absolute top-1/2 -left-20 w-72 h-72 rounded-full bg-secondary/5" />
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
                  background: "var(--background)",
                  backdropFilter: "blur(12px)",
                  opacity: 0.92,
                }}
              >
                <div
                  className="glass-card p-8 max-w-md mx-4 text-center border-primary/30 shadow-lg animate-slideUp"
                >
                  <div className="w-16 h-16 rounded-2xl bg-gradient-primary flex items-center justify-center mx-auto mb-5">
                    <AlertTriangle className="w-8 h-8 text-warning" />
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
    </ProfileContext.Provider>
    </SessionProvider>
  );
}
