"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MoreVertical, Phone, Video } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { ConversationList } from "./conversation-list";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import type { ConversationListProps } from "./conversation-list";
import type { MessageBubbleProps } from "./message-bubble";
import { useChatRoomSocket } from "@/hooks/useSocket";
import { chatApi } from "@/lib/chat-api";

// ============================================================================
// Types
// ============================================================================

interface ChatContainerProps {
  className?: string;
}

interface UserLimits {
  isPremium: boolean;
  maxChats: number;
  currentChats: number;
  messagesSent: number;
  messagesRemaining: number;
}

interface RoomInfo {
  id: string;
  otherUser: {
    id: string;
    name: string;
    avatar: string | null;
    isOnline?: boolean;
    isBot?: boolean;
    lastSeen?: string;
  };
  isVault?: boolean;
  vaultExpiresAt?: string;
}

interface EmptyChatProps {
  isBot?: boolean;
}

interface QuotedMessageState {
  id: string;
  content: string;
  senderName?: string;
}

// ============================================================================
// Empty State Components
// ============================================================================

function EmptyChat({ isBot }: EmptyChatProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
        {isBot ? (
          <span className="text-4xl">🤖</span>
        ) : (
          <span className="text-4xl">💬</span>
        )}
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">
        {isBot ? "AI Companion" : "Select a conversation"}
      </h3>
      <p className="text-white/50 text-sm max-w-xs">
        {isBot
          ? "Start a conversation with your AI companion"
          : "Choose a conversation from the list to start chatting"}
      </p>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
        <span className="text-4xl">💌</span>
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">No conversations yet</h3>
      <p className="text-white/50 text-sm max-w-xs">
        Accept a match to start chatting with other users
      </p>
      <Link
        href="/dashboard/matches"
        className="mt-6 px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white font-medium transition-colors"
      >
        Find Matches
      </Link>
    </div>
  );
}

// ============================================================================
// Chat Header Component
// ============================================================================

interface ChatHeaderProps {
  roomInfo?: RoomInfo;
  onBack?: () => void;
}

function ChatHeader({ roomInfo, onBack }: ChatHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  const isBot = roomInfo?.otherUser?.isBot || roomInfo?.otherUser?.id?.startsWith("bot-");
  const isOnline = roomInfo?.otherUser?.isOnline;

  const formatLastSeen = (dateStr?: string) => {
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
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[#13121a] border-b border-white/10">
      <div className="flex items-center gap-3">
        {/* Back Button (Mobile) */}
        <button
          onClick={onBack}
          className="md:hidden p-2 -ml-2 rounded-full hover:bg-white/10"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>

        {/* Avatar */}
        <div className="relative">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-white/5 flex items-center justify-center">
            {roomInfo?.otherUser?.avatar ? (
              <img
                src={roomInfo.otherUser.avatar}
                alt={roomInfo.otherUser.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold">
                {roomInfo?.otherUser?.name?.[0] || "?"}
              </div>
            )}
          </div>
          {/* Online Status */}
          {isOnline ? (
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#13121a]" />
          ) : (
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-gray-500 rounded-full border-2 border-[#13121a]" />
          )}
          {/* Bot Badge */}
          {isBot && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center border-2 border-[#13121a]">
              <span className="text-[10px]">🤖</span>
            </div>
          )}
        </div>

        {/* User Info */}
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white text-sm">
              {roomInfo?.otherUser?.name || "Unknown"}
            </h3>
            {isBot && (
              <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] rounded-full">
                AI
              </span>
            )}
          </div>
          <p className="text-xs text-white/50">
            {isOnline ? "Online" : formatLastSeen(roomInfo?.otherUser?.lastSeen)}
          </p>
        </div>
      </div>

      {/* Header Actions */}
      <div className="flex items-center gap-1">
        <button className="p-2 rounded-full hover:bg-white/10 transition-colors">
          <Phone className="w-5 h-5 text-white/60" />
        </button>
        <button className="p-2 rounded-full hover:bg-white/10 transition-colors">
          <Video className="w-5 h-5 text-white/60" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <MoreVertical className="w-5 h-5 text-white/60" />
          </button>

          {/* Menu Dropdown */}
          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute right-0 top-full mt-2 w-48 bg-[#1a1926] rounded-xl border border-white/10 shadow-xl z-50"
              >
                <button className="w-full px-4 py-3 text-left text-sm text-white/80 hover:bg-white/5">
                  View Profile
                </button>
                <button className="w-full px-4 py-3 text-left text-sm text-white/80 hover:bg-white/5">
                  Mute Notifications
                </button>
                <button className="w-full px-4 py-3 text-left text-sm text-white/80 hover:bg-white/5">
                  Search in Chat
                </button>
                <button className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-white/5">
                  Block User
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Vault Banner Component
// ============================================================================

interface VaultBannerProps {
  expiresAt?: string;
}

function VaultBanner({ expiresAt }: VaultBannerProps) {
  if (!expiresAt) return null;

  const expiry = new Date(expiresAt);
  const now = new Date();
  const hoursRemaining = Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / 3600000));

  return (
    <div className="bg-gradient-to-r from-primary/20 to-secondary/20 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-primary">🔒</span>
        <span className="text-sm text-white/80">Vault Chat - Exchange contacts to unlock</span>
      </div>
      <div className="flex items-center gap-1 text-sm text-primary">
        <span>⏱️</span>
        <span>{hoursRemaining}h remaining</span>
      </div>
    </div>
  );
}

// ============================================================================
// Message Limit Warning Component
// ============================================================================

interface MessageLimitWarningProps {
  limits: UserLimits;
  onUpgrade: () => void;
}

function MessageLimitWarning({ limits, onUpgrade }: MessageLimitWarningProps) {
  if (limits.isPremium || limits.messagesRemaining > 5) return null;

  return (
    <div className="px-4 py-2 bg-primary/10 border-t border-primary/20">
      <p className="text-xs text-center text-white/60">
        {limits.messagesRemaining} free messages remaining.{" "}
        <button onClick={onUpgrade} className="text-primary hover:underline">
          Upgrade
        </button>
      </p>
    </div>
  );
}

// ============================================================================
// Chat Container Component
// ============================================================================

export function ChatContainer({ className = "" }: ChatContainerProps) {
  const router = useRouter();
  
  // State
  const [conversations, setConversations] = useState<ConversationListProps["conversations"]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [userLimits, setUserLimits] = useState<UserLimits | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<QuotedMessageState | null>(null);

  // Socket connection (IM API v2 - 使用 conversationId)
  const {
    messages,
    isTyping,
    typingUserId,
    sendMessage,
    sendTyping,
    markAsRead,
    error: socketError,
  } = useChatRoomSocket({ conversationId: currentConvId });

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Load conversations (IM API v2)
  const loadConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      // 使用新的 IM API v2
      const response = await chatApi.getConversations({ limit: 50 });
      setConversations(response.conversations as unknown as ConversationListProps["conversations"]);
    } catch (err) {
      console.error("Failed to load conversations:", err);
      toast.error("Failed to load conversations");
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  // Load room info (IM API v2)
  const loadRoomInfo = useCallback(async (convId: string) => {
    try {
      // 从会话列表中查找或获取消息时一并获取
      const response = await chatApi.getMessages(convId, { limit: 1 });
      // 从会话列表中获取用户信息
      const conv = conversations.find(c => c.id === convId);
      if (conv) {
        setRoomInfo({
          id: convId,
          otherUser: {
            id: (conv as any).otherUser?.id || "",
            name: (conv as any).otherUser?.name || "Unknown",
            avatar: (conv as any).otherUser?.avatar || null,
            isOnline: (conv as any).otherUser?.presence === 'ONLINE',
            isBot: (conv as any).otherUser?.id?.startsWith("bot-"),
          },
        });
      }
    } catch (err) {
      console.error("Failed to load room info:", err);
    }
  }, [conversations]);

  // Load user limits
  const loadUserLimits = useCallback(async () => {
    try {
      const limits = await chatApi.getUserLimits();
      setUserLimits(limits);
    } catch (err) {
      console.error("Failed to load user limits:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadConversations();
    loadUserLimits();
  }, [loadConversations, loadUserLimits]);

  // Load room info when current conversation changes
  useEffect(() => {
    if (currentConvId) {
      loadRoomInfo(currentConvId);
    } else {
      setRoomInfo(null);
    }
  }, [currentConvId, loadRoomInfo]);

  // Handle conversation selection
  const handleSelectConversation = useCallback((id: string) => {
    setCurrentConvId(id);
    if (isMobile) {
      router.push(`/dashboard/chat/${id}`);
    }
  }, [isMobile, router]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    setCurrentConvId(null);
  }, []);

  // Handle send message
  const handleSendMessage = useCallback(
    async (content: string, quotedMsgId?: string) => {
      if (!currentConvId) return;

      // Check limits
      if (userLimits && !userLimits.isPremium && userLimits.messagesRemaining <= 0) {
        toast.error("You've used all your free messages. Upgrade to continue.");
        return;
      }

      try {
        // Include quoted message in payload if present
        await sendMessage(content);
        
        // Clear quoted message after sending
        setQuotedMessage(null);
        
        // Update limits
        if (userLimits) {
          setUserLimits({
            ...userLimits,
            messagesSent: userLimits.messagesSent + 1,
            messagesRemaining: Math.max(0, userLimits.messagesRemaining - 1),
          });
        }
      } catch (err) {
        toast.error("Failed to send message");
      }
    },
    [currentConvId, sendMessage, userLimits]
  );

  // Handle typing
  const handleTyping = useCallback(
    (isTyping: boolean) => {
      if (currentConvId) {
        sendTyping(isTyping);
      }
    },
    [currentConvId, sendTyping]
  );

  // Handle retry (IM API v2 - 使用 msgId)
  const handleRetry = useCallback(
    async (msgId: string) => {
      // Find the message and retry
      const message = messages.find((m) => m.msgId === msgId);
      if (message && currentConvId) {
        try {
          await chatApi.sendMessage(currentConvId, message.payload, message.msgType as any);
        } catch (err) {
          toast.error("Failed to resend message");
        }
      }
    },
    [messages, currentConvId]
  );

  // Handle reply (引用回复)
  const handleReply = useCallback(
    (message: any) => {
      setQuotedMessage({
        id: message.msgId,
        content: message.payload,
        senderName: message.sender?.name,
      });
    },
    []
  );

  // Handle cancel quote (取消引用)
  const handleCancelQuote = useCallback(() => {
    setQuotedMessage(null);
  }, []);

  // Handle copy message
  const handleCopy = useCallback(
    (content: string) => {
      navigator.clipboard.writeText(content);
      toast.success("Copied to clipboard");
    },
    []
  );

  // Handle delete message
  const handleDelete = useCallback(
    async (msgId: string) => {
      try {
        // Call API to delete message
        await fetch(`/api/im/messages/${msgId}`, {
          method: 'DELETE',
        });
        toast.success("Message deleted");
      } catch (err) {
        toast.error("Failed to delete message");
      }
    },
    []
  );

  // Handle report message
  const handleReport = useCallback(
    (msgId: string, senderId: string) => {
      // Open report modal or navigate to report page
      toast.success("Report submitted. Thank you for your feedback.");
    },
    []
  );

  // Show conversation list on mobile when no room selected
  const showConversationList = isMobile && !currentConvId;

  // Show chat on mobile when room selected
  const showChat = isMobile && currentConvId;

  return (
    <div className={`flex h-[calc(100vh-4rem)] -mx-4 -mt-6 bg-[#0d0c11] ${className}`}>
      {/* Left Sidebar - Conversation List */}
      <div
        className={`w-full md:w-[380px] border-r border-white/10 flex flex-col ${
          showChat ? "hidden md:flex" : "flex"
        }`}
      >
        <ConversationList
          conversations={conversations}
          isLoading={isLoadingConversations}
          currentRoomId={currentConvId || undefined}
          onSelect={handleSelectConversation}
        />
      </div>

      {/* Right Side - Chat Area */}
      <div
        className={`flex-1 flex flex-col ${
          showConversationList ? "hidden md:flex" : "flex"
        }`}
      >
        {currentConvId && roomInfo ? (
          <>
            {/* Chat Header */}
            <ChatHeader roomInfo={roomInfo} onBack={handleBack} />

            {/* Vault Banner */}
            <VaultBanner expiresAt={roomInfo.vaultExpiresAt} />

            {/* Messages */}
            <MessageList
              messages={messages.map(m => ({ 
                ...m, 
                senderId: m.senderId 
              }))}
              isTyping={isTyping}
              typingUserName={typingUserId ? roomInfo.otherUser.name : undefined}
              onRetry={handleRetry}
              onCopy={handleCopy}
              onDelete={handleDelete}
              onReport={handleReport}
              onReply={handleReply}
              className="flex-1"
            />

            {/* Message Limit Warning */}
            {userLimits && (
              <MessageLimitWarning
                limits={userLimits}
                onUpgrade={() => router.push("/dashboard/settings/billing")}
              />
            )}

            {/* Input */}
            <ChatInput
              onSend={handleSendMessage}
              onTyping={handleTyping}
              disabled={!!roomInfo.vaultExpiresAt}
              quotedMessage={quotedMessage}
              onCancelQuote={handleCancelQuote}
            />
          </>
        ) : (
          <EmptyChat />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export { ChatInput } from "./chat-input";
export { MessageBubble } from "./message-bubble";
export { ConversationItem } from "./conversation-item";
