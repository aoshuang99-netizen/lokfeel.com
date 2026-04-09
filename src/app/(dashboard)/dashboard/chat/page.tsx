"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, Search, User, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { useApiGet } from "@/hooks/use-api";

interface ChatData {
  chats: Array<{
    id: string;
    matchId: string | null;
    otherUser: {
      id: string;
      name: string;
      age: number;
      avatar: string | null;
    };
    lastMessage: {
      content: string;
      timestamp: string;
    } | null;
    unreadCount: number;
  }>;
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function ChatListPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data, isLoading, error } = useApiGet<ChatData>("/api/chat");

  const chats = data?.chats || [];
  const filteredChats = chats.filter((chat) =>
    chat.otherUser.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-white/60">Loading conversations...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          <p className="text-white/60">Connect with your matches</p>
        </div>
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <MessageCircle className="w-8 h-8 text-white/30" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Service Unavailable</h3>
          <p className="text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  if (filteredChats.length === 0 && !searchQuery) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          <p className="text-white/60">Connect with your matches</p>
        </div>
        <EmptyState
          icon="message"
          title="No conversations yet"
          description="Accept a match to start a conversation"
          action={{
            label: "Find Matches",
            onClick: () => (window.location.href = "/dashboard/matches"),
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Messages</h1>
        <p className="text-white/60">Connect with your matches</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-feeld pl-12"
        />
      </div>

      {/* Chat List */}
      <div className="space-y-2">
        {filteredChats.map((chat) => (
          <Link
            key={chat.id}
            href={`/dashboard/chat/${chat.id}`}
            className="glass-card p-4 flex items-center gap-4 hover:bg-white/10 transition-colors group"
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-full overflow-hidden bg-white/5 flex items-center justify-center">
                {chat.otherUser.avatar ? (
                  <img
                    src={chat.otherUser.avatar}
                    alt={chat.otherUser.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-7 h-7 text-white/30" />
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className={`font-semibold truncate ${chat.unreadCount > 0 ? "text-white" : "text-white/80"}`}>
                  {chat.otherUser.name}, {chat.otherUser.age}
                </h3>
                {chat.lastMessage && (
                  <span className="text-xs text-white/40 flex-shrink-0 ml-2">
                    {formatTimestamp(chat.lastMessage.timestamp)}
                  </span>
                )}
              </div>
              <p className={`text-sm truncate ${chat.unreadCount > 0 ? "text-white" : "text-white/60"}`}>
                {chat.lastMessage ? chat.lastMessage.content : "Start the conversation!"}
              </p>
            </div>

            {/* Unread Badge */}
            {chat.unreadCount > 0 && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                <span className="text-xs font-bold text-white">{chat.unreadCount}</span>
              </div>
            )}
          </Link>
        ))}

        {searchQuery && filteredChats.length === 0 && (
          <div className="text-center py-8 text-white/40">
            No conversations match &quot;{searchQuery}&quot;
          </div>
        )}
      </div>
    </div>
  );
}
