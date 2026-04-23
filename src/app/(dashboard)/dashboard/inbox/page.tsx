"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, X, Mail, Gift, Clock, Filter, Check, Loader2, Sparkles, Shield } from "lucide-react";
import { useApiGet, useApiPost } from "@/hooks/use-api";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar } from "@/lib/avatar-utils";

type FilterType = "all" | "unread" | "verified" | "withGift" | "expiring";
type SortType = "smart" | "score" | "recent" | "expiring";

interface InboxItem {
  id: string;
  otherUser: {
    id: string;
    name: string;
    age: number;
    avatar: string | null;
    city: string;
    isVerified: boolean;
    occupation?: string;
  };
  matchScore: number;
  pitchMessage?: string;
  pitchTone?: string;
  giftAmount?: number;
  isUnread: boolean;
  inboxPriority: number;
  createdAt: string;
  expiresAt: string;
  aiAssisted?: boolean; // Add missing property
}

interface ApiInboxResponse {
  matches: Array<{
    id: string;
    matchScore: number;
    matchReason: string;
    pitchMessage?: string;
    pitchTone?: string;
    aiAssisted?: boolean;
    giftAmount?: number;
    isUnread: boolean;
    inboxPriority: number;
    createdAt: string;
    expiresAt: string;
    sender: {
      id: string;
      name: string;
      age?: number;
      avatar: string | null;
      city?: string;
      occupation?: string;
      company?: string;
      isVerified: boolean;
      verificationBadge?: string;
    };
  }>;
  stats: {
    total: number;
    pending: number;
    accepted: number;
    unread: number;
  };
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// 适配器：将API响应转换为前端期望的格式
interface InboxData {
  items: InboxItem[];
  pagination: { total: number; unread: number };
}

function getMatchScoreColor(score: number): string {
  // 90%+ gold, 80-89% purple, <80% gray
  if (score >= 90) return "bg-gradient-to-r from-amber-400 to-yellow-300 text-black";
  if (score >= 80) return "bg-gradient-to-r from-orange-500 to-pink-500 text-white";
  return "bg-white/10 text-white/60";
}

function formatTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getTimeColor(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  const hours = diff / 3600000;
  if (hours < 2) return "text-red-400";
  if (hours < 6) return "text-yellow-400";
  return "text-white/40";
}

export default function InboxPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("smart");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  // GET /api/matches/inbox?filter=unread|verified|withGift|expiring&sort=smart|score|recent|expiring
  const { data: apiData, isLoading, error, refetch } = useApiGet<ApiInboxResponse>(`/api/matches/inbox?filter=${filter}&sort=${sort}`);
  
  // POST /api/matches/inbox for batch actions
  const { post, isLoading: isActionLoading } = useApiPost();

  // 转换API数据为前端格式
  const items = apiData?.matches?.map(match => ({
    id: match.id,
    otherUser: {
      id: match.sender.id,
      name: match.sender.name,
      age: match.sender.age || 0,
      avatar: match.sender.avatar,
      city: match.sender.city || '',
      isVerified: match.sender.isVerified,
      occupation: match.sender.occupation,
    },
    matchScore: match.matchScore,
    pitchMessage: match.pitchMessage,
    pitchTone: match.pitchTone,
    giftAmount: match.giftAmount,
    isUnread: match.isUnread,
    inboxPriority: match.inboxPriority,
    createdAt: match.createdAt,
    expiresAt: match.expiresAt,
    aiAssisted: match.aiAssisted,
  })) || [];

  const totalUnread = apiData?.stats?.unread || 0;

  const filters: { id: FilterType; label: string; icon: React.ReactNode }[] = [
    { id: "all", label: "All", icon: <Mail className="w-4 h-4" /> },
    { id: "unread", label: "Unread", icon: <Mail className="w-4 h-4" /> },
    { id: "verified", label: "Verified", icon: <Shield className="w-4 h-4" /> },
    { id: "withGift", label: "With Gift", icon: <Gift className="w-4 h-4" /> },
    { id: "expiring", label: "Expiring", icon: <Clock className="w-4 h-4" /> },
  ];

  const sortOptions: { id: SortType; label: string }[] = [
    { id: "smart", label: "Smart Sort" },
    { id: "score", label: "Highest Match" },
    { id: "recent", label: "Most Recent" },
    { id: "expiring", label: "Expiring Soon" },
  ];

  const handleSelect = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(i => i.id)));
    }
  };

  const handleBatchAction = async (action: "accept" | "pass" | "markRead") => {
    if (selectedItems.size === 0) return;
    const result = await post("/api/matches/inbox", {
      action,
      matchIds: Array.from(selectedItems),
    });
    if (result) {
      setSelectedItems(new Set());
      refetch();
    }
  };

  const handleSingleAction = async (matchId: string, action: "accept" | "pass") => {
    const result = await post(`/api/matches/${matchId}`, { reaction: action === "accept" ? "INTERESTED" : "PASS" });
    if (result) refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-white/60">Loading your inbox...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Your Inbox</h1>
          <p className="text-white/60">Requests from people interested in you</p>
        </div>
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-white/30" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Service Unavailable</h3>
          <p className="text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Your Inbox</h1>
          <p className="text-white/60">Requests from people interested in you</p>
        </div>
        {totalUnread > 0 && (
          <span className="px-3 py-1 rounded-full bg-primary/20 text-primary text-sm font-medium">
            {totalUnread} new
          </span>
        )}
      </div>

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 overflow-x-auto pb-2 flex-1">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === f.id
                  ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {f.icon}
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortType)}
          className="input-feeld py-2 text-sm"
        >
          {sortOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Batch Actions */}
      {selectedItems.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20">
          <span className="text-sm text-white/80">{selectedItems.size} selected</span>
          <div className="flex-1" />
          <button
            onClick={() => handleBatchAction("accept")}
            disabled={isActionLoading}
            className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1"
          >
            <Heart className="w-4 h-4" /> Accept All
          </button>
          <button
            onClick={() => handleBatchAction("pass")}
            disabled={isActionLoading}
            className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
          >
            <X className="w-4 h-4" /> Pass All
          </button>
          <button
            onClick={() => handleBatchAction("markRead")}
            disabled={isActionLoading}
            className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
          >
            <Check className="w-4 h-4" /> Mark Read
          </button>
        </div>
      )}

      {/* Inbox Grid */}
      {items.length > 0 ? (
        <div className="space-y-4">
          {/* Select All */}
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedItems.size === items.length && items.length > 0}
              onChange={handleSelectAll}
              className="rounded border-white/20 bg-white/5"
            />
            Select All
          </label>

          {items.map((item) => (
            <div
              key={item.id}
              className={`glass-card overflow-hidden transition-all ${
                item.isUnread ? "border-primary/30" : ""
              }`}
            >
              <div className="p-4 flex gap-4">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selectedItems.has(item.id)}
                  onChange={() => handleSelect(item.id)}
                  className="mt-1 rounded border-white/20 bg-white/5"
                />

                {/* Avatar */}
                <Link href={`/dashboard/matches/${item.id}`} className="flex-shrink-0">
                  <div className="relative w-16 h-16 rounded-full overflow-hidden bg-white/5">
                    {(() => {
                      const kind = getAvatarKind(item.otherUser.avatar);
                      if (kind === 'none') {
                        return (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-2xl text-white/30">{item.otherUser.name[0]}</span>
                          </div>
                        );
                      }
                      if (kind === 'emoji') {
                        const parsed = parseEmojiAvatar(item.otherUser.avatar);
                        return <span className="text-3xl">{parsed?.emoji}</span>;
                      }
                      return (
                        <img
                          src={item.otherUser.avatar!}
                          alt={item.otherUser.name}
                          className={getAvatarImgClasses(kind)}
                          style={kind === 'svg' ? { background: getAvatarBackground(kind, item.otherUser.avatar) } : undefined}
                        />
                      );
                    })()}
                    {item.otherUser.isVerified && (
                      <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                        <Shield className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                </Link>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white">
                          {item.otherUser.name}, {item.otherUser.age}
                        </h3>
                        {item.isUnread && (
                          <span className="w-2 h-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="text-sm text-white/60">
                        {item.otherUser.city}
                        {item.otherUser.occupation && ` • ${item.otherUser.occupation}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-lg text-xs font-bold ${getMatchScoreColor(item.matchScore)}`}>
                        {Math.round(item.matchScore)}%
                      </span>
                      {item.giftAmount && item.giftAmount > 0 && (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/20 text-amber-400 text-xs">
                          <Gift className="w-3 h-3" /> +{item.giftAmount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pitch Message */}
                  {item.pitchMessage && (
                    <div className="mt-3 p-3 rounded-lg bg-white/5">
                      <p className="text-sm text-white/80 line-clamp-2">"{item.pitchMessage}"</p>
                      {item.aiAssisted && (
                        <span className="flex items-center gap-1 mt-1 text-xs text-white/40">
                          <Sparkles className="w-3 h-3" /> AI-assisted
                        </span>
                      )}
                    </div>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-4 mt-3 text-xs text-white/40">
                    <span className={getTimeColor(item.expiresAt)}>
                      <Clock className="w-3 h-3 inline mr-1" />
                      Expires in {formatTimeRemaining(item.expiresAt)}
                    </span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleSingleAction(item.id, "accept")}
                    disabled={isActionLoading}
                    className="btn-primary p-2"
                    title="Accept"
                  >
                    <Heart className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleSingleAction(item.id, "pass")}
                    disabled={isActionLoading}
                    className="btn-secondary p-2"
                    title="Pass"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-white/30" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No requests yet</h3>
          <p className="text-white/60">
            When someone is interested in you, they&apos;ll appear here
          </p>
        </div>
      )}
    </div>
  );
}
