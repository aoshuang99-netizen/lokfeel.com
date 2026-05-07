"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Heart,
  MessageCircle,
  User,
  Sparkles,
  Filter,
  MapPin,
  Star,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar } from "@/lib/avatar-utils";

// ══════════════════════════════════════
// SEXUAL ORIENTATION TAGS
// ══════════════════════════════════════

const ORIENTATION_TAGS = [
  { value: "ALL", label: "All", emoji: "🌈" },
  { value: "STRAIGHT", label: "Straight", emoji: "💕" },
  { value: "GAY", label: "Gay", emoji: "🌈" },
  { value: "LESBIAN", label: "Lesbian", emoji: "💜" },
  { value: "BISEXUAL", label: "Bi", emoji: "💗" },
  { value: "PANSEXUAL", label: "Pan", emoji: "💛" },
  { value: "QUEER", label: "Queer", emoji: "🌟" },
];

// ══════════════════════════════════════
// USER CARD INTERFACE
// ══════════════════════════════════════

interface SquareUser {
  id: string;
  name: string;
  age: number;
  avatar: string | null;
  city?: string;
  matchScore: number;
  matchReason: string;
  sexualOrientation?: string;
  isOnline?: boolean;
}

export default function MatchingSquarePage() {
  const router = useRouter();
  const [users, setUsers] = useState<SquareUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<SquareUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrientation, setSelectedOrientation] = useState("ALL");
  const [showFilters, setShowFilters] = useState(false);

  // Load users
  useEffect(() => {
    fetchUsers();
  }, []);

  // Filter users when orientation changes
  useEffect(() => {
    if (selectedOrientation === "ALL") {
      setFilteredUsers(users);
    } else {
      setFilteredUsers(users.filter(u => 
        u.sexualOrientation === selectedOrientation || !u.sexualOrientation
      ));
    }
  }, [selectedOrientation, users]);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/discover?limit=50&minOnboardingStep=2");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUsers(data.users || []);
      setFilteredUsers(data.users || []);
    } catch (e) {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (userId: string) => {
    try {
      const res = await fetch("/api/matches/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: userId,
          reaction: "LIKE",
        }),
      });

      const data = await res.json();

      if (data.isMatch) {
        toast.success(
          <div className="flex flex-col gap-2">
            <span className="font-bold">It&apos;s a Match! 💕</span>
            <button
              onClick={() => router.push(`/dashboard/chat/${data.chatId}`)}
              className="mt-2 px-4 py-2 bg-pink-500 text-foreground rounded-lg text-sm font-medium"
            >
              Start Chatting
            </button>
          </div>,
          { duration: 5000 }
        );
      } else {
        toast.success("Like sent! 💝");
      }

      // Remove from list
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setFilteredUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (e) {
      toast.error("Failed to send like");
    }
  };

  const getMatchScoreColor = (score: number) => {
    if (score >= 90) return "from-green-400 to-emerald-500";
    if (score >= 80) return "from-pink-400 to-orange-500";
    if (score >= 70) return "from-yellow-400 to-orange-500";
    return "from-purple-500 to-violet-500";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black p-4">
        <div className="max-w-md mx-auto">
          <Skeleton className="h-12 w-full rounded-xl mb-4" />
          <div className="grid grid-cols-2 gap-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-black/80 backdrop-blur-xl border-b border-card-border">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-foreground">Matching Square</h1>
              <p className="text-xs text-foreground-muted">
                {filteredUsers.length} people nearby
              </p>
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-xl transition-colors ${
                showFilters ? "bg-pink-500/20 text-pink-400" : "bg-background-tertiary text-foreground-muted"
              }`}
            >
              <Filter className="w-5 h-5" />
            </button>
          </div>

          {/* Orientation Tags - Vertical Layout */}
          <div className="flex flex-wrap gap-2">
            {ORIENTATION_TAGS.map((tag) => (
              <button
                key={tag.value}
                onClick={() => setSelectedOrientation(tag.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all ${
                  selectedOrientation === tag.value
                    ? "bg-accent-lime text-black"
                    : "bg-background-tertiary text-foreground-muted hover:bg-background-tertiary"
                }`}
              >
                <span>{tag.emoji}</span>
                <span>{tag.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* User Grid */}
      <div className="max-w-md mx-auto p-4">
        {filteredUsers.length === 0 ? (
          <div className="text-center py-12">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-20 h-20 rounded-full bg-gradient-to-br from-pink-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-4"
            >
              <Sparkles className="w-10 h-10 text-pink-400" />
            </motion.div>
            <h2 className="text-lg font-bold text-foreground mb-2">No more profiles</h2>
            <p className="text-sm text-foreground-muted mb-4">Check back later for new matches</p>
            <button
              onClick={fetchUsers}
              className="px-4 py-2 bg-background-tertiary rounded-xl text-sm text-foreground hover:bg-background-tertiary transition-colors"
            >
              Refresh
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <AnimatePresence>
              {filteredUsers.map((user, index) => (
                <motion.div
                  key={user.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative group"
                >
                  {/* Card */}
                  <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-background-tertiary border border-card-border">
                    {/* Avatar - Unified rendering */}
                    {(() => {
                      const kind = getAvatarKind(user.avatar);
                      if (kind === 'none') {
                        return (
                          <div className="w-full h-full bg-gradient-to-br from-pink-500/20 to-orange-500/20 flex items-center justify-center">
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
                            <span className="text-6xl">{parsed?.emoji}</span>
                          </div>
                        );
                      }
                      return (
                        <img
                          src={user.avatar!}
                          alt={user.name}
                          className={getAvatarImgClasses(kind)}
                          style={kind === 'svg' ? { background: getAvatarBackground(kind, user.avatar) } : undefined}
                        />
                      );
                    })()}

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

                    {/* Online Indicator */}
                    {user.isOnline && (
                      <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-green-400" />
                    )}

                    {/* Match Score */}
                    <div className="absolute top-2 right-2">
                      <div className={`px-2 py-1 rounded-full bg-gradient-to-r ${getMatchScoreColor(user.matchScore)} text-foreground text-xs font-bold`}>
                        {user.matchScore}%
                      </div>
                    </div>

                    {/* Info */}
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <h3 className="font-bold text-foreground text-sm">
                        {user.name}, {user.age}
                      </h3>
                      {user.city && (
                        <p className="text-xs text-foreground-muted flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {user.city}
                        </p>
                      )}
                      <p className="text-xs text-foreground-subtle mt-1 line-clamp-1">
                        {user.matchReason}
                      </p>
                    </div>

                    {/* Hover Actions */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleLike(user.id)}
                        className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center hover:scale-110 transition-transform"
                      >
                        <Heart className="w-6 h-6 text-foreground" fill="currentColor" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {filteredUsers.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black to-transparent">
          <div className="max-w-md mx-auto">
            <button
              onClick={() => router.push("/dashboard/discover")}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-foreground font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Zap className="w-5 h-5" />
              Try Swipe Mode
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
