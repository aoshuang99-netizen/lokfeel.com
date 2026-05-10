"use client";

import { useState, useMemo } from "react";
import { Heart, Users, Clock, Eye, Loader2, MessageCircle, X } from "lucide-react";
import { useApiGet, useApiPost } from "@/hooks/use-api";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar, isBrokenAvatarUrl, getFallbackAvatarUrl } from "@/lib/avatar-utils";
import Link from "next/link";

// ══════════════════════════════════════
// CONNECTIONS PAGE — Unified Hub
// Likes You / Matches / Pending
// ══════════════════════════════════════

type TabType = "likes" | "matches" | "pending";

interface MatchUser {
  id: string;
  name: string;
  age: number;
  avatar: string | null;
  city: string | null;
}

interface MatchData {
  matches: Array<{
    id: string;
    otherUser: MatchUser;
    matchScore: number;
    matchReason: string;
    status: string;
    myReaction: string | null;
    otherReaction: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>;
  pagination: { total: number };
}

interface WhoLikedMeUser {
  id: string;
  matchId: string;
  matchScore: number;
  matchReason: string;
  sender: MatchUser & {
    gender: string | null;
    relationshipGoal: string | null;
  };
}

export default function ConnectionsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("likes");

  // Fetch matches data
  const { data: matchesData, isLoading: matchesLoading, refetch: refetchMatches } = useApiGet<MatchData>("/api/matches?limit=50");
  const { data: likesData, isLoading: likesLoading, refetch: refetchLikes } = useApiGet<{ senders: WhoLikedMeUser[] }>("/api/matches/who-liked-me?limit=50");

  const { post, isLoading: isReacting } = useApiPost();

  const matches = matchesData?.matches || [];
  const likes = likesData?.senders || [];

  // Tab counts
  const tabs: { id: TabType; label: string; icon: typeof Eye; count: number }[] = useMemo(() => [
    { id: "likes", label: "Likes You", icon: Eye, count: likes.length },
    { id: "matches", label: "Matches", icon: Heart, count: matches.filter((m) => m.status === "ACCEPTED").length },
    { id: "pending", label: "Pending", icon: Clock, count: matches.filter((m) => m.status === "PENDING" && m.myReaction === null).length },
  ], [likes, matches]);

  const handleReact = async (matchId: string, reaction: string) => {
    const result = await post(`/api/matches/${matchId}`, { reaction });
    if (result) {
      refetchMatches();
      refetchLikes();
    }
  };

  const isLoading = matchesLoading || likesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-foreground-muted">Loading connections...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground font-display">Connections</h1>
        <p className="text-sm text-foreground-muted">See who likes you, your matches, and pending requests</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-background-secondary rounded-xl border border-card-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? "bg-primary/15 text-primary shadow-sm"
                  : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  active ? "bg-primary text-primary-foreground" : "bg-background-tertiary text-foreground-muted"
                }`}>
                  {tab.count > 99 ? "99+" : tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === "likes" && (
        <div className="space-y-3">
          {likes.length === 0 ? (
            <EmptyState
              icon={Eye}
              title="No likes yet"
              description="Keep exploring! When someone likes you, they'll appear here."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {likes.map((like) => (
                <ConnectionCard
                  key={like.id}
                  user={like.sender}
                  matchScore={like.matchScore}
                  matchReason={like.matchReason}
                  matchId={like.matchId}
                  onReact={handleReact}
                  isReacting={isReacting}
                  showActions={true}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "matches" && (
        <div className="space-y-3">
          {matches.filter((m) => m.status === "ACCEPTED").length === 0 ? (
            <EmptyState
              icon={Heart}
              title="No matches yet"
              description="Accept connections to start chatting with your matches."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {matches
                .filter((m) => m.status === "ACCEPTED")
                .map((match) => (
                  <ConnectionCard
                    key={match.id}
                    user={match.otherUser}
                    matchScore={match.matchScore}
                    matchReason={match.matchReason}
                    matchId={match.id}
                    onReact={handleReact}
                    isReacting={isReacting}
                    showActions={false}
                    chatHref={`/dashboard/chats/${match.otherUser.id}`}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "pending" && (
        <div className="space-y-3">
          {matches.filter((m) => m.status === "PENDING" && m.myReaction === null).length === 0 ? (
            <EmptyState
              icon={Clock}
              title="All caught up!"
              description="No pending connections to review. Check back later."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {matches
                .filter((m) => m.status === "PENDING" && m.myReaction === null)
                .map((match) => (
                  <ConnectionCard
                    key={match.id}
                    user={match.otherUser}
                    matchScore={match.matchScore}
                    matchReason={match.matchReason}
                    matchId={match.id}
                    onReact={handleReact}
                    isReacting={isReacting}
                    showActions={true}
                    expiresAt={match.expiresAt}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Connection Card ──────────────────────────────────────────
function ConnectionCard({
  user,
  matchScore,
  matchReason,
  matchId,
  onReact,
  isReacting,
  showActions,
  chatHref,
  expiresAt,
}: {
  user: MatchUser;
  matchScore: number;
  matchReason: string;
  matchId: string;
  onReact: (id: string, reaction: string) => void;
  isReacting: boolean;
  showActions: boolean;
  chatHref?: string;
  expiresAt?: string | null;
}) {
  return (
    <div className="glass-card p-3 rounded-xl border border-card-border hover:border-primary/30 transition-all group">
      {/* Avatar */}
      <div className="relative mb-3">
        <div className={`w-full aspect-square rounded-lg overflow-hidden ${getAvatarBackground(getAvatarKind(user.avatar), user.avatar)}`}>
          {user.avatar && !isBrokenAvatarUrl(user.avatar) ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                const img = e.currentTarget;
                const fallbackUrl = getFallbackAvatarUrl(user.id || user.name);
                if (img.src !== (fallbackUrl || '')) {
                  img.src = fallbackUrl || '';
                } else {
                  img.style.display = 'none';
                }
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <img src={getFallbackAvatarUrl(user.id || user.name)} alt={user.name} className="w-16 h-16 object-contain p-1" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          )}
        </div>
        {/* Match Score Badge */}
        <div className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${
          matchScore >= 90 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
          matchScore >= 80 ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
          "bg-amber-600/20 text-amber-400 border-amber-600/30"
        }`}>
          {matchScore}%
        </div>
      </div>

      {/* Info */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground truncate">{user.name}{user.age ? `, ${user.age}` : ""}</h3>
        {user.city && <p className="text-xs text-foreground-muted truncate">{user.city}</p>}
        {matchReason && <p className="text-[10px] text-foreground-subtle line-clamp-1">{matchReason}</p>}
      </div>

      {/* Actions */}
      {showActions ? (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onReact(matchId, "PASS")}
            disabled={isReacting}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-background-tertiary text-foreground-muted hover:bg-red-500/20 hover:text-red-400 transition-all disabled:opacity-50"
          >
            <X className="w-3 h-3" />
          </button>
          <button
            onClick={() => onReact(matchId, "LIKE")}
            disabled={isReacting}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-all disabled:opacity-50"
          >
            <Heart className="w-3 h-3" />
          </button>
        </div>
      ) : chatHref ? (
        <Link
          href={chatHref}
          className="flex items-center justify-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all"
        >
          <MessageCircle className="w-3 h-3" />
          <span>Chat</span>
        </Link>
      ) : null}

      {/* Expiry */}
      {expiresAt && (
        <p className="text-[9px] text-foreground-subtle mt-2 text-center">
          Expires {new Date(expiresAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────
function EmptyState({ icon: Icon, title, description }: { icon: typeof Eye; title: string; description: string }) {
  return (
    <div className="glass-card p-12 text-center border border-card-border">
      <div className="w-16 h-16 rounded-2xl bg-background-tertiary flex items-center justify-center mx-auto mb-4">
        <Icon className="w-8 h-8 text-foreground-subtle" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-foreground-muted max-w-xs mx-auto">{description}</p>
    </div>
  );
}
