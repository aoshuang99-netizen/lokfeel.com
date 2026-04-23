"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
} from "lucide-react";
import Link from "next/link";

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
// QUICK REPLIES
// ══════════════════════════════════════

const QUICK_REPLIES = [
  "Hey! How are you? 😊",
  "That's interesting! Tell me more",
  "I'd love to meet up sometime",
  "What's your ideal date?",
  "You have a great smile!",
  "What are you looking for?",
  "Want to grab coffee? ☕",
  "Tell me about yourself",
];

// ══════════════════════════════════════
// AI SUGGESTIONS
// ══════════════════════════════════════

const AI_SUGGESTIONS = [
  "Ask about their weekend plans",
  "Compliment something specific in their profile",
  "Share a fun fact about yourself",
  "Ask what they're passionate about",
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
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load room info and messages
  useEffect(() => {
    if (roomId) {
      console.log('[Chat] Loading room:', roomId);
      setLoading(true);
      Promise.all([
        loadRoomInfo(),
        loadMessages(),
        loadUserLimits(),
      ]).finally(() => {
        setLoading(false);
      });
    }
  }, [roomId]);

  // Poll for new messages every 3 seconds
  useEffect(() => {
    if (!roomId) return;
    
    const interval = setInterval(() => {
      loadMessages();
    }, 3000);

    return () => clearInterval(interval);
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
      const res = await fetch(`/api/chat/${roomId}`);
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        console.error('[Chat] Room API error:', res.status, errText);
        throw new Error(`Failed to load room: ${res.status}`);
      }
      const data = await res.json();
      console.log('[Chat] Room info loaded:', data);
      setRoomInfo(data.room || data);
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
        setMessages(msgs);
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

      // Trigger AI response if this is a bot conversation
      // Bot replies are now handled server-side in the API, but we also
      // trigger a client-side refresh to show the bot's reply
      if (roomInfo?.otherUser?.isBot) {
        console.log('[Chat] Bot conversation detected, will refresh for reply');
        // Poll for bot reply after a short delay
        setTimeout(() => loadMessages(), 2000);
      }
    } catch (e) {
      console.error('[Chat] Failed to send:', e);
      toast.error("Failed to send message");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const triggerAiResponse = async () => {
    try {
      console.log('[Chat] Triggering AI response for room:', roomId);
      const res = await fetch(`/api/bot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      
      if (res.ok) {
        const data = await res.json();
        console.log('[Chat] AI response received:', data);
        if (data.message) {
          // Add AI message to chat
          const aiMessage: Message = {
            id: data.message.id,
            content: data.message.content,
            senderId: roomInfo?.otherUser?.id || "bot",
            sender: {
              id: roomInfo?.otherUser?.id || "bot",
              name: roomInfo?.otherUser?.name || "AI",
              avatar: roomInfo?.otherUser?.avatar || null,
              isBot: true,
            },
            createdAt: data.message.createdAt,
          };
          setMessages((prev) => [...prev, aiMessage]);
        }
      } else {
        console.error('[Chat] AI response failed:', res.status);
      }
    } catch (e) {
      console.error('[Chat] Failed to trigger AI response:', e);
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
    if (msg.senderId?.startsWith("bot-")) return true;
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
          <p className="text-white/60">Loading conversation...</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0c11]">
      {/* ═══════════════════════════════════════════════════════
          CHAT HEADER
          ═══════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#13121a] border-b border-white/10">
        <div className="flex items-center gap-3">
          {/* Back Button (Mobile) */}
          <Link
            href="/dashboard/chat"
            className="md:hidden p-2 -ml-2 rounded-full hover:bg-white/10"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </Link>

          {/* Avatar with Online Status */}
          <div className="relative">
            <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center">
              {roomInfo?.otherUser?.avatar ? (
                roomInfo.otherUser.avatar.startsWith("emoji:") ? (
                  <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
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
                <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold">
                  {roomInfo?.otherUser?.name?.[0] || "?"}
                </div>
              )}
            </div>
            {/* Online Status */}
            {roomInfo?.otherUser?.isOnline ? (
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#13121a]" />
            ) : (
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-gray-500 rounded-full border-2 border-[#13121a]" />
            )}
            {/* Bot Badge */}
            {(roomInfo?.otherUser?.isBot || roomInfo?.otherUser?.id?.startsWith("bot-")) && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center border-2 border-[#13121a]">
                <Bot className="w-3 h-3 text-white" />
              </div>
            )}
          </div>

          {/* User Info */}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white text-sm">
                {roomInfo?.otherUser?.name || "Unknown"}
              </h3>
              {(roomInfo?.otherUser?.isBot || roomInfo?.otherUser?.id?.startsWith("bot-")) && (
                <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] rounded-full">
                  AI
                </span>
              )}
            </div>
            <p className="text-xs text-white/50">
              {roomInfo?.otherUser?.isOnline 
                ? "Online" 
                : formatLastSeen(roomInfo?.otherUser?.lastSeen)
              }
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
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-white/60" />
            </button>

            {/* More Menu Dropdown */}
            <AnimatePresence>
              {showMoreMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-[#1a1926] rounded-xl border border-white/10 shadow-xl z-50"
                >
                  <button
                    onClick={() => {
                      setShowReportModal(true);
                      setShowMoreMenu(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-white/80 hover:bg-white/5 flex items-center gap-2"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Report User
                  </button>
                  <button
                    onClick={handleBlockUser}
                    disabled={isBlocking}
                    className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-white/5 flex items-center gap-2"
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
            <span className="text-sm text-white/80">
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
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
              {(roomInfo?.otherUser?.isBot || roomInfo?.otherUser?.id?.startsWith("bot-")) ? (
                <Bot className="w-8 h-8 text-purple-400" />
              ) : (
                <Sparkles className="w-8 h-8 text-white/30" />
              )}
            </div>
            <p className="text-white/60 mb-2">
              {(roomInfo?.otherUser?.isBot || roomInfo?.otherUser?.id?.startsWith("bot-"))
                ? `Start chatting with ${roomInfo?.otherUser?.name || "AI"}`
                : "No messages yet"
              }
            </p>
            <p className="text-white/40 text-sm">
              {(roomInfo?.otherUser?.isBot || roomInfo?.otherUser?.id?.startsWith("bot-"))
                ? "AI-powered conversation partner"
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
                      {roomInfo?.otherUser?.avatar ? (
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
                          />
                        )
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-xs font-bold">
                          {roomInfo?.otherUser?.name?.[0] || "?"}
                        </div>
                      )}
                      {/* Bot indicator on avatar */}
                      {fromBot && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-purple-500 rounded-full flex items-center justify-center">
                          <Bot className="w-2 h-2 text-white" />
                        </div>
                      )}
                    </div>
                  )}
                  {!fromMe && !showAvatar && <div className="w-8" />}

                  {/* Message Bubble */}
                  <div
                    className={`px-4 py-2.5 rounded-2xl max-w-[75%] ${
                      fromMe
                        ? "bg-gradient-to-br from-pink-500 to-purple-500 text-white rounded-br-md"
                        : fromBot
                        ? "bg-white/[0.08] text-white/90 rounded-bl-md border border-white/[0.08]"
                        : "bg-white/[0.08] text-white/90 rounded-bl-md"
                    }`}
                  >
                    {/* Bot label */}
                    {fromBot && (
                      <div className="flex items-center gap-1 mb-1.5 opacity-70">
                        <Bot className="w-3 h-3 text-violet-300" />
                        <span className="text-[10px] text-violet-300 font-medium tracking-wide">AI</span>
                      </div>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [word-break:break-word]">{msg.content}</p>
                    <p className={`text-xs mt-1 ${fromMe ? "text-white/70" : "text-white/50"}`}>
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
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
            className="px-4 py-2 bg-[#13121a] border-t border-white/5"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs text-white/60">AI Suggestions</span>
              <button
                onClick={() => setShowAiSuggestions(false)}
                className="ml-auto text-white/40 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {AI_SUGGESTIONS.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(suggestion)}
                  className="flex-shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs text-white/80 transition-colors whitespace-nowrap"
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
            className="px-4 py-2 bg-[#13121a] border-t border-white/5"
          >
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {QUICK_REPLIES.map((reply, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(reply)}
                  className="flex-shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs text-white/80 transition-colors whitespace-nowrap"
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
            className="px-4 py-3 bg-[#13121a] border-t border-white/5"
          >
            <div className="grid grid-cols-8 gap-2">
              {EMOJIS.map((emoji, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setNewMessage((prev) => prev + emoji);
                    inputRef.current?.focus();
                  }}
                  className="text-2xl hover:bg-white/10 rounded-lg p-1 transition-colors"
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
      <div className="p-3 bg-[#13121a] border-t border-white/10">
        <div className="flex items-center gap-2">
          {/* Emoji Button */}
          <button
            onClick={() => {
              setShowEmojiPicker(!showEmojiPicker);
              setShowQuickReplies(false);
            }}
            className={`p-2 rounded-full transition-colors ${
              showEmojiPicker ? "bg-primary/20 text-primary" : "hover:bg-white/10 text-white/60"
            }`}
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* Attachment Button */}
          <button className="p-2 rounded-full hover:bg-white/10 text-white/60 transition-colors">
            <ImageIcon className="w-5 h-5" />
          </button>

          {/* Quick Replies Button */}
          <button
            onClick={() => {
              setShowQuickReplies(!showQuickReplies);
              setShowEmojiPicker(false);
            }}
            className={`p-2 rounded-full transition-colors ${
              showQuickReplies ? "bg-primary/20 text-primary" : "hover:bg-white/10 text-white/60"
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
              className="w-full bg-[#0d0c11] text-white placeholder:text-white/40 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Voice / Send Button */}
          {newMessage.trim() ? (
            <button
              onClick={() => handleSend()}
              disabled={sending}
              className="p-2 rounded-full bg-primary hover:bg-primary-hover text-white transition-colors disabled:opacity-50"
            >
              {sending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          ) : (
            <button className="p-2 rounded-full hover:bg-white/10 text-white/60 transition-colors">
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Free User Limit Warning */}
        {userLimits && !userLimits.isPremium && userLimits.messagesRemaining <= 5 && (
          <div className="mt-2 text-center">
            <p className="text-xs text-white/50">
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
              className="bg-[#1a1926] rounded-2xl p-6 max-w-sm w-full border border-white/10"
            >
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  Upgrade to Premium
                </h3>
                <p className="text-white/60 text-sm mb-6">
                  You&apos;ve used all your free messages. Upgrade to unlock unlimited messaging and more features.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowUpgradeModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white transition-colors"
                  >
                    Maybe Later
                  </button>
                  <button
                    onClick={() => {
                      setShowUpgradeModal(false);
                      window.location.href = "/dashboard/settings/billing";
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white transition-colors"
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
    </div>
  );
}
