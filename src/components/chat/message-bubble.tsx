"use client";

import { memo, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Check, CheckCheck, Clock, Copy, Trash2, Flag, Reply, ChevronRight, Sparkles } from "lucide-react";
import type { IMMessagePayload, MessageDeliveryStatus } from "@/lib/im/types";
import { ReactionPicker, ReactionSummary, type ReactionSummaryDisplay } from "./reaction-picker";
import { toast } from "sonner";
import { isBrokenAvatarUrl } from "@/lib/avatar-utils";

// ============================================================================
// Types
// ============================================================================

export interface MessageBubbleProps {
  /** IM API v2 消息载荷 */
  message: IMMessagePayload;
  /** 当前用户 ID (用于判断是否是自己发送) */
  currentUserId?: string;
  /** 发送者信息 */
  sender?: {
    id: string;
    name: string;
    avatar?: string | null;
    isBot?: boolean;
  };
  isGrouped?: boolean;
  showAvatar?: boolean;
  onRetry?: (msgId: string) => void;
  onCopy?: (content: string) => void;
  onDelete?: (msgId: string) => void;
  onReport?: (msgId: string, senderId: string) => void;
  onReply?: (message: IMMessagePayload) => void;
  /** 添加 reaction */
  onReaction?: (msgId: string, emoji: string) => void;
  /** 移除 reaction */
  onRemoveReaction?: (msgId: string, emoji: string) => void;
  /** 消息的 reactions 汇总（显示在气泡下方） */
  reactions?: ReactionSummaryDisplay[];
  /** 我对这个消息添加的 reactions（用于高亮显示） */
  myReactions?: string[];
  /** 引用的消息（用于显示引用回复） */
  quotedMessage?: {
    id: string;
    content: string;
    senderName?: string;
  } | null;
}

// Legacy type alias for backward compatibility
export type LegacyMessageBubbleProps = Omit<MessageBubbleProps, 'message'> & {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
  status?: "sending" | "sent" | "delivered" | "read" | "failed";
};

interface AvatarDisplayProps {
  name: string;
  avatar?: string | null;
  isBot?: boolean;
  size?: "sm" | "md";
}

// ============================================================================
// Avatar Display Component
// ============================================================================

function AvatarDisplay({ name, avatar, isBot, size = "sm" }: AvatarDisplayProps) {
  const sizeClasses = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  const botBadgeSize = size === "sm" ? "-bottom-0.5 -right-0.5 w-4 h-4" : "-bottom-0.5 -right-0.5 w-5 h-5";
  // Skip broken CDN URLs immediately
  const safeAvatar = avatar && !isBrokenAvatarUrl(avatar) ? avatar : null;

  return (
    <div className={`relative ${sizeClasses} rounded-full overflow-hidden flex-shrink-0 ring-1 ring-white/10`}>
      {safeAvatar ? (
        safeAvatar.startsWith("emoji:") ? (
          // High-quality emoji avatar — fills container responsively
          <div
            className={`w-full h-full flex items-center justify-center ${
              isBot
                ? 'bg-gradient-to-br from-amber-500/80 to-rose-500/80'
                : 'bg-gradient-to-br from-primary to-secondary'
            }`}
          >
            <span
              className="select-none leading-none"
              style={{
                display: 'inline-block',
                width: '100%',
                height: '100%',
                fontSize: 'clamp(1.2rem, 200%, 2.5rem)',
                lineHeight: '1',
                textAlign: 'center',
                verticalAlign: 'middle',
              }}
            >
              {safeAvatar.split(":")[1]}
            </span>
          </div>
        ) : (
          <img
            src={safeAvatar}
            alt={name}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; const p = e.currentTarget.parentElement; if (p) { const fb = document.createElement('div'); fb.className = 'w-full h-full flex items-center justify-center text-foreground text-xs font-bold bg-gradient-to-br from-primary to-secondary'; fb.textContent = name?.[0] || '?'; p.appendChild(fb); } }}
          />
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
      {/* Bot indicator - elegant sparkle instead of robot icon */}
      {isBot && (
        <div className={`absolute ${botBadgeSize} bg-gradient-to-br from-amber-500 to-rose-500 rounded-full flex items-center justify-center ring-2 ring-background`}>
          <Sparkles className={size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5"} color="white" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Context Menu Component (长按菜单)
// ============================================================================

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onReport: () => void;
  onReply: () => void;
  canDelete: boolean;
}

function ContextMenu({ x, y, onClose, onCopy, onDelete, onReport, onReply, canDelete }: ContextMenuProps) {
  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-50" 
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      
      {/* Menu */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{ 
          position: 'fixed', 
          left: x, 
          top: y,
          zIndex: 51,
        }}
        className="bg-background-tertiary rounded-xl border border-card-border shadow-xl overflow-hidden min-w-[160px]"
      >
        <button
          onClick={() => { onReply(); onClose(); }}
          className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-background-tertiary flex items-center gap-3 transition-colors"
        >
          <Reply className="w-4 h-4 text-primary" />
          Reply
        </button>
        <button
          onClick={() => { onCopy(); onClose(); }}
          className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-background-tertiary flex items-center gap-3 transition-colors"
        >
          <Copy className="w-4 h-4 text-foreground-muted" />
          Copy
        </button>
        {canDelete && (
          <button
            onClick={() => { onDelete(); onClose(); }}
            className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-background-tertiary flex items-center gap-3 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        )}
        {!canDelete && (
          <button
            onClick={() => { onReport(); onClose(); }}
            className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-background-tertiary flex items-center gap-3 transition-colors"
          >
            <Flag className="w-4 h-4" />
            Report
          </button>
        )}
      </motion.div>
    </>
  );
}

// ============================================================================
// Quoted Message Component (引用消息)
// ============================================================================

interface QuotedMessageProps {
  content: string;
  senderName?: string;
  isFromMe?: boolean;
}

function QuotedMessage({ content, senderName, isFromMe }: QuotedMessageProps) {
  return (
    <div className={`mb-2 px-3 py-2 rounded-lg ${isFromMe ? 'bg-primary/10' : 'bg-black/20'} border-l-2 ${isFromMe ? 'border-amber-400/50' : 'border-card-border'}`}>
      <p className="text-[11px] text-foreground-subtle mb-0.5">
        {senderName ? `${senderName}` : 'Original message'}
      </p>
      <p className="text-sm text-foreground-muted truncate">
        {content}
      </p>
    </div>
  );
}

// ============================================================================
// Status Icon Component
// ============================================================================

/**
 * 将 IM API v2 的 MessageDeliveryStatus 转换为旧版状态字符串
 */
function mapDeliveryStatus(status: MessageDeliveryStatus): LegacyMessageBubbleProps["status"] {
  switch (status) {
    case 'SENDING':
      return 'sending';
    case 'SENT':
      return 'sent';
    case 'DELIVERED':
      return 'delivered';
    case 'READ':
      return 'read';
    case 'FAILED':
      return 'failed';
    default:
      return undefined;
  }
}

function StatusIcon({ status }: { status?: LegacyMessageBubbleProps["status"] }) {
  if (!status || status === "sending") {
    return <Clock className="w-3 h-3 text-foreground-subtle" />;
  }
  
  if (status === "sent") {
    return <Check className="w-3 h-3 text-foreground-muted" />;
  }
  
  if (status === "delivered" || status === "read") {
    return <CheckCheck className={`w-3 h-3 ${status === "read" ? "text-primary" : "text-foreground-muted"}`} />;
  }
  
  if (status === "failed") {
    return <span className="text-xs text-red-400">Failed</span>;
  }
  
  return null;
}

// ============================================================================
// Message Bubble Component
// ============================================================================

function MessageBubbleComponent({
  message,
  currentUserId,
  sender,
  isGrouped = false,
  showAvatar = true,
  onRetry,
  onCopy,
  onDelete,
  onReport,
  onReply,
  onReaction,
  onRemoveReaction,
  reactions = [],
  myReactions = [],
  quotedMessage,
}: MessageBubbleProps) {
  // 提取消息数据
  const { msgId, payload, senderId, msgType, status, timestamp } = message;
  
  // State for context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // State for image fullscreen preview
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  
  // Determine if message is from current user
  const isFromMe = currentUserId ? senderId === currentUserId : sender?.id === currentUserId;
  // Use isBot from sender prop first, then fallback to ID pattern detection
  const isBot = sender?.isBot || 
    senderId?.startsWith("bot-") || 
    senderId?.startsWith("bot_") ||
    sender?.id?.includes("bot-") ||
    false;

  // Format time from timestamp (milliseconds)
  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get bubble styles based on sender type
  const getBubbleStyles = () => {
    if (isFromMe) {
      // Warm gradient for own messages - distinctive, not generic purple-blue
      return "bg-gradient-to-br from-amber-600/90 to-amber-500/90 text-foreground rounded-br-sm rounded-2xl";
    }
    if (isBot) {
      // Soft, warm AI message style - feels approachable, not robotic
      return "bg-primary/10 text-foreground rounded-bl-sm rounded-2xl border border-card-border/[0.06] backdrop-blur-sm";
    }
    // Other user messages - clean subtle style
    return "bg-primary/10 text-foreground rounded-bl-sm rounded-2xl";
  };

  // Handle long press / context menu
  const handleContextMenu = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    
    let x: number, y: number;
    
    if ('touches' in e) {
      const touch = e.touches[0];
      x = touch.clientX;
      y = touch.clientY;
    } else {
      x = e.clientX;
      y = e.clientY;
    }
    
    // Adjust position to keep menu in viewport
    const menuWidth = 180;
    const menuHeight = 180;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }
    
    setContextMenu({ x, y });
  }, []);

  // Handle menu actions
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(payload).then(() => {
      toast.success("Copied to clipboard");
    }).catch(() => {
      toast.error("Failed to copy");
    });
    onCopy?.(payload);
  }, [payload, onCopy]);

  const handleDelete = useCallback(() => {
    onDelete?.(msgId);
  }, [msgId, onDelete]);

  const handleReport = useCallback(() => {
    onReport?.(msgId, senderId);
  }, [msgId, senderId, onReport]);

  const handleReply = useCallback(() => {
    onReply?.(message);
  }, [message, onReply]);

  // Handle reaction toggle
  const handleReaction = useCallback((emoji: string) => {
    if (myReactions.includes(emoji)) {
      onRemoveReaction?.(msgId, emoji);
    } else {
      onReaction?.(msgId, emoji);
    }
  }, [msgId, myReactions, onReaction, onRemoveReaction]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
        className={`flex ${isFromMe ? "justify-end" : "justify-start"} ${isGrouped ? "mt-0.5" : "mt-4"}`}
        onContextMenu={handleContextMenu}
        onTouchStart={() => {}}
      >
        <div className={`flex items-end gap-2 max-w-[78%] ${isFromMe ? "flex-row-reverse" : ""}`}>
          {/* Avatar - only show for first message in group or when showAvatar is true */}
          {!isFromMe && showAvatar && (
            <AvatarDisplay
              name={sender?.name || senderId || "?"}
              avatar={sender?.avatar}
              isBot={isBot}
              size="sm"
            />
          )}
          {/* Spacer for grouped messages */}
          {!isFromMe && !showAvatar && <div className="w-8" />}

          {/* Message Content */}
          <div 
            className={`px-3.5 py-2.5 ${getBubbleStyles()} select-text`}
            onContextMenu={handleContextMenu}
          >
            {/* Quoted Message (引用回复) */}
            {quotedMessage && (
              <QuotedMessage 
                content={quotedMessage.content}
                senderName={quotedMessage.senderName}
                isFromMe={isFromMe}
              />
            )}



            {/* Message content based on msgType */}
            {msgType === 'TEXT' && (
              <p className="text-sm whitespace-pre-wrap break-words">{payload}</p>
            )}

            {msgType === 'IMAGE' && (
              <div className="space-y-2">
                <img
                  src={payload}
                  alt="Shared image"
                  className="rounded-lg max-w-[250px] max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFullscreenImage(payload);
                  }}
                />
              </div>
            )}

            {msgType === 'VOICE' && (
              <div className="flex items-center gap-2 min-w-[150px]">
                <div className="w-8 h-8 rounded-full bg-background-tertiary flex items-center justify-center">
                  <span className="text-xs">🎤</span>
                </div>
                <div className="flex-1 h-1 bg-background-tertiary rounded-full overflow-hidden">
                  <div className="w-1/2 h-full bg-background-tertiary0 rounded-full" />
                </div>
                <span className="text-xs opacity-70">{payload}</span>
              </div>
            )}

            {/* Time and status */}
            <div className={`flex items-center gap-1 mt-1.5 ${isFromMe ? "justify-end" : ""}`}>
              <span className={`text-[11px] ${isFromMe ? "text-foreground-muted" : "text-foreground-subtle"}`}>
                {formatTime(timestamp)}
              </span>
              {isFromMe && status && (
                <StatusIcon status={mapDeliveryStatus(status)} />
              )}
              {/* Reaction picker button - only show for text messages */}
              {msgType === 'TEXT' && onReaction && (
                <ReactionPicker
                  onSelect={handleReaction}
                  myReactions={myReactions}
                  position="above"
                />
              )}
            </div>

            {/* Reactions Summary */}
            {reactions.length > 0 && (
              <ReactionSummary
                reactions={reactions}
                onToggle={handleReaction}
              />
            )}

            {/* Retry button for failed messages */}
            {status === 'FAILED' && onRetry && (
              <button
                onClick={() => onRetry(msgId)}
                className="mt-2 text-xs bg-background-tertiary hover:bg-white/30 px-2 py-1 rounded-full transition-colors"
              >
                Tap to retry
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onCopy={handleCopy}
            onDelete={handleDelete}
            onReport={handleReport}
            onReply={handleReply}
            canDelete={isFromMe}
          />
        )}
      </AnimatePresence>

      {/* Image Fullscreen Preview */}
      <AnimatePresence>
        {fullscreenImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setFullscreenImage(null)}
          >
            <button
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-[61]"
              onClick={() => setFullscreenImage(null)}
              aria-label="Close preview"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={fullscreenImage}
              alt="Full size preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ============================================================================
// Memoized Export
// ============================================================================

export const MessageBubble = memo(MessageBubbleComponent);
