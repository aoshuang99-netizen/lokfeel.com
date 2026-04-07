"use client";

import Link from "next/link";
import { MessageCircle, Search } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

const mockChats = [
  {
    id: "1",
    name: "Sarah",
    age: 28,
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
    lastMessage: "That sounds amazing! I'd love to explore that coffee shop.",
    timestamp: "2m ago",
    unread: 2,
    isOnline: true,
  },
  {
    id: "2",
    name: "Michael",
    age: 31,
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop",
    lastMessage: "I had a great time chatting with you!",
    timestamp: "1h ago",
    unread: 0,
    isOnline: false,
  },
  {
    id: "3",
    name: "Emma",
    age: 29,
    image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop",
    lastMessage: "Looking forward to our call tomorrow!",
    timestamp: "3h ago",
    unread: 1,
    isOnline: true,
  },
  {
    id: "4",
    name: "James",
    age: 33,
    image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop",
    lastMessage: "The hike was incredible. Thanks for suggesting it!",
    timestamp: "1d ago",
    unread: 0,
    isOnline: false,
  },
];

export default function ChatListPage() {
  const [searchQuery, setSearchQuery] = React.useState("");
  const chats = mockChats.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (chats.length === 0) {
    return (
      <div className="space-y-6">
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

        <EmptyState
          icon="message"
          title="No conversations yet"
          description="Start a conversation with one of your matches"
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
        {chats.map((chat) => (
          <Link
            key={chat.id}
            href={`/dashboard/chat/${chat.id}`}
            className="glass-card p-4 flex items-center gap-4 hover:bg-white/10 transition-colors group"
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-full overflow-hidden">
                <img
                  src={chat.image}
                  alt={chat.name}
                  className="w-full h-full object-cover"
                />
              </div>
              {chat.isOnline && (
                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-success border-2 border-[#0d0c11] rounded-full" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className={`font-semibold truncate ${chat.unread > 0 ? "text-white" : "text-white/80"}`}>
                  {chat.name}, {chat.age}
                </h3>
                <span className="text-xs text-white/40 flex-shrink-0 ml-2">
                  {chat.timestamp}
                </span>
              </div>
              <p className={`text-sm truncate ${chat.unread > 0 ? "text-white" : "text-white/60"}`}>
                {chat.lastMessage}
              </p>
            </div>

            {/* Unread Badge */}
            {chat.unread > 0 && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                <span className="text-xs font-bold text-white">{chat.unread}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

// Need to import React for useState
import React from "react";
