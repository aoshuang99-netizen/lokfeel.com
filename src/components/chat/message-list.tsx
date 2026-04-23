"use client";

import { useRef, useEffect, useCallback, useMemo, memo } from "react";
import { Sparkles, Bot, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { MessageBubble, MessageBubbleProps } from "./message-bubble";
import type { IMMessagePayload } from "@/lib/im/types";

// ============================================================================
// Types
// ============================================================================

interface MessageListProps {
  /** IM API v2 消息列表 */
  messages: IMMessagePayload[];
  /** 当前用户 ID */
  currentUserId?: string;
  isLoading?: boolean;
  isTyping?: boolean;
  typingUserName?: string;
  onRetry?: (msgId: string) => void;
  onLoadMore?: () => void;
  onCopy?: (content: string) => void;
  onDelete?: (msgId: string) => void;
  onReport?: (msgId: string, senderId: string) => void;
  onReply?: (message: IMMessagePayload) => void;
  hasMore?: boolean;
  className?: string;
}

interface MessageGroup {
  id: string;
  messages: IMMessagePayload[];
  isFromMe: boolean;
  isFromBot: boolean;
  senderName: string;
  senderAvatar?: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group consecutive messages from the same sender
 */
function groupMessages(messages: IMMessagePayload[], currentUserId?: string): MessageGroup[] {
  const groups: MessageGroup[] = [];
  
  messages.forEach((message, index) => {
    const isFromMe = message.senderId === currentUserId || message.senderId === "me";
    const isFromBot = message.senderId?.startsWith("bot-");
    
    // Check if this message should be grouped with the previous one
    const prevMessage = messages[index - 1];
    const prevIsFromMe = prevMessage && (prevMessage.senderId === currentUserId || prevMessage.senderId === "me");
    const prevIsFromBot = prevMessage && prevMessage.senderId?.startsWith("bot-");
    
    const shouldGroup = prevMessage && isFromMe === prevIsFromMe && isFromBot === prevIsFromBot;
    
    if (shouldGroup && groups.length > 0) {
      // Add to existing group
      groups[groups.length - 1].messages.push(message);
    } else {
      // Create new group
      groups.push({
        id: message.msgId,
        messages: [message],
        isFromMe,
        isFromBot,
        senderName: isFromMe ? "You" : isFromBot ? "Bot" : "Unknown",
        senderAvatar: undefined,
      });
    }
  });
  
  return groups;
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ isBot }: { isBot?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
        className="relative mb-6"
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-500/10 to-rose-500/10 blur-2xl scale-150" />
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/10 to-rose-500/10 border border-white/[0.06] flex items-center justify-center">
          {isBot ? (
            <Sparkles className="w-7 h-7 text-amber-400/60" />
          ) : (
            <Sparkles className="w-7 h-7 text-white/20" />
          )}
        </div>
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-white/50 mb-1.5 text-[15px]"
      >
        {isBot ? "Start chatting" : "No messages yet"}
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-white/25 text-sm leading-relaxed"
      >
        {isBot ? "Say hello to start the conversation!" : "Say hello to start the conversation!"}
      </motion.p>
    </div>
  );
}

// ============================================================================
// Typing Indicator Component
// ============================================================================

function TypingIndicator({ name }: { name?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2.5 px-4 py-2"
    >
      <div className="flex items-center gap-[3px]">
        <span className="w-[5px] h-[5px] bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.4s" }} />
        <span className="w-[5px] h-[5px] bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1.4s" }} />
        <span className="w-[5px] h-[5px] bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1.4s" }} />
      </div>
      <span className="text-[11px] text-white/30">
        {name ? `${name} is typing...` : "Typing..."}
      </span>
    </motion.div>
  );
}

// ============================================================================
// Message List Component
// ============================================================================

function MessageListComponent({
  messages,
  currentUserId,
  isLoading = false,
  isTyping = false,
  typingUserName,
  onRetry,
  onLoadMore,
  onCopy,
  onDelete,
  onReport,
  onReply,
  hasMore = false,
  className = "",
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const previousMessagesLengthRef = useRef(0);

  // Group messages
  const messageGroups = useMemo(() => groupMessages(messages, currentUserId), [messages, currentUserId]);

  // Check if we have bot messages
  const hasBotMessages = useMemo(
    () => messages.some((m) => m.senderId?.startsWith("bot-")),
    [messages]
  );

  // Scroll to bottom when new messages arrive
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Track scroll position to detect if user is at bottom
  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  }, []);

  // Auto-scroll on new messages if user is at bottom
  useEffect(() => {
    // Only auto-scroll if new messages were added (not on initial load)
    if (messages.length > previousMessagesLengthRef.current && isAtBottomRef.current) {
      scrollToBottom("smooth");
    }
    previousMessagesLengthRef.current = messages.length;
  }, [messages, scrollToBottom]);

  // Initial scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom("instant");
    }
  }, []);

  // Load more handler
  const handleLoadMore = useCallback(() => {
    if (onLoadMore && hasMore && !isLoading) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, isLoading]);

  // Check for scroll to top (load more trigger)
  const handleScrollForLoadMore = useCallback(() => {
    if (containerRef.current && hasMore && onLoadMore) {
      const { scrollTop } = containerRef.current;
      if (scrollTop < 200 && !isLoading) {
        onLoadMore();
      }
    }
  }, [hasMore, onLoadMore, isLoading]);

  // Combine scroll handlers
  const handleScrollCombined = useCallback(() => {
    handleScroll();
    handleScrollForLoadMore();
  }, [handleScroll, handleScrollForLoadMore]);

  // Loading indicator
  if (isLoading && messages.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
            <p className="text-white/60">Loading messages...</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (messages.length === 0 && !isLoading) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <EmptyState isBot={hasBotMessages} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScrollCombined}
      className={`flex-1 overflow-y-auto ${className}`}
    >
      <div className="p-4 space-y-1">
        {/* Load more indicator */}
        {hasMore && (
          <div className="flex justify-center py-2">
            {isLoading ? (
              <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
            ) : (
              <button
                onClick={handleLoadMore}
                className="text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                Load earlier messages
              </button>
            )}
          </div>
        )}

        {/* Render message groups */}
        {messageGroups.map((group, groupIndex) => (
          <div key={group.id} className="space-y-1">
            {group.messages.map((message, messageIndex) => {
              const isFirstInGroup = messageIndex === 0;
              const showAvatar = !group.isFromMe && isFirstInGroup;
              
              return (
                <MessageBubble
                  key={message.msgId}
                  message={message}
                  currentUserId={currentUserId}
                  sender={{
                    id: message.senderId,
                    name: group.senderName,
                    avatar: group.senderAvatar,
                    isBot: group.isFromBot,
                  }}
                  showAvatar={showAvatar}
                  onRetry={onRetry}
                  onCopy={onCopy}
                  onDelete={onDelete}
                  onReport={onReport}
                  onReply={onReply}
                />
              );
            })}
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div className="py-2">
            <TypingIndicator name={typingUserName} />
          </div>
        )}

        {/* End spacer for scroll positioning */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export const MessageList = memo(MessageListComponent);

// Re-export types for convenience
export type { MessageListProps, MessageBubbleProps };
