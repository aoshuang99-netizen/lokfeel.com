"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  MessageCircle,
  Clock,
  ChevronRight,
  User,
  Sparkles,
  Lock,
} from "lucide-react";
import { Skeleton, EmptyState } from "@/components/ui";
import { getAvatarKind, getAvatarImgClasses, getAvatarBackground, parseEmojiAvatar } from "@/lib/avatar-utils";

interface ChatPreview {
  id: string;
  otherUser: {
    id: string;
    name: string;
    age: number;
    avatar: string | null;
  };
  lastMessage: {
    content: string;
    timestamp: string;
    isFromMe: boolean;
  } | null;
  unreadCount: number;
  vaultExpiry: string | null;
  isVaultExpired: boolean;
}

export default function MessagesPage() {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChats();
  }, []);

  const fetchChats = async () => {
    try {
      const res = await fetch("/api/chat");
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        console.error('Chats API error:', res.status, errText);
        throw new Error(`Failed to fetch: ${res.status}`);
      }
      const data = await res.json();
      console.log('[Messages] Loaded chats:', data.chats?.length || 0);
      setChats(data.chats || []);
    } catch (e) {
      console.error('Failed to load messages:', e);
      toast.error("Failed to load messages");
    } finally {
      setLoading(false);
    }
  };

  // 格式化时间
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  };

  // 计算Vault剩余时间
  const getVaultTimeRemaining = (expiry: string) => {
    const expiryDate = new Date(expiry);
    const now = new Date();
    const diff = expiryDate.getTime() - now.getTime();

    if (diff <= 0) return "Expired";

    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);

    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          <p className="text-white/50 text-sm mt-1">
            Your active conversations
          </p>
        </div>
      </div>

      {/* Vault说明卡片 */}
      <div className="glass-card p-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-white text-sm">The Vault</h4>
            <p className="text-xs text-white/60 mt-1">
              Conversations are available for 24 hours after matching. 
              Women can extend or close the Vault at any time.
            </p>
          </div>
        </div>
      </div>

      {/* 聊天列表 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : chats.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No messages yet"
          description="Start discovering and matching to begin conversations!"
          action={
            <Link href="/dashboard/discover" className="btn-primary">
              <Sparkles className="w-4 h-4 mr-2" />
              Discover People
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {chats.map((chat, index) => (
              <motion.div
                key={chat.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ delay: index * 0.05 }}
              >
                <Link href={`/dashboard/chat/${chat.id}`}>
                  <div
                    className={`glass-card p-4 hover:border-primary/30 transition-all ${
                      chat.unreadCount > 0 ? "border-primary/30 bg-primary/5" : ""
                    } ${chat.isVaultExpired ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center gap-4">
                      {/* 头像 */}
                      <div className="relative">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center overflow-hidden">
                          {(() => {
                            const kind = getAvatarKind(chat.otherUser.avatar);
                            if (kind === 'none') return <User className="w-7 h-7 text-white/30" />;
                            if (kind === 'emoji') {
                              const parsed = parseEmojiAvatar(chat.otherUser.avatar);
                              return <span className="text-2xl">{parsed?.emoji}</span>;
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
                        {/* 未读标记 */}
                        {chat.unreadCount > 0 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white">
                            {chat.unreadCount}
                          </div>
                        )}
                      </div>

                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-white truncate">
                            {chat.otherUser.name}, {chat.otherUser.age}
                          </h3>
                          {chat.isVaultExpired && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/40">
                              Vault Closed
                            </span>
                          )}
                        </div>

                        {/* 最后消息 */}
                        {chat.lastMessage ? (
                          <p className="text-sm text-white/60 truncate">
                            {chat.lastMessage.isFromMe ? "You: " : ""}
                            {chat.lastMessage.content}
                          </p>
                        ) : (
                          <p className="text-sm text-white/40 italic">
                            No messages yet. Say hello! 👋
                          </p>
                        )}

                        {/* Vault倒计时 */}
                        <div className="flex items-center gap-3 mt-1">
                          {chat.vaultExpiry && !chat.isVaultExpired && (
                            <p className="text-xs text-primary flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {getVaultTimeRemaining(chat.vaultExpiry)}
                            </p>
                          )}
                          {chat.lastMessage && (
                            <p className="text-xs text-white/40">
                              {formatTime(chat.lastMessage.timestamp)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 箭头 */}
                      <ChevronRight className="w-5 h-5 text-white/20" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
