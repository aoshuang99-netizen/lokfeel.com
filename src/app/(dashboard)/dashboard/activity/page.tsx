"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { toast } from "sonner";
import {
  Heart,
  User,
  Clock,
  Check,
  X,
  MessageCircle,
  Sparkles,
  Filter,
  ChevronRight,
  Eye,
  Zap,
  Send,
  Inbox,
  Flame,
  RefreshCw,
} from "lucide-react";
import { Skeleton, EmptyState } from "@/components/ui";

// ══════════════════════════════════════
// DESIGN TOKENS
// ══════════════════════════════════════
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// ══════════════════════════════════════
// INTERFACES
// ══════════════════════════════════════

interface Activity {
  id: string;
  type: "like_received" | "match" | "view" | "message" | "request";
  user: {
    id: string;
    name: string;
    age: number;
    avatar: string | null;
  };
  timestamp: string;
  read: boolean;
  requestStatus?: "pending" | "accepted" | "declined";
  matchScore?: number;
}

type FilterTab = "all" | "likes" | "matches" | "requests";

// Tab config
const TABS: { id: FilterTab; label: string; icon: any }[] = [
  { id: "all", label: "All", icon: Inbox },
  { id: "likes", label: "Likes", icon: Heart },
  { id: "matches", label: "Matches", icon: Sparkles },
  { id: "requests", label: "Requests", icon: Send },
];

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════

function getMatchScoreColor(score: number): string {
  if (score >= 90) return "text-amber-400 bg-amber-500/15";
  if (score >= 80) return "text-purple-400 bg-purple-500/15";
  return "text-indigo-400 bg-indigo-500/15";
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function getActivityIcon(type: Activity["type"]) {
  switch (type) {
    case "like_received":
    case "request":
      return <Heart className="w-4 h-4 text-pink-400" fill="currentColor" />;
    case "match":
      return <Sparkles className="w-4 h-4 text-primary" />;
    case "view":
      return <Eye className="w-4 h-4 text-white/40" />;
    case "message":
      return <MessageCircle className="w-4 h-4 text-primary" />;
    default:
      return null;
  }
}

function getActivityText(activity: Activity): string {
  switch (activity.type) {
    case "like_received":
      return "liked your profile";
    case "request":
      return "sent you a connection request";
    case "match":
      return "is now your match";
    case "view":
      return "viewed your profile";
    case "message":
      return "sent you a message";
    default:
      return "";
  }
}

// ══════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [userGender, setUserGender] = useState<"male" | "female" | null>(null);

  useEffect(() => {
    fetchActivities();
    fetchUserProfile();
  }, []);

  const fetchUserProfile = async () => {
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const data = await res.json();
        const gender = data.profile?.gender?.toLowerCase();
        setUserGender(gender === "male" || gender === "man" ? "male" : "female");
      }
    } catch (e) {
      console.error("Failed to fetch profile:", e);
    }
  };

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/activity");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setActivities(data.activities || []);
    } catch (e) {
      toast.error("Failed to load activity");
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async (activityId: string, action: "accept" | "decline") => {
    try {
      await fetch(`/api/requests/${activityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setActivities((prev) =>
        prev.map((a) =>
          a.id === activityId
            ? { ...a, requestStatus: action === "accept" ? "accepted" : "declined" }
            : a
        )
      );
      toast.success(action === "accept" ? "Request accepted!" : "Request declined");
    } catch (e) {
      toast.error("Failed to process request");
    }
  };

  // Tab counts
  const tabCounts = useMemo(
    () => ({
      all: activities.length,
      likes: activities.filter((a) => a.type === "like_received").length,
      matches: activities.filter((a) => a.type === "match").length,
      requests: activities.filter((a) => a.type === "request").length,
    }),
    [activities]
  );

  // Filter activities
  const filteredActivities = useMemo(() => {
    switch (activeTab) {
      case "likes":
        return activities.filter((a) => a.type === "like_received" || a.type === "request");
      case "matches":
        return activities.filter((a) => a.type === "match");
      case "requests":
        return activities.filter((a) => a.type === "request");
      default:
        return activities;
    }
  }, [activities, activeTab]);

  // Stats
  const stats = useMemo(
    () => ({
      likes: activities.filter((a) => a.type === "like_received" || a.type === "request").length,
      matches: activities.filter((a) => a.type === "match").length,
      unread: activities.filter((a) => !a.read).length,
    }),
    [activities]
  );

  return (
    <div className="max-w-4xl mx-auto space-y-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {userGender === "female" ? "Inbox" : "Activity"}
          </h1>
          <p className="text-white/50 text-sm mt-1">
            {userGender === "female"
              ? "Review and respond to connection requests"
              : "Track your likes, matches, and views"}
          </p>
        </div>
        <button
          onClick={fetchActivities}
          className="p-2 rounded-xl hover:bg-white/5 transition-colors"
        >
          <RefreshCw className="w-4 h-4 text-white/50" />
        </button>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-4 text-center"
        >
          <p className="text-xl font-bold text-white">{stats.likes}</p>
          <p className="text-[11px] text-white/50">New Likes</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-4 text-center"
        >
          <p className="text-xl font-bold text-primary">{stats.matches}</p>
          <p className="text-[11px] text-white/50">Matches</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-4 text-center"
        >
          <p className="text-xl font-bold text-white">{stats.unread}</p>
          <p className="text-[11px] text-white/50">Unread</p>
        </motion.div>
      </div>

      {/* ── Tab Filters ── */}
      <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const count = tabCounts[tab.id];

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "bg-primary/20 text-primary"
                  : "text-white/50 hover:text-white/70 hover:bg-white/5"
              }`}
              style={{ transitionTimingFunction: EASING }}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {count > 0 && (
                <span
                  className={`min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
                    isActive ? "bg-primary text-white" : "bg-white/10 text-white/50"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Activity List ── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredActivities.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No activity yet"
          description="Start exploring to see likes, matches, and more here."
          action={
            <Link href="/dashboard/discover" className="btn-primary text-sm">
              <Sparkles className="w-4 h-4 mr-2" />
              Discover People
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filteredActivities.map((activity, index) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ delay: index * 0.03, duration: 0.2 }}
                className={`rounded-xl p-4 transition-colors ${
                  !activity.read
                    ? "bg-primary/5 border border-primary/20"
                    : "bg-white/[0.03] border border-white/5"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center overflow-hidden">
                      {activity.user.avatar ? (
                        <img
                          src={activity.user.avatar}
                          alt={activity.user.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-6 h-6 text-white/30" />
                      )}
                    </div>
                    {/* Activity type icon */}
                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#13121a] border border-white/10 flex items-center justify-center">
                      {getActivityIcon(activity.type)}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white truncate text-sm">
                        {activity.user.name}, {activity.user.age}
                      </h3>
                      {activity.matchScore && (
                        <span
                          className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${getMatchScoreColor(activity.matchScore)}`}
                        >
                          <Flame className="w-2.5 h-2.5" />
                          {activity.matchScore}%
                        </span>
                      )}
                      {!activity.read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="text-xs text-white/50">{getActivityText(activity)}</p>
                    <p className="text-[10px] text-white/30 mt-0.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatTime(activity.timestamp)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {activity.type === "request" &&
                    activity.requestStatus === "pending" &&
                    userGender === "female" ? (
                      <>
                        <button
                          onClick={() => handleRequest(activity.id, "decline")}
                          className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRequest(activity.id, "accept")}
                          className="p-2 rounded-full bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 transition-opacity"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </>
                    ) : activity.type === "match" ? (
                      <Link
                        href={`/dashboard/chat/${activity.user.id}`}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors"
                      >
                        Message
                      </Link>
                    ) : (
                      <Link
                        href="/dashboard/matches"
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    )}
                  </div>
                </div>

                {/* Request status */}
                {activity.type === "request" && activity.requestStatus !== "pending" && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <span
                      className={`text-xs ${
                        activity.requestStatus === "accepted"
                          ? "text-green-400"
                          : "text-white/40"
                      }`}
                    >
                      {activity.requestStatus === "accepted" ? "✓ Accepted" : "✗ Declined"}
                    </span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Female Control Tip ── */}
      {userGender === "female" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-6 rounded-xl p-4 border border-primary/20 bg-primary/5"
        >
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-white text-sm">You&apos;re in control</h4>
              <p className="text-xs text-white/50 mt-1">
                Only you can initiate conversations. Review connection requests and decide who can message you.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
