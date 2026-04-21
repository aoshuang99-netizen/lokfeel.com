"use client";

import { memo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { User, Bot, Lock } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface ConversationItemProps {
  id: string;
  matchId?: string | null;
  otherUser: {
    id: string;
    name: string;
    age?: number;
    avatar?: string | null;
    isOnline?: boolean;
    isBot?: boolean;
    lastSeen?: string;
  };
  lastMessage?: {
    content: string;
    timestamp: string;
    isFromMe?: boolean;
  } | null;
  unreadCount?: number;
  isVault?: boolean;
  vaultExpiresAt?: string;
  isSelected?: boolean;
  onClick?: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

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

// ============================================================================
// Avatar Component
// ============================================================================

interface AvatarProps {
  name: string;
  avatar?: string | null;
  isOnline?: boolean;
  isBot?: boolean;
}

function Avatar({ name, avatar, isOnline, isBot }: AvatarProps) {
  return (
    <div className="relative flex-shrink-0">
      <div className="w-12 h-12 rounded-full overflow-hidden bg-white/5 flex items-center justify-center">
        {avatar ? (
          <img
            src={avatar}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold">
            {name?.[0] || "?"}
          </div>
        )}
      </div>
      {/* Online Status Indicator */}
      {isOnline ? (
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0d0c11]" />
      ) : (
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-gray-500 rounded-full border-2 border-[#0d0c11]" />
      )}
      {/* Bot Badge */}
      {isBot && (
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center border-2 border-[#0d0c11]">
          <Bot className="w-3 h-3 text-white" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Vault Badge Component
// ============================================================================

function VaultBadge({ expiresAt }: { expiresAt?: string }) {
  if (!expiresAt) return null;

  const expiry = new Date(expiresAt);
  const now = new Date();
  const hoursRemaining = Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / 3600000));

  return (
    <span className="ml-2 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
      <Lock className="w-3 h-3" />
      Vault {hoursRemaining > 0 ? `${hoursRemaining}h` : "Soon"}
    </span>
  );
}

// ============================================================================
// Conversation Item Component
// ============================================================================

function ConversationItemComponent({
  id,
  matchId,
  otherUser,
  lastMessage,
  unreadCount = 0,
  isVault = false,
  vaultExpiresAt,
  isSelected = false,
  onClick,
}: ConversationItemProps) {
  const isBot = otherUser.isBot || otherUser.id?.startsWith("bot-");
  const hasUnread = unreadCount > 0;

  // Render as link if no onClick handler
  const content = (
    <motion.div
      className={`
        flex items-center gap-3 p-3 transition-colors cursor-pointer
        ${isSelected ? "bg-white/10" : "hover:bg-white/5"}
        ${hasUnread ? "bg-primary/5" : ""}
      `}
    >
      {/* Avatar */}
      <Avatar
        name={otherUser.name}
        avatar={otherUser.avatar}
        isOnline={otherUser.isOnline}
        isBot={isBot}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row: name and time */}
        <div className="flex items-center justify-between mb-0.5">
          <h3 className={`font-semibold text-white truncate text-sm ${hasUnread ? "font-bold" : ""}`}>
            {otherUser.name}
            {otherUser.age !== undefined && (
              <span className="text-white/60 font-normal ml-1">, {otherUser.age}</span>
            )}
            {isVault && <VaultBadge expiresAt={vaultExpiresAt} />}
          </h3>
          {lastMessage && (
            <span
              className={`text-xs flex-shrink-0 ml-2 ${
                hasUnread ? "text-primary" : "text-white/40"
              }`}
            >
              {formatMessageTime(lastMessage.timestamp)}
            </span>
          )}
        </div>

        {/* Message preview row */}
        <div className="flex items-center justify-between">
          <p
            className={`text-sm truncate ${
              hasUnread ? "text-white font-medium" : "text-white/50"
            }`}
          >
            {lastMessage ? (
              <>
                {lastMessage.isFromMe && <span className="text-white/60">You: </span>}
                {lastMessage.content}
              </>
            ) : (
              <span className="italic text-white/40">Start chatting...</span>
            )}
          </p>
          {hasUnread && (
            <div className="flex-shrink-0 ml-2 min-w-[20px] h-5 rounded-full bg-primary flex items-center justify-center">
              <span className="text-xs font-bold text-white px-1">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </div>
          )}
        </div>

        {/* Online status text */}
        <p className="text-xs text-white/40 mt-0.5">
          {otherUser.isOnline ? (
            <span className="text-green-500">Online</span>
          ) : (
            formatLastSeen(otherUser.lastSeen)
          )}
        </p>
      </div>
    </motion.div>
  );

  // If onClick is provided, use a div; otherwise use Link
  if (onClick) {
    return (
      <div
        onClick={onClick}
        className="border-b border-white/5"
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={`/dashboard/chat/${id}`}
      className="block border-b border-white/5"
    >
      {content}
    </Link>
  );
}

// ============================================================================
// Memoized Export
// ============================================================================

export const ConversationItem = memo(ConversationItemComponent);

// ConversationItemProps is already exported as an interface above
