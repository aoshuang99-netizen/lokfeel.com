"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  Heart,
  X,
  MapPin,
  Sparkles,
  Star,
  ArrowLeft,
  Info,
  ChevronDown,
  ChevronUp,
  User,
  Flame,
  Zap,
  RefreshCw,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar, isBrokenAvatarUrl, getRealPhotoAvatarUrl, generateLocalAvatarDataUri } from "@/lib/avatar-utils";

// ══════════════════════════════════════
// DESIGN TOKENS
// ══════════════════════════════════════
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// ══════════════════════════════════════
// USER CARD INTERFACE
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
  tags: string[];
  verified?: boolean;
}

// ══════════════════════════════════════
// DEMO USERS (fallback)
// ══════════════════════════════════════

// Real photo URLs — high-quality Unsplash portraits with gender-appropriate images
// Format: https://images.unsplash.com/photo-{ID}?w=600&h=800&fit=crop&crop=face
const DEMO_USERS: DiscoverUser[] = [
  {
    id: "demo-1",
    name: "Sarah",
    age: 28,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=800&fit=crop&crop=face",
    city: "New York",
    bio: "Coffee lover, hiking enthusiast, looking for meaningful connections",
    matchScore: 95,
    matchReason: "Both value deep conversations and outdoor activities",
    tags: ["Coffee", "Hiking", "Deep Talks"],
    verified: true,
  },
  {
    id: "demo-2",
    name: "Michael",
    age: 32,
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=800&fit=crop&crop=face",
    city: "Los Angeles",
    bio: "Creative soul, photographer, love exploring new places",
    matchScore: 88,
    matchReason: "Shared interest in art and travel",
    tags: ["Photography", "Travel", "Art"],
  },
  {
    id: "demo-3",
    name: "Emma",
    age: 26,
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&h=800&fit=crop&crop=face",
    city: "Chicago",
    bio: "Book worm, yoga practitioner, seeking genuine connections",
    matchScore: 92,
    matchReason: "Similar values around mindfulness and growth",
    tags: ["Yoga", "Reading", "Mindfulness"],
    verified: true,
  },
  {
    id: "demo-4",
    name: "James",
    age: 30,
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=800&fit=crop&crop=face",
    city: "San Francisco",
    bio: "Tech professional, foodie, enjoy meaningful conversations",
    matchScore: 85,
    matchReason: "Both passionate about learning and good food",
    tags: ["Tech", "Foodie", "Learning"],
  },
  {
    id: "demo-5",
    name: "Olivia",
    age: 27,
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&h=800&fit=crop&crop=face",
    city: "Miami",
    bio: "Dancer, beach lover, looking for someone authentic",
    matchScore: 90,
    matchReason: "Complementary personalities, shared love for adventure",
    tags: ["Dance", "Beach", "Authenticity"],
  },
];

// ══════════════════════════════════════
// MATCH SCORE HELPERS
// ══════════════════════════════════════

function getMatchScoreGradient(score: number): string {
  if (score >= 90) return "from-amber-400 to-amber-600"; // Gold
  if (score >= 80) return "from-orange-400 to-pink-500"; // Purple-Pink
  return "from-amber-400 to-amber-700"; // Indigo
}

function getMatchScoreBg(score: number): string {
  if (score >= 90) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (score >= 80) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-amber-600/20 text-amber-400 border-amber-600/30";
}

// ══════════════════════════════════════
// SWIPE CARD COMPONENT (Feeld-inspired)
// ══════════════════════════════════════

function SwipeCard({
  user,
  onSwipe,
  isTop,
}: {
  user: DiscoverUser;
  onSwipe: (direction: string) => void;
  isTop: boolean;
}) {
  const [exitX, setExitX] = useState(0);
  const [showIndicator, setShowIndicator] = useState<string | null>(null);
  const [showWhyMatch, setShowWhyMatch] = useState(false);

  const handleDragEnd = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    const threshold = 100;
    if (info.offset.x > threshold) {
      setExitX(500);
      setShowIndicator("right");
      setTimeout(() => onSwipe("right"), 200);
    } else if (info.offset.x < -threshold) {
      setExitX(-500);
      setShowIndicator("left");
      setTimeout(() => onSwipe("left"), 200);
    }
  };

  const handleDrag = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (info.offset.x > 50) {
      setShowIndicator("right");
    } else if (info.offset.x < -50) {
      setShowIndicator("left");
    } else {
      setShowIndicator(null);
    }
  };

  return (
    <motion.div
      className="absolute w-full h-full"
      initial={{ scale: 0.95, opacity: 0, x: 0 }}
      animate={{
        scale: isTop ? 1 : 0.95,
        opacity: 1,
        x: exitX,
        rotate: exitX > 0 ? 15 : exitX < 0 ? -15 : 0,
      }}
      exit={{ x: exitX, opacity: 0 }}
      transition={{ duration: 0.3, type: "spring", stiffness: 300, damping: 30 }}
      drag={isTop ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.8}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      style={{ zIndex: isTop ? 10 : 5 }}
    >
      <div className="relative w-full h-full rounded-3xl overflow-hidden bg-background border border-card-border"
        style={{ transitionTimingFunction: EASING }}
      >
        {/* Photo / Avatar Area — Real HD Photos */}
        <div className="absolute inset-0">
          {(() => {
            const kind = getAvatarKind(user.avatar);
            if (kind === 'emoji') {
              const parsed = parseEmojiAvatar(user.avatar);
              return (
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ background: getAvatarBackground(kind, user.avatar) }}
                >
                  <span className="text-9xl">{parsed?.emoji}</span>
                </div>
              );
            }
            // Always use real photo: user photo or gender-aware fallback
            const photoUrl = (kind === 'photo' && user.avatar && !isBrokenAvatarUrl(user.avatar))
              ? user.avatar
              : getRealPhotoAvatarUrl(user.id || user.name, undefined, 'preview');
            return (
              <img
                src={photoUrl}
                alt={user.name}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const img = e.currentTarget;
                  const fallbackUrl = getRealPhotoAvatarUrl(user.id || user.name, undefined, 'preview');
                  if (img.src !== fallbackUrl) {
                    img.src = fallbackUrl;
                  } else {
                    // All external URLs failed — use local SVG data-URI
                    img.src = generateLocalAvatarDataUri(user.id || user.name);
                    img.style.display = '';
                  }
                }}
              />
            );
          })()}
        </div>

        {/* Gradient Overlays — Cool Blue design system */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-background/40 to-transparent" />

        {/* Swipe Indicators */}
        <AnimatePresence>
          {showIndicator === "right" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute top-10 left-8 border-4 border-green-500 text-green-500 rounded-xl px-5 py-2 font-bold text-2xl rotate-[-15deg] shadow-lg"
            >
              LIKE
            </motion.div>
          )}
          {showIndicator === "left" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute top-10 right-8 border-4 border-red-500 text-red-500 rounded-xl px-5 py-2 font-bold text-2xl rotate-[15deg] shadow-lg"
            >
              NOPE
            </motion.div>
          )}
        </AnimatePresence>

        {/* Match Score Badge (top right) */}
        <div className="absolute top-4 right-4 z-20">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold text-foreground bg-gradient-to-r ${getMatchScoreGradient(user.matchScore)} shadow-lg`}
          >
            <Flame className="w-4 h-4" />
            {user.matchScore}%
          </span>
        </div>

        {/* Verified Badge */}
        {user.verified && (
          <div className="absolute top-4 left-4 z-20">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/80 text-foreground text-xs font-medium shadow-lg">
              <Zap className="w-3 h-3" /> Verified
            </span>
          </div>
        )}

        {/* Content (bottom) */}
        <div className="absolute bottom-0 left-0 right-0 p-5 z-10">
          {/* Name & Age */}
          <div className="mb-3">
            <h2 className="text-2xl font-bold text-foreground">
              {user.name}, {user.age}
            </h2>
            {user.city && (
              <div className="flex items-center gap-1.5 text-foreground-muted text-sm mt-1">
                <MapPin className="w-3.5 h-3.5" />
                {user.city}
              </div>
            )}
          </div>

          {/* Bio */}
          {user.bio && (
            <p className="text-foreground-muted text-sm line-clamp-2 mb-3">{user.bio}</p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {user.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 bg-background-tertiary text-foreground-muted rounded-full text-[11px] font-medium border border-card-border"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Why this match? (expandable) */}
          <button
            onClick={() => setShowWhyMatch(!showWhyMatch)}
            className="w-full text-left"
          >
            <div className={`rounded-xl p-3 border transition-all duration-200 ${
              showWhyMatch
                ? "bg-primary/15 border-primary/30"
                : "bg-background-tertiary border-card-border hover:border-primary/20"
            }`}
              style={{ transitionTimingFunction: EASING }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star className={`w-4 h-4 ${showWhyMatch ? "text-primary" : "text-foreground-subtle"}`} />
                  <span className="text-xs font-medium text-foreground-muted">
                    Why this match?
                  </span>
                </div>
                {showWhyMatch ? (
                  <ChevronUp className="w-4 h-4 text-foreground-subtle" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-foreground-subtle" />
                )}
              </div>
              <AnimatePresence>
                {showWhyMatch && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-xs text-primary/80 mt-2 overflow-hidden"
                  >
                    {user.matchReason}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════

export default function DiscoverPage() {
  const router = useRouter();
  const [users, setUsers] = useState<DiscoverUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/discover?limit=20");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      if (data.users && data.users.length > 0) {
        const transformedUsers = data.users.map((u: any) => ({
          id: u.id,
          name: u.name || u.displayName || "Anonymous",
          age: u.age || 25,
          avatar: u.avatar,
          avatarType: u.avatarType,
          city: u.city,
          bio: u.bio,
          matchScore: Math.round(u.matchScore || 85),
          matchReason: u.matchReason || "Great compatibility based on your profile",
          tags: u.tags || ["Match"],
          verified: u.verified,
        }));
        setUsers(transformedUsers);
      } else {
        setUsers(DEMO_USERS);
      }
    } catch (e) {
      console.error("Failed to load users:", e);
      setUsers(DEMO_USERS);
    } finally {
      setLoading(false);
    }
  };

  const handleSwipe = useCallback(
    async (swipedDirection: string, userId: string) => {
      setCurrentIndex((prev) => prev + 1);

      if (swipedDirection === "right") {
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
            toast.success("It's a match! 🎉", {
              description: "You can now start chatting",
              action: {
                label: "Chat",
                onClick: () => router.push("/dashboard/chats"),
              },
            });
          }
        } catch (e) {
          console.error("Failed to like:", e);
        }
      }
    },
    [router]
  );

  const handleButtonSwipe = (swipeDirection: "left" | "right") => {
    if (currentIndex >= users.length) return;
    const user = users[currentIndex];
    handleSwipe(swipeDirection, user.id);
  };

  // ──── LOADING ────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-foreground-muted text-sm">Loading profiles...</p>
        </div>
      </div>
    );
  }

  // ──── EMPTY ────
  if (users.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-background-tertiary flex items-center justify-center mx-auto mb-6">
            <Heart className="w-10 h-10 text-foreground-faint" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">No more profiles</h2>
          <p className="text-foreground-muted text-sm mb-6">
            Check back later for more matches
          </p>
          <Link href="/dashboard" className="btn-primary text-sm">
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  const remainingUsers = users.slice(currentIndex);
  const progress = ((currentIndex / users.length) * 100).toFixed(0);

  return (
    <div className="flex flex-col -mx-4 -mt-6 lg:mx-0 lg:mt-0">
      {/* ── Header ── */}
      <header className="px-5 py-4 border-b border-card-border flex items-center justify-between bg-background">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="p-2 -ml-2 rounded-full hover:bg-background-tertiary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </Link>
          <div>
            <h1 className="font-semibold text-foreground text-sm">Discover</h1>
            <p className="text-[11px] text-foreground-subtle">
              {currentIndex + 1} of {users.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter — toggle panel */}
          <button
            onClick={() => setShowFilter(prev => !prev)}
            className={`p-2 rounded-full hover:bg-background-tertiary transition-colors ${showFilter ? 'bg-background-tertiary' : ''}`}
          >
            <Filter className="w-4 h-4 text-foreground-muted" />
          </button>
          <button
            onClick={loadUsers}
            className="p-2 rounded-full hover:bg-background-tertiary transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-foreground-muted" />
          </button>
        </div>
      </header>

      {/* ── Progress Bar ── */}
      <div className="h-0.5 bg-background-tertiary">
        <motion.div
          className="h-full bg-gradient-to-r from-primary to-secondary"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* ── Filter Panel (Coming Soon) ── */}
      <AnimatePresence>
        {showFilter && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-card-border"
          >
            <div className="px-5 py-4 bg-card">
              <h3 className="text-sm font-semibold text-foreground mb-3">Filters</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-foreground-muted mb-1 block">Age Range</label>
                  <div className="flex items-center gap-2">
                    <input type="number" placeholder="18" min="18" max="99"
                      className="w-full px-3 py-2 rounded-lg border border-card-border bg-background text-sm text-foreground" />
                    <span className="text-foreground-muted text-sm">-</span>
                    <input type="number" placeholder="50" min="18" max="99"
                      className="w-full px-3 py-2 rounded-lg border border-card-border bg-background text-sm text-foreground" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-foreground-muted mb-1 block">Distance</label>
                  <select className="w-full px-3 py-2 rounded-lg border border-card-border bg-background text-sm text-foreground">
                    <option>Any distance</option>
                    <option>5 km</option>
                    <option>25 km</option>
                    <option>50 km</option>
                    <option>100 km</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-foreground-muted mt-3">
                More filters and advanced matching coming soon.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Card Stack ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-5 min-h-[50vh]">
        <div className="relative w-full max-w-sm aspect-[3/4]">
          <AnimatePresence mode="popLayout">
            {remainingUsers.length > 0 ? (
              remainingUsers
                .slice(0, 3)
                .reverse()
                .map((user, index) => (
                  <SwipeCard
                    key={user.id}
                    user={user}
                    onSwipe={(dir) => handleSwipe(dir, user.id)}
                    isTop={index === remainingUsers.slice(0, 3).length - 1}
                  />
                ))
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-10 h-10 text-primary/50" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">All caught up!</h3>
                  <p className="text-foreground-muted text-sm mb-4">
                    Check back later for more profiles
                  </p>
                  <button
                    onClick={loadUsers}
                    className="btn-primary text-sm"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="px-6 pb-8 pt-2">
        <div className="flex items-center justify-center gap-8">
          {/* Pass */}
          <button
            onClick={() => handleButtonSwipe("left")}
            disabled={currentIndex >= users.length}
            className="w-14 h-14 rounded-full border-2 border-red-500/40 hover:border-red-500 hover:bg-red-500/10 text-red-500 flex items-center justify-center transition-all disabled:opacity-30"
            style={{ transitionTimingFunction: EASING }}
          >
            <X className="w-7 h-7" />
          </button>

          {/* Super Like — send INTERESTED reaction */}
          <button
            onClick={async () => {
              if (currentIndex >= users.length) return;
              const user = users[currentIndex];
              try {
                await fetch("/api/matches/react", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ targetUserId: user.id, reaction: "INTERESTED" }),
                });
                toast.success(`Super liked ${user.name}! ⭐`);
                setCurrentIndex(prev => prev + 1);
              } catch {
                toast.error("Failed to super like");
              }
            }}
            disabled={currentIndex >= users.length}
            className="w-10 h-10 rounded-full border border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/10 text-blue-500 flex items-center justify-center transition-all disabled:opacity-30"
            style={{ transitionTimingFunction: EASING }}
          >
            <Star className="w-5 h-5" />
          </button>

          {/* Like */}
          <button
            onClick={() => handleButtonSwipe("right")}
            disabled={currentIndex >= users.length}
            className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-secondary text-foreground flex items-center justify-center shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all disabled:opacity-30"
            style={{ transitionTimingFunction: EASING }}
          >
            <Heart className="w-7 h-7" fill="white" />
          </button>
        </div>
        <p className="text-center text-xs text-foreground-subtle mt-3">
          Swipe right to like, left to pass
        </p>
      </div>
    </div>
  );
}
