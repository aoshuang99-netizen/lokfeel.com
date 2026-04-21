"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Heart,
  X,
  MapPin,
  Sparkles,
  Star,
  ArrowLeft,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ══════════════════════════════════════
// USER CARD INTERFACE
// ══════════════════════════════════════

interface DiscoverUser {
  id: string;
  name: string;
  age: number;
  avatar: string | null;
  city?: string;
  bio?: string;
  matchScore: number;
  matchReason: string;
  tags: string[];
}

// ══════════════════════════════════════
// DEMO USERS (for testing)
// ══════════════════════════════════════

const DEMO_USERS: DiscoverUser[] = [
  {
    id: "demo-1",
    name: "Sarah",
    age: 28,
    avatar: null,
    city: "New York",
    bio: "Coffee lover, hiking enthusiast, looking for meaningful connections",
    matchScore: 95,
    matchReason: "Both value deep conversations and outdoor activities",
    tags: ["Coffee", "Hiking", "Deep Talks"],
  },
  {
    id: "demo-2",
    name: "Michael",
    age: 32,
    avatar: null,
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
    avatar: null,
    city: "Chicago",
    bio: "Book worm, yoga practitioner, seeking genuine connections",
    matchScore: 92,
    matchReason: "Similar values around mindfulness and growth",
    tags: ["Yoga", "Reading", "Mindfulness"],
  },
  {
    id: "demo-4",
    name: "James",
    age: 30,
    avatar: null,
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
    avatar: null,
    city: "Miami",
    bio: "Dancer, beach lover, looking for someone authentic",
    matchScore: 90,
    matchReason: "Complementary personalities, shared love for adventure",
    tags: ["Dance", "Beach", "Authenticity"],
  },
];

// ══════════════════════════════════════
// SWIPE CARD COMPONENT
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

  const getAvatarUrl = () => {
    if (user.avatar) return user.avatar;
    const seed = user.name.charCodeAt(0) % 5;
    const avatars = [
      "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
      "https://api.dicebear.com/7.x/avataaars/svg?seed=Michael",
      "https://api.dicebear.com/7.x/avataaars/svg?seed=Emma",
      "https://api.dicebear.com/7.x/avataaars/svg?seed=James",
      "https://api.dicebear.com/7.x/avataaars/svg?seed=Olivia",
    ];
    return avatars[seed] || avatars[0];
  };

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
      <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-2xl bg-card border border-border">
        {/* Background Image / Avatar */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/20 via-background to-background">
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={getAvatarUrl()}
              alt={user.name}
              className="w-48 h-48 rounded-full object-cover border-4 border-background shadow-xl"
            />
          </div>
        </div>

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />

        {/* Swipe Indicators */}
        <AnimatePresence>
          {showIndicator === "right" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute top-8 left-8 border-4 border-green-500 text-green-500 rounded-xl px-4 py-2 font-bold text-2xl rotate-[-15deg]"
            >
              LIKE
            </motion.div>
          )}
          {showIndicator === "left" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute top-8 right-8 border-4 border-red-500 text-red-500 rounded-xl px-4 py-2 font-bold text-2xl rotate-[15deg]"
            >
              NOPE
            </motion.div>
          )}
        </AnimatePresence>

        {/* Match Score Badge */}
        <div className="absolute top-4 right-4 bg-primary/90 text-primary-foreground px-3 py-1.5 rounded-full flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="w-4 h-4" />
          {user.matchScore}% Match
        </div>

        {/* Content */}
        <div className="absolute bottom-0 left-0 right-0 p-6 space-y-4">
          {/* Name & Age */}
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-bold">
                {user.name}, {user.age}
              </h2>
              {user.city && (
                <div className="flex items-center gap-1.5 text-muted-foreground mt-1">
                  <MapPin className="w-4 h-4" />
                  {user.city}
                </div>
              )}
            </div>
          </div>

          {/* Match Reason */}
          <div className="bg-primary/10 rounded-xl p-3 border border-primary/20">
            <p className="text-sm text-primary flex items-start gap-2">
              <Star className="w-4 h-4 mt-0.5 shrink-0" />
              {user.matchReason}
            </p>
          </div>

          {/* Bio */}
          {user.bio && (
            <p className="text-muted-foreground text-sm line-clamp-2">
              {user.bio}
            </p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {user.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-secondary text-secondary-foreground rounded-full text-xs font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
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
  const [currentIndex, setCurrentIndex] = useState(0);

  // Load users
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
          city: u.city,
          bio: u.bio,
          matchScore: Math.round(u.matchScore || 85),
          matchReason: u.matchReason || "Great compatibility based on your profile",
          tags: u.tags || ["Match"],
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
                onClick: () => router.push("/dashboard/matches"),
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 bg-primary/20 rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading profiles...</p>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-muted rounded-full mx-auto mb-6 flex items-center justify-center">
            <Heart className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2">No more profiles</h2>
          <p className="text-muted-foreground mb-6">
            Check back later for more matches
          </p>
          <Button onClick={() => router.push("/dashboard")}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const remainingUsers = users.slice(currentIndex);
  const progress = ((currentIndex / users.length) * 100).toFixed(0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 border-b flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/dashboard")}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="text-center">
          <h1 className="font-semibold">Discover</h1>
          <p className="text-xs text-muted-foreground">
            {currentIndex + 1} / {users.length}
          </p>
        </div>
        <Button variant="ghost" size="icon">
          <Info className="w-5 h-5" />
        </Button>
      </header>

      {/* Progress Bar */}
      <div className="h-1 bg-muted">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Card Stack */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
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
                  <div className="w-20 h-20 bg-primary/10 rounded-full mx-auto mb-4 flex items-center justify-center">
                    <Heart className="w-10 h-10 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">All caught up!</h3>
                  <p className="text-muted-foreground">
                    Check back later for more profiles
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-6 pb-8 pt-4">
        <div className="flex items-center justify-center gap-6">
          <Button
            variant="outline"
            size="lg"
            className="w-16 h-16 rounded-full border-2 border-red-500/50 hover:bg-red-500/10 hover:border-red-500"
            onClick={() => handleButtonSwipe("left")}
            disabled={currentIndex >= users.length}
          >
            <X className="w-8 h-8 text-red-500" />
          </Button>

          <Button
            size="lg"
            className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600"
            onClick={() => handleButtonSwipe("right")}
            disabled={currentIndex >= users.length}
          >
            <Heart className="w-8 h-8" />
          </Button>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Swipe right to like, left to pass
        </p>
      </div>
    </div>
  );
}
