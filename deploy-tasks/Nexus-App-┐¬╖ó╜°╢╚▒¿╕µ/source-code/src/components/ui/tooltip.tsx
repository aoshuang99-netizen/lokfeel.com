"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle } from "lucide-react";

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  icon?: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * Tooltip component with customizable positioning and icon
 * Used for explaining concepts like "Attachment Style", "Love Language", etc.
 */
export function Tooltip({
  children,
  content,
  icon,
  position = "top",
  className = "",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipWidth = tooltipRef.current?.offsetWidth || 200;
      const tooltipHeight = tooltipRef.current?.offsetHeight || 100;

      let x = rect.left + rect.width / 2;
      let y = rect.top;

      switch (position) {
        case "top":
          x = rect.left + rect.width / 2 - tooltipWidth / 2;
          y = rect.top - tooltipHeight - 8;
          // Keep within viewport
          if (x < 8) x = 8;
          if (x + tooltipWidth > window.innerWidth - 8) {
            x = window.innerWidth - tooltipWidth - 8;
          }
          break;
        case "bottom":
          x = rect.left + rect.width / 2 - tooltipWidth / 2;
          y = rect.bottom + 8;
          if (x < 8) x = 8;
          if (x + tooltipWidth > window.innerWidth - 8) {
            x = window.innerWidth - tooltipWidth - 8;
          }
          break;
        case "left":
          x = rect.left - tooltipWidth - 8;
          y = rect.top + rect.height / 2 - tooltipHeight / 2;
          break;
        case "right":
          x = rect.right + 8;
          y = rect.top + rect.height / 2 - tooltipHeight / 2;
          break;
      }

      // Prevent going above viewport for top position
      if (position === "top" && y < 8) {
        y = rect.bottom + 8;
      }

      setCoords({ x, y });
    }
  }, [isVisible, position]);

  return (
    <div className={`inline-flex items-center ${className}`}>
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onClick={() => setIsVisible(!isVisible)}
        className="inline-flex items-center gap-1 cursor-help"
      >
        {children}
        {icon || <HelpCircle className="w-4 h-4 text-foreground-muted" />}
      </div>

      <AnimatePresence>
        {isVisible && (
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "fixed",
              left: coords.x,
              top: coords.y,
              zIndex: 9999,
            }}
            className="max-w-[280px] px-4 py-3 rounded-xl bg-[var(--background-secondary,#1a1a1a)] border border-card-border shadow-xl"
          >
            <p className="text-sm text-foreground leading-relaxed">{content}</p>
            {/* Arrow */}
            <div
              className={`absolute w-2 h-2 bg-[var(--background-secondary,#1a1a1a)] border-card-border border-r border-t transform rotate-45 ${
                position === "top" ? "-bottom-1 left-1/2 -translate-x-1/2" : ""
              } ${position === "bottom" ? "-top-1 left-1/2 -translate-x-1/2" : ""}`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Pre-built explanation content for common concepts
export const CONCEPT_EXPLANATIONS = {
  attachmentStyle: {
    Secure: "You feel comfortable getting close to others and don't worry much about being abandoned.",
    Anxious: "You want to be very close with partners but worry they don't want to be as close with you.",
    Avoidant: "You feel uneasy when others get too close and prefer emotional distance.",
    Fearful: "You want close relationships but find it hard to trust or depend on others completely.",
  },
  loveLanguage: {
    Words: "You feel loved when someone gives you kind words, compliments, or verbal encouragement.",
    Time: "You feel loved when someone spends quality time with you, giving you their full attention.",
    Touch: "You feel loved through physical touch like hugging, holding hands, or cuddling.",
    Service: "You feel loved when someone does things for you, like cooking or helping with tasks.",
    Gifts: "You feel loved when someone gives you thoughtful gifts or surprises.",
  },
  communication: {
    Direct: "You say what you mean and expect others to do the same. You value clarity and honesty.",
    Reflective: "You think before you speak and prefer to listen first. You process internally.",
    Expressive: "You share your thoughts and feelings openly and enjoy emotional conversations.",
    Supportive: "You focus on helping others feel heard and understood. You're empathetic.",
  },
};
