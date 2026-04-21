"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Smile, Image, Mic, Sparkles, X, Reply } from "lucide-react";
import type { IMMessagePayload } from "@/lib/im/types";

interface ChatInputProps {
  onSend: (message: string, quotedMsgId?: string) => void;
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

// 快捷回复
const QUICK_REPLIES = [
  "Hi there! 👋",
  "How are you?",
  "That's interesting!",
  "Tell me more",
  "I agree!",
  "What do you like to do?",
  "Sounds great!",
  "Looking forward to it",
];

export function ChatInput({ 
  onSend, 
  onTyping,
  isSending = false, 
  disabled = false,
  quotedMessage,
  onCancelQuote,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const handleQuickReply = (reply: string) => {
    onSend(reply, quotedMessage?.id);
    setShowQuickReplies(false);
    onCancelQuote?.();
  };

  return (
    <div className="relative">
      {/* 快捷回复面板 */}
      <AnimatePresence>
        {showQuickReplies && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 p-3 glass-card border border-white/10"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs text-white/60">Quick Replies</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_REPLIES.map((reply, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickReply(reply)}
                  className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/80 text-sm transition-colors"
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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 p-3 glass-card border border-white/10"
          >
            <div className="grid grid-cols-8 gap-2">
              {EMOJIS.map((emoji, idx) => (
                <button
                  key={idx}
                  onClick={() => handleEmojiSelect(emoji)}
                  className="w-8 h-8 flex items-center justify-center text-xl hover:bg-white/10 rounded-lg transition-colors"
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
            className="mb-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2"
          >
            <Reply className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/50 mb-0.5">
                Reply to {quotedMessage.senderName || 'message'}
              </p>
              <p className="text-sm text-white/70 truncate">
                {quotedMessage.content}
              </p>
            </div>
            <button
              onClick={onCancelQuote}
              className="p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 输入框 */}
      <form onSubmit={handleSend} className="glass-card p-2 flex items-center gap-2">
        {/* 快捷回复按钮 */}
        <button
          type="button"
          onClick={() => {
            setShowQuickReplies(!showQuickReplies);
            setShowEmojiPicker(false);
          }}
          className={`p-2 rounded-lg transition-colors ${
            showQuickReplies ? "bg-primary/20 text-primary" : "text-white/40 hover:text-white/60"
          }`}
        >
          <Sparkles className="w-5 h-5" />
        </button>

        {/* 表情按钮 */}
        <button
          type="button"
          onClick={() => {
            setShowEmojiPicker(!showEmojiPicker);
            setShowQuickReplies(false);
          }}
          className={`p-2 rounded-lg transition-colors ${
            showEmojiPicker ? "bg-primary/20 text-primary" : "text-white/40 hover:text-white/60"
          }`}
        >
          <Smile className="w-5 h-5" />
        </button>

        {/* 图片按钮 */}
        <button
          type="button"
          className="p-2 rounded-lg text-white/40 hover:text-white/60 transition-colors"
          title="Send image (coming soon)"
        >
          <Image className="w-5 h-5" />
        </button>

        {/* 语音按钮 */}
        <button
          type="button"
          className="p-2 rounded-lg text-white/40 hover:text-white/60 transition-colors"
          title="Voice message (coming soon)"
        >
          <Mic className="w-5 h-5" />
        </button>

        {/* 输入框 */}
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => handleTyping(e.target.value)}
          placeholder={disabled ? "Chat unavailable" : "Type a message..."}
          className="flex-1 bg-transparent text-white placeholder:text-white/40 outline-none px-2"
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
          whileTap={{ scale: 0.95 }}
          className="p-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {isSending ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </motion.button>
      </form>
    </div>
  );
}
