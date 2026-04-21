"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Search, 
  MoreVertical, 
  MessageCircle, 
  User,
  Loader2,
  Phone,
  Video,
  Circle
} from "lucide-react";
import { useApiGet } from "@/hooks/use-api";

interface ChatItem {
  id: string;
  matchId: string | null;
  otherUser: {
    id: string;
    name: string;
    age: number;
    avatar: string | null;
    isOnline?: boolean;
    lastSeen?: string;
  };
  lastMessage: {
    content: string;
    timestamp: string;
    isFromMe?: boolean;
  } | null;
  unreadCount: number;
  isVault?: boolean;
}

interface ChatListData {
  chats: ChatItem[];
}

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
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const { data, isLoading, error } = useApiGet<ChatListData>("/api/chat");

  const chats = data?.chats || [];
  const filteredChats = chats.filter((chat) =>
    chat.otherUser.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get current room ID from pathname
  const currentRoomId = pathname?.split("/").pop();
  const isChatListPage = pathname === "/dashboard/chat";

  return (
    <div className="flex h-[calc(100vh-4rem)] -mx-4 -mt-6 bg-[#0d0c11]">
      {/* ═══════════════════════════════════════════════════════
          LEFT SIDEBAR - Chat List (WhatsApp Style)
          ═══════════════════════════════════════════════════════ */}
      <div className={`w-full md:w-[380px] border-r border-white/10 flex flex-col ${!isChatListPage && currentRoomId ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-[#13121a]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">Messages</h2>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full hover:bg-white/10 transition-colors">
                <MessageCircle className="w-5 h-5 text-white/60" />
              </button>
              <button className="p-2 rounded-full hover:bg-white/10 transition-colors">
                <MoreVertical className="w-5 h-5 text-white/60" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Search or start new chat"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 text-white placeholder:text-white/40 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 text-center text-white/60">
              <p>Failed to load chats</p>
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-8 h-8 text-white/30" />
              </div>
              <p className="text-white/60 text-sm">
                {searchQuery ? "No chats found" : "No conversations yet"}
              </p>
              {!searchQuery && (
                <Link
                  href="/dashboard/matches"
                  className="inline-block mt-4 text-primary text-sm hover:underline"
                >
                  Find matches →
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filteredChats.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/dashboard/chat/${chat.id}`}
                  className={`flex items-center gap-3 p-3 hover:bg-white/5 transition-colors ${
                    currentRoomId === chat.id ? "bg-white/10" : ""
                  }`}
                >
                  {/* Avatar with Online Status */}
                  <div className="relative flex-shrink-0">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-white/5 flex items-center justify-center">
                      {chat.otherUser.avatar ? (
                        <img
                          src={chat.otherUser.avatar}
                          alt={chat.otherUser.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-6 h-6 text-white/30" />
                      )}
                    </div>
                    {/* Online Status Indicator */}
                    {chat.otherUser.isOnline ? (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0d0c11]" />
                    ) : (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-gray-500 rounded-full border-2 border-[#0d0c11]" />
                    )}
                  </div>

                  {/* Chat Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className="font-semibold text-white truncate text-sm">
                        {chat.otherUser.name}
                        {chat.isVault && (
                          <span className="ml-2 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                            Vault
                          </span>
                        )}
                      </h3>
                      {chat.lastMessage && (
                        <span className={`text-xs flex-shrink-0 ml-2 ${
                          chat.unreadCount > 0 ? "text-primary" : "text-white/40"
                        }`}>
                          {formatMessageTime(chat.lastMessage.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <p className={`text-sm truncate ${
                        chat.unreadCount > 0 
                          ? "text-white font-medium" 
                          : "text-white/50"
                      }`}>
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
                          <span className="text-xs font-bold text-white px-1">
                            {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Last Seen / Online Status Text */}
                    <p className="text-xs text-white/40 mt-0.5">
                      {chat.otherUser.isOnline 
                        ? "Online" 
                        : formatLastSeen(chat.otherUser.lastSeen)
                      }
                    </p>
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
      <div className={`flex-1 flex flex-col ${isChatListPage ? 'hidden md:flex' : 'flex'}`}>
        {children}
      </div>
    </div>
  );
}
