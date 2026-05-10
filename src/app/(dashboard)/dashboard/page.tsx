"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import OnboardingTour from "@/components/onboarding/onboarding-tour";
import {
  Heart,
  MessageCircle,
  User,
  Sparkles,
  TrendingUp,
  ChevronRight,
  Star,
  RefreshCw,
  Search,
  Bell,
  Zap,
  Radar,
  ArrowRight,
  Clock,
  Eye,
  Flame,
  Compass,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Skeleton, SkeletonCard, SkeletonStatCard, InlineError } from "@/components/ui";
import { CardVerificationWall } from "@/components/payment/CardVerificationWall";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar } from "@/lib/avatar-utils";

// ══════════════════════════════════════
// DESIGN TOKENS — Dateasy Dark (Purple + Lime)
// ══════════════════════════════════════
const COLORS = {
  primary: "#4c1d95",           // Deep Purple
  primaryLight: "#8b5cf6",     // Violet
  primaryDark: "#3b0764",       // Dark Purple
  accent: "#a3e635",            // Lime CTA
  accentLight: "#bef264",       // Light Lime
  pink: "#f472b6",              // Pink accent
  purple: "#4c1d95",            // Deep Purple
  success: "#a3e635",
  warning: "#fbbf24",
  error: "#fb7185",
};

const EASING = "cubic-bezier(0.22, 1, 0.36, 1)"; // Nexus ease

// ══════════════════════════════════════
// INTERFACES
// ══════════════════════════════════════

interface DashboardData {
  profile: any;
  user: any;
}

interface MatchesData {
  matches: Array<{
    id: string;
    otherUser: {
      id: string;
      name: string;
      age: number;
      avatar: string | null;
      city: string | null;
    };
    matchScore: number;
    matchReason: string;
    status: string;
    myReaction: string | null;
    createdAt: string;
  }>;
}

interface NotificationsData {
  unreadCount: number;
}

interface UnreadMessagesData {
  unreadCount: number;
  totalChats: number;
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

// ══════════════════════════════════════
// ENHANCED RADAR CHART COMPONENT
// ══════════════════════════════════════

function RadarChart({ data, size = 200 }: { data: { label: string; value: number }[]; size?: number }) {
  const center = size / 2;
  const radius = size * 0.33;
  const levels = 5;
  const angleSlice = (Math.PI * 2) / data.length;

  const getCoordinates = (value: number, index: number) => {
    const angle = index * angleSlice - Math.PI / 2;
    const r = (value / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const pathData = data
    .map((d, i) => {
      const { x, y } = getCoordinates(d.value, i);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ") + " Z";

  return (
    <svg width={size} height={size} className="mx-auto">
      {/* Background grid — 加深对比度 */}
      {[...Array(levels)].map((_, i) => {
        const r = ((i + 1) / levels) * radius;
        const circlePoints = data
          .map((_, j) => {
            const angle = j * angleSlice - Math.PI / 2;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          })
          .join(" ");
        return (
          <polygon
            key={i}
            points={circlePoints}
            fill={i % 2 === 0 ? "rgba(139, 92, 246, 0.08)" : "none"}
            stroke="rgba(139, 92, 246, 0.2)"
            strokeWidth={1}
          />
        );
      })}

      {/* Axes — 加深 */}
      {data.map((_, i) => {
        const angle = i * angleSlice - Math.PI / 2;
        const x2 = center + radius * Math.cos(angle);
        const y2 = center + radius * Math.sin(angle);
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={x2}
            y2={y2}
            stroke="rgba(139, 92, 246, 0.15)"
            strokeWidth={1}
          />
        );
      })}

      {/* Data area glow */}
      <path
        d={pathData}
        fill="rgba(76, 29, 149, 0.1)"
        stroke="none"
        filter="url(#glow)"
      />

      {/* Data area */}
      <path
        d={pathData}
        fill="url(#radarGradient)"
        stroke={COLORS.primary}
        strokeWidth={2}
      />

      {/* Data points */}
      {data.map((d, i) => {
        const { x, y } = getCoordinates(d.value, i);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={4}
            fill={COLORS.primary}
            stroke="#1a1a1a"
            strokeWidth={1.5}
          />
        );
      })}

      {/* Labels — 深色粗体，清晰可读 */}
      {data.map((d, i) => {
        const angle = i * angleSlice - Math.PI / 2;
        const labelRadius = radius + 24;
        const x = center + labelRadius * Math.cos(angle);
        const y = center + labelRadius * Math.sin(angle);
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#aaaaaa"
            fontSize={11}
            fontWeight={700}
          >
            {d.label}
          </text>
        );
      })}

      {/* Gradient definition */}
      <defs>
        <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.3" />
          <stop offset="100%" stopColor={COLORS.pink} stopOpacity="0.15" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

// ══════════════════════════════════════
// TODAY'S PICK CARD
// ══════════════════════════════════════

function TodayPickCard({ user, index }: { user: DiscoverUser; index: number }) {
  const getMatchScoreColor = (score: number) => {
    if (score >= 90) return "from-amber-400 to-amber-600"; // Gold
    if (score >= 80) return "from-orange-400 to-pink-500"; // Purple-Pink
    return "from-amber-400 to-amber-700"; // Indigo
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1, ease: EASING as any }}
      className="flex-shrink-0 w-[260px] snap-start"
    >
      <Link href={`/dashboard/users/${user.id}`}>
        <div className="relative rounded-2xl overflow-hidden group cursor-pointer bg-[#111111] border border-card-border hover:border-primary/30 transition-all duration-300 hover:shadow-lg"
          style={{ transitionTimingFunction: EASING, boxShadow: "var(--shadow-sm)" }}
        >
          {/* Avatar Area */}
          <div className="relative h-56 overflow-hidden">
            {(() => {
              const kind = getAvatarKind(user.avatar);
              if (kind === 'none') {
                return (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <User className="w-12 h-12 text-foreground-faint" />
                  </div>
                );
              }
              if (kind === 'emoji') {
                const parsed = parseEmojiAvatar(user.avatar);
                return (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: getAvatarBackground(kind, user.avatar) }}
                  >
                    <span
                      className="select-none leading-none"
                      style={{
                        display: 'inline-block',
                        width: '100%',
                        height: '100%',
                        fontSize: 'clamp(4rem, 25vw, 7rem)',
                        lineHeight: '1',
                        textAlign: 'center',
                        verticalAlign: 'middle',
                      }}
                    >
                      {parsed?.emoji}
                    </span>
                  </div>
                );
              }
              const hoverClass = kind === 'photo' ? 'group-hover:scale-105 transition-transform duration-500' : '';
              return (
                <img
                  src={user.avatar!}
                  alt={user.name}
                  className={`${getAvatarImgClasses(kind)} ${hoverClass}`}
                  style={{
                    ...(kind === 'svg' ? { background: getAvatarBackground(kind, user.avatar) } : {}),
                    transitionTimingFunction: EASING,
                  }}
                />
              );
            })()}

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

            {/* Match Score Badge */}
            <div className="absolute top-3 left-3">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-foreground bg-gradient-to-r ${getMatchScoreColor(user.matchScore)}`}
              >
                <Flame className="w-3 h-3" />
                {Math.round(user.matchScore)}%
              </span>
            </div>

            {/* Verified Badge */}
            {user.verified && (
              <div className="absolute top-3 right-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/80 text-foreground text-[10px] font-medium">
                  <Zap className="w-2.5 h-2.5" /> Verified
                </span>
              </div>
            )}

            {/* Name & Age */}
            <div className="absolute bottom-3 left-3 right-3">
              <h3 className="text-lg font-bold text-foreground font-display">
                {user.name}, {user.age}
              </h3>
              {user.city && (
                <p className="text-foreground-muted text-xs mt-0.5">{user.city}</p>
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

// ══════════════════════════════════════
// ACTIVITY ITEM
// ══════════════════════════════════════

function ActivityItem({
  icon: Icon,
  iconBg,
  title,
  subtitle,
  count,
  href,
}: {
  icon: any;
  iconBg: string;
  title: string;
  subtitle: string;
  count?: number;
  href: string;
}) {
  return (
    <Link href={href} className="block group">
      <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-foreground-faint transition-all duration-200"
        style={{ transitionTimingFunction: EASING }}
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg} group-hover:scale-105 transition-transform duration-200`}
          style={{ transitionTimingFunction: EASING }}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-foreground-muted truncate">{subtitle}</p>
        </div>
        {count !== undefined && count > 0 && (
          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-foreground text-[10px] font-bold flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-foreground-faint group-hover:text-foreground-muted transition-colors" />
      </div>
    </Link>
  );
}

// ══════════════════════════════════════
// MAIN DASHBOARD PAGE
// ══════════════════════════════════════

export default function DashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [retryKey, setRetryKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data: profileData,
    isLoading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useApiGetWithRetry<DashboardData>("/api/profile", retryKey);
  const {
    data: matchesData,
    isLoading: matchesLoading,
    error: matchesError,
    refetch: refetchMatches,
  } = useApiGetWithRetry<MatchesData>("/api/matches?status=PENDING&limit=3", retryKey);
  const { data: notificationsData } = useApiGetWithRetry<NotificationsData>(
    "/api/notifications?filter=unread&limit=1",
    retryKey
  );
  const { data: unreadMessagesData } = useApiGetWithRetry<UnreadMessagesData>(
    "/api/chats/unread-count",
    retryKey
  );
  const { data: discoverData, isLoading: discoverLoading } = useApiGetWithRetry<{
    users: DiscoverUser[];
  }>("/api/discover?limit=6", retryKey);

  const user = profileData?.user || session?.user;
  const profile = profileData?.profile;
  const userName = user?.name || profile?.displayName || "there";
  const firstName = userName.split(" ")[0];
  const pendingMatches = matchesData?.matches || [];
  const unreadMatches = pendingMatches.filter((m) => m.myReaction === null).length;
  const unreadNotifications = notificationsData?.unreadCount || 0;
  const unreadMessages = unreadMessagesData?.unreadCount || 0;
  const discoverUsers = discoverData?.users || [];

  // ═══ AUTO-MATCH: Ensure user has matches & conversations with bot users ═══
  // Tour completed state — used to gate mandatory field popups
  const [tourCompleted, setTourCompleted] = useState(false);
  useEffect(() => {
    const completed = localStorage.getItem("lokfeel-tour-completed");
    if (completed) setTourCompleted(true);
    // Listen for tour completion
    const observer = new MutationObserver(() => {
      const c = localStorage.getItem("lokfeel-tour-completed");
      if (c) setTourCompleted(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Auto-match: ensure user has matches & conversations with bot users
  const [autoMatchTriggered, setAutoMatchTriggered] = useState(false);
  useEffect(() => {
    if (autoMatchTriggered || authStatus === "loading") return;
    // Only trigger once per session when user has profile
    if (profileData?.profile && pendingMatches.length < 3) {
      setAutoMatchTriggered(true);
      fetch("/api/auto-match", { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.createdCount > 0) {
            console.log(`[Auto-Match] Created ${data.createdCount} new matches`);
            // Refetch matches and discover to show new data
            setRetryKey((prev) => prev + 1);
          }
        })
        .catch((err) => console.warn("[Auto-Match] Failed:", err));
    }
  }, [profileData, pendingMatches.length, autoMatchTriggered, authStatus]);

  // Greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  // Radar data from profile
  const getRadarData = () => [
    { label: "Intimacy", value: profile?.attachmentStyle ? 85 : 50 },
    { label: "Communication", value: profile?.communicationStyle ? 90 : 50 },
    { label: "Affection", value: profile?.loveLanguage ? 88 : 50 },
    { label: "Commitment", value: profile?.relationshipGoal ? 82 : 50 },
    { label: "Emotional", value: profile?.emotionalAvailability ? 87 : 50 },
  ];

  // Onboarding status
  const onboardingStep = profile?.onboardingStep || 0;
  const profileStatus = profile?.profileStatus;

  // Profile必填项检查（头像/名字/年龄/性别/地点）
  const profileRequiredMissing = !profile?.avatar || !profile?.displayName || !profile?.age || !profile?.gender || !profile?.city;

  // 五维卡（Relationship Blueprint）必填检查
  const radarData = getRadarData();
  const radarIncomplete = radarData.every(d => d.value === 50);
  const needsBlueprint = radarIncomplete && !profile?.attachmentStyle && !profile?.relationshipGoal;

  // Onboarding considered complete if:
  // 1. onboardingStep >= 6, OR
  // 2. profileStatus is APPROVED/ACTIVE, OR
  // 3. All required fields filled AND blueprint exists (implicit completion — guards against stale DB data)
  const isOnboardingComplete = onboardingStep >= 6 || profileStatus === "APPROVED" || profileStatus === "ACTIVE" || (!profileRequiredMissing && !needsBlueprint);
  const needsOnboarding = !isOnboardingComplete;

  // Profile completion
  const profileCompletion = profile ? calculateProfileCompletion(profile) : 0;

  const handleRetry = () => {
    setRetryKey((prev) => prev + 1);
  };

  // ──── LOADING STATE ────
  if (profileLoading) {
    return (
      <div className="space-y-8 max-w-5xl mx-auto">
        <div className="space-y-2">
          <Skeleton variant="text" width="60%" height={36} />
          <Skeleton variant="text" width="40%" />
        </div>
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-[260px] flex-shrink-0">
              <SkeletonCard />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
      </div>
    );
  }

  // ──── ERROR STATE ────
  if (profileError) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <InlineError error={profileError} onRetry={handleRetry} className="mb-6" />
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-foreground-faint flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="w-8 h-8 text-foreground-subtle" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Unable to load dashboard</h3>
          <p className="text-foreground-muted mb-4">{profileError}</p>
          <button onClick={handleRetry} className="btn-primary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // PROFILE LOCK STATE
  // ═══════════════════════════════════════════════════════
  const isProfileLocked = needsOnboarding || needsBlueprint || profileRequiredMissing;

  // ═══════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div className="max-w-5xl mx-auto space-y-0 relative min-h-[60vh]">
      {/* ── Atmosphere: Subtle glow orbs for light theme ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-48 -right-48 opacity-40 animate-breathe" />
        <div className="glow-orb glow-orb-secondary w-[500px] h-[500px] bottom-32 -left-40 opacity-30 animate-breathe" style={{ animationDelay: "2s" }} />
      </div>

      {/* ═══ PROFILE LOCK OVERLAY ═══ */}
      {/* When profile is incomplete, show a comprehensive lock screen */}
      {isProfileLocked && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[90] flex items-center justify-center"
          style={{ background: "rgba(10, 10, 10, 0.94)", backdropFilter: "blur(10px)" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="glass-card p-8 max-w-md mx-4 w-full border-primary/30 shadow-xl"
          >
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-primary flex items-center justify-center mx-auto mb-4" style={{ boxShadow: "var(--shadow-glow)" }}>
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-1 font-display">
                Welcome to LokFee!
              </h2>
              <p className="text-sm text-foreground-muted">
                Complete the steps below to unlock all features
              </p>
            </div>

            {/* Step list */}
            <div className="space-y-3 mb-6">
              {/* Step 1: Onboarding */}
              <div className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                !needsOnboarding
                  ? "border-[#a3e635]/30 bg-[#a3e635]/5"
                  : "border-primary/30 bg-primary/5"
              }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  !needsOnboarding ? "bg-[#a3e635]" : "bg-primary"
                }`}>
                  {!needsOnboarding ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : (
                    <span className="text-xs font-bold text-white">1</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${!needsOnboarding ? "text-[#a3e635]" : "text-foreground"}`}>
                    Relationship Blueprint
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {needsOnboarding ? "5 dimensions" : "Completed ✓"}
                  </p>
                </div>
                {needsOnboarding && (
                  <Link href="/dashboard/onboarding" className="btn-primary text-xs px-3 py-1.5 flex-shrink-0">
                    Start
                  </Link>
                )}
              </div>

              {/* Step 2: Profile Info */}
              <div className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                !profileRequiredMissing
                  ? "border-[#a3e635]/30 bg-[#a3e635]/5"
                  : needsOnboarding
                  ? "border-card-border bg-background-tertiary opacity-50"
                  : "border-primary/30 bg-primary/5"
              }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  !profileRequiredMissing ? "bg-[#a3e635]" : needsOnboarding ? "bg-foreground-faint" : "bg-primary"
                }`}>
                  {!profileRequiredMissing ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : (
                    <span className={`text-xs font-bold ${needsOnboarding ? "text-foreground-subtle" : "text-white"}`}>2</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${
                    !profileRequiredMissing ? "text-[#a3e635]" : needsOnboarding ? "text-foreground-subtle" : "text-foreground"
                  }`}>
                    Basic Info
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {profileRequiredMissing
                      ? `${[!profile?.avatar, !profile?.displayName, !profile?.age, !profile?.gender, !profile?.city].filter(Boolean).length} fields remaining`
                      : "Completed ✓"}
                  </p>
                </div>
                {profileRequiredMissing && !needsOnboarding && (
                  <Link href="/dashboard/profile" className="btn-primary text-xs px-3 py-1.5 flex-shrink-0">
                    Fill
                  </Link>
                )}
              </div>

              {/* Step 3: Go to Discover */}
              <div
                className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                  isProfileLocked
                    ? "border-[rgba(139,92,246,0.2)] bg-[#1a1a1a] opacity-50"
                    : "border-[#a3e635]/30 bg-[#a3e635]/5 cursor-pointer hover:bg-[#a3e635]/10"
                }`}
                onClick={!isProfileLocked ? () => { window.location.href = "/dashboard/explore"; } : undefined}
                role={!isProfileLocked ? "button" : undefined}
                tabIndex={!isProfileLocked ? 0 : undefined}
                onKeyDown={!isProfileLocked ? (e) => { if (e.key === 'Enter' || e.key === ' ') window.location.href = "/dashboard/explore"; } : undefined}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isProfileLocked ? "bg-foreground-faint" : "bg-[#a3e635]"
                }`}>
                  <span className={`text-xs font-bold ${isProfileLocked ? "text-foreground-subtle" : "text-white"}`}>3</span>
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${isProfileLocked ? "text-foreground-subtle" : "text-[#a3e635]"}`}>
                    Start Matching
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {isProfileLocked ? "Complete steps 1 & 2 first" : "Ready to go!"}
                  </p>
                </div>
                {!isProfileLocked && (
                  <svg className="w-4 h-4 text-[#a3e635]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            </div>

            {/* Missing fields detail */}
            {profileRequiredMissing && !needsOnboarding && (
              <div className="mb-6 p-3 rounded-lg bg-warning/5 border border-warning/20">
                <p className="text-xs text-warning font-medium mb-2">Missing fields:</p>
                <div className="flex flex-wrap gap-1.5">
                  {!profile?.avatar && <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">Photo</span>}
                  {!profile?.displayName && <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">Name</span>}
                  {!profile?.age && <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">Age</span>}
                  {!profile?.gender && <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">Gender</span>}
                  {!profile?.city && <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">Location</span>}
                </div>
              </div>
            )}

            {/* Primary CTA */}
            <Link
              href={needsOnboarding ? "/dashboard/onboarding" : "/dashboard/profile"}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {needsOnboarding ? <Radar className="w-4 h-4" /> : <User className="w-4 h-4" />}
              {needsOnboarding ? "Start Blueprint" : "Complete Profile"}
              <ArrowRight className="w-4 h-4" />
            </Link>

            <p className="text-xs text-foreground-faint mt-3 text-center">
              All features will unlock once your profile is complete
            </p>
          </motion.div>
        </motion.div>
      )}

      {/* ═══ NORMAL DASHBOARD CONTENT — hidden when profile is locked ═══ */}
      {!isProfileLocked && (
        <>
      {/* ═══════════════════════════════════════════════════════
          SECTION 1: PERSONALIZED GREETING
          ═══════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-1 font-display">
          {getGreeting()}, <span className="text-gradient">{firstName}</span>
        </h1>
        <p className="text-foreground-muted text-sm">
          {unreadMatches > 0
            ? `You have ${unreadMatches} new match${unreadMatches > 1 ? "es" : ""} waiting for you`
            : unreadMessages > 0
            ? `You have ${unreadMessages} unread message${unreadMessages > 1 ? "s" : ""}`
            : "Your relationship blueprint is working for you"}
        </p>
      </motion.section>

      {/* ═══════════════════════════════════════════════════════
          SECTION 2: TODAY'S PICKS (Horizontal Scroll)
          ═══════════════════════════════════════════════════════ */}
      <section className="mb-8" data-tour="today-picks">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/30 to-accent/10 flex items-center justify-center">
              <Flame className="w-4 h-4 text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-foreground font-display">Today&apos;s Picks</h2>
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
              <div key={i} className="w-[260px] flex-shrink-0 h-80 rounded-2xl bg-foreground-faint animate-pulse" />
            ))}
          </div>
        ) : discoverUsers.length > 0 ? (
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {discoverUsers.slice(0, 6).map((user, index) => (
              <TodayPickCard key={user.id} user={user} index={index} />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="glass-card p-8 text-center"
          >
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#4c1d95]/30 to-[#8b5cf6]/20 flex items-center justify-center mx-auto mb-4">
              <Compass className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground-muted mb-1">Finding your matches...</h3>
            <p className="text-foreground-muted text-sm mb-4">
              We&apos;re searching for people who match your blueprint.
            </p>
            <Link href="/dashboard/explore" className="btn-primary text-sm">
              <Search className="w-4 h-4 mr-2" />
              Browse Discover
            </Link>
          </motion.div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════
          SECTION 3: TWO-COLUMN LAYOUT
          Left: Relationship Engine Radar
          Right: Activity Summary
          ═══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* ── Relationship Engine ── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          data-tour="relationship-engine"
        >
          <div className="glass-card p-6 h-full">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Radar className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-base font-semibold text-foreground font-display">Your Relationship Engine</h2>
              </div>
              <RadarChart data={getRadarData()} size={220} />
              <div className="mt-4 grid grid-cols-5 gap-1">
                {getRadarData().map((d, i) => (
                  <div key={i} className="text-center">
                    <p className="text-xs font-medium text-foreground mb-0.5">{d.label}</p>
                    <p className="text-sm font-bold text-primary">{d.value}%</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-card-border5">
                <p className="text-xs text-foreground text-center">
                  Complete your profile to unlock full engine potential
                </p>
                <div className="mt-2 w-full h-1.5 bg-foreground-faint rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-primary rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${profileCompletion}%` }}
                    transition={{ duration: 1, delay: 0.5 }}
                  />
                </div>
                <p className="text-xs text-foreground-muted mt-1 text-right">{profileCompletion}% complete</p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* ── Activity Summary ── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          data-tour="activity-summary"
        >
          <div className="glass-card p-6 h-full">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-base font-semibold text-foreground font-display">Activity Summary</h2>
            </div>

            <div className="space-y-1">
              <ActivityItem
                icon={Heart}
                iconBg="bg-pink-500/20 text-pink-400"
                title="New Matches"
                subtitle={`${unreadMatches} pending review`}
                count={unreadMatches}
                href="/dashboard/notifications"
              />
              <ActivityItem
                icon={MessageCircle}
                iconBg="bg-primary/20 text-primary"
                title="Messages"
                subtitle={`${unreadMessages} unread conversation${unreadMessages !== 1 ? "s" : ""}`}
                count={unreadMessages}
                href="/dashboard/chats"
              />
              <ActivityItem
                icon={Eye}
                iconBg="bg-blue-500/20 text-blue-400"
                title="Profile Views"
                subtitle="Check who viewed you"
                href="/dashboard/notifications"
              />
              <ActivityItem
                icon={Bell}
                iconBg="bg-amber-500/20 text-amber-400"
                title="Notifications"
                subtitle={`${unreadNotifications} unread`}
                count={unreadNotifications}
                href="/dashboard/notifications"
              />
            </div>

            {/* Quick Actions */}
            <div className="mt-4 pt-4 border-t border-card-border5">
              <p className="text-xs text-foreground-subtle mb-3">Quick Actions</p>
              <div className="grid grid-cols-3 gap-2">
                <Link
                  href="/dashboard/explore"
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-foreground-faint hover:bg-primary/15 transition-colors group"
                >
                  <Search className="w-4 h-4 text-foreground-muted group-hover:text-primary transition-colors" />
                  <span className="text-[10px] text-foreground-muted group-hover:text-foreground">Browse</span>
                </Link>
                <Link
                  href="/dashboard/profile"
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-foreground-faint hover:bg-primary/15 transition-colors group"
                  data-tour="profile-link"
                >
                  <User className="w-4 h-4 text-foreground-muted group-hover:text-primary transition-colors" />
                  <span className="text-[10px] text-foreground-muted group-hover:text-foreground">Profile</span>
                </Link>
                <Link
                  href="/dashboard/settings"
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-foreground-faint hover:bg-primary/15 transition-colors group"
                >
                  <Sparkles className="w-4 h-4 text-foreground-muted group-hover:text-primary transition-colors" />
                  <span className="text-[10px] text-foreground-subtle group-hover:text-foreground">Boost</span>
                </Link>
              </div>
            </div>
          </div>
        </motion.section>
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 3.5: CARD VERIFICATION WALL
          When user has used free matches but hasn't verified card
          ═══════════════════════════════════════════════════════ */}
      {!isProfileLocked && !profileData?.user?.cardVerified && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mb-8"
        >
          <div className="glass-card border-primary/30 p-6 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-secondary/5" />
            <div className="relative">
              <CardVerificationWall
                variant="inline"
                title="Verify to Continue Matching"
                description="You've used your free matches. Add a card to keep going — verification only, no charges."
              />
            </div>
          </div>
        </motion.section>
      )}

      {/* ═══════════════════════════════════════════════════════
          SECTION 4: PREMIUM BANNER
          ═══════════════════════════════════════════════════════ */}
      {profileData?.user?.role !== "ADMIN" && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="mb-8"
        >
          <div className="glass-card border-primary/30 p-5 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-secondary/5" />
            <div className="relative flex flex-col sm:flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-primary flex items-center justify-center flex-shrink-0" style={{ boxShadow: "var(--shadow-glow)" }}>
                <Zap className="w-6 h-6 text-foreground" />
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h3 className="font-semibold text-foreground-muted text-sm mb-0.5">
                  Unlock Premium Features
                </h3>
                <p className="text-foreground-muted text-xs">
                  Unlimited likes, see who liked you, and advanced matching filters.
                </p>
              </div>
              <Link
                href="/dashboard/subscription"
                className="btn-primary whitespace-nowrap text-sm"
              >
                Upgrade
              </Link>
            </div>
          </div>
        </motion.section>
      )}

      {/* ═══ 新用户功能引导 ═══ */}
      <OnboardingTour />
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════
// HOOKS & HELPERS
// ══════════════════════════════════════

interface FetchState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

function useApiGetWithRetry<T>(url: string | null, retryKey: number): FetchState<T> {
  const { data: session, status: authStatus } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const refetch = () => {
    setRetryCount(prev => prev + 1);
  };

  useEffect(() => {
    if (!url) return;
    if (authStatus === "loading") return; // Wait for auth to resolve
    
    // If not authenticated, don't fetch
    if (authStatus === "unauthenticated") {
      setIsLoading(false);
      setError("Please sign in to continue");
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    const fetchData = async () => {
      if (cancelled) return;
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(url);

        if (cancelled) return;

        if (!res.ok) {
          if (res.status === 401) {
            // Session expired - retry once after delay
            if (retryCount < 1) {
              retryTimer = setTimeout(() => {
                setRetryCount(prev => prev + 1);
              }, 2000);
              return;
            }
            setError("Please sign in to continue");
            return;
          }
          const err = await res.json().catch(() => ({ message: "Request failed" }));
          setError(err.message || `Error ${res.status}`);
          return;
        }

        const json = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn(`API fetch failed for ${url}:`, err);
        // Auto-retry on network error (up to 2 times)
        if (retryCount < 2) {
          retryTimer = setTimeout(() => {
            setRetryCount(prev => prev + 1);
          }, 3000);
        } else {
          setError("Service unavailable — please try again");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [url, authStatus, retryKey, retryCount]);

  return { data, isLoading, error, refetch };
}

function calculateProfileCompletion(profile: any): number {
  if (!profile) return 0;

  const fields = [
    profile.displayName,
    profile.bio,
    profile.avatar,
    profile.age,
    profile.attachmentStyle,
    profile.communicationStyle,
    profile.conflictResolution,
    profile.loveLanguage,
    profile.lifePriorities,
    profile.relationshipGoal,
    profile.city,
    profile.boundaries,
    profile.emotionalAvailability,
  ];

  const filled = fields.filter((f) => f && f !== "" && f !== "null").length;
  return Math.round((filled / fields.length) * 100);
}
