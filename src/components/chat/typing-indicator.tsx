"use client";

import { memo } from "react";
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
    <div
      className={`flex items-center gap-2 px-4 py-2 animate-fade-in ${className}`}
    >
      {/* Avatar placeholder */}
      {isBot ? (
        <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-orange-400" />
        </div>
      ) : (
        <div className="w-8 h-8 rounded-full bg-background-tertiary flex-shrink-0" />
      )}

      {/* Typing dots — pure CSS animation */}
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 bg-white/40 rounded-full animate-[typing-dot_1.2s_ease-in-out_infinite]" />
        <span className="w-2 h-2 bg-white/40 rounded-full animate-[typing-dot_1.2s_ease-in-out_infinite_0.15s]" />
        <span className="w-2 h-2 bg-white/40 rounded-full animate-[typing-dot_1.2s_ease-in-out_infinite_0.3s]" />
      </div>

      {/* Label */}
      <span className="text-xs text-foreground-muted">
        {name ? `${name} is typing...` : "Typing..."}
      </span>
    </div>
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
      <span className="w-1.5 h-1.5 bg-foreground-subtle rounded-full animate-[typing-dot_0.8s_ease-in-out_infinite]" />
      <span className="w-1.5 h-1.5 bg-foreground-subtle rounded-full animate-[typing-dot_0.8s_ease-in-out_infinite_0.13s]" />
      <span className="w-1.5 h-1.5 bg-foreground-subtle rounded-full animate-[typing-dot_0.8s_ease-in-out_infinite_0.26s]" />
    </div>
  );
}
