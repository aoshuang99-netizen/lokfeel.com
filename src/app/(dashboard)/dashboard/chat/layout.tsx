"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  MoreVertical,
  MessageCircle,
  User,
  Loader2,
  Circle,
  Flame,
  Lock,
  Filter,
  Clock,
  Inbox,
  Heart,
  Eye,
} from "lucide-react";
import { useApiGet } from "@/hooks/use-api";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar } from "@/lib/avatar-utils";

// ══════════════════════════════════════
// DESIGN TOKENS
// ══════════════════════════════════════
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// ══════════════════════════════════════
// TAB TYPES
// ══════════════════════════════════════

type ChatTab = "all" | "matches" | "vault" | "unread";

interface ChatItem {
  id: string;
  matchId: string | null;
  matchScore?: number;
  otherUser: {
    id: string;
    name: string;
    age: number;
    avatar: string | null;
    isOnline?: boolean;
    lastSeen?: string;
    isBot?: boolean;
  };
  lastMessage: {
    content: string;
    timestamp: string;
    isFromMe?: boolean;
  } | null;
  unreadCount: number;
  isVault?: boolean;
  vaultExpiresAt?: string;
}

interface ChatListData {
  chats: ChatItem[];
}

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════

function formatLastSeen(dateStr?: string): string {
  if (!dateStr) return "Offline";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getMatchScoreColor(score: number): string {
  if (score >= 90) return "text-amber-400 bg-amber-500/15";
  if (score >= 80) return "text-orange-400 bg-orange-500/15";
  if (score >= 70) return "text-primary bg-primary/15";
  return "text-foreground-muted bg-background-tertiary";
}

function getMatchScoreBadge(score: number): string {
  if (score >= 90) return "from-amber-400 to-amber-600";
  if (score >= 80) return "from-orange-400 to-pink-500";
  return "from-amber-400 to-amber-700";
}

function formatVaultTime(expiresAt?: string): string {
  if (!expiresAt) return "";
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffMs = expires.getTime() - now.getTime();
  if (diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

// ══════════════════════════════════════
// TAB CONFIG
// ══════════════════════════════════════

const TABS: { id: ChatTab; label: string; icon: any }[] = [
  { id: "all", label: "All", icon: Inbox },
  { id: "matches", label: "Matches", icon: Heart },
  { id: "vault", label: "Vault", icon: Lock },
  { id: "unread", label: "Unread", icon: Eye },
];

// ══════════════════════════════════════
// MAIN LAYOUT
// ══════════════════════════════════════

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("all");
  const { data, isLoading, error } = useApiGet<ChatListData>("/api/chat");

  const chats = data?.chats || [];

  // Filter chats by tab
  const filteredChats = useMemo(() => {
    let result = chats;

    // Apply tab filter
    switch (activeTab) {
      case "matches":
        result = result.filter((c) => c.matchId);
        break;
      case "vault":
        result = result.filter((c) => c.isVault);
        break;
      case "unread":
        result = result.filter((c) => c.unreadCount > 0);
        break;
    }

    // Apply search filter
    if (searchQuery.trim()) {
      result = result.filter((c) =>
        c.otherUser.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return result;
  }, [chats, activeTab, searchQuery]);

  // Tab counts
  const tabCounts = useMemo(
    () => ({
      all: chats.length,
      matches: chats.filter((c) => c.matchId).length,
      vault: chats.filter((c) => c.isVault).length,
      unread: chats.filter((c) => c.unreadCount > 0).length,
    }),
    [chats]
  );

  const currentRoomId = pathname?.split("/").pop();
  const isChatListPage = pathname === "/dashboard/chat";

  return (
    <div className="flex h-[calc(100vh-4rem)] -mx-4 -mt-6 bg-background">
      {/* ═══════════════════════════════════════════════════════
          LEFT SIDEBAR - Chat List (WhatsApp Style + Tabs)
          ═══════════════════════════════════════════════════════ */}
      <div
        className={`w-full md:w-[380px] border-r border-card-border flex flex-col ${
          !isChatListPage && currentRoomId ? "hidden md:flex" : "flex"
        }`}
      >
        {/* ── Header ── */}
        <div className="p-4 border-b border-card-border bg-background-secondary">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-foreground">Messages</h2>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full hover:bg-background-tertiary transition-colors">
                <Filter className="w-5 h-5 text-foreground-muted" />
              </button>
              <button className="p-2 rounded-full hover:bg-background-tertiary transition-colors">
                <MoreVertical className="w-5 h-5 text-foreground-muted" />
              </button>
            </div>
          </div>

          {/* ── Search ── */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search or start new chat"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-background-tertiary text-foreground placeholder:text-foreground-subtle rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            />
          </div>

          {/* ── Tab Filters ── */}
          <div className="flex gap-1 mt-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const count = tabCounts[tab.id];

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-primary/20 text-primary"
                      : "text-foreground-muted hover:text-foreground-muted hover:bg-background-tertiary"
                  }`}
                  style={{ transitionTimingFunction: EASING }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {count > 0 && (
                    <span
                      className={`min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
                        isActive
                          ? "bg-primary text-foreground"
                          : "bg-background-tertiary text-foreground-muted"
                      }`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Chat List ── */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 text-center text-foreground-muted">
              <p>Failed to load chats</p>
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-background-tertiary flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-8 h-8 text-foreground-subtle" />
              </div>
              <p className="text-foreground-muted text-sm mb-1">
                {searchQuery
                  ? "No chats found"
                  : activeTab === "vault"
                  ? "No Vault chats"
                  : activeTab === "unread"
                  ? "No unread messages"
                  : "No conversations yet"}
              </p>
              <p className="text-foreground-subtle text-xs">
                {activeTab === "all" && !searchQuery && "Match with people to start chatting"}
              </p>
              {activeTab === "all" && !searchQuery && (
                <Link
                  href="/dashboard/discover"
                  className="inline-block mt-4 text-primary text-sm hover:underline"
                >
                  Discover people →
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filteredChats.map((chat) => (
                <Link
                    href={`/dashboard/chat/${chat.id}`}
                    className={`flex items-center gap-3 p-3 hover:bg-background-tertiary transition-colors ${
                      currentRoomId === chat.id ? "bg-background-tertiary" : ""
                    }`}
                  >
                    {/* Avatar with Online Status */}
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-background-tertiary flex items-center justify-center">
                        {(() => {
                          const kind = getAvatarKind(chat.otherUser.avatar);
                          if (kind === 'none') return <User className="w-6 h-6 text-foreground-subtle" />;
                          if (kind === 'emoji') {
                            const parsed = parseEmojiAvatar(chat.otherUser.avatar);
                            return <span className="text-xl">{parsed?.emoji}</span>;
                          }
                          return (
                            <img
                              src={chat.otherUser.avatar!}
                              alt={chat.otherUser.name}
                              className={getAvatarImgClasses(kind)}
                              style={kind === 'svg' ? { background: getAvatarBackground(kind, chat.otherUser.avatar) } : undefined}
                            />
                          );
                        })()}
                      </div>
                      {/* Online Status */}
                      {chat.otherUser.isOnline ? (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
                      ) : (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-foreground-muted/40 rounded-full border-2 border-background" />
                      )}
                    </div>

                    {/* Chat Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="font-semibold text-foreground truncate text-sm">
                            {chat.otherUser.name}
                          </h3>
                          {/* Vault Badge */}
                          {chat.isVault && (
                            <span className="flex-shrink-0 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              Vault
                            </span>
                          )}

                        </div>
                        {chat.lastMessage && (
                          <span
                            className={`text-xs flex-shrink-0 ml-2 ${
                              chat.unreadCount > 0 ? "text-primary" : "text-foreground-subtle"
                            }`}
                          >
                            {formatMessageTime(chat.lastMessage.timestamp)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <p
                          className={`text-sm truncate ${
                            chat.unreadCount > 0
                              ? "text-foreground font-medium"
                              : "text-foreground-muted"
                          }`}
                        >
                          {chat.lastMessage ? (
                            <>
                              {chat.lastMessage.isFromMe && "You: "}
                              {chat.lastMessage.content}
                            </>
                          ) : (
                            <span className="italic">Start chatting...</span>
                          )}
                        </p>
                        {chat.unreadCount > 0 && (
                          <div className="flex-shrink-0 ml-2 min-w-[20px] h-5 rounded-full bg-primary flex items-center justify-center">
                            <span className="text-xs font-bold text-foreground px-1">
                              {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Match Score + Online Status / Vault Timer */}
                      <div className="flex items-center gap-2 mt-0.5">
                        {/* Match Score */}
                        {chat.matchScore !== undefined && chat.matchScore > 0 && (
                          <span
                            className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${getMatchScoreColor(chat.matchScore)}`}
                          >
                            <Flame className="w-2.5 h-2.5" />
                            {Math.round(chat.matchScore)}%
                          </span>
                        )}

                        {/* Online Status Text */}
                        <p className="text-[10px] text-foreground-subtle">
                          {chat.otherUser.isOnline
                            ? "Online"
                            : formatLastSeen(chat.otherUser.lastSeen)}
                        </p>

                        {/* Vault Timer */}
                        {chat.isVault && chat.vaultExpiresAt && (
                          <span className="flex items-center gap-0.5 text-[10px] text-amber-400 ml-auto">
                            <Clock className="w-2.5 h-2.5" />
                            {formatVaultTime(chat.vaultExpiresAt)}
                          </span>
                        )}
                      </div>
                    </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          RIGHT SIDE - Chat Content
          ═══════════════════════════════════════════════════════ */}
      <div
        className={`flex-1 flex flex-col ${
          isChatListPage ? "hidden md:flex" : "flex"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
