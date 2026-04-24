"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, X, MessageCircle, Filter, User, Loader2 } from "lucide-react";
import { useApiGet } from "@/hooks/use-api";
import { useApiPost } from "@/hooks/use-api";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground } from "@/lib/avatar-utils";

type TabType = "new" | "accepted" | "passed" | "expired";

interface MatchData {
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
    otherReaction: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>;
  pagination: { total: number };
}

const STATUS_MAP: Record<string, TabType> = {
  PENDING: "new",
  ACCEPTED: "accepted",
  REJECTED: "passed",
  EXPIRED: "expired",
};

export default function MatchesPage() {
  const [activeTab, setActiveTab] = useState<TabType>("new");
  const { data, isLoading, error, refetch } = useApiGet<MatchData>("/api/matches?limit=50");
  const { post, isLoading: isReacting } = useApiPost();

  const matches = data?.matches || [];

  const filteredMatches = matches.filter((m) => {
    if (activeTab === "new") return m.status === "PENDING" && m.myReaction === null;
    if (activeTab === "accepted") return m.status === "ACCEPTED";
    if (activeTab === "passed") return m.myReaction === "PASS" || m.status === "REJECTED";
    if (activeTab === "expired") return m.status === "EXPIRED";
    return true;
  });

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: "new", label: "New", count: matches.filter((m) => m.status === "PENDING" && m.myReaction === null).length },
    { id: "accepted", label: "Accepted", count: matches.filter((m) => m.status === "ACCEPTED").length },
    { id: "passed", label: "Passed", count: matches.filter((m) => m.myReaction === "PASS" || m.status === "REJECTED").length },
    { id: "expired", label: "Expired", count: matches.filter((m) => m.status === "EXPIRED").length },
  ];

  const handleReact = async (matchId: string, reaction: string) => {
    const result = await post(`/api/matches/${matchId}`, { reaction });
    if (result) {
      refetch();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-foreground-muted">Loading matches...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Your Matches</h1>
          <p className="text-foreground-muted">Discover curated connections based on your blueprint</p>
        </div>
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-background-tertiary flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-foreground-subtle" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Service Unavailable</h3>
          <p className="text-foreground-muted">{error}</p>
          <p className="text-foreground-subtle text-sm mt-2">Complete database setup to see matches here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Your Matches</h1>
          <p className="text-foreground-muted">Discover curated connections based on your blueprint</p>
        </div>
        <button className="btn-secondary flex items-center gap-2">
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-foreground border border-primary/30"
                : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeTab === tab.id ? "bg-primary text-foreground" : "bg-background-tertiary"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Match Grid */}
      {filteredMatches.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMatches.map((match) => (
            <div key={match.id} className="glass-card overflow-hidden group">
              <Link href={`/dashboard/matches/${match.id}`}>
                <div className="relative h-56">
                  {(() => {
                    const kind = getAvatarKind(match.otherUser.avatar);
                    if (kind === 'none') {
                      return (
                        <div className="w-full h-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                          <User className="w-16 h-16 text-foreground-faint" />
                        </div>
                      );
                    }
                    return (
                      <img
                        src={match.otherUser.avatar!}
                        alt={match.otherUser.name}
                        className={getAvatarImgClasses(kind)}
                        style={kind === 'svg' ? { background: getAvatarBackground(kind, match.otherUser.avatar) } : undefined}
                      />
                    );
                  })()}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground">{match.otherUser.name}, {match.otherUser.age}</h3>
                      <span className={`match-score ${match.matchScore >= 90 ? "match-score-high" : match.matchScore >= 80 ? "match-score-medium" : "match-score-low"}`}>
                        {Math.round(match.matchScore)}%
                      </span>
                    </div>
                  </div>
                </div>
              </Link>

              <div className="p-4">
                <p className="text-sm text-foreground-muted mb-4 line-clamp-2">{match.matchReason}</p>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                        style={{ width: `${match.matchScore}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-foreground-subtle">Compatibility Score</p>
                </div>

                <div className="flex gap-2">
                  {activeTab === "new" && (
                    <>
                      <button
                        onClick={() => handleReact(match.id, "INTERESTED")}
                        disabled={isReacting}
                        className="btn-primary flex-1 text-sm py-2"
                      >
                        Interested
                      </button>
                      <button
                        onClick={() => handleReact(match.id, "PASS")}
                        disabled={isReacting}
                        className="btn-secondary p-2"
                        title="Pass"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  {activeTab === "accepted" && (
                    <Link
                      href={`/dashboard/chat/${match.id}`}
                      className="btn-primary flex-1 text-sm py-2 flex items-center justify-center gap-2"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Message
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-background-tertiary flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-foreground-subtle" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No matches in this category</h3>
          <p className="text-foreground-muted">
            {activeTab === "new" && "Check back soon for new matches!"}
            {activeTab === "accepted" && "Accept some matches to see them here"}
            {activeTab === "passed" && "Passed matches won't show up here"}
            {activeTab === "expired" && "No expired matches"}
          </p>
        </div>
      )}
    </div>
  );
}
