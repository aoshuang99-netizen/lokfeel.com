"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Bot } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface TypingIndicatorProps {
  /** 显示打字的用户名 */
  name?: string;
  /** 是否为 AI 打字指示器 */
  isBot?: boolean;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// Typing Indicator Component
// ============================================================================

function TypingIndicatorComponent({ name, isBot = false, className = "" }: TypingIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`flex items-center gap-2 px-4 py-2 ${className}`}
    >
      {/* Avatar placeholder */}
      {isBot ? (
        <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-orange-400" />
        </div>
      ) : (
        <div className="w-8 h-8 rounded-full bg-white/5 flex-shrink-0" />
      )}

      {/* Typing dots */}
      <div className="flex items-center gap-1">
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          className="w-2 h-2 bg-white/40 rounded-full"
        />
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
          className="w-2 h-2 bg-white/40 rounded-full"
        />
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
          className="w-2 h-2 bg-white/40 rounded-full"
        />
      </div>

      {/* Label */}
      <span className="text-xs text-white/50">
        {isBot ? (
          <span className="flex items-center gap-1">
            {name ? `${name} is typing...` : "Typing..."}
          </span>
        ) : (
          name ? `${name} is typing...` : "Typing..."
        )}
      </span>
    </motion.div>
  );
}

// ============================================================================
// Memoized Export
// ============================================================================

export const TypingIndicator = memo(TypingIndicatorComponent);

// ============================================================================
// Alternative Simple Version
// ============================================================================

export interface SimpleTypingIndicatorProps {
  className?: string;
}

export function SimpleTypingIndicator({ className = "" }: SimpleTypingIndicatorProps) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <motion.span
        animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        className="w-1.5 h-1.5 bg-white/50 rounded-full"
      />
      <motion.span
        animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.13 }}
        className="w-1.5 h-1.5 bg-white/50 rounded-full"
      />
      <motion.span
        animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.26 }}
        className="w-1.5 h-1.5 bg-white/50 rounded-full"
      />
    </div>
  );
}
