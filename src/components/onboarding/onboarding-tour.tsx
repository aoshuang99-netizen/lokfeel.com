"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Radar, Flame, Bell, User } from "lucide-react";

const TOUR_KEY = "lokfeel-tour-completed";

const TOUR_STEPS = [
  {
    id: 1,
    icon: Radar,
    title: "Your Relationship Blueprint",
    description: "Tell LokFeel your relationship style for more precise matching",
    targetSelector: "[data-tour='relationship-engine']",
    tooltipPosition: "right" as const,
    color: "from-[#4c1d95] to-[#8b5cf6]",
  },
  {
    id: 2,
    icon: Flame,
    title: "Today's Picks",
    description: "Handpicked people daily, see who's waiting for you",
    targetSelector: "[data-tour='today-picks']",
    tooltipPosition: "bottom" as const,
    color: "from-[#ec4899] to-[#f472b6]",
  },
  {
    id: 3,
    icon: Bell,
    title: "Messages & Activity",
    description: "Check new matches and unread messages, start a conversation",
    targetSelector: "[data-tour='activity-summary']",
    tooltipPosition: "left" as const,
    color: "from-blue-400 to-indigo-500",
  },
  {
    id: 4,
    icon: User,
    title: "Complete Your Profile",
    description: "A fuller profile means better matches — complete it now",
    targetSelector: "[data-tour='profile-link']",
    tooltipPosition: "top" as const,
    color: "from-emerald-400 to-teal-500",
  },
];

interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export default function OnboardingTour() {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[currentStep];
  const StepIcon = step.icon;
  const isLast = currentStep === TOUR_STEPS.length - 1;

  // Calculate target element position
  const calculateTargetPosition = useCallback(() => {
    const el = document.querySelector(step.targetSelector);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    setTargetRect({
      x: rect.left + scrollX,
      y: rect.top + scrollY,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
    });
  }, [step.targetSelector]);

  // Position tooltip relative to viewport
  const positionTooltip = useCallback((rect: TargetRect | null) => {
    if (!rect) {
      setTooltipPos({ x: window.innerWidth / 2 - 180, y: window.innerHeight / 2 - 150 });
      return;
    }
    const GAP = 16;
    const TOOLTIP_W = 320;
    const TOOLTIP_H = 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = 0;
    let y = 0;

    switch (step.tooltipPosition) {
      case "right":
        x = Math.min(rect.right + GAP, vw - TOOLTIP_W - 16);
        y = Math.min(Math.max(rect.top, 16), vh - TOOLTIP_H - 16);
        break;
      case "left":
        x = Math.max(rect.left - TOOLTIP_W - GAP, 16);
        y = Math.min(Math.max(rect.top, 16), vh - TOOLTIP_H - 16);
        break;
      case "bottom":
        x = Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 16), vw - TOOLTIP_W - 16);
        y = Math.min(rect.bottom + GAP, vh - TOOLTIP_H - 16);
        break;
      case "top":
        x = Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 16), vw - TOOLTIP_W - 16);
        y = Math.max(rect.top - TOOLTIP_H - GAP, 16);
        break;
    }
    setTooltipPos({ x, y });
  }, [step.tooltipPosition]);

  // Initialize
  useEffect(() => {
    const completed = localStorage.getItem(TOUR_KEY);
    if (!completed) {
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Recalculate position when step changes or on scroll/resize
  useEffect(() => {
    if (!isVisible) return;
    const update = () => {
      calculateTargetPosition();
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [isVisible, currentStep, calculateTargetPosition]);

  // Position tooltip after rect is set
  useEffect(() => {
    if (targetRect) {
      positionTooltip(targetRect);
    }
  }, [targetRect, positionTooltip]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(TOUR_KEY, "true");
    setIsVisible(false);
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleDismiss();
    }
  }, [currentStep, handleDismiss]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  // Build SVG clip-path for spotlight
  const buildSpotlightPath = (rect: TargetRect | null, padding = 8) => {
    if (!rect) {
      // Full dark overlay if target not found
      return `M0,0 H${window.innerWidth} V${window.innerHeight} H0 Z`;
    }
    const R = padding;
    const x = rect.left - R;
    const y = rect.top - R;
    const w = rect.width + R * 2;
    const h = rect.height + R * 2;
    const r = Math.min(R, 12);
    // Outer rect (dark area) - counter-clockwise to create hole
    const outer = `M0,0 H${window.innerWidth} V${window.innerHeight} H0 Z`;
    // Inner rect (spotlight hole) - clockwise
    const inner = `M${x},${y} H${x + w} V${y + h} H${x} Z`;
    return outer;
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* ── SVG Spotlight Overlay ── */}
          <motion.div
            ref={overlayRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[100] pointer-events-none"
          >
            <svg
              width={window.innerWidth}
              height={window.innerHeight}
              style={{ position: "absolute", inset: 0 }}
            >
              <defs>
                <mask id="spotlight-mask">
                  {/* White = show (transparent), Black = hide (dark overlay) */}
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  {targetRect && (
                    <rect
                      x={targetRect.left - 10}
                      y={targetRect.top - 10}
                      width={targetRect.width + 20}
                      height={targetRect.height + 20}
                      rx="14"
                      fill="black"
                    />
                  )}
                </mask>
              </defs>
              <rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill="rgba(0, 0, 0, 0.75)"
                mask="url(#spotlight-mask)"
              />
              {/* Spotlight border glow */}
              {targetRect && (
                <rect
                  x={targetRect.left - 10}
                  y={targetRect.top - 10}
                  width={targetRect.width + 20}
                  height={targetRect.height + 20}
                  rx="14"
                  fill="none"
                  stroke="rgba(139, 92, 246, 0.8)"
                  strokeWidth="2"
                />
              )}
            </svg>

            {/* ── Spotlight pulse ring on target ── */}
            {targetRect && (
              <div
                className="absolute pointer-events-none animate-pulse"
                style={{
                  left: targetRect.left - 14,
                  top: targetRect.top - 14,
                  width: targetRect.width + 28,
                  height: targetRect.height + 28,
                  borderRadius: "18px",
                  border: "2px solid rgba(139, 92, 246, 0.6)",
                  boxShadow: "0 0 20px rgba(139, 92, 246, 0.3)",
                }}
              />
            )}
          </motion.div>

          {/* ── Spotlight pulse ring on target (fixed layer) ── */}
          {targetRect && (
            <div
              className="fixed pointer-events-none z-[101] animate-pulse"
              style={{
                left: targetRect.left - 14,
                top: targetRect.top - 14,
                width: targetRect.width + 28,
                height: targetRect.height + 28,
                borderRadius: "18px",
                border: "2px solid rgba(139, 92, 246, 0.6)",
                boxShadow: "0 0 20px rgba(139, 92, 246, 0.3)",
              }}
            />
          )}

          {/* ── Tooltip Bubble ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="fixed z-[102] w-[320px]"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
            }}
          >
            {/* Arrow pointer */}
            <div
              className="absolute w-4 h-4 rotate-45 bg-background-secondary shadow-lg border border-card-border"
              style={{
                ...(step.tooltipPosition === "bottom" && { top: -8, left: "50%", marginLeft: -8 }),
                ...(step.tooltipPosition === "top" && { bottom: -8, left: "50%", marginLeft: -8 }),
                ...(step.tooltipPosition === "right" && { left: -8, top: "50%", marginTop: -8 }),
                ...(step.tooltipPosition === "left" && { right: -8, top: "50%", marginTop: -8 }),
              }}
            />

            {/* Card */}
            <div className="bg-background-secondary rounded-2xl shadow-2xl border border-card-border overflow-hidden">
              {/* Color accent top bar */}
              <div className={`h-1 bg-gradient-to-r ${step.color}`} />

              <div className="p-5">
                {/* Step indicator */}
                <div className="flex items-center gap-1.5 mb-4">
                  {TOUR_STEPS.map((s, i) => (
                    <div
                      key={s.id}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        i <= currentStep ? "bg-accent-lime" : "bg-foreground-faint/30"
                      }`}
                      style={{ width: i <= currentStep ? "24px" : "8px" }}
                    />
                  ))}
                </div>

                {/* Icon */}
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center mb-3 shadow-md`}
                >
                  <StepIcon className="w-6 h-6 text-white" />
                </div>

                {/* Content */}
                <h3 className="text-base font-bold text-foreground mb-1.5 font-display">
                  {step.title}
                </h3>
                <p className="text-sm text-foreground-muted leading-relaxed">
                  {step.description}
                </p>

                {/* Actions */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-card-border">
                  <button
                    onClick={handleDismiss}
                    className="text-xs text-foreground-subtle hover:text-foreground-muted transition-colors"
                  >
                    Skip tour
                  </button>
                  <div className="flex items-center gap-2">
                    {currentStep > 0 && (
                      <button
                        onClick={handlePrev}
                        className="w-8 h-8 rounded-full bg-background-tertiary flex items-center justify-center hover:bg-foreground-faint/20 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4 text-foreground-muted" />
                      </button>
                    )}
                    <button
                      onClick={handleNext}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#4c1d95] to-[#8b5cf6] hover:opacity-90 transition-opacity shadow-md"
                    >
                      {isLast ? "Get Started" : "Next"}
                      {!isLast && <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Step counter */}
                <p className="text-center text-xs text-foreground-subtle mt-2">
                  {currentStep + 1} of {TOUR_STEPS.length}
                </p>
              </div>
            </div>
          </motion.div>

          {/* ── Close button ── */}
          <button
            onClick={handleDismiss}
            className="fixed top-4 right-4 z-[103] w-10 h-10 rounded-full bg-background-secondary/90 backdrop-blur flex items-center justify-center hover:bg-background-secondary transition-colors shadow-lg border border-card-border"
          >
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </>
      )}
    </AnimatePresence>
  );
}
