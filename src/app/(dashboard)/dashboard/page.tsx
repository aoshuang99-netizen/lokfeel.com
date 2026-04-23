"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Skeleton, SkeletonCard, SkeletonStatCard, InlineError } from "@/components/ui";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar } from "@/lib/avatar-utils";

// ══════════════════════════════════════
// DESIGN TOKENS — Nexus v2 (OKLCH)
// ══════════════════════════════════════
const COLORS = {
  primary: "oklch(62% 0.22 280)",        // Electric Violet
  primaryLight: "oklch(68% 0.20 280)",
  primaryDark: "oklch(55% 0.24 280)",
  accent: "oklch(78% 0.14 55)",           // Warm Rose Gold
  accentLight: "oklch(82% 0.12 55)",
  pink: "oklch(65% 0.22 350)",            // Fuchsia
  purple: "oklch(58% 0.20 310)",          // Deep Purple
  success: "oklch(72% 0.19 155)",
  warning: "oklch(78% 0.16 75)",
  error: "oklch(63% 0.22 25)",
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
      {/* Background grid */}
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
            fill="none"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={1}
          />
        );
      })}

      {/* Axes */}
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
            stroke="rgba(0,0,0,0.06)"
            strokeWidth={1}
          />
        );
      })}

      {/* Data area glow */}
      <path
        d={pathData}
        fill="rgba(232, 160, 56, 0.08)"
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
            stroke="#fff"
            strokeWidth={1.5}
          />
        );
      })}

      {/* Labels */}
      {data.map((d, i) => {
        const angle = i * angleSlice - Math.PI / 2;
        const labelRadius = radius + 20;
        const x = center + labelRadius * Math.cos(angle);
        const y = center + labelRadius * Math.sin(angle);
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(0,0,0,0.5)"
            fontSize={10}
            fontWeight={500}
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
        <div className="relative rounded-2xl overflow-hidden group cursor-pointer bg-white border border-card-border hover:border-primary/30 transition-all duration-300 hover:shadow-lg"
          style={{ transitionTimingFunction: EASING, boxShadow: "var(--shadow-sm)" }}
        >
          {/* Avatar Area */}
          <div className="relative h-56 overflow-hidden">
            {(() => {
              const kind = getAvatarKind(user.avatar);
              if (kind === 'none') {
                return (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <User className="w-12 h-12 text-white/20" />
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
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-white bg-gradient-to-r ${getMatchScoreColor(user.matchScore)}`}
              >
                <Flame className="w-3 h-3" />
                {Math.round(user.matchScore)}%
              </span>
            </div>

            {/* Verified Badge */}
            {user.verified && (
              <div className="absolute top-3 right-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/80 text-white text-[10px] font-medium">
                  <Zap className="w-2.5 h-2.5" /> Verified
                </span>
              </div>
            )}

            {/* Name & Age */}
            <div className="absolute bottom-3 left-3 right-3">
              <h3 className="text-lg font-bold text-foreground font-[family-name:var(--font-display)]">
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
          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
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

  // Onboarding status
  const onboardingStep = profile?.onboardingStep || 0;
  const profileStatus = profile?.profileStatus;
  const isOnboardingComplete = onboardingStep >= 8 || profileStatus === "ACTIVE";
  const needsOnboarding = !isOnboardingComplete;

  // Profile completion
  const profileCompletion = profile ? calculateProfileCompletion(profile) : 0;

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
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div className="max-w-5xl mx-auto space-y-0 relative">
      {/* ── Atmosphere: Subtle glow orbs for light theme ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-48 -right-48 opacity-40 animate-breathe" />
        <div className="glow-orb glow-orb-secondary w-[500px] h-[500px] bottom-32 -left-40 opacity-30 animate-breathe" style={{ animationDelay: "2s" }} />
      </div>

      {/* ═══ ONBOARDING CTA BANNER ═══ */}
      <AnimatePresence>
        {needsOnboarding && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="glass-card border-primary/30 p-5 mb-8 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10" />
            <div className="relative flex items-center justify-between gap-6">
              <div className="flex items-center gap-4 flex-1">
                <div className="w-12 h-12 rounded-xl bg-gradient-primary flex items-center justify-center flex-shrink-0 shadow-lg" style={{ boxShadow: "var(--shadow-glow)" }}>
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground-muted text-sm mb-1">
                    Complete Your Relationship Blueprint
                  </h3>
                  <p className="text-xs text-foreground-muted">
                    Finish your profile setup to unlock matches and messaging
                    {onboardingStep > 0 && onboardingStep < 8
                      ? ` (step ${Math.min(onboardingStep, 4)} of 4)`
                      : ""}
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/onboarding"
                className="btn-primary whitespace-nowrap text-sm flex-shrink-0"
              >
                Continue Setup
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          SECTION 1: PERSONALIZED GREETING
          ═══════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-1 font-[family-name:var(--font-display)]">
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
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/30 to-accent/10 flex items-center justify-center">
              <Flame className="w-4 h-4 text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-foreground font-[family-name:var(--font-display)]">Today&apos;s Picks</h2>
          </div>
          <Link
            href="/dashboard/discover"
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
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-4">
              <Compass className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground-muted mb-1">Finding your matches...</h3>
            <p className="text-foreground-muted text-sm mb-4">
              We&apos;re searching for people who match your blueprint.
            </p>
            <Link href="/dashboard/discover" className="btn-primary text-sm">
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
        >
          <div className="glass-card p-6 h-full relative overflow-hidden">
            {/* Subtle radial glow inside card */}
            <div className="absolute inset-0 bg-gradient-radial opacity-40 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Radar className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-base font-semibold text-foreground font-[family-name:var(--font-display)]">Your Relationship Engine</h2>
              </div>
              <RadarChart data={getRadarData()} size={220} />
              <div className="mt-4 grid grid-cols-5 gap-1">
                {getRadarData().map((d, i) => (
                  <div key={i} className="text-center">
                    <p className="text-xs text-foreground-subtle mb-0.5">{d.label}</p>
                    <p className="text-sm font-semibold text-primary">{d.value}%</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-white/55">
                <p className="text-xs text-foreground-subtle text-center">
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
        >
          <div className="glass-card p-6 h-full">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-base font-semibold text-foreground font-[family-name:var(--font-display)]">Activity Summary</h2>
            </div>

            <div className="space-y-1">
              <ActivityItem
                icon={Heart}
                iconBg="bg-pink-500/20 text-pink-400"
                title="New Matches"
                subtitle={`${unreadMatches} pending review`}
                count={unreadMatches}
                href="/dashboard/activity"
              />
              <ActivityItem
                icon={MessageCircle}
                iconBg="bg-primary/20 text-primary"
                title="Messages"
                subtitle={`${unreadMessages} unread conversation${unreadMessages !== 1 ? "s" : ""}`}
                count={unreadMessages}
                href="/dashboard/chat"
              />
              <ActivityItem
                icon={Eye}
                iconBg="bg-blue-500/20 text-blue-400"
                title="Profile Views"
                subtitle="Check who viewed you"
                href="/dashboard/activity"
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
            <div className="mt-4 pt-4 border-t border-white/55">
              <p className="text-xs text-foreground-subtle mb-3">Quick Actions</p>
              <div className="grid grid-cols-3 gap-2">
                <Link
                  href="/dashboard/discover"
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-foreground-faint hover:bg-primary/15 transition-colors group"
                >
                  <Search className="w-4 h-4 text-foreground-muted group-hover:text-primary transition-colors" />
                  <span className="text-[10px] text-foreground-muted group-hover:text-foreground">Browse</span>
                </Link>
                <Link
                  href="/dashboard/profile"
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-foreground-faint hover:bg-primary/15 transition-colors group"
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
                <Zap className="w-6 h-6 text-white" />
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

  const refetch = () => {
    setData(null);
    setError(null);
  };

  useEffect(() => {
    if (!url) return;
    if (authStatus === "loading") return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(url);

        if (!res.ok) {
          if (res.status === 401) {
            setError("Please sign in to continue");
            return;
          }
          const err = await res.json().catch(() => ({ message: "Request failed" }));
          setError(err.message || `Error ${res.status}`);
          return;
        }

        const json = await res.json();
        setData(json);
      } catch (err) {
        console.warn(`API fetch failed for ${url}:`, err);
        setError("Service unavailable — please try again");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [url, authStatus, retryKey]);

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
