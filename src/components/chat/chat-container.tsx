"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MoreVertical, Phone, Video, Sparkles, MessageCircle, Shield, X, Ban } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { ConversationList } from "./conversation-list";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { ReportModal } from "./report-modal";
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
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
        className="relative mb-8"
      >
        {/* Ambient glow behind icon */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 blur-2xl scale-150" />
        <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 border border-card-border flex items-center justify-center backdrop-blur-sm">
          {isBot ? (
            <Sparkles className="w-10 h-10 text-primary/80" />
          ) : (
            <MessageCircle className="w-10 h-10 text-foreground-subtle" />
          )}
        </div>
      </motion.div>
      <motion.h3 
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="text-lg font-semibold text-foreground mb-2"
      >
        {isBot ? "Say hello" : "Your messages"}
      </motion.h3>
      <motion.p 
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className="text-foreground-subtle text-sm max-w-[260px] leading-relaxed"
      >
        {isBot
          ? "Start a conversation — they're ready to chat"
          : "Pick a conversation from the sidebar, or match with someone new"}
      </motion.p>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
        className="relative mb-8"
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/15 to-secondary/15 blur-2xl scale-150" />
        <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 border border-card-border/[0.06] flex items-center justify-center backdrop-blur-sm">
          <MessageCircle className="w-10 h-10 text-foreground-faint" />
        </div>
      </motion.div>
      <motion.h3
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="text-lg font-semibold text-foreground mb-2"
      >
        No conversations yet
      </motion.h3>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className="text-foreground-subtle text-sm max-w-[260px] leading-relaxed mb-6"
      >
        Accept a match to start chatting with someone
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.4 }}
      >
        <Link
          href="/dashboard/matches"
          className="px-5 py-2.5 rounded-xl bg-gradient-to-br from-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-400 text-foreground text-sm font-medium transition-all duration-200 shadow-lg shadow-amber-600/20"
        >
          Find Matches
        </Link>
      </motion.div>
    </div>
  );
}

// ============================================================================
// Chat Header Component
// ============================================================================

interface ChatHeaderProps {
  roomInfo?: RoomInfo;
  onBack?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
}

function ChatHeader({ roomInfo, onBack, onReport, onBlock }: ChatHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  const isBot = roomInfo?.otherUser?.isBot || false;
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
    <div className="flex items-center justify-between px-4 py-3 bg-background-secondary/90 backdrop-blur-lg border-b border-card-border/[0.06]">
      <div className="flex items-center gap-3">
        {/* Back Button (Mobile) */}
        <button
          onClick={onBack}
          className="md:hidden p-2 -ml-2 rounded-full hover:bg-background-tertiary transition-colors duration-200"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-foreground-muted" />
        </button>

        {/* Avatar */}
        <div className="relative">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-background-tertiary flex items-center justify-center ring-1 ring-white/10">
            {roomInfo?.otherUser?.avatar ? (
              roomInfo.otherUser.avatar.startsWith("emoji:") ? (
                <div className={`w-full h-full flex items-center justify-center ${
                  isBot 
                    ? 'bg-gradient-to-br from-amber-500/80 to-rose-500/80'
                    : 'bg-gradient-to-br from-primary to-secondary'
                }`}>
                  <span
                    className="select-none leading-none"
                    style={{
                      fontSize: 'clamp(1rem, 200%, 2rem)',
                      lineHeight: '1',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                    }}
                  >
                    {roomInfo.otherUser.avatar.split(":")[1]}
                  </span>
                </div>
              ) : (
                <img
                  src={roomInfo.otherUser.avatar}
                  alt={roomInfo.otherUser.name}
                  className="w-full h-full object-cover"
                />
              )
            ) : (
              <div className={`w-full h-full flex items-center justify-center text-foreground font-bold text-sm ${
                isBot 
                  ? 'bg-gradient-to-br from-amber-500/80 to-rose-500/80' 
                  : 'bg-gradient-to-br from-primary to-secondary'
              }`}>
                {roomInfo?.otherUser?.name?.[0] || "?"}
              </div>
            )}
          </div>
          {/* Online Status */}
          {isOnline ? (
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full ring-2 ring-background-secondary" />
          ) : !isBot ? (
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-background-tertiary rounded-full ring-2 ring-background-secondary" />
          ) : null}
          {/* Bot Badge - removed, no AI indicator */}
        </div>

        {/* User Info */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground text-sm truncate">
              {roomInfo?.otherUser?.name || "Unknown"}
            </h3>

          </div>
          <p className="text-xs text-foreground-subtle flex items-center gap-1.5">
            {isOnline ? (
              <>
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <span>Online</span>
              </>
            ) : isBot ? (
              <>
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <span>Online</span>
              </>
            ) : (
              formatLastSeen(roomInfo?.otherUser?.lastSeen)
            )}
          </p>
        </div>
      </div>

      {/* Header Actions */}
      <div className="flex items-center gap-0.5">
        <button className="p-2 rounded-full hover:bg-background-tertiary transition-colors duration-200" aria-label="Voice call">
          <Phone className="w-[18px] h-[18px] text-foreground-subtle" />
        </button>
        <button className="p-2 rounded-full hover:bg-background-tertiary transition-colors duration-200" aria-label="Video call">
          <Video className="w-[18px] h-[18px] text-foreground-subtle" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-full hover:bg-background-tertiary transition-colors duration-200"
            aria-label="More options"
          >
            <MoreVertical className="w-[18px] h-[18px] text-foreground-subtle" />
          </button>

          {/* Menu Dropdown */}
          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15, ease: [0.25, 1, 0.5, 1] }}
                className="absolute right-0 top-full mt-1 w-52 bg-background-secondary rounded-xl border border-card-border/[0.08] shadow-2xl z-50 overflow-hidden"
              >
                <button className="w-full px-4 py-3 text-left text-sm text-foreground-muted hover:bg-background-tertiary hover:text-foreground/90 transition-colors flex items-center gap-3">
                  View Profile
                </button>
                <button className="w-full px-4 py-3 text-left text-sm text-foreground-muted hover:bg-background-tertiary hover:text-foreground/90 transition-colors flex items-center gap-3">
                  Mute Notifications
                </button>
                <button className="w-full px-4 py-3 text-left text-sm text-foreground-muted hover:bg-background-tertiary hover:text-foreground/90 transition-colors flex items-center gap-3">
                  Search in Chat
                </button>
                <div className="h-px bg-background-tertiary" />
                <button
                  onClick={() => { setShowMenu(false); onReport?.(); }}
                  className="w-full px-4 py-3 text-left text-sm text-foreground-muted hover:bg-background-tertiary hover:text-foreground/90 transition-colors flex items-center gap-3"
                >
                  <Shield className="w-4 h-4" />
                  Report User
                </button>
                <div className="h-px bg-background-tertiary" />
                <button
                  onClick={() => { setShowMenu(false); onBlock?.(); }}
                  className="w-full px-4 py-3 text-left text-sm text-red-400/80 hover:bg-red-500/[0.06] hover:text-red-400 transition-colors flex items-center gap-3"
                >
                  <Ban className="w-4 h-4" />
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
    <div className="bg-amber-500/[0.06] border-b border-amber-500/[0.08] px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 text-amber-400/60" />
        <span className="text-[13px] text-amber-200/60">Vault Chat — Exchange contacts to unlock</span>
      </div>
      <div className="flex items-center gap-1.5 text-[13px] text-amber-400/60 tabular-nums">
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
    <div className="px-4 py-2 bg-amber-500/[0.04] border-t border-amber-500/[0.08]">
      <p className="text-[11px] text-center text-foreground-subtle">
        {limits.messagesRemaining} free messages remaining.{" "}
        <button onClick={onUpgrade} className="text-amber-400/70 hover:text-amber-400 transition-colors">
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
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const botTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
            isBot: (conv as any).otherUser?.isBot || false,
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
    // Clear bot typing state when navigating away
    if (botTypingTimeoutRef.current) {
      clearTimeout(botTypingTimeoutRef.current);
      botTypingTimeoutRef.current = null;
    }
    setIsBotTyping(false);
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

        // Bot typing indicator + 2s delay (simulate real human behavior)
        const isBot = roomInfo?.otherUser?.isBot || false;
        if (isBot) {
          // Clear any existing bot typing timeout
          if (botTypingTimeoutRef.current) {
            clearTimeout(botTypingTimeoutRef.current);
          }
          // Show typing indicator immediately
          setIsBotTyping(true);
          // Wait 2 seconds before refreshing for bot reply
          botTypingTimeoutRef.current = setTimeout(() => {
            setIsBotTyping(false);
            botTypingTimeoutRef.current = null;
            // Refresh messages to get bot reply (socket should deliver it, but poll as fallback)
          }, 2000);
        }
      } catch (err) {
        toast.error("Failed to send message");
      }
    },
    [currentConvId, sendMessage, userLimits, roomInfo]
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

  // Handle report user
  const handleReport = useCallback(
    (_msgId: string, _senderId: string) => {
      setShowReportModal(true);
    },
    []
  );

  // Handle block user
  const handleBlockUser = useCallback(async () => {
    if (!roomInfo?.otherUser?.id) return;
    const confirmed = window.confirm(
      `Block ${roomInfo.otherUser.name}?\n\nThey won't be able to see or message you.`
    );
    if (!confirmed) return;
    setIsBlocking(true);
    try {
      const res = await fetch(`/api/users/${roomInfo.otherUser.id}/block`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success(`${roomInfo.otherUser.name} has been blocked`);
        setCurrentConvId(null);
        setRoomInfo(null);
        loadConversations();
      } else {
        toast.error("Failed to block user");
      }
    } catch {
      toast.error("Failed to block user");
    } finally {
      setIsBlocking(false);
    }
  }, [roomInfo?.otherUser?.id, roomInfo?.otherUser?.name, loadConversations]);

  // Show conversation list on mobile when no room selected
  const showConversationList = isMobile && !currentConvId;

  // Show chat on mobile when room selected
  const showChat = isMobile && currentConvId;

  return (
    <div className={`flex h-[calc(100vh-4rem)] -mx-4 -mt-6 bg-background ${className}`}>
      {/* Left Sidebar - Conversation List */}
      <div
        className={`w-full md:w-[340px] border-r border-card-border/[0.04] flex flex-col bg-background ${
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
            <ChatHeader roomInfo={roomInfo} onBack={handleBack} onReport={() => setShowReportModal(true)} onBlock={handleBlockUser} />

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
              isBotTyping={isBotTyping}
              otherUserAvatar={roomInfo.otherUser.avatar}
              otherUserName={roomInfo.otherUser.name}
              otherUserIsBot={roomInfo.otherUser.isBot}
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

      {/* Report Modal */}
      {roomInfo && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          reportedUserId={roomInfo.otherUser.id}
          reportedUserName={roomInfo.otherUser.name}
        />
      )}
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export { ChatInput } from "./chat-input";
export { MessageBubble } from "./message-bubble";
export { ConversationItem } from "./conversation-item";
