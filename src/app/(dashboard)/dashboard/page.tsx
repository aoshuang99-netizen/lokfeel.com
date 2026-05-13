"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  Heart,
  MessageCircle,
  Sparkles,
  ChevronRight,
  Flame,
  ArrowRight,
  Check,
  Loader2,
  Search,
  User,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Skeleton, SkeletonCard, SkeletonStatCard, InlineError } from "@/components/ui";
import { getAvatarKind, getAvatarBackground, parseEmojiAvatar, getRealPhotoAvatarUrl, isUnsplashUrl, generateLocalAvatarDataUri } from "@/lib/avatar-utils";
import { AnalyticsReport } from "@/components/dashboard/analytics-report";

// ════════════════════════════════════
// DESIGN TOKENS — Cool Blue Design System
// ════════════════════════════════════
const COLORS = {
  primary: "#3b82f6",
  primaryHover: "#60a5fa",
  secondary: "#6366f1",
  cta: "#22d3ee",
  pink: "#f472b6",
};

const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// ════════════════════════════════════
// TYPES
// ════════════════════════════════════
interface DashboardData {
  profile: any;
  user: any;
}

interface DiscoverUser {
  id: string;
  name: string;
  age: number;
  avatar: string | null;
  avatarType?: string;
  city?: string;
  bio?: string;
  matchScore: number;
  matchReason: string;
  verified?: boolean;
}

// ════════════════════════════════════
// TODAY'S PICK CARD — 精简优化
// ════════════════════════════════════
function TodayPickCard({ user, index }: { user: DiscoverUser; index: number }) {
  const getMatchScoreColor = (score: number) => {
    if (score >= 90) return "from-amber-400 to-amber-600";
    if (score >= 80) return "from-primary to-pink-500";
    return "from-primary/70 to-secondary/70";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
      className="flex-shrink-0 w-[280px] snap-start"
    >
      <Link href={`/dashboard/users/${user.id}`}>
        <div className="relative rounded-2xl overflow-hidden group cursor-pointer bg-background-secondary border border-card-border hover:border-primary/30 transition-all duration-300">
          {/* Avatar Area — Real HD Photos */}
          <div className="relative h-72 overflow-hidden bg-background-tertiary">
            {(() => {
              const kind = getAvatarKind(user.avatar);
              if (kind === 'emoji') {
                const parsed = parseEmojiAvatar(user.avatar);
                return (
                  <div
                    className="w-full h-full flex items-center justify-center text-8xl"
                    style={{ background: getAvatarBackground(kind, user.avatar) }}
                  >
                    {parsed?.emoji}
                  </div>
                );
              }
              // Use real photo: either user's photo or gender-aware fallback
              const photoUrl = kind === 'photo' && user.avatar
                ? user.avatar
                : getRealPhotoAvatarUrl(user.id || user.name, undefined, 'preview');
              return (
                <img
                  src={photoUrl}
                  alt={user.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading={index < 3 ? "eager" : "lazy"}
                  decoding="async"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    // Tier-1: Try different Unsplash photo from pool
                    const fallbackUrl = getRealPhotoAvatarUrl(user.id || user.name, undefined, 'preview');
                    if (img.src !== fallbackUrl) {
                      img.src = fallbackUrl;
                    } else {
                      // Tier-2: All external URLs failed — use local SVG data-URI
                      img.src = generateLocalAvatarDataUri(user.id || user.name);
                    }
                  }}
                />
              );
            })()}

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

            {/* Match Score Badge */}
            <div className="absolute top-3 left-3">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-white bg-gradient-to-r ${getMatchScoreColor(user.matchScore)}`}>
                <Flame className="w-3 h-3" />
                {Math.round(user.matchScore)}%
              </span>
            </div>

            {/* Verified Badge */}
            {user.verified && (
              <div className="absolute top-3 right-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/80 text-white text-[10px] font-medium">
                  ✓ Verified
                </span>
              </div>
            )}

            {/* Name & Age Overlay */}
            <div className="absolute bottom-3 left-3 right-3">
              <h3 className="text-lg font-bold text-white font-display">
                {user.name}, {user.age}
              </h3>
              {user.city && (
                <p className="text-white/70 text-xs mt-0.5">{user.city}</p>
              )}
            </div>
          </div>

          {/* Match Reason */}
          <div className="p-3">
            <p className="text-foreground-muted text-xs line-clamp-2 leading-relaxed">
              {user.matchReason}
            </p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ════════════════════════════════════
// USE API GET WITH RETRY
// ════════════════════════════════════
function useApiGetWithRetry<T>(url: string | null, retryKey: number): {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { data: session, status: authStatus } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    setError(null);
    setIsLoading(true);
    // The useEffect below will re-run due to retryKey change
  };

  useEffect(() => {
    if (!url) return;
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      setIsLoading(false);
      setError("Please sign in");
      return;
    }

    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(url);
        if (cancelled) return;
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Request failed" }));
          setError(err.message || `Error ${res.status}`);
          return;
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Service unavailable");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [url, authStatus, retryKey]);

  return { data, isLoading, error, refetch };
}

// ════════════════════════════════════
// MAIN DASHBOARD PAGE — 重新设计
// ════════════════════════════════════
export default function DashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [retryKey, setRetryKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: profileData, isLoading: profileLoading, error: profileError } = useApiGetWithRetry<DashboardData>("/api/profile", retryKey);
  const { data: discoverData, isLoading: discoverLoading } = useApiGetWithRetry<{ users: DiscoverUser[] }>("/api/discover?limit=8", retryKey);

  const user = profileData?.user || session?.user;
  const profile = profileData?.profile;
  const userName = user?.name || profile?.displayName || "there";
  const firstName = userName.split(" ")[0];
  const discoverUsers = discoverData?.users || [];

  // Greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  // Onboarding status
  const onboardingStep = profile?.onboardingStep || 0;
  const isOnboardingComplete = onboardingStep >= 6;
  const profileRequiredMissing = !profile?.avatar || !profile?.displayName || !profile?.age || !profile?.gender || !profile?.city;
  const isProfileLocked = !isOnboardingComplete || profileRequiredMissing;

  // ═══ AUTO-MATCH ═══
  const [autoMatchTriggered, setAutoMatchTriggered] = useState(false);
  useEffect(() => {
    if (autoMatchTriggered || authStatus === "loading") return;
    if (profileData?.profile) {
      setAutoMatchTriggered(true);
      fetch("/api/auto-match", { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.createdCount > 0) {
            setRetryKey((prev) => prev + 1);
          }
        })
        .catch((err) => console.warn("[Auto-Match] Failed:", err));
    }
  }, [profileData, authStatus, autoMatchTriggered]);

  // ═══ LOADING STATE ═══
  if (profileLoading) {
    return (
      <div className="space-y-8 max-w-6xl mx-auto px-4 py-8">
        <Skeleton variant="text" width="50%" height={32} />
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ═══ ERROR STATE ═══
  if (profileError) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <InlineError error={profileError} onRetry={() => setRetryKey((prev) => prev + 1)} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-10 relative min-h-screen">
      {/* ── Subtle background orbs ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="absolute w-[500px] h-[500px] -top-48 -right-48 bg-primary/5 rounded-full blur-3xl opacity-40 animate-pulse" />
        <div className="absolute w-[400px] h-[400px] bottom-32 -left-40 bg-accent/5 rounded-full blur-3xl opacity-30 animate-pulse" style={{ animationDelay: "2s" }} />
      </div>

      {/* ════════════════════════════════════
          SECTION 1: PERSONALIZED GREETING
          ════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-1 font-display">
          {getGreeting()}, <span className="text-primary-hover">{firstName}</span>
        </h1>
        <p className="text-foreground-muted text-sm">
          Discover people who match your relationship blueprint
        </p>
      </motion.section>

      {/* ════════════════════════════════════
          SECTION 2: TODAY'S PICKS — 核心区块
          ════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cta/30 to-cta/10 flex items-center justify-center">
              <Flame className="w-4 h-4 text-cta" />
            </div>
            <h2 className="text-lg font-semibold text-foreground font-display">Today's Picks</h2>
            <span className="text-xs text-foreground-muted ml-2">
              {discoverUsers.length} {discoverUsers.length === 1 ? 'person' : 'people'} nearby
            </span>
          </div>
          <Link
            href="/dashboard/explore"
            className="text-xs text-foreground-muted hover:text-primary transition-colors flex items-center gap-1"
          >
            View All <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {discoverLoading ? (
          <div className="flex gap-4 overflow-hidden">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-[280px] flex-shrink-0 h-96 rounded-2xl bg-foreground-faint animate-pulse" />
            ))}
          </div>
        ) : discoverUsers.length > 0 ? (
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {discoverUsers.map((user, index) => (
              <TodayPickCard key={user.id} user={user} index={index} />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-background-secondary rounded-2xl p-8 text-center border border-card-border"
          >
            <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground-muted mb-1">Finding your matches...</h3>
            <p className="text-foreground-muted text-sm mb-4">
              We're searching for people who match your blueprint.
            </p>
            <Link href="/dashboard/explore" className="btn-primary text-sm inline-flex items-center gap-2">
              <Search className="w-4 h-4" />
              Browse Discover
            </Link>
          </motion.div>
        )}
      </section>

      {/* ════════════════════════════════════
          SECTION 3: QUICK ACTIONS — 简化
          ════════════════════════════════════ */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/dashboard/chats" className="bg-background-secondary rounded-2xl p-4 border border-card-border hover:border-primary/30 transition-all duration-300 group">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <MessageCircle className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">Messages</p>
          <p className="text-xs text-foreground-muted mt-0.5">Chat with matches</p>
        </Link>

        <Link href="/dashboard/notifications" className="bg-background-secondary rounded-2xl p-4 border border-card-border hover:border-pink-500/30 transition-all duration-300 group">
          <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <Heart className="w-5 h-5 text-pink-400" />
          </div>
          <p className="text-sm font-medium text-foreground">Matches</p>
          <p className="text-xs text-foreground-muted mt-0.5">View your matches</p>
        </Link>

        <Link href="/dashboard/profile" className="bg-background-secondary rounded-2xl p-4 border border-card-border hover:border-primary/30 transition-all duration-300 group">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <User className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">Profile</p>
          <p className="text-xs text-foreground-muted mt-0.5">Edit your info</p>
        </Link>

        <Link href="/dashboard/subscription" className="bg-background-secondary rounded-2xl p-4 border border-card-border hover:border-cta/30 transition-all duration-300 group">
          <div className="w-10 h-10 rounded-xl bg-cta/20 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
            <Sparkles className="w-5 h-5 text-cta" />
          </div>
          <p className="text-sm font-medium text-foreground">Upgrade</p>
          <p className="text-xs text-foreground-muted mt-0.5">Unlock premium</p>
        </Link>
      </section>

      {/* ════════════════════════════════════
          SECTION 4: ANALYTICS REPORT
          ════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <AnalyticsReport />
      </motion.section>

      {/* Onboarding CTA — 如果没有完成 */}
      {isProfileLocked && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-background-secondary rounded-2xl p-6 border border-primary/30"
        >
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h3 className="font-semibold text-foreground">Complete your profile</h3>
              <p className="text-sm text-foreground-muted mt-0.5">
                Finish onboarding to start matching with real people
              </p>
            </div>
            <Link
              href={isOnboardingComplete ? "/dashboard/profile" : "/dashboard/onboarding"}
              className="btn-primary whitespace-nowrap"
            >
              {isOnboardingComplete ? "Complete Profile" : "Start Onboarding"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  );
}
