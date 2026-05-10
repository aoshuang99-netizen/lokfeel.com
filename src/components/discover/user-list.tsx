"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Heart, X, MapPin, MessageCircle, Flame } from "lucide-react";

// ═════════════════════════════════════
// TYPES
// ═════════════════════════════════════

interface UserListItem {
  id: string;
  name: string;
  age: number;
  avatar: string | null;
  avatarType?: string;
  city?: string;
  bio?: string;
  matchScore: number;
  matchReason?: string;
  tags: string[];
  verified?: boolean;
  lastActive?: string;
}

interface UserListProps {
  initialUsers?: UserListItem[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
}

// ═════════════════════════════════════
// MATCH SCORE BADGE
// ═════════════════════════════════════

function MatchScoreBadge({ score }: { score: number }) {
  const getColor = () => {
    if (score >= 90) return "bg-gradient-to-r from-amber-400 to-amber-600";
    if (score >= 80) return "bg-gradient-to-r from-purple-400 to-pink-500";
    return "bg-primary/80";
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-white ${getColor()}`}>
      <Flame className="w-3 h-3" />
      {score}%
    </span>
  );
}

// ═════════════════════════════════════
// USER LIST ITEM (Feeld/Hinge Style)
// ═════════════════════════════════════

function UserListItem({ user, onLike, onPass }: {
  user: UserListItem;
  onLike: (id: string) => void;
  onPass: (id: string) => void;
}) {
  const [showReason, setShowReason] = useState(false);

  return (
    <div className="group relative bg-[#111111] rounded-2xl border border-white/5 hover:border-primary/30 transition-all duration-300 overflow-hidden">
      {/* Mobile: Vertical Layout | Desktop: Horizontal Layout */}
      <div className="flex flex-col sm:flex-row">
        {/* Avatar Area - 40% width on mobile, fixed width on desktop */}
        <Link href={`/dashboard/users/${user.id}`} className="relative sm:w-48 h-48 sm:h-auto overflow-hidden">
          <div className="w-full h-full min-h-48 bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="text-6xl">👤</div>
            )}
          </div>

          {/* Match Score - Top Right */}
          <div className="absolute top-3 right-3">
            <MatchScoreBadge score={user.matchScore} />
          </div>

          {/* Verified Badge - Bottom Left */}
          {user.verified && (
            <div className="absolute bottom-3 left-3">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/80 text-white text-[10px] font-medium">
                ✓ Verified
              </span>
            </div>
          )}
        </Link>

        {/* Content Area */}
        <div className="flex-1 p-4 sm:p-5 flex flex-col justify-between">
          <div>
            {/* Name & Age */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
                  <Link href={`/dashboard/users/${user.id}`}>
                    {user.name}, {user.age}
                  </Link>
                </h3>
                {user.city && (
                  <div className="flex items-center gap-1 text-foreground-muted text-sm mt-0.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {user.city}
                  </div>
                )}
              </div>

              {/* Quick Action - Desktop */}
              <div className="hidden sm:flex items-center gap-2">
                <button
                  onClick={() => onPass(user.id)}
                  className="w-10 h-10 rounded-full border-2 border-red-500/40 hover:border-red-500 hover:bg-red-500/10 text-red-500 flex items-center justify-center transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
                <button
                  onClick={() => onLike(user.id)}
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary text-white flex items-center justify-center shadow-lg shadow-primary/20"
                >
                  <Heart className="w-5 h-5" fill="white" />
                </button>
              </div>
            </div>

            {/* Bio */}
            {user.bio && (
              <p className="text-foreground-muted text-sm line-clamp-2 mb-3 leading-relaxed">
                {user.bio}
              </p>
            )}

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {user.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 bg-white/5 text-foreground-muted rounded-full text-[11px] font-medium border border-white/10"
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Match Reason - Expandable */}
            {user.matchReason && (
              <button
                onClick={() => setShowReason(!showReason)}
                className="w-full text-left"
              >
                <div className={`rounded-xl p-3 border transition-all duration-200 ${
                  showReason
                    ? "bg-primary/15 border-primary/30"
                    : "bg-white/5 border-white/10 hover:border-primary/20"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground-muted">
                      Why {user.matchScore}% match?
                    </span>
                    <span className="text-xs text-foreground-subtle">
                      {showReason ? '↑' : '↓'}
                    </span>
                  </div>
                  {showReason && (
                    <p className="text-xs text-primary/80 mt-2">
                      {user.matchReason}
                    </p>
                  )}
                </div>
              </button>
            )}
          </div>

          {/* Mobile Actions */}
          <div className="flex sm:hidden items-center gap-4 mt-4 pt-4 border-t border-white/5">
            <button
              onClick={() => onPass(user.id)}
              className="flex-1 py-2.5 rounded-xl border-2 border-red-500/40 text-red-500 font-medium text-sm hover:bg-red-500/10 transition-colors"
            >
              Pass
            </button>
            <button
              onClick={() => onLike(user.id)}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-medium text-sm shadow-lg shadow-primary/20"
            >
              Like
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════
// INFINITE SCROLL HOOK
// ═════════════════════════════════════

function useInfiniteScroll(onLoadMore: () => void, hasMore: boolean, isLoading: boolean) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (isLoading) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) {
        onLoadMore();
      }
    });

    if (node) {
      observerRef.current.observe(node);
    }
  }, [isLoading, hasMore, onLoadMore]);

  return loadMoreRef;
}

// ═════════════════════════════════════
// MAIN USER LIST COMPONENT
// ═════════════════════════════════════

export function UserList({ initialUsers = [], onLoadMore, hasMore = true, isLoading = false }: UserListProps) {
  const [users, setUsers] = useState<UserListItem[]>(initialUsers);
  const [internalLoading, setInternalLoading] = useState(false);

  const loadMoreRef = useInfiniteScroll(() => {
    if (onLoadMore) {
      onLoadMore();
    } else {
      // Demo: Load more users
      setInternalLoading(true);
      setTimeout(() => {
        setUsers(prev => [...prev, ...initialUsers.map(u => ({ ...u, id: `${u.id}-${Date.now()}` }))]);
        setInternalLoading(false);
      }, 1000);
    }
  }, hasMore, isLoading || internalLoading);

  // Load initial users
  useEffect(() => {
    if (initialUsers.length > 0 && users.length === 0) {
      setUsers(initialUsers);
    }
  }, [initialUsers]);

  return (
    <div className="space-y-4">
      {/* User List */}
      {users.map((user) => (
        <UserListItem
          key={user.id}
          user={user}
          onLike={(id) => console.log('Like:', id)}
          onPass={(id) => console.log('Pass:', id)}
        />
      ))}

      {/* Loading More Indicator */}
      <div ref={loadMoreRef} className="py-8 text-center">
        {isLoading || internalLoading ? (
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span className="text-sm text-foreground-muted">Loading more...</span>
          </div>
        ) : hasMore ? (
          <span className="text-sm text-foreground-subtle">Scroll for more</span>
        ) : (
          <span className="text-sm text-foreground-muted">No more users</span>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════
// EXPORT: Discover Page with List View
// ═════════════════════════════════════

export function DiscoverListPage() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadUsers = async (pageNum: number) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/discover?page=${pageNum}&limit=10`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      if (data.users && data.users.length > 0) {
        const transformed = data.users.map((u: any) => ({
          id: u.id,
          name: u.name || u.displayName || "Anonymous",
          age: u.age || 25,
          avatar: u.avatar,
          avatarType: u.avatarType,
          city: u.city,
          bio: u.bio,
          matchScore: Math.round(u.matchScore || 85),
          matchReason: u.matchReason || "Great compatibility",
          tags: u.tags || [],
          verified: u.verified,
        }));

        setUsers(prev => pageNum === 1 ? transformed : [...prev, ...transformed]);
        setHasMore(transformed.length === 10);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error("Failed to load users:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers(1);
  }, []);

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadUsers(nextPage);
    }
  };

  if (loading && users.length === 0) {
    return (
      <div className="space-y-4 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 bg-[#111111] rounded-2xl animate-pulse border border-white/5" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-[#0a0a0a]/80 border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <h1 className="text-xl font-bold text-foreground">Discover</h1>
          <span className="text-sm text-foreground-muted">
            {users.length} {users.length === 1 ? 'person' : 'people'} nearby
          </span>
        </div>
      </header>

      {/* User List */}
      <div className="max-w-6xl mx-auto p-4">
        <UserList
          initialUsers={users}
          onLoadMore={handleLoadMore}
          hasMore={hasMore}
          isLoading={loading}
        />
      </div>
    </div>
  );
}
