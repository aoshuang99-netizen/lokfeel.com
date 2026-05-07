"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Heart,
  Eye,
  ArrowRight,
  Users,
  MessageCircle,
  ArrowLeft,
  Flame,
  MapPin,
  Loader2,
  Sparkles,
} from "lucide-react";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar } from "@/lib/avatar-utils";

// ══════════════════════════════════════
// TYPES
// ══════════════════════════════════════

interface WhoLikedMeUser {
  id: string;
  matchId: string;
  matchScore: number;
  matchReason: string;
  sender: {
    id: string;
    displayName: string;
    avatar: string | null;
    age: number | null;
    city: string | null;
    gender: string | null;
    relationshipGoal: string | null;
  };
}

// ══════════════════════════════════════
// MATCH SCORE HELPERS
// ══════════════════════════════════════

function getMatchScoreBg(score: number): string {
  if (score >= 90) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (score >= 80) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-amber-600/20 text-amber-400 border-amber-600/30";
}

function getMatchScoreGradient(score: number): string {
  if (score >= 90) return "from-amber-400 to-amber-600";
  if (score >= 80) return "from-orange-400 to-pink-500";
  return "from-amber-400 to-amber-700";
}

// ══════════════════════════════════════
// AVATAR COMPONENT
// ══════════════════════════════════════

function UserAvatar({ avatar, name }: { avatar: string | null; name: string }) {
  const kind = getAvatarKind(avatar);
  if (kind === 'none') {
    return (
      <div className="w-full h-full bg-gradient-to-br from-primary/20 via-[#13121a] to-[#0d0c11] flex items-center justify-center rounded-2xl">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center">
          <Users className="w-8 h-8 text-foreground-faint" />
        </div>
      </div>
    );
  }
  if (kind === 'emoji') {
    const parsed = parseEmojiAvatar(avatar);
    return (
      <div
        className="w-full h-full flex items-center justify-center rounded-2xl"
        style={{ background: getAvatarBackground(kind, avatar) }}
      >
        <span className="text-6xl">{parsed?.emoji}</span>
      </div>
    );
  }
  return (
    <img
      src={avatar!}
      alt={name}
      className={`${getAvatarImgClasses(kind)} rounded-2xl`}
      style={kind === 'svg' ? { background: getAvatarBackground(kind, avatar) } : undefined}
    />
  );
}

// ══════════════════════════════════════
// USER CARD COMPONENT
// ══════════════════════════════════════

function LikeCard({ user, index }: { user: WhoLikedMeUser; index: number }) {
  const router = useRouter();

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card overflow-hidden group hover:border-primary/20 transition-all duration-300"
    >
      {/* Avatar Area */}
      <div className="relative aspect-[4/5] overflow-hidden">
        <UserAvatar avatar={user.sender.avatar} name={user.sender.displayName} />

        {/* Gradient overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#0d0c11] via-[#0d0c11]/60 to-transparent" />

        {/* Match Score Badge */}
        <div className="absolute top-3 right-3 z-10">
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gradient-to-r ${getMatchScoreGradient(user.matchScore)} shadow-lg`}
          >
            <Flame className="w-3 h-3" />
            {user.matchScore}%
          </span>
        </div>

        {/* Heart badge (liked indicator) */}
        <div className="absolute top-3 left-3 z-10">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/80 text-foreground text-xs font-medium shadow-lg">
            <Heart className="w-3 h-3" fill="white" />
            Liked you
          </span>
        </div>

        {/* Name & info at bottom of avatar */}
        <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
          <h3 className="text-lg font-bold text-foreground leading-tight">
            {user.sender.displayName}, {user.sender.age || '?'}
          </h3>
          {user.sender.city && (
            <div className="flex items-center gap-1 text-foreground-muted text-xs mt-1">
              <MapPin className="w-3 h-3" />
              {user.sender.city}
            </div>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4 space-y-3">
        {/* Match Reason */}
        <div className="p-3 rounded-xl bg-background-tertiary border border-card-border">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-[11px] font-medium text-foreground-muted uppercase tracking-wider">
              Why they matched with you
            </span>
          </div>
          <p className="text-xs text-foreground-muted line-clamp-2 leading-relaxed">
            {user.matchReason}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Link
            href={`/dashboard/matches?highlight=${user.matchId}`}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-foreground text-sm font-semibold hover:shadow-lg hover:shadow-primary/20 transition-all duration-200"
          >
            <Eye className="w-4 h-4" />
            View Profile
          </Link>
          <Link
            href={`/dashboard/chat?matchId=${user.matchId}`}
            className="flex items-center justify-center px-3 py-2.5 rounded-xl border border-card-border bg-background-tertiary hover:border-primary/30 text-foreground-muted hover:text-foreground transition-all duration-200"
          >
            <MessageCircle className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════

export default function WhoLikedMePage() {
  const [users, setUsers] = useState<WhoLikedMeUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLikes() {
      try {
        const res = await fetch("/api/who-liked-me");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setUsers(data.likes || []);
      } catch (e) {
        console.error("Failed to load likes:", e);
      } finally {
        setLoading(false);
      }
    }
    loadLikes();
  }, []);

  // ──── LOADING ────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-foreground-muted text-sm">Finding your admirers...</p>
        </div>
      </div>
    );
  }

  // ──── EMPTY STATE ────
  if (users.length === 0) {
    return (
      <div className="flex flex-col -mx-4 -mt-6 lg:mx-0 lg:mt-0">
        {/* Header */}
        <header className="px-5 py-4 border-b border-card-border flex items-center gap-3 bg-background">
          <Link
            href="/dashboard"
            className="p-2 -ml-2 rounded-full hover:bg-background-tertiary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </Link>
          <div>
            <h1 className="font-semibold text-foreground text-sm">Who Liked Me</h1>
            <p className="text-[11px] text-foreground-subtle">See who's interested</p>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center max-w-sm"
          >
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center mx-auto mb-6 border border-primary/10">
              <Heart className="w-12 h-12 text-primary/30" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">No likes yet</h2>
            <p className="text-foreground-muted text-sm mb-6 leading-relaxed">
              When someone shows interest in you, they'll appear here. Keep completing your profile to attract more matches!
            </p>
            <Link
              href="/dashboard/discover"
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Discover People
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col -mx-4 -mt-6 lg:mx-0 lg:mt-0">
      {/* ── Gradient Header ── */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-secondary/10 to-transparent" />
        <div className="absolute inset-0 bg-[#0d0c11]/40 backdrop-blur-sm" />
        <div className="relative px-5 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 -ml-2 rounded-full hover:bg-background-tertiary/80 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </Link>
            <div>
              <h1 className="font-bold text-foreground text-base flex items-center gap-2">
                <Heart className="w-5 h-5 text-red-400" fill="currentColor" />
                Who Liked Me
              </h1>
              <p className="text-[11px] text-foreground-muted mt-0.5">
                {users.length} {users.length === 1 ? 'person' : 'people'} interested in you
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-background-tertiary/60 border border-card-border">
            <Eye className="w-3.5 h-3.5 text-foreground-muted" />
            <span className="text-xs font-medium text-foreground-muted">Premium</span>
          </div>
        </div>
      </header>

      {/* ── User Cards Grid ── */}
      <div className="flex-1 p-4">
        <AnimatePresence mode="wait">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {users.map((user, index) => (
              <LikeCard key={user.matchId} user={user} index={index} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
