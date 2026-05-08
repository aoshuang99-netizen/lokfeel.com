"use client";

import { memo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MessageCircle, Bot, Sparkles, Search, Inbox } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface ChatEmptyStateProps {
  /** 空状态类型 */
  type?: "no-conversations" | "no-messages" | "bot-chat" | "search-empty";
  /** 搜索关键词（用于搜索空状态） */
  searchQuery?: string;
  /** 自定义类名 */
  className?: string;
  /** 自定义动作按钮 */
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

// ============================================================================
// Icons Map
// ============================================================================

const iconMap = {
  "no-conversations": MessageCircle,
  "no-messages": Inbox,
  "bot-chat": Bot,
  "search-empty": Search,
} as const;

// ============================================================================
// Content Map
// ============================================================================

const contentMap = {
  "no-conversations": {
    title: "No conversations yet",
    description: "Accept a match to start chatting with other users",
    cta: "Find Matches",
    href: "/dashboard/connections",
  },
  "no-messages": {
    title: "No messages yet",
    description: "Start the conversation!",
    cta: null,
    href: null,
  },
  "bot-chat": {
    title: "Chat",
    description: "Start chatting and get to know each other",
    cta: null,
    href: null,
  },
  "search-empty": {
    title: "No results found",
    description: "", // Will be set dynamically
    cta: null,
    href: null,
  },
} as const;

// ============================================================================
// Empty State Component
// ============================================================================

function ChatEmptyStateComponent({ 
  type = "no-conversations", 
  searchQuery,
  className = "",
  action 
}: ChatEmptyStateProps) {
  const Icon = iconMap[type];
  const content = contentMap[type];
  
  const title = content.title;
  const description = searchQuery 
    ? `No conversations match "${searchQuery}"` 
    : content.description;
  
  // Determine icon color based on type
  const iconColor = type === "bot-chat" ? "text-orange-400" : "text-foreground-subtle";

  // Determine icon background
  const iconBg = type === "bot-chat" ? "bg-orange-500/20" : "bg-background-tertiary";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center h-full text-center p-8 ${className}`}
    >
      {/* Icon */}
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        className={`w-16 h-16 rounded-full ${iconBg} flex items-center justify-center mb-4`}
      >
        <Icon className={`w-8 h-8 ${iconColor}`} />
      </motion.div>

      {/* Title */}
      <h3 className="text-xl font-semibold text-foreground mb-2">
        {title}
      </h3>

      {/* Description */}
      <p className="text-foreground-muted text-sm max-w-xs">
        {description}
      </p>

      {/* Action Button */}
      {(action?.label || content.cta) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-6"
        >
          {action?.href || content.href ? (
            <Link
              href={action?.href || content.href!}
              className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-foreground font-medium transition-colors"
            >
              {action?.label || content.cta}
            </Link>
          ) : action?.onClick ? (
            <button
              onClick={action.onClick}
              className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-foreground font-medium transition-colors"
            >
              {action.label}
            </button>
          ) : null}
        </motion.div>
      )}
    </motion.div>
  );
}

// ============================================================================
// Variants for Different States
// ============================================================================

export const NoConversationsEmpty = memo((props: Omit<ChatEmptyStateProps, "type">) => (
  <ChatEmptyStateComponent {...props} type="no-conversations" />
));

export const NoMessagesEmpty = memo((props: Omit<ChatEmptyStateProps, "type">) => (
  <ChatEmptyStateComponent {...props} type="no-messages" />
));

export const BotChatEmpty = memo((props: Omit<ChatEmptyStateProps, "type">) => (
  <ChatEmptyStateComponent {...props} type="bot-chat" />
));

export const SearchEmpty = memo(({ searchQuery, ...props }: Omit<ChatEmptyStateProps, "type"> & { searchQuery: string }) => (
  <ChatEmptyStateComponent {...props} type="search-empty" searchQuery={searchQuery} />
));

// ============================================================================
// Memoized Export
// ============================================================================

export const ChatEmptyState = memo(ChatEmptyStateComponent);
