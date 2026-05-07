"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { CardVerificationWall } from "@/components/payment/CardVerificationWall";
import {
  ArrowLeft,
  MoreVertical,
  Phone,
  Video,
  Image as ImageIcon,
  Mic,
  Send,
  Smile,
  Sparkles,
  Clock,
  Lock,
  Zap,
  X,
  ShieldAlert,
  Ban,
  ChevronRight,
  Circle,
  Bot,
  User,
  RefreshCw,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { isBrokenAvatarUrl, getAvatarKind, parseEmojiAvatar, handleAvatarError } from "@/lib/avatar-utils";
import { ReportModal } from "@/components/chat/report-modal";
import { QUICK_REPLIES, AI_SUGGESTIONS } from "@/constants";

// ══════════════════════════════════════
// EMOJI LIST
// ══════════════════════════════════════

const EMOJIS = [
  "😀", "😂", "🥰", "😍", "😘", "😊", "😉", "🤔",
  "😎", "🥳", "😏", "😌", "😢", "😭", "😤", "😡",
  "❤️", "💕", "💖", "💗", "💝", "💘", "🔥", "✨",
  "🌹", "🌸", "🌺", "🌻", "🌙", "⭐", "☀️", "🌈",
];

// ══════════════════════════════════════
// MESSAGE INTERFACE
// ══════════════════════════════════════

interface Message {
  id: string;
  content: string;
  senderId: string;
  sender?: {
    id: string;
    name: string;
    avatar: string | null;
    isBot?: boolean;
    isSelf?: boolean;
  };
  createdAt: string;
  type?: "text" | "image" | "voice";
  metadata?: any;
}

interface RoomInfo {
  id: string;
  otherUser: {
    id: string;
    name: string;
    avatar: string | null;
    isOnline?: boolean;
    lastSeen?: string;
    isBot?: boolean;
  };
  isVault?: boolean;
  vaultExpiresAt?: string;
}

interface UserLimits {
  isPremium: boolean;
  maxChats: number;
  currentChats: number;
  messagesSent: number;
  messagesRemaining: number;
}

/** Reusable inline avatar — replaces 4 duplicate avatar rendering blocks */
function InlineAvatar({ avatar, name, className = "", emojiSize }: {
  avatar: string | null | undefined;
  name: string | undefined;
  className?: string;
  emojiSize?: string;
}) {
  const kind = getAvatarKind(avatar);
  const parsed = parseEmojiAvatar(avatar);

  if (kind === 'emoji' && parsed) {
    return (
      <div className={`w-full h-full bg-gradient-to-br from-amber-500/80 to-rose-500/80 flex items-center justify-center ${className}`}>
        <span className="select-none leading-none" style={{ fontSize: emojiSize || 'clamp(0.9rem, 180%, 1.8rem)', lineHeight: '1' }}>
          {parsed.emoji}
        </span>
      </div>
    );
  }

  if (kind === 'photo' || kind === 'svg') {
    const safeUrl = isBrokenAvatarUrl(avatar) ? null : avatar;
    if (safeUrl) {
      return (
        <img
          src={safeUrl}
          alt={name || "User"}
          className={`w-full h-full ${kind === 'svg' ? 'object-contain p-3' : 'object-cover'} ${className}`}
          onError={handleAvatarError}
        />
      );
    }
  }

  // Fallback: initials
  return (
    <div className={`w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground font-bold ${className}`}>
      {name?.[0] || "?"}
    </div>
  );
}

export default function ChatRoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(true);
  const [userLimits, setUserLimits] = useState<UserLimits | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showCardVerificationModal, setShowCardVerificationModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [isBotTyping, setIsBotTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const hasInitialLoaded = useRef(false);

  // Stable reference that always enriches with current roomInfo
  const loadMessagesWithAvatar = useCallback(() => loadMessages(), [roomId, roomInfo?.otherUser?.avatar]);

  // Load room info and messages — load roomInfo first, then messages with avatar context
  // Use ref to prevent circular re-triggering: loadRoomInfo updates roomInfo,
  // which changes loadMessagesWithAvatar deps, which re-triggers this effect.
  useEffect(() => {
    if (roomId && !hasInitialLoaded.current) {
      setLoading(true);
      hasInitialLoaded.current = true; // Prevent re-entry on subsequent renders
      loadRoomInfo().then(() => {
        return loadMessagesWithAvatar();
      }).finally(() => {
        setLoading(false);
      });
      loadUserLimits();
    }
  }, [roomId, loadMessagesWithAvatar]);

  // Optimized polling: Check for new messages every 5 seconds (reduced from 3s)
  // Use incremental loading with cursor-based pagination for efficiency
  useEffect(() => {
    if (!roomId) return;

    // Adaptive polling: 5s when active, pause when tab is hidden
    let intervalId: ReturnType<typeof setInterval>;
    let isVisible = true;

    const handleVisibility = () => {
      isVisible = !document.hidden;
      if (isVisible) {
        // Tab became visible - immediately check for new messages
        loadMessagesWithAvatar();
        startPolling();
      } else {
        stopPolling();
      }
    };

    const startPolling = () => {
      stopPolling();
      intervalId = setInterval(() => {
        if (isVisible) loadMessagesWithAvatar();
      }, 5000);
    };

    const stopPolling = () => {
      if (intervalId) clearInterval(intervalId);
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [roomId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadRoomInfo = async () => {
    try {
      // Try legacy ChatRoom API first (for old chat rooms)
      let res = await fetch(`/api/chat/${roomId}`);
      if (res.ok) {
        const data = await res.json();
        console.log('[Chat] Room info loaded (legacy):', data);
        setRoomInfo(data.room || data);
        return;
      }

      // Fallback: use IM v2 conversations API to find this conversation
      console.log('[Chat] Legacy API failed, trying IM conversations API for:', roomId);
      res = await fetch('/api/im/conversations?limit=100');
      if (!res.ok) {
        throw new Error(`Failed to load room info: ${res.status}`);
      }
      const convData = await res.json();
      const conv = convData.conversations?.find((c: any) => c.id === roomId);
      if (conv?.otherUser) {
        console.log('[Chat] Room info loaded (IM v2):', conv);
        setRoomInfo({
          id: roomId,
          otherUser: {
            id: conv.otherUser.id,
            name: conv.otherUser.name || 'Unknown',
            avatar: conv.otherUser.avatar || null,
            isOnline: conv.otherUser.presence === 'ONLINE',
            isBot: conv.otherUser.isBot || false,
            lastSeen: undefined,
          },
          isVault: false,
          vaultExpiresAt: undefined,
        });
        return;
      }

      // Last resort: query messages API which supports both systems
      console.log('[Chat] Conversation not in list, trying messages API...');
      const msgRes = await fetch(`/api/chat/${roomId}/messages?limit=1`);
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        const msgs = msgData.messages || [];
        if (msgs.length > 0 && msgs[0].sender && !msgs[0].sender.isSelf) {
          console.log('[Chat] Room info inferred from messages:', msgs[0].sender);
          setRoomInfo({
            id: roomId,
            otherUser: {
              id: msgs[0].sender.id,
              name: msgs[0].sender.name || 'Unknown',
              avatar: msgs[0].sender.avatar || null,
              isBot: msgs[0].sender.isBot || false,
              lastSeen: undefined,
            },
            isVault: false,
            vaultExpiresAt: undefined,
          });
          return;
        }
      }

      console.warn('[Chat] Could not determine room info for:', roomId);
    } catch (e) {
      console.error("[Chat] Failed to load chat room:", e);
      toast.error("Failed to load chat room");
    }
  };

  const loadMessages = async () => {
    try {
      const res = await fetch(`/api/chat/${roomId}/messages`);
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        console.error('[Chat] Messages API error:', res.status, errText);
        throw new Error(`Failed to load messages: ${res.status}`);
      }
      const data = await res.json();
      console.log('[Chat] Messages loaded:', data.messages?.length || 0, 'messages');
      
      // Handle both old and new API response formats
      const msgs = data.messages || data;
      if (Array.isArray(msgs)) {
        // Ensure every message from the other user has avatar from roomInfo
        const enrichedMsgs = msgs.map((msg: Message) => {
          if (!msg.sender && roomInfo?.otherUser) {
            return {
              ...msg,
              sender: {
                id: msg.senderId,
                name: roomInfo.otherUser.name,
                avatar: roomInfo.otherUser.avatar,
                isBot: roomInfo.otherUser.isBot,
                isSelf: false,
              },
            };
          }
          // Patch avatar if missing on non-self messages
          if (msg.sender && !msg.sender.avatar && !msg.sender.isSelf && roomInfo?.otherUser?.avatar) {
            return {
              ...msg,
              sender: { ...msg.sender, avatar: roomInfo.otherUser.avatar },
            };
          }
          return msg;
        });
        setMessages(enrichedMsgs);
        // Extract current user ID from first message if available
        if (msgs.length > 0 && msgs[0].sender) {
          const selfMsg = msgs.find((m: Message) => m.sender?.isSelf);
          if (selfMsg) {
            setCurrentUserId(selfMsg.sender.id);
          }
        }
      }
    } catch (e) {
      console.error("[Chat] Failed to load messages:", e);
    }
  };

  const loadUserLimits = async () => {
    try {
      const res = await fetch("/api/user/limits");
      if (res.ok) {
        const data = await res.json();
        setUserLimits(data);
      }
    } catch (e) {
      console.error("Failed to load user limits", e);
    }
  };

  const handleSend = async (content: string = newMessage) => {
    if (!content.trim() || sending) return;

    // Check free user limits
    if (userLimits && !userLimits.isPremium && userLimits.messagesRemaining <= 0) {
      setShowUpgradeModal(true);
      return;
    }

    setSending(true);
    setNewMessage("");
    setShowQuickReplies(false);
    setShowEmojiPicker(false);

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      content,
      senderId: "me",
      sender: {
        id: currentUserId || "me",
        name: "You",
        avatar: null,
        isBot: false,
      },
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMessage]);

    try {
      console.log('[Chat] Sending message to room:', roomId);
      const res = await fetch(`/api/chat/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      console.log('[Chat] Send response status:', res.status);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('[Chat] Send error:', errData);
        if (res.status === 403 && errData.code === "CARD_VERIFICATION_REQUIRED") {
          setShowCardVerificationModal(true);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
        if (res.status === 403 && errData.code === "UPGRADE_REQUIRED") {
          setShowUpgradeModal(true);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
        throw new Error(errData.message || "Failed to send");
      }

      const data = await res.json();
      console.log('[Chat] Message sent successfully:', data);

      // Replace temp message with real one
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? data.message : m))
      );

      // Update limits
      if (userLimits) {
        setUserLimits({
          ...userLimits,
          messagesSent: userLimits.messagesSent + 1,
          messagesRemaining: Math.max(0, userLimits.messagesRemaining - 1),
        });
      }

      // Trigger Bot response with typing indicator + 2s delay (simulate real human behavior)
      if (roomInfo?.otherUser?.isBot) {
        console.log('[Chat] Bot conversation detected, showing typing indicator then refreshing for reply');
        // Show typing indicator immediately
        setIsBotTyping(true);
        // Wait 2 seconds before polling for the bot reply (simulate real person reading + typing)
        setTimeout(() => {
          setIsBotTyping(false);
          loadMessagesWithAvatar();
        }, 2000);
      }
    } catch (e) {
      console.error('[Chat] Failed to send:', e);
      toast.error("Failed to send message");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const handleBlockUser = async () => {
    if (!roomInfo?.otherUser?.id) return;
    const confirmed = window.confirm(
      `Block ${roomInfo.otherUser.name}?\n\nThey won't be able to see or message you, and you won't see them.`
    );
    if (!confirmed) return;
    setIsBlocking(true);
    try {
      const res = await fetch(`/api/users/${roomInfo.otherUser.id}/block`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success(`${roomInfo.otherUser.name} has been blocked`);
        setShowMoreMenu(false);
        window.location.href = "/dashboard/chat";
      } else {
        toast.error("Failed to block user");
      }
    } catch (e) {
      toast.error("Failed to block user");
    } finally {
      setIsBlocking(false);
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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

  // Determine if a message is from the current user
  const isMessageFromMe = (msg: Message): boolean => {
    if (msg.sender?.isSelf) return true;
    if (msg.senderId === currentUserId) return true;
    if (msg.senderId === "me") return true;
    return false;
  };

  // Determine if a message is from a bot
  const isMessageFromBot = (msg: Message): boolean => {
    if (msg.sender?.isBot) return true;
    if (msg.senderId?.startsWith("bot-") || msg.senderId?.startsWith("bot_")) return true;
    if (msg.senderId === roomInfo?.otherUser?.id && roomInfo?.otherUser?.isBot) return true;
    return false;
  };

  // ═══════════════════════════════════════════════════════
  // LOADING STATE
  // ═══════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-foreground-muted">Loading conversation...</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* ═══════════════════════════════════════════════════════
          CHAT HEADER
          ═══════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between px-4 py-3 bg-background-secondary border-b border-card-border">
        <div className="flex items-center gap-3">
          {/* Back Button (Mobile) */}
          <Link
            href="/dashboard/chat"
            className="md:hidden p-2 -ml-2 rounded-full hover:bg-background-tertiary"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </Link>

          {/* Avatar with Online Status */}
          <div className="relative">
            <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center">
              <InlineAvatar avatar={roomInfo?.otherUser?.avatar} name={roomInfo?.otherUser?.name} emojiSize="clamp(1rem, 200%, 2rem)" />
            </div>
            {/* Online Status */}
            {roomInfo?.otherUser?.isOnline ? (
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background-secondary" />
            ) : (
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-foreground-muted/40 rounded-full border-2 border-background-secondary" />
            )}

          </div>

          {/* User Info */}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-sm">
                {roomInfo?.otherUser?.name || "Unknown"}
              </h3>

            </div>
            <p className="text-xs text-foreground-muted">
              {roomInfo?.otherUser?.isOnline 
                ? "Online" 
                : formatLastSeen(roomInfo?.otherUser?.lastSeen)
              }
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1">
          <button className="p-2 rounded-full hover:bg-background-tertiary transition-colors">
            <Phone className="w-5 h-5 text-foreground-muted" />
          </button>
          <button className="p-2 rounded-full hover:bg-background-tertiary transition-colors">
            <Video className="w-5 h-5 text-foreground-muted" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 rounded-full hover:bg-background-tertiary transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-foreground-muted" />
            </button>

            {/* More Menu Dropdown */}
            <AnimatePresence>
              {showMoreMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-background-tertiary rounded-xl border border-card-border shadow-xl z-50"
                >
                  <button
                    onClick={() => {
                      setShowReportModal(true);
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-background-tertiary flex items-center gap-2"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Report User
                  </button>
                  <button
                    onClick={handleBlockUser}
                    disabled={isBlocking}
                    className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-background-tertiary flex items-center gap-2"
                  >
                    <Ban className="w-4 h-4" />
                    {isBlocking ? "Blocking..." : "Block User"}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          VAULT BANNER (if applicable)
          ═══════════════════════════════════════════════════════ */}
      {roomInfo?.isVault && (
        <div className="bg-gradient-to-r from-primary/20 to-secondary/20 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <span className="text-sm text-foreground">
              Vault Chat - Exchange contacts to unlock
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm text-primary">
            <Clock className="w-4 h-4" />
            <span>48h</span>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          MESSAGES AREA
          ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-background-tertiary flex items-center justify-center mb-4">
              {(roomInfo?.otherUser?.isBot) ? (
                <Bot className="w-8 h-8 text-orange-400" />
              ) : (
                <Sparkles className="w-8 h-8 text-foreground-subtle" />
              )}
            </div>
            <p className="text-foreground-muted mb-2">
              {(roomInfo?.otherUser?.isBot)
                ? `Start chatting with ${roomInfo?.otherUser?.name || "them"}`
                : "No messages yet"
              }
            </p>
            <p className="text-foreground-subtle text-sm">
              {(roomInfo?.otherUser?.isBot)
                ? "Say hello and start the conversation!"
                : "Start the conversation!"
              }
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const fromMe = isMessageFromMe(msg);
            const fromBot = isMessageFromBot(msg);
            const showAvatar = !fromMe && (index === 0 || isMessageFromMe(messages[index - 1]));

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${fromMe ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex items-end gap-2 max-w-[80%] ${fromMe ? "flex-row-reverse" : ""}`}>
                  {/* Avatar (only show for first message in group) */}
                  {!fromMe && showAvatar && (
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 relative">
                      {roomInfo?.otherUser?.avatar && !isBrokenAvatarUrl(roomInfo.otherUser.avatar) ? (
                        roomInfo.otherUser.avatar.startsWith("emoji:") ? (
                          <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                            <span
                              className="select-none leading-none"
                              style={{
                                fontSize: 'clamp(0.9rem, 180%, 1.8rem)',
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
                            onError={(e) => { e.currentTarget.style.display = 'none'; const p = e.currentTarget.parentElement; if (p) { const fb = document.createElement('div'); fb.className = 'w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground text-xs font-bold'; fb.textContent = roomInfo?.otherUser?.name?.[0] || '?'; p.appendChild(fb); } }}
                          />
                        )
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground text-xs font-bold">
                          {roomInfo?.otherUser?.name?.[0] || "?"}
                        </div>
                      )}
                      {/* Bot indicator on avatar */}
                      {fromBot && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-orange-500 rounded-full flex items-center justify-center">
                          <Bot className="w-2 h-2 text-foreground" />
                        </div>
                      )}
                    </div>
                  )}
                  {!fromMe && !showAvatar && <div className="w-8" />}

                  {/* Message Bubble */}
                  <div
                    className={`px-4 py-2.5 rounded-2xl max-w-[75%] ${
                      fromMe
                        ? "bg-gradient-to-br from-purple-700/90 to-purple-600/90 text-foreground rounded-br-md"
                        : fromBot
                        ? "bg-purple-900/30 text-foreground rounded-bl-md border border-purple-500/10"
                        : "bg-primary/10 text-foreground rounded-bl-md"
                    }`}
                  >

                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [word-break:break-word]">{msg.content}</p>
                    <p className={`text-xs mt-1 ${fromMe ? "text-foreground-muted" : "text-foreground-muted"}`}>
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
        {/* Bot typing indicator */}
        <AnimatePresence>
          {isBotTyping && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="flex items-center gap-2.5 px-4 py-2"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 relative">
                {roomInfo?.otherUser?.avatar && !isBrokenAvatarUrl(roomInfo.otherUser.avatar) ? (
                  roomInfo.otherUser.avatar.startsWith("emoji:") ? (
                    <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                      <span className="select-none leading-none" style={{ fontSize: 'clamp(0.9rem, 180%, 1.8rem)' }}>
                        {roomInfo.otherUser.avatar.split(":")[1]}
                      </span>
                    </div>
                  ) : (
                    <img src={roomInfo.otherUser.avatar} alt="" className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground text-xs font-bold">
                    {roomInfo?.otherUser?.name?.[0] || "?"}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 bg-purple-900/30 rounded-2xl px-4 py-2.5 border border-purple-500/10">
                <div className="flex items-center gap-[3px]">
                  <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.4s" }} />
                  <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1.4s" }} />
                  <span className="w-[5px] h-[5px] bg-foreground-muted rounded-full animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1.4s" }} />
                </div>
                <span className="text-[11px] text-foreground-subtle">typing...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* ═══════════════════════════════════════════════════════
          AI SUGGESTIONS
          ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showAiSuggestions && messages.length < 3 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="px-4 py-2 bg-background-secondary border-t border-card-border"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs text-foreground-muted">AI Suggestions</span>
              <button
                onClick={() => setShowAiSuggestions(false)}
                className="ml-auto text-foreground-subtle hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {AI_SUGGESTIONS.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(suggestion)}
                  className="flex-shrink-0 px-3 py-1.5 bg-background-tertiary hover:bg-background-tertiary rounded-full text-xs text-foreground transition-colors whitespace-nowrap"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          QUICK REPLIES
          ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showQuickReplies && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-2 bg-background-secondary border-t border-card-border"
          >
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {QUICK_REPLIES.map((reply, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(reply)}
                  className="flex-shrink-0 px-3 py-1.5 bg-background-tertiary hover:bg-background-tertiary rounded-full text-xs text-foreground transition-colors whitespace-nowrap"
                >
                  {reply}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          EMOJI PICKER
          ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showEmojiPicker && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-3 bg-background-secondary border-t border-card-border"
          >
            <div className="grid grid-cols-8 gap-2">
              {EMOJIS.map((emoji, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setNewMessage((prev) => prev + emoji);
                    inputRef.current?.focus();
                  }}
                  className="text-2xl hover:bg-background-tertiary rounded-lg p-1 transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════
          INPUT AREA
          ═══════════════════════════════════════════════════════ */}
      <div className="p-3 bg-background-secondary border-t border-card-border">
        <div className="flex items-center gap-2">
          {/* Emoji Button */}
          <button
            onClick={() => {
              setShowEmojiPicker(!showEmojiPicker);
              setShowQuickReplies(false);
            }}
            className={`p-2 rounded-full transition-colors ${
              showEmojiPicker ? "bg-primary/20 text-primary" : "hover:bg-background-tertiary text-foreground-muted"
            }`}
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* Image Send Button */}
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={sendingImage}
            className="p-2 rounded-full hover:bg-background-tertiary text-foreground-muted transition-colors disabled:opacity-30"
          >
            {sendingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!file.type.startsWith("image/")) {
                toast.error("Please select an image file");
                return;
              }
              if (file.size > 5 * 1024 * 1024) {
                toast.error("Image must be under 5MB");
                return;
              }
              setSendingImage(true);
              try {
                const formData = new FormData();
                formData.append("file", file);
                const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
                if (!uploadRes.ok) throw new Error("Upload failed");
                const uploadData = await uploadRes.json();
                const imageUrl = uploadData.url || uploadData.imageUrl;
                if (imageUrl) {
                  await fetch(`/api/chat/${roomId}/messages`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: imageUrl, type: "IMAGE" }),
                  });
                  loadMessagesWithAvatar();
                }
              } catch {
                toast.error("Failed to send image");
              } finally {
                setSendingImage(false);
                e.target.value = "";
              }
            }}
          />

          {/* Quick Replies Button */}
          <button
            onClick={() => {
              setShowQuickReplies(!showQuickReplies);
              setShowEmojiPicker(false);
            }}
            className={`p-2 rounded-full transition-colors ${
              showQuickReplies ? "bg-primary/20 text-primary" : "hover:bg-background-tertiary text-foreground-muted"
            }`}
          >
            <Zap className="w-5 h-5" />
          </button>

          {/* Text Input */}
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message..."
              className="w-full bg-background-tertiary text-foreground placeholder:text-foreground-subtle rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Voice / Send Button */}
          {newMessage.trim() ? (
            <button
              onClick={() => handleSend()}
              disabled={sending}
              className="p-2 rounded-full bg-primary hover:bg-primary-hover text-foreground transition-colors disabled:opacity-50"
            >
              {sending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          ) : (
            <button className="p-2 rounded-full hover:bg-background-tertiary text-foreground-muted transition-colors">
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Free User Limit Warning */}
        {userLimits && !userLimits.isPremium && userLimits.messagesRemaining <= 5 && (
          <div className="mt-2 text-center">
            <p className="text-xs text-foreground-muted">
              {userLimits.messagesRemaining} free messages remaining.{" "}
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="text-primary hover:underline"
              >
                Upgrade
              </button>
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          UPGRADE MODAL
          ═══════════════════════════════════════════════════════ */}
      {/* Card Verification Modal */}
      {showCardVerificationModal && (
        <CardVerificationWall
          variant="modal"
          title="Verify Your Card to Continue"
          description="Verify your card to keep chatting — identity check only, no charges."
          onSuccess={() => {
            setShowCardVerificationModal(false);
            toast.success("Card verified! You can now send messages.");
          }}
        />
      )}

      <AnimatePresence>
        {showUpgradeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background-tertiary rounded-2xl p-6 max-w-sm w-full border border-card-border"
            >
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">
                  Upgrade to Premium
                </h3>
                <p className="text-foreground-muted text-sm mb-6">
                  You&apos;ve used all your free messages. Upgrade to unlock unlimited messaging and more features.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowUpgradeModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-background-tertiary hover:bg-background-tertiary text-foreground transition-colors"
                  >
                    Maybe Later
                  </button>
                  <button
                    onClick={() => {
                      setShowUpgradeModal(false);
                      window.location.href = "/dashboard/settings/billing";
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-foreground transition-colors"
                  >
                    Upgrade
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click outside to close menus */}
      {(showMoreMenu || showEmojiPicker || showQuickReplies) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowMoreMenu(false);
            setShowEmojiPicker(false);
            setShowQuickReplies(false);
          }}
        />
      )}

      {/* Report Modal */}
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        reportedUserId={roomInfo?.otherUser?.id || ""}
        reportedUserName={roomInfo?.otherUser?.name || "User"}
        chatRoomId={roomId}
      />
    </div>
  );
}
