"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from "react";
import { Sparkles, Bot, Loader2 } from "lucide-react";
import { m } from "framer-motion";
import { MessageBubble, MessageBubbleProps } from "./message-bubble";
import type { IMMessagePayload } from "@/lib/im/types";
import { isBrokenAvatarUrl } from "@/lib/avatar-utils";
import { useMessageWindowing } from "./use-message-windowing";

// ============================================================================
// Types
// ============================================================================

interface MessageListProps {
  /** IM API v2 消息列表 */
  messages: IMMessagePayload[];
  /** 当前用户 ID */
  currentUserId?: string;
  isLoading?: boolean;
  /** 真实用户正在输入（来自socket事件） */
  isTyping?: boolean;
  typingUserName?: string;
  /** Bot模拟的typing状态（2秒延迟后获取回复） */
  isBotTyping?: boolean;
  /** 对方用户的头像URL（用于显示消息头像） */
  otherUserAvatar?: string | null;
  /** 对方用户的名字（用于显示消息头像fallback） */
  otherUserName?: string;
  /** 对方用户是否是Bot */
  otherUserIsBot?: boolean;
  onRetry?: (msgId: string) => void;
  onLoadMore?: () => void;
  onCopy?: (content: string) => void;
  onDelete?: (msgId: string) => void;
  onReport?: (msgId: string, senderId: string) => void;
  onReply?: (message: IMMessagePayload) => void;
  hasMore?: boolean;
  className?: string;
}

interface SenderInfo {
  id: string;
  name: string;
  avatar?: string | null;
  isBot: boolean;
  isFromMe: boolean;
}

interface MessageGroup {
  id: string;
  messages: IMMessagePayload[];
  isFromMe: boolean;
  isFromBot: boolean;
  sender: SenderInfo;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group consecutive messages from the same sender.
 * The `sender` object is built once per group so it stays referentially stable
 * across re-renders — this is what lets memo(MessageBubble) actually skip work.
 */
function groupMessages(
  messages: IMMessagePayload[],
  currentUserId?: string,
  otherUserAvatar?: string | null,
  otherUserName?: string,
  otherUserIsBot?: boolean,
): MessageGroup[] {
  const groups: MessageGroup[] = [];

  messages.forEach((message, index) => {
    const isFromMe = message.senderId === currentUserId || message.senderId === "me";
    const isFromBot =
      otherUserIsBot ||
      message.senderId?.startsWith("bot-") ||
      message.senderId?.startsWith("bot_") ||
      false;

    const prevMessage = messages[index - 1];
    const prevIsFromMe = prevMessage && (prevMessage.senderId === currentUserId || prevMessage.senderId === "me");
    const prevIsFromBot =
      otherUserIsBot ||
      (prevMessage?.senderId?.startsWith("bot-") || prevMessage?.senderId?.startsWith("bot_") || false);

    const shouldGroup = prevMessage && isFromMe === prevIsFromMe && isFromBot === prevIsFromBot;

    if (shouldGroup && groups.length > 0) {
      groups[groups.length - 1].messages.push(message);
    } else {
      groups.push({
        id: message.msgId,
        messages: [message],
        isFromMe,
        isFromBot,
        sender: {
          id: message.senderId,
          name: isFromMe ? "You" : otherUserName || (isFromBot ? "Bot" : "Unknown"),
          avatar: isFromMe ? undefined : otherUserAvatar,
          isBot: isFromBot,
          isFromMe,
        },
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
      <m.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
        className="relative mb-6"
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-500/10 to-rose-500/10 blur-2xl scale-150" />
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/10 to-rose-500/10 border border-card-border/[0.06] flex items-center justify-center">
          {isBot ? (
            <Sparkles className="w-7 h-7 text-amber-400/60" />
          ) : (
            <Sparkles className="w-7 h-7 text-foreground-faint" />
          )}
        </div>
      </m.div>
      <m.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-foreground-muted mb-1.5 text-[15px]"
      >
        {isBot ? "Start chatting" : "No messages yet"}
      </m.p>
      <m.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-foreground-faint text-sm leading-relaxed"
      >
        {isBot ? "Say hello to start the conversation!" : "Say hello to start the conversation!"}
      </m.p>
    </div>
  );
}

// ============================================================================
// Typing Indicator Component
// ============================================================================

interface TypingIndicatorProps {
  name?: string;
  avatar?: string | null;
  isBot?: boolean;
}

function TypingIndicator({ name, avatar, isBot }: TypingIndicatorProps) {
  const safeAvatar = avatar && !isBrokenAvatarUrl(avatar) ? avatar : null;

  return (
    <m.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2.5 px-4 py-2"
    >
      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ring-1 ring-white/10">
        {safeAvatar ? (
          safeAvatar.startsWith("emoji:") ? (
            <div className={`w-full h-full flex items-center justify-center ${
              isBot
                ? 'bg-gradient-to-br from-amber-500/80 to-rose-500/80'
                : 'bg-gradient-to-br from-primary to-secondary'
            }`}>
              <span
                className="select-none leading-none"
                style={{
                  display: 'inline-block',
                  width: '100%',
                  height: '100%',
                  fontSize: 'clamp(0.9rem, 180%, 1.8rem)',
                  lineHeight: '1',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                }}
              >
                {safeAvatar.split(":")[1]}
              </span>
            </div>
          ) : (
            <img src={safeAvatar} alt={name || "User"} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )
        ) : (
          <div className={`w-full h-full flex items-center justify-center text-foreground text-xs font-bold ${
            isBot
              ? 'bg-gradient-to-br from-amber-500/80 to-rose-500/80'
              : 'bg-gradient-to-br from-primary to-secondary'
          }`}>
            {name?.[0] || "?"}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 bg-background-tertiary rounded-2xl px-4 py-2.5 border border-card-border/[0.06]">
        <div className="flex items-center gap-[3px]">
          <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.4s" }} />
          <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1.4s" }} />
          <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1.4s" }} />
        </div>
        <span className="text-[11px] text-foreground-subtle">
          {name ? `${name} is typing...` : "Typing..."}
        </span>
      </div>
    </m.div>
  );
}

// ============================================================================
// Chat Row (memoized so scrolling only re-renders the windowed slice)
// ============================================================================

interface ChatRowProps {
  message: IMMessagePayload;
  sender: SenderInfo;
  showAvatar: boolean;
  currentUserId?: string;
  onRetry?: (msgId: string) => void;
  onCopy?: (content: string) => void;
  onDelete?: (msgId: string) => void;
  onReport?: (msgId: string, senderId: string) => void;
  onReply?: (message: IMMessagePayload) => void;
}

const ChatRow = memo(function ChatRow({
  message,
  sender,
  showAvatar,
  currentUserId,
  onRetry,
  onCopy,
  onDelete,
  onReport,
  onReply,
}: ChatRowProps) {
  return (
    <MessageBubble
      message={message}
      currentUserId={currentUserId}
      sender={sender}
      showAvatar={showAvatar}
      onRetry={onRetry}
      onCopy={onCopy}
      onDelete={onDelete}
      onReport={onReport}
      onReply={onReply}
    />
  );
});

// ============================================================================
// Message List Component
// ============================================================================

function MessageListComponent({
  messages,
  currentUserId,
  isLoading = false,
  isTyping = false,
  typingUserName,
  isBotTyping = false,
  otherUserAvatar,
  otherUserName,
  otherUserIsBot,
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
  const pinToBottomRef = useRef(true);
  const anchorScrollHeightRef = useRef<number | null>(null);

  // Group messages (memoized; stable sender objects per group)
  const messageGroups = useMemo(
    () => groupMessages(messages, currentUserId, otherUserAvatar, otherUserName, otherUserIsBot),
    [messages, currentUserId, otherUserAvatar, otherUserName, otherUserIsBot],
  );

  // Flatten to a row list (one per message) carrying group context.
  const rows = useMemo(() => {
    const result: { key: string; message: IMMessagePayload; sender: SenderInfo; isFirstInGroup: boolean }[] = [];
    messageGroups.forEach((group) => {
      group.messages.forEach((message, i) => {
        result.push({
          key: message.msgId,
          message,
          sender: group.sender,
          isFirstInGroup: i === 0,
        });
      });
    });
    return result;
  }, [messageGroups]);

  // Only virtualize long conversations; short/medium chats keep the classic
  // render path so there is zero behavioural regression for the common case.
  const USE_WINDOW = rows.length > 60;

  const win = useMessageWindowing({
    items: rows,
    getKey: (row) => row.key,
    estimateSize: 64,
    overscan: 10,
    getScrollElement: () => containerRef.current,
  });

  const hasBotMessages = useMemo(
    () => messages.some((m) => m.senderId?.startsWith("bot-")),
    [messages],
  );

  // Scroll to bottom (classic path)
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Track scroll position (isAtBottom + stop pinning once the user scrolls up)
  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
      if (!isAtBottomRef.current) pinToBottomRef.current = false;
    }
  }, []);

  // Auto-scroll on new messages if user is at bottom
  useEffect(() => {
    if (messages.length > previousMessagesLengthRef.current) {
      if (USE_WINDOW) {
        if (win.isAtBottom()) win.scrollToBottom("smooth");
      } else if (isAtBottomRef.current) {
        scrollToBottom("smooth");
      }
    }
    previousMessagesLengthRef.current = messages.length;
  }, [messages, USE_WINDOW, win, scrollToBottom]);

  // Initial scroll to bottom
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    if (USE_WINDOW) {
      pinToBottomRef.current = true;
      win.scrollToBottom("auto");
      const id = requestAnimationFrame(() => win.scrollToBottom("auto"));
      return () => cancelAnimationFrame(id);
    }
    scrollToBottom("instant");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep pinned to the bottom while measurements settle (windowed only)
  useEffect(() => {
    if (USE_WINDOW && pinToBottomRef.current && rows.length > 0) {
      win.scrollToBottom("auto");
    }
  }, [USE_WINDOW, win.totalSize, rows.length, win]);

  // Load more (windowed: preserve scroll position across prepend)
  const handleLoadMore = useCallback(() => {
    if (onLoadMore && hasMore && !isLoading) {
      const el = containerRef.current;
      if (el && USE_WINDOW) anchorScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [onLoadMore, hasMore, isLoading, USE_WINDOW]);

  // Restore scroll position after older messages are prepended
  useLayoutEffect(() => {
    if (USE_WINDOW && anchorScrollHeightRef.current !== null && containerRef.current) {
      const el = containerRef.current;
      const delta = el.scrollHeight - anchorScrollHeightRef.current;
      if (delta > 0) el.scrollTop += delta;
      anchorScrollHeightRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Check for scroll to top (load more trigger)
  const handleScrollForLoadMore = useCallback(() => {
    if (containerRef.current && hasMore && onLoadMore) {
      const { scrollTop } = containerRef.current;
      if (scrollTop < 200 && !isLoading) {
        handleLoadMore();
      }
    }
  }, [hasMore, onLoadMore, isLoading, handleLoadMore]);

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
            <p className="text-foreground-muted">Loading messages...</p>
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

  // Load-more bar (sticky so it never scrolls out of view)
  const loadMoreBar = hasMore ? (
    <div className="sticky top-0 z-20 flex justify-center py-2 bg-background/90 backdrop-blur-sm">
      {isLoading ? (
        <Loader2 className="w-5 h-5 text-foreground-subtle animate-spin" />
      ) : (
        <button
          onClick={handleLoadMore}
          className="text-xs text-foreground-subtle hover:text-foreground-muted transition-colors"
        >
          Load earlier messages
        </button>
      )}
    </div>
  ) : null;

  // Typing indicator (sticky bottom)
  const typingBar = isTyping || isBotTyping ? (
    <div className="sticky bottom-0 z-20 bg-background/90 backdrop-blur-sm">
      <div className="py-2">
        <TypingIndicator
          name={typingUserName || otherUserName}
          avatar={otherUserAvatar}
          isBot={otherUserIsBot || isBotTyping}
        />
      </div>
    </div>
  ) : null;

  // ---- Windowed render (long conversations) ----
  if (USE_WINDOW) {
    const count = Math.max(0, win.rangeEnd - win.rangeStart + 1);
    return (
      <div
        ref={containerRef}
        onScroll={handleScrollCombined}
        className={`flex-1 overflow-y-auto ${className}`}
      >
        {loadMoreBar}
        <div style={{ height: win.totalSize, position: "relative", width: "100%" }}>
          {Array.from({ length: count }, (_, k) => {
            const index = win.rangeStart + k;
            if (index < 0 || index >= rows.length) return null;
            const row = rows[index];
            return (
              <div
                key={row.key}
                data-index={index}
                ref={(el) => win.measure(row.key, el)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${win.offsetOf(index)}px)`,
                }}
                className="px-4 pb-1"
              >
                <ChatRow
                  message={row.message}
                  sender={row.sender}
                  showAvatar={!row.sender.isFromMe && row.isFirstInGroup}
                  currentUserId={currentUserId}
                  onRetry={onRetry}
                  onCopy={onCopy}
                  onDelete={onDelete}
                  onReport={onReport}
                  onReply={onReply}
                />
              </div>
            );
          })}
        </div>
        {typingBar}
      </div>
    );
  }

  // ---- Classic render (short / medium conversations) ----
  return (
    <div
      ref={containerRef}
      onScroll={handleScrollCombined}
      className={`flex-1 overflow-y-auto ${className}`}
    >
      <div className="p-4 space-y-1">
        {loadMoreBar}
        {messageGroups.map((group) => (
          <div key={group.id} className="space-y-1">
            {group.messages.map((message, messageIndex) => {
              const isFirstInGroup = messageIndex === 0;
              const showAvatar = !group.sender.isFromMe && isFirstInGroup;
              return (
                <ChatRow
                  key={message.msgId}
                  message={message}
                  sender={group.sender}
                  showAvatar={showAvatar}
                  currentUserId={currentUserId}
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
        {typingBar}
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
