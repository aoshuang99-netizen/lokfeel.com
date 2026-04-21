"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Skeleton, SkeletonCard, SkeletonStatCard, InlineError } from "@/components/ui";

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

// ══════════════════════════════════════
// DISCOVER USER INTERFACE
// ══════════════════════════════════════

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
// RADAR CHART COMPONENT
// ══════════════════════════════════════

function RadarChart({ data }: { data: { label: string; value: number }[] }) {
  const size = 180;
  const center = size / 2;
  const radius = 60;
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
        const circlePoints = data.map((_, j) => {
          const angle = j * angleSlice - Math.PI / 2;
          return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(" ");
        return (
          <polygon
            key={i}
            points={circlePoints}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
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
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={1}
          />
        );
      })}

      {/* Data area */}
      <path
        d={pathData}
        fill="rgba(236, 72, 153, 0.3)"
        stroke="#EC4899"
        strokeWidth={2}
      />

      {/* Data points */}
      {data.map((d, i) => {
        const { x, y } = getCoordinates(d.value, i);
        return <circle key={i} cx={x} cy={y} r={3} fill="#EC4899" />;
      })}

      {/* Labels */}
      {data.map((d, i) => {
        const angle = i * angleSlice - Math.PI / 2;
        const labelRadius = radius + 15;
        const x = center + labelRadius * Math.cos(angle);
        const y = center + labelRadius * Math.sin(angle);
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.7)"
            fontSize={9}
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [retryKey, setRetryKey] = useState(0);
  const [showPersonalityTest, setShowPersonalityTest] = useState(false);
  const [testStep, setTestStep] = useState(0);
  const [testData, setTestData] = useState({
    attachmentStyle: "",
    communicationStyle: "",
    loveLanguage: "",
    relationshipGoal: "",
    emotionalAvailability: "",
  });
  const [savingTest, setSavingTest] = useState(false);

  const { data: profileData, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useApiGetWithRetry<DashboardData>("/api/profile", retryKey);
  const { data: matchesData, isLoading: matchesLoading, error: matchesError, refetch: refetchMatches } = useApiGetWithRetry<MatchesData>("/api/matches?status=PENDING&limit=3", retryKey);
  const { data: notificationsData } = useApiGetWithRetry<NotificationsData>("/api/notifications?filter=unread&limit=1", retryKey);
  const { data: unreadMessagesData } = useApiGetWithRetry<UnreadMessagesData>("/api/chats/unread-count", retryKey);
  
  // ═══ RELATIONSHIP MATCHING ENGINE - DISCOVER USERS ═══
  const { data: discoverData, isLoading: discoverLoading } = useApiGetWithRetry<{ users: DiscoverUser[] }>("/api/discover?limit=6", retryKey);

  const user = profileData?.user || session?.user;
  const profile = profileData?.profile;
  const userName = user?.name || profile?.displayName || "there";
  const pendingMatches = matchesData?.matches || [];
  const unreadMatches = pendingMatches.filter((m) => m.myReaction === null).length;
  const unreadNotifications = notificationsData?.unreadCount || 0;
  const unreadMessages = unreadMessagesData?.unreadCount || 0;
  
  // ═══ DISCOVER USERS FROM MATCHING ENGINE ═══
  const discoverUsers = discoverData?.users || [];
  const hasDiscoverUsers = discoverUsers.length > 0;

  // Profile completion calculation
  const profileCompletion = profile ? calculateProfileCompletion(profile) : 0;
  const hasSubscription = profileData?.user?.role === "ADMIN" ? true : false;

  // ═══ ONBOARDING STATUS ═══
  const onboardingStep = profile?.onboardingStep || 0;
  const profileStatus = profile?.profileStatus;
  const isOnboardingComplete = onboardingStep >= 8 || profileStatus === "ACTIVE";
  const needsOnboarding = !isOnboardingComplete;
  
  // ═══ PERSONALITY TEST STATUS ═══
  // Note: Personality test is now part of Onboarding flow (Step 3)
  // Dashboard no longer forces this test - users complete it during onboarding
  const hasCompletedPersonalityTest = !!(
    profile?.attachmentStyle && 
    profile?.communicationStyle && 
    profile?.loveLanguage &&
    profile?.relationshipGoal
  );
  
  // REMOVED: Dashboard no longer blocks with personality test
  // The test is completed during Onboarding Step 3
  const showRequiredTest = false;

  const weeklyMatches = pendingMatches.slice(0, 3);

  // Handle retry
  const handleRetry = () => {
    setRetryKey(prev => prev + 1);
  };

  // Handle personality test completion
  const handleTestComplete = async () => {
    setSavingTest(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentStyle: testData.attachmentStyle,
          communicationStyle: testData.communicationStyle,
          loveLanguage: testData.loveLanguage,
          relationshipGoal: testData.relationshipGoal,
          emotionalAvailability: testData.emotionalAvailability,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      toast.success("Profile analysis complete!");
      setShowPersonalityTest(false);
      
      // Redirect to matching square after completing test
      setTimeout(() => {
        window.location.href = "/dashboard/square";
      }, 1000);
    } catch (e) {
      toast.error("Failed to save profile");
    } finally {
      setSavingTest(false);
    }
  };

  // Calculate radar data from test answers
  const getRadarData = () => [
    { label: "Intimacy", value: testData.attachmentStyle ? 85 : 50 },
    { label: "Communication", value: testData.communicationStyle ? 90 : 50 },
    { label: "Affection", value: testData.loveLanguage ? 88 : 50 },
    { label: "Commitment", value: testData.relationshipGoal ? 82 : 50 },
    { label: "Emotional", value: testData.emotionalAvailability ? 87 : 50 },
  ];

  // Show loading state with skeleton
  if (profileLoading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton variant="text" width="60%" height={36} />
          <Skeleton variant="text" width="40%" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  // Show error state
  if (profileError) {
    return (
      <div className="space-y-6">
        <InlineError
          error={profileError}
          onRetry={handleRetry}
          className="mb-6"
        />
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="w-8 h-8 text-white/30" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Unable to load dashboard</h3>
          <p className="text-white/60 mb-4">{profileError}</p>
          <button onClick={handleRetry} className="btn-primary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // PERSONALITY TEST MODAL (Optional - can be accessed from profile)
  // ═══════════════════════════════════════════════════════
  // NOTE: This modal is now optional. Users complete personality test during Onboarding.
  // Keeping the component for users who want to retake the test from their profile.
  if (showPersonalityTest) {
    const testSteps = [
      { id: "attachment", title: "Attachment Style", question: "How do you approach relationships?" },
      { id: "communication", title: "Communication", question: "How do you express yourself?" },
      { id: "love", title: "Love Language", question: "How do you receive love?" },
      { id: "goal", title: "Relationship Goal", question: "What are you looking for?" },
      { id: "emotional", title: "Emotional Availability", question: "How available are you emotionally?" },
    ];

    const currentTestStep = testSteps[testStep];
    const isLastTestStep = testStep === testSteps.length - 1;

    return (
      <div className="min-h-screen bg-black text-white flex flex-col relative overflow-hidden">
        {/* Background */}
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-pink-500/10 to-purple-500/10 blur-[120px]" />
        </div>

        {/* Progress */}
        <div className="fixed top-0 left-0 right-0 h-1 bg-white/10 z-50">
          <motion.div
            className="h-full bg-gradient-to-r from-pink-500 to-purple-500"
            initial={{ width: 0 }}
            animate={{ width: `${((testStep + 1) / testSteps.length) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Header */}
        <div className="pt-8 pb-4 px-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
              <Radar className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Relationship Radar</h2>
              <p className="text-xs text-white/50">Step {testStep + 1} of {testSteps.length}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 pb-32">
          <motion.div
            key={testStep}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="max-w-md mx-auto"
          >
            <h3 className="text-2xl font-bold mb-2 text-center">{currentTestStep.question}</h3>
            <p className="text-sm text-white/50 mb-8 text-center">
              This helps us find your best matches
            </p>

            {/* Step 1: Attachment Style */}
            {currentTestStep.id === "attachment" && (
              <div className="space-y-3">
                {[
                  { value: "Secure", label: "Secure", desc: "Comfortable with intimacy" },
                  { value: "Anxious", label: "Anxious", desc: "Craves closeness" },
                  { value: "Avoidant", label: "Avoidant", desc: "Values independence" },
                  { value: "Fearful", label: "Fearful", desc: "Wants but fears connection" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTestData(prev => ({ ...prev, attachmentStyle: option.value }));
                      if (!isLastTestStep) setTestStep(prev => prev + 1);
                    }}
                    className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                      testData.attachmentStyle === option.value
                        ? "border-pink-500 bg-pink-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <span className="font-semibold text-white block">{option.label}</span>
                    <span className="text-xs text-white/50">{option.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: Communication Style */}
            {currentTestStep.id === "communication" && (
              <div className="space-y-3">
                {[
                  { value: "Direct", label: "Direct", desc: "Clear & honest communication" },
                  { value: "Reflective", label: "Thoughtful", desc: "Listener first, then speaker" },
                  { value: "Expressive", label: "Expressive", desc: "Shares feelings openly" },
                  { value: "Supportive", label: "Supportive", desc: "Empathetic & caring" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTestData(prev => ({ ...prev, communicationStyle: option.value }));
                      if (!isLastTestStep) setTestStep(prev => prev + 1);
                    }}
                    className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                      testData.communicationStyle === option.value
                        ? "border-purple-500 bg-purple-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <span className="font-semibold text-white block">{option.label}</span>
                    <span className="text-xs text-white/50">{option.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Step 3: Love Language */}
            {currentTestStep.id === "love" && (
              <div className="space-y-3">
                {[
                  { value: "Words", label: "Words of Affirmation", desc: "Verbal encouragement & appreciation", icon: "💬" },
                  { value: "Time", label: "Quality Time", desc: "Undivided attention together", icon: "⏰" },
                  { value: "Touch", label: "Physical Touch", desc: "Hugs, holding hands, closeness", icon: "✋" },
                  { value: "Service", label: "Acts of Service", desc: "Helpful actions & support", icon: "🛠️" },
                  { value: "Gifts", label: "Receiving Gifts", desc: "Thoughtful tokens of love", icon: "🎁" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTestData(prev => ({ ...prev, loveLanguage: option.value }));
                      if (!isLastTestStep) setTestStep(prev => prev + 1);
                    }}
                    className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-3 ${
                      testData.loveLanguage === option.value
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <span className="text-2xl">{option.icon}</span>
                    <div>
                      <span className="font-semibold text-white block">{option.label}</span>
                      <span className="text-xs text-white/50">{option.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 4: Relationship Goal */}
            {currentTestStep.id === "goal" && (
              <div className="space-y-3">
                {[
                  { value: "MONOGAMY", label: "One & Only", desc: "Committed to one person", emoji: "💑" },
                  { value: "ETHICAL_NON_MONOGAMY", label: "Open Hearts", desc: "Multiple connections, honest boundaries", emoji: "🔗" },
                  { value: "CASUAL_DATING", label: "Go With Flow", desc: "No labels, see where it goes", emoji: "☕" },
                  { value: "FRIENDSHIP_FIRST", label: "Friends First", desc: "Connection before romance", emoji: "🤝" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTestData(prev => ({ ...prev, relationshipGoal: option.value }));
                      if (!isLastTestStep) setTestStep(prev => prev + 1);
                    }}
                    className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-3 ${
                      testData.relationshipGoal === option.value
                        ? "border-green-500 bg-green-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <span className="text-2xl">{option.emoji}</span>
                    <div>
                      <span className="font-semibold text-white block">{option.label}</span>
                      <span className="text-xs text-white/50">{option.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 5: Emotional Availability */}
            {currentTestStep.id === "emotional" && (
              <div className="space-y-3">
                {[
                  { value: "Fully Available", label: "Fully Available", desc: "Ready for deep connection" },
                  { value: "Mostly Available", label: "Mostly Available", desc: "Open with some reservations" },
                  { value: "Working On It", label: "Working On It", desc: "Healing and growing" },
                  { value: "Limited", label: "Limited Availability", desc: "Busy but open to connection" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setTestData(prev => ({ ...prev, emotionalAvailability: option.value }));
                    }}
                    className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                      testData.emotionalAvailability === option.value
                        ? "border-yellow-500 bg-yellow-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <span className="font-semibold text-white block">{option.label}</span>
                    <span className="text-xs text-white/50">{option.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Radar Preview (shown on last step) */}
            {isLastTestStep && testData.emotionalAvailability && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-8 bg-white/5 rounded-2xl p-6 border border-white/10"
              >
                <h4 className="text-sm font-medium text-white/70 mb-4 text-center">Your Relationship Profile</h4>
                <RadarChart data={getRadarData()} />
              </motion.div>
            )}
          </motion.div>
        </div>

        {/* Navigation */}
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 py-4 bg-black/80 backdrop-blur-xl border-t border-white/10">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <button
              onClick={() => setTestStep(prev => Math.max(0, prev - 1))}
              disabled={testStep === 0}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white transition-colors disabled:opacity-30"
            >
              Back
            </button>

            {isLastTestStep ? (
              <button
                onClick={handleTestComplete}
                disabled={!testData.emotionalAvailability || savingTest}
                className="flex items-center gap-2 px-8 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {savingTest ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Start Matching
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => setTestStep(prev => prev + 1)}
                disabled={
                  (testStep === 0 && !testData.attachmentStyle) ||
                  (testStep === 1 && !testData.communicationStyle) ||
                  (testStep === 2 && !testData.loveLanguage) ||
                  (testStep === 3 && !testData.relationshipGoal)
                }
                className="flex items-center gap-2 px-8 py-2.5 rounded-xl text-sm font-medium bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* ═══ ONBOARDING CTA BANNER ═══ */}
      {needsOnboarding && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="glass-card border-primary/30 p-5 bg-gradient-to-r from-primary/10 to-secondary/10"
        >
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm mb-1">Complete Your Relationship Blueprint</h3>
                <p className="text-xs text-white/60">
                  Finish your profile setup to unlock matches and messaging
                  {onboardingStep > 0 && onboardingStep < 8 ? ` (step ${Math.min(onboardingStep, 4)} of 4)` : ''}
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

      {/* Welcome Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="relative"
      >
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
      </motion.div>

      {/* Quick Actions Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <Link href="/dashboard/discover" className="group">
          <div className="glass-card p-5 hover:border-primary/30 transition-all h-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Search className="w-5 h-5 text-primary" />
              </div>
              <span className="text-white/60 text-sm">Discover</span>
            </div>
            <p className="text-lg font-bold text-white">Find People</p>
            <p className="text-xs text-white/40 mt-1">Browse new matches</p>
          </div>
        </Link>

        <Link href="/dashboard/chat" className="group">
          <div className="glass-card p-5 hover:border-primary/30 transition-all h-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <MessageCircle className="w-5 h-5 text-secondary" />
              </div>
              <span className="text-white/60 text-sm">Messages</span>
            </div>
            <p className="text-lg font-bold text-white">{unreadMessages}</p>
            <p className="text-xs text-white/40 mt-1">Unread messages</p>
          </div>
        </Link>

        <Link href="/dashboard/activity" className="group">
          <div className="glass-card p-5 hover:border-primary/30 transition-all h-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Bell className="w-5 h-5 text-warning" />
              </div>
              <span className="text-white/60 text-sm">Activity</span>
            </div>
            <p className="text-lg font-bold text-white">{unreadMatches}</p>
            <p className="text-xs text-white/40 mt-1">New likes & requests</p>
          </div>
        </Link>

        <Link href="/dashboard/profile" className="group">
          <div className="glass-card p-5 hover:border-primary/30 transition-all h-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <span className="text-white/60 text-sm">Progress</span>
            </div>
            <p className="text-lg font-bold text-white">{profileCompletion}%</p>
            <p className="text-xs text-white/40 mt-1">Profile complete</p>
          </div>
        </Link>
      </motion.div>

      {/* ═══════════════════════════════════════════════════════
          RELATIONSHIP MATCHING ENGINE - FEATURED MATCH
          ═══════════════════════════════════════════════════════ */}
      {hasDiscoverUsers && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Your Best Match</h2>
              <p className="text-sm text-white/60">Powered by our relationship matching engine</p>
            </div>
            <Link href="/dashboard/discover" className="btn-ghost text-sm flex items-center gap-1">
              Discover More <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="flex flex-col md:flex-row">
              <div className="relative w-full md:w-72 h-64 md:h-auto flex-shrink-0">
                {discoverUsers[0].avatar ? (
                  discoverUsers[0].avatar.startsWith('emoji:') ? (
                    <div 
                      className="w-full h-full flex items-center justify-center"
                      style={{ 
                        background: `linear-gradient(135deg, ${discoverUsers[0].avatar.split(':')[2]}40, ${discoverUsers[0].avatar.split(':')[2]}20)` 
                      }}
                    >
                      <span className="text-8xl">{discoverUsers[0].avatar.split(':')[1]}</span>
                    </div>
                  ) : (
                    <img
                      src={discoverUsers[0].avatar}
                      alt={discoverUsers[0].name}
                      className="w-full h-full object-cover"
                    />
                  )
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <User className="w-16 h-16 text-white/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent md:bg-gradient-to-r" />
                
                <div className="absolute top-4 left-4">
                  <span className={`match-score ${discoverUsers[0].matchScore >= 90 ? "match-score-high" : discoverUsers[0].matchScore >= 80 ? "match-score-medium" : "match-score-low"}`}>
                    {Math.round(discoverUsers[0].matchScore)}%
                  </span>
                </div>
                
                {discoverUsers[0].verified && (
                  <div className="absolute top-4 right-4">
                    <span className="px-2 py-1 rounded-full bg-blue-500/80 text-white text-xs font-medium flex items-center gap-1">
                      <Zap className="w-3 h-3" /> Verified
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 p-6 flex flex-col justify-center">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">
                      {discoverUsers[0].name}, {discoverUsers[0].age}
                    </h3>
                    {discoverUsers[0].city && (
                      <p className="text-white/50 text-sm">{discoverUsers[0].city}</p>
                    )}
                  </div>
                  <Star className="w-6 h-6 text-primary" fill="currentColor" />
                </div>

                <p className="text-white/70 mb-6">{discoverUsers[0].matchReason}</p>
                
                {discoverUsers[0].bio && (
                  <p className="text-white/50 text-sm mb-6 line-clamp-2">{discoverUsers[0].bio}</p>
                )}

                <div className="flex gap-3">
                  <Link
                    href={`/dashboard/users/${discoverUsers[0].id}`}
                    className="btn-primary flex-1"
                  >
                    View Profile
                  </Link>
                  <Link
                    href="/dashboard/discover"
                    className="btn-secondary flex-1"
                  >
                    Browse More
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* ═══════════════════════════════════════════════════════
          MORE RECOMMENDED MATCHES
          ═══════════════════════════════════════════════════════ */}
      {discoverUsers.length > 1 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">More Matches</h2>
            <Link href="/dashboard/discover" className="btn-ghost text-sm flex items-center gap-1">
              View All <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {discoverUsers.slice(1, 5).map((user, index) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + index * 0.1 }}
                className="glass-card p-4 flex items-center gap-4 hover:border-primary/30 transition-all group"
              >
                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-primary/20 to-secondary/20">
                  {user.avatar ? (
                    user.avatar.startsWith('emoji:') ? (
                      <div 
                        className="w-full h-full flex items-center justify-center"
                        style={{ 
                          background: `linear-gradient(135deg, ${user.avatar.split(':')[2]}40, ${user.avatar.split(':')[2]}20)` 
                        }}
                      >
                        <span className="text-3xl">{user.avatar.split(':')[1]}</span>
                      </div>
                    ) : (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-8 h-8 text-white/20" />
                    </div>
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white truncate">
                      {user.name}, {user.age}
                    </h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      user.matchScore >= 90 ? "bg-green-500/20 text-green-400" :
                      user.matchScore >= 80 ? "bg-primary/20 text-primary" :
                      "bg-white/10 text-white/60"
                    }`}>
                      {Math.round(user.matchScore)}%
                    </span>
                  </div>
                  <p className="text-sm text-white/50 truncate">{user.matchReason}</p>
                </div>

                <Link
                  href={`/dashboard/users/${user.id}`}
                  className="p-2 rounded-lg bg-white/5 hover:bg-primary/20 text-white/40 hover:text-primary transition-all"
                >
                  <ChevronRight className="w-5 h-5" />
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}

      {/* ═══════════════════════════════════════════════════════
          EMPTY STATE - NO DISCOVER USERS
          ═══════════════════════════════════════════════════════ */}
      {!hasDiscoverUsers && !discoverLoading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="glass-card p-12 text-center"
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-10 h-10 text-primary" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Finding your matches...</h3>
          <p className="text-white/60 mb-6 max-w-md mx-auto">
            We&apos;re searching for people who match your relationship blueprint. Check back soon or browse the discover page!
          </p>
          <Link href="/dashboard/discover" className="btn-primary">
            <Search className="w-4 h-4 mr-2" />
            Browse Discover
          </Link>
        </motion.div>
      )}

      {/* Loading State for Discover */}
      {discoverLoading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="glass-card p-12 text-center"
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6 animate-pulse">
            <Sparkles className="w-10 h-10 text-primary" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Loading your matches...</h3>
          <p className="text-white/60 max-w-md mx-auto">
            Our relationship matching engine is finding the best connections for you.
          </p>
        </motion.div>
      )}

      {/* Premium Banner */}
      {!hasSubscription && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="glass-card border-primary/30 p-6 bg-gradient-to-r from-primary/5 to-secondary/5"
        >
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <h3 className="font-semibold text-white text-lg mb-1">Unlock Premium Features</h3>
              <p className="text-white/60 text-sm">
                Get unlimited likes, see who liked you, and access advanced filters to find your perfect match faster.
              </p>
            </div>
            <Link href="/dashboard/subscription" className="btn-primary whitespace-nowrap">
              Upgrade Now
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Custom hook for API fetching with retry capability
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
