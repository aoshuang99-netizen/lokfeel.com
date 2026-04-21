"use client";

import { memo, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface ReactionPickerProps {
  /** Callback when an emoji is selected */
  onSelect: (emoji: string) => void;
  /** Current user's reactions on this message (to show which ones they've already reacted with) */
  myReactions?: string[];
  /** Position adjustment for mobile */
  position?: "above" | "below";
  /** Custom emoji set */
  emojis?: string[];
}

// Default emoji set
const DEFAULT_EMOJIS = [
  "👍", "❤️", "😂", "😮", "😢", "🙏",
  "🔥", "💯", "✨", "🎉",
];

// ============================================================================
// Emoji Button Component
// ============================================================================

interface EmojiButtonProps {
  emoji: string;
  isSelected: boolean;
  onClick: () => void;
  onHover?: () => void;
}

function EmojiButton({ emoji, isSelected, onClick, onHover }: EmojiButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.2 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      onMouseEnter={onHover}
      onTouchStart={onHover}
      className={`
        w-8 h-8 flex items-center justify-center rounded-full text-lg
        transition-all duration-150
        ${isSelected 
          ? "bg-pink-500/30 ring-2 ring-pink-400" 
          : "hover:bg-white/10"
        }
      `}
    >
      {emoji}
    </motion.button>
  );
}

// ============================================================================
// Main Reaction Picker Component
// ============================================================================

function ReactionPickerComponent({
  onSelect,
  myReactions = [],
  position = "above",
  emojis = DEFAULT_EMOJIS,
}: ReactionPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleSelect = useCallback((emoji: string) => {
    onSelect(emoji);
    // Close picker after selection
    setIsOpen(false);
  }, [onSelect]);

  const handleMouseEnter = useCallback((emoji: string) => {
    setHoveredEmoji(emoji);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredEmoji(null);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Add Reaction Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleToggle}
        className={`
          w-6 h-6 flex items-center justify-center rounded-full
          bg-white/10 hover:bg-white/20 transition-all duration-150
          ${isOpen ? "bg-white/20 rotate-45" : ""}
        `}
        title="Add reaction"
      >
        <Plus className="w-3 h-3 text-white/70" />
      </motion.button>

      {/* Reaction Picker Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: position === "above" ? 10 : -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: position === "above" ? 10 : -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`
              absolute ${position === "above" ? "bottom-full mb-2" : "top-full mt-2"}
              left-1/2 -translate-x-1/2
              z-50
              bg-[#1a1926] rounded-2xl border border-white/10 
              shadow-xl overflow-hidden
              p-2
            `}
            onMouseLeave={handleMouseLeave}
          >
            {/* Emoji Grid */}
            <div className="flex gap-1">
              {emojis.map((emoji) => (
                <EmojiButton
                  key={emoji}
                  emoji={emoji}
                  isSelected={myReactions.includes(emoji)}
                  onClick={() => handleSelect(emoji)}
                  onHover={() => handleMouseEnter(emoji)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Memoized Export
// ============================================================================

export const ReactionPicker = memo(ReactionPickerComponent);

// ============================================================================
// Reaction Summary Component (displays reactions on a message)
// ============================================================================

export interface ReactionSummaryDisplay {
  emoji: string;
  count: number;
  hasReacted: boolean;
}

export interface ReactionSummaryProps {
  reactions: ReactionSummaryDisplay[];
  onToggle: (emoji: string) => void;
}

function ReactionSummaryComponent({ reactions, onToggle }: ReactionSummaryProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((reaction) => (
        <motion.button
          key={reaction.emoji}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onToggle(reaction.emoji)}
          className={`
            flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
            transition-all duration-150
            ${reaction.hasReacted
              ? "bg-pink-500/20 border border-pink-400/50 text-white"
              : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
            }
          `}
        >
          <span>{reaction.emoji}</span>
          {reaction.count > 1 && <span>{reaction.count}</span>}
        </motion.button>
      ))}
    </div>
  );
}

export const ReactionSummary = memo(ReactionSummaryComponent);
