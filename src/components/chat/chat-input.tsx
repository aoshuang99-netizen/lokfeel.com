"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Smile, Image, Mic, Sparkles, X, Reply } from "lucide-react";
import type { IMMessagePayload } from "@/lib/im/types";

interface ChatInputProps {
  onSend: (message: string, quotedMsgId?: string) => void;
  onImageSend?: (imageUrl: string) => void;
  onTyping?: (isTyping: boolean) => void;
  isSending?: boolean;
  disabled?: boolean;
  /** 当前引用的消息 */
  quotedMessage?: {
    id: string;
    content: string;
    senderName?: string;
  } | null;
  /** 取消引用回调 */
  onCancelQuote?: () => void;
}

// 常用表情包
const EMOJIS = [
  "😊", "😂", "❤️", "👍", "🔥", "😍", "🎉", "🤔",
  "😅", "😭", "🥰", "😎", "🙏", "👏", "💪", "✨",
  "🌟", "💕", "😘", "🤗", "😋", "🤩", "😏", "🥳",
  "🎈", "🌈", "☀️", "🌙", "⭐", "💫", "🌺", "🌸",
];

// 快捷回复 - 更自然对话化的建议
const QUICK_REPLIES = [
  "Hey! 👋",
  "How's your day?",
  "That's interesting",
  "Tell me more!",
  "Sounds great 😊",
  "What are you into?",
];

export function ChatInput({
  onSend,
  onImageSend,
  onTyping,
  isSending = false,
  disabled = false,
  quotedMessage,
  onCancelQuote,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Focus input when quoted message changes
  useEffect(() => {
    if (quotedMessage) {
      inputRef.current?.focus();
    }
  }, [quotedMessage]);

  // Handle typing indicator
  const handleTyping = (value: string) => {
    setMessage(value);
    
    if (onTyping) {
      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Send typing start
      onTyping(true);
      
      // Send typing stop after 2 seconds of no input
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 2000);
    }
  };

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!message.trim() || isSending || disabled) return;
    
    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      onTyping?.(false);
    }
    
    // Send with quoted message ID if present
    onSend(message.trim(), quotedMessage?.id);
    setMessage("");
    setShowEmojiPicker(false);
    setShowQuickReplies(false);
    onCancelQuote?.();
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessage((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isUploading || disabled) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "image");

      const res = await fetch("/api/upload", {
        method: "PUT",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      const imageUrl = data.data?.url;

      if (imageUrl && onImageSend) {
        onImageSend(imageUrl);
      }
    } catch {
      // Silently fail — don't disrupt UX
    } finally {
      setIsUploading(false);
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleQuickReply = (reply: string) => {
    onSend(reply, quotedMessage?.id);
    setShowQuickReplies(false);
    onCancelQuote?.();
  };

  return (
    <div className="relative px-3 pb-3 pt-1">
      {/* 快捷回复面板 */}
      <AnimatePresence>
        {showQuickReplies && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            className="absolute bottom-full left-3 right-3 mb-2 p-3 bg-background-tertiary/95 backdrop-blur-lg rounded-xl border border-card-border/[0.06]"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400/70" />
              <span className="text-[11px] text-foreground-subtle font-medium">Quick replies</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REPLIES.map((reply, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickReply(reply)}
                  className="px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-foreground-muted hover:text-foreground/90 text-[13px] transition-all duration-200 border border-card-border/[0.04] hover:border-card-border/[0.08]"
                >
                  {reply}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 表情面板 */}
      <AnimatePresence>
        {showEmojiPicker && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            className="absolute bottom-full left-3 right-3 mb-2 p-3 bg-background-tertiary/95 backdrop-blur-lg rounded-xl border border-card-border/[0.06]"
          >
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map((emoji, idx) => (
                <button
                  key={idx}
                  onClick={() => handleEmojiSelect(emoji)}
                  className="w-8 h-8 flex items-center justify-center text-lg hover:bg-white/[0.06] rounded-lg transition-colors duration-150"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 引用回复预览 */}
      <AnimatePresence>
        {quotedMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-card-border/[0.06] flex items-center gap-2"
          >
            <Reply className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-foreground-subtle mb-0.5">
                Reply to {quotedMessage.senderName || 'message'}
              </p>
              <p className="text-[13px] text-foreground-muted truncate">
                {quotedMessage.content}
              </p>
            </div>
            <button
              onClick={onCancelQuote}
              className="p-1 rounded-full hover:bg-white/[0.06] text-foreground-subtle hover:text-foreground-muted transition-colors duration-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 输入框 */}
      <form onSubmit={handleSend} className="flex items-center gap-1.5 bg-white/[0.04] backdrop-blur-lg border border-card-border/[0.06] rounded-2xl px-2 py-1.5">
        {/* 快捷回复按钮 */}
        <button
          type="button"
          onClick={() => {
            setShowQuickReplies(!showQuickReplies);
            setShowEmojiPicker(false);
          }}
          className={`p-2 rounded-xl transition-all duration-200 ${
            showQuickReplies ? "bg-amber-500/15 text-amber-400" : "text-foreground-faint hover:text-foreground-muted hover:bg-white/[0.04]"
          }`}
          aria-label="Quick replies"
        >
          <Sparkles className="w-[18px] h-[18px]" />
        </button>

        {/* 表情按钮 */}
        <button
          type="button"
          onClick={() => {
            setShowEmojiPicker(!showEmojiPicker);
            setShowQuickReplies(false);
          }}
          className={`p-2 rounded-xl transition-all duration-200 ${
            showEmojiPicker ? "bg-amber-500/15 text-amber-400" : "text-foreground-faint hover:text-foreground-muted hover:bg-white/[0.04]"
          }`}
          aria-label="Emoji"
        >
          <Smile className="w-[18px] h-[18px]" />
        </button>

        {/* 图片上传按钮 */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`p-2 rounded-xl transition-all duration-200 ${
            isUploading ? "bg-accent-lime/15 text-accent-lime animate-pulse" : "text-foreground-faint hover:text-foreground-muted hover:bg-white/[0.04]"
          }`}
          aria-label="Send image"
          disabled={isUploading || disabled}
        >
          <Image className="w-[18px] h-[18px]" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleImageSelect}
        />

        {/* 输入框 */}
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => handleTyping(e.target.value)}
          placeholder={disabled ? "Chat unavailable" : "Say something..."}
          className="flex-1 bg-transparent text-foreground placeholder:text-foreground-faint outline-none text-[15px] min-w-0"
          disabled={isSending || disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />

        {/* 发送按钮 */}
        <motion.button
          type="submit"
          disabled={!message.trim() || isSending || disabled}
          whileTap={{ scale: 0.92 }}
          className={`p-2.5 rounded-xl transition-all duration-200 ${
            message.trim() && !isSending && !disabled
              ? "bg-gradient-to-br from-amber-600 to-amber-500 text-foreground shadow-lg shadow-amber-600/20"
              : "bg-white/[0.04] text-foreground-faint"
          }`}
        >
          {isSending ? (
            <div className="w-[18px] h-[18px] border-2 border-card-border border-t-white rounded-full animate-spin" />
          ) : (
            <Send className="w-[18px] h-[18px]" />
          )}
        </motion.button>
      </form>
    </div>
  );
}
