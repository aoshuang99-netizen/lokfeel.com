"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Heart, MessageCircle, User, Sparkles, TrendingUp, ChevronRight, Star, Loader2, Shield, AlertTriangle } from "lucide-react";
import { useApiGet } from "@/hooks/use-api";

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

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const { data: profileData, isLoading: profileLoading } = useApiGet<DashboardData>("/api/profile");
  const { data: matchesData, isLoading: matchesLoading } = useApiGet<MatchesData>("/api/matches?status=PENDING&limit=3");
  const { data: notificationsData } = useApiGet<NotificationsData>("/api/notifications?filter=unread&limit=1");

  const user = profileData?.user || session?.user;
  const profile = profileData?.profile;
  const userName = user?.name || profile?.displayName || "there";
  const pendingMatches = matchesData?.matches || [];
  const unreadMatches = pendingMatches.filter((m) => m.myReaction === null).length;
  const unreadNotifications = notificationsData?.unreadCount || 0;

  // Profile completion calculation
  const profileCompletion = profile ? calculateProfileCompletion(profile) : 0;
  const hasSubscription = profileData?.user?.role === "ADMIN" ? true : false;

  // ═══ VERIFICATION & ONBOARDING STATUS ═══
  const isEmailVerified = user?.emailVerified;
  const isOnboardingComplete = profile?.onboardingStep >= 8;
  const needsVerification = !isEmailVerified;
  const needsOnboarding = !isOnboardingComplete;

  const weeklyMatches = pendingMatches.slice(0, 3);

  // Show loading
  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (profileLoading || matchesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-white/60">Loading your dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ═══ VERIFICATION BANNER ═══ — Show if email not verified */}
      {needsVerification && (
        <div className="glass-card border-amber-500/30 p-5 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white text-sm mb-1">Verify Your Email to Unlock All Features</h3>
              <p className="text-xs text-white/60 mb-3">
                Please verify your email address before you can send messages or react to matches.
              </p>
              <Link
                href="/dashboard/onboarding"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <Shield className="w-3.5 h-3.5" />
                Verify Now
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ONBOARDING CTA BANNER ═══ — Show if profile not complete */}
      {needsOnboarding && !needsVerification && (
        <div className="glass-card border-primary/30 p-5 bg-gradient-to-r from-primary/10 to-secondary/10">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm mb-1">Complete Your Relationship Blueprint</h3>
                <p className="text-xs text-white/60">
                  Finish your profile setup to unlock matches and messaging
                  {profile?.onboardingStep ? ` (step ${profile.onboardingStep} of 8)` : ''}
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
        </div>
      )}

      {/* Welcome Header */}
      <div className="relative">
        <div className="glow-orb glow-orb-primary w-64 h-64 -top-20 -right-20 opacity-20" />
        <div className="relative">
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome back, <span className="text-gradient">{userName.split(" ")[0]}</span>
          </h1>
          <p className="text-white/60">
            {unreadMatches > 0
              ? `You have ${unreadMatches} new match${unreadMatches > 1 ? "es" : ""} waiting for you`
              : unreadNotifications > 0
              ? `You have ${unreadNotifications} unread notification${unreadNotifications > 1 ? "s" : ""}`
              : "Your relationship blueprint is working for you"}
          </p>
        </div>
      </div>

      {/* Subscription Banner — show only if free user */}
      {!hasSubscription && (
        <div className="glass-card border-primary/30 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Upgrade to Premium</h3>
                <p className="text-sm text-white/60">Unlock unlimited matches and advanced filters</p>
              </div>
            </div>
            <Link href="/dashboard/subscription" className="btn-primary">
              Learn More
            </Link>
          </div>
        </div>
      )}

      {/* Profile not set up — redirect to onboarding */}
      {!profile && (
        <div className="glass-card border-warning/30 p-6">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-warning to-orange-500 flex items-center justify-center flex-shrink-0">
              <User className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Complete Your Relationship Blueprint</h3>
              <p className="text-sm text-white/60 mb-3">
                Your personalized matches start with understanding your relationship patterns
              </p>
            </div>
            <Link href="/dashboard/profile" className="btn-primary whitespace-nowrap">
              Get Started
            </Link>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Heart className="w-5 h-5 text-primary" />
            </div>
            <span className="text-white/60 text-sm">New Matches</span>
          </div>
          <p className="text-2xl font-bold text-white">{unreadMatches}</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-secondary" />
            </div>
            <span className="text-white/60 text-sm">Unread Messages</span>
          </div>
          <p className="text-2xl font-bold text-white">{unreadNotifications}</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-success" />
            </div>
            <span className="text-white/60 text-sm">Profile Progress</span>
          </div>
          <p className="text-2xl font-bold text-white">{profileCompletion}%</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
              <Star className="w-5 h-5 text-warning" />
            </div>
            <span className="text-white/60 text-sm">Your Tier</span>
          </div>
          <p className="text-2xl font-bold text-white">{hasSubscription ? "Premium" : "Free"}</p>
        </div>
      </div>

      {/* Weekly Matches */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">This Week&apos;s Matches</h2>
            <p className="text-sm text-white/60">Curated based on your relationship blueprint</p>
          </div>
          <Link href="/dashboard/matches" className="btn-ghost text-sm flex items-center gap-1">
            View All <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {weeklyMatches.length > 0 ? (
          <div className="grid md:grid-cols-3 gap-6">
            {weeklyMatches.map((match) => (
              <div key={match.id} className="glass-card overflow-hidden group">
                <div className="relative h-48">
                  {match.otherUser.avatar ? (
                    <img
                      src={match.otherUser.avatar}
                      alt={match.otherUser.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                      <User className="w-16 h-16 text-white/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  {match.myReaction === null && (
                    <span className="absolute top-3 right-3 badge badge-primary">New</span>
                  )}
                  <div className="absolute bottom-3 right-3">
                    <span className={`match-score ${match.matchScore >= 90 ? "match-score-high" : match.matchScore >= 80 ? "match-score-medium" : "match-score-low"}`}>
                      {Math.round(match.matchScore)}%
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-white">{match.otherUser.name}, {match.otherUser.age}</h3>
                    {match.otherUser.city && (
                      <span className="text-xs text-white/40">{match.otherUser.city}</span>
                    )}
                  </div>
                  <p className="text-sm text-white/60 mb-4 line-clamp-2">{match.matchReason}</p>

                  <div className="flex gap-2">
                    <Link
                      href={`/dashboard/matches/${match.id}`}
                      className="btn-primary flex-1 text-sm py-2"
                    >
                      View Match
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Heart className="w-8 h-8 text-white/30" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No matches yet</h3>
            <p className="text-white/60 mb-4">
              {profile?.profileStatus === "APPROVED"
                ? "Your next weekly matches are being prepared!"
                : "Complete your relationship blueprint to start receiving matches"}
            </p>
            {(!profile || profile.profileStatus !== "APPROVED") && (
              <Link href="/dashboard/profile" className="btn-primary">
                Complete Blueprint
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Profile Completion CTA */}
      {profile && profileCompletion < 100 && (
        <section className="glass-card p-6">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
              <User className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Complete Your Profile</h3>
              <p className="text-sm text-white/60 mb-3">
                A complete profile increases your match quality by 73%
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
                    style={{ width: `${profileCompletion}%` }}
                  />
                </div>
                <span className="text-sm text-white/60">{profileCompletion}%</span>
              </div>
            </div>
            <Link href="/dashboard/profile" className="btn-primary whitespace-nowrap">
              Continue
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

// Calculate profile completion percentage
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
