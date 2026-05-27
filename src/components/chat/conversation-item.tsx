"use client";

import { memo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { User, Bot, Lock, Sparkles } from "lucide-react";
import { isBrokenAvatarUrl } from "@/lib/avatar-utils";

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
    msgType?: string;
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
  // Detect avatar type: emoji format, photo URL, or none
  const isEmoji = avatar?.startsWith("emoji:");
  const emojiChar = isEmoji ? avatar!.split(":")[1] : null;
  // Skip broken CDN URLs immediately — show fallback instead of broken image
  const safeAvatar = avatar && !isBrokenAvatarUrl(avatar) ? avatar : null;

  return (
    <div className="relative flex-shrink-0">
      <div className="w-12 h-12 rounded-full overflow-hidden bg-background-tertiary flex items-center justify-center ring-1 ring-white/[0.06]">
        {safeAvatar ? (
          isEmoji ? (
            <div className={`w-full h-full flex items-center justify-center ${
              isBot
                ? 'bg-gradient-to-br from-amber-500/80 to-rose-500/80'
                : 'bg-gradient-to-br from-primary to-secondary'
            }`}>
              <span
                className="select-none leading-none"
                style={{
                  fontSize: 'clamp(1.2rem, 200%, 2.5rem)',
                  lineHeight: '1',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                }}
              >
                {emojiChar}
              </span>
            </div>
          ) : (
            <img
              src={safeAvatar}
              alt={name}
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; const fb = e.currentTarget.nextElementSibling as HTMLElement; if (fb) fb.style.display = 'flex'; }}
            />
          )
        ) : (
          <div className={`w-full h-full flex items-center justify-center text-foreground font-bold text-sm ${
            isBot 
              ? 'bg-gradient-to-br from-amber-500/80 to-rose-500/80'
              : 'bg-gradient-to-br from-primary to-secondary'
          }`}>
            {name?.[0] || "?"}
          </div>
        )}
      </div>
      {/* Online Status Indicator */}
      {isOnline ? (
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full ring-2 ring-background" />
      ) : !isBot ? (
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-background-tertiary rounded-full ring-2 ring-background" />
      ) : null}

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
    <span className="ml-2 text-[10px] bg-amber-500/10 text-amber-400/70 px-1.5 py-0.5 rounded-md flex items-center gap-1 font-medium">
      <Lock className="w-2.5 h-2.5" />
      {hoursRemaining > 0 ? `${hoursRemaining}h` : "Soon"}
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
        flex items-center gap-3 p-3 transition-all duration-200 cursor-pointer
        ${isSelected ? "bg-background-tertiary" : "hover:bg-background-tertiary"}
        ${hasUnread ? "bg-amber-600/[0.03]" : ""}
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
          <h3 className={`text-foreground truncate text-[14px] ${hasUnread ? "font-semibold" : "font-medium"}`}>
            {otherUser.name}
            {otherUser.age !== undefined && (
              <span className="text-foreground-subtle font-normal ml-1">, {otherUser.age}</span>
            )}
            {isVault && <VaultBadge expiresAt={vaultExpiresAt} />}
          </h3>
          {lastMessage && (
            <span
              className={`text-[11px] flex-shrink-0 ml-2 tabular-nums ${
                hasUnread ? "text-amber-400" : "text-foreground-faint"
              }`}
            >
              {formatMessageTime(lastMessage.timestamp)}
            </span>
          )}
        </div>

        {/* Message preview row */}
        <div className="flex items-center justify-between">
          <p
            className={`text-[13px] truncate ${
              hasUnread ? "text-foreground-muted" : "text-foreground-subtle"
            }`}
          >
            {lastMessage ? (
              <>
                {lastMessage.isFromMe && <span className="text-foreground-faint">You: </span>}
                {lastMessage.msgType === "IMAGE" ? (
                  <span className="text-foreground-subtle">📷 Image</span>
                ) : lastMessage.msgType === "VOICE" ? (
                  <span className="text-foreground-subtle">🎤 Voice</span>
                ) : (
                  lastMessage.content
                )}
              </>
            ) : (
              <span className="italic text-foreground-faint">Start chatting...</span>
            )}
          </p>
          {hasUnread && (
            <div className="flex-shrink-0 ml-2 min-w-[20px] h-5 rounded-full bg-amber-600 flex items-center justify-center">
              <span className="text-[10px] font-bold text-foreground px-1.5 tabular-nums">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </div>
          )}
        </div>

        {/* Online status text */}
        <p className="text-[11px] mt-0.5">
          {otherUser.isOnline ? (
            <span className="text-emerald-400/60">Online</span>
          ) : isBot ? (
            <span className="text-foreground-faint">Online</span>
          ) : (
            <span className="text-foreground-faint">{formatLastSeen(otherUser.lastSeen)}</span>
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
        className="border-b border-card-border"
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={`/dashboard/chats/${id}`}
      className="block border-b border-card-border"
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
