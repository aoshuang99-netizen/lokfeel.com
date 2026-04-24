"use client";

import { motion } from "framer-motion";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular" | "rounded";
  width?: string | number;
  height?: string | number;
  count?: number;
  animation?: "pulse" | "wave" | "none";
}

export function Skeleton({
  className = "",
  variant = "rectangular",
  width,
  height,
  animation = "pulse",
}: SkeletonProps) {
  const baseClasses = "bg-background-tertiary";

  const variantClasses = {
    text: "rounded h-4",
    circular: "rounded-full",
    rectangular: "rounded-lg",
    rounded: "rounded-xl",
  };

  const animationClasses = {
    pulse: "animate-pulse",
    wave: "relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent before:animate-[shimmer_1.5s_infinite]",
    none: "",
  };

  const style: React.CSSProperties = {
    width: width ?? (variant === "circular" ? 40 : "100%"),
    height: height ?? (variant === "text" ? 16 : 80),
  };

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
      style={style}
    />
  );
}

// Skeleton for text lines
export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={i === lines - 1 ? "75%" : "100%"}
        />
      ))}
    </div>
  );
}

// Skeleton for cards
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`glass-card p-4 space-y-4 ${className}`}>
      <div className="flex items-center gap-4">
        <Skeleton variant="circular" width={56} height={56} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="40%" height={12} />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

// Skeleton for user cards (like in Square)
export function SkeletonUserCard({ className = "" }: { className?: string }) {
  return (
    <div className={`glass-card overflow-hidden ${className}`}>
      <Skeleton variant="rectangular" height={280} animation="wave" />
      <div className="p-4 space-y-3">
        <Skeleton variant="text" width="70%" />
        <Skeleton variant="text" width="50%" height={12} />
        <div className="flex gap-2">
          <Skeleton variant="rounded" width={60} height={24} />
          <Skeleton variant="rounded" width={60} height={24} />
        </div>
      </div>
    </div>
  );
}

// Skeleton for chat message
export function SkeletonMessage({
  isSelf = false,
  className = "",
}: {
  isSelf?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-2 ${isSelf ? "justify-end" : "justify-start"} ${className}`}
    >
      {!isSelf && <Skeleton variant="circular" width={32} height={32} />}
      <Skeleton
        variant="rounded"
        width={isSelf ? "70%" : "60%"}
        height={48}
      />
    </div>
  );
}

// Skeleton for dashboard stats
export function SkeletonStatCard({ className = "" }: { className?: string }) {
  return (
    <div className={`glass-card p-5 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <Skeleton variant="rounded" width={40} height={40} />
        <Skeleton variant="text" width="60%" />
      </div>
      <Skeleton variant="text" width="40%" height={28} />
    </div>
  );
}

// Loading page with skeleton
export function LoadingScreen({
  title = "Loading...",
  subtitle,
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <motion.div
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="space-y-4 text-center"
      >
        <div className="w-16 h-16 rounded-full bg-background-tertiary flex items-center justify-center mx-auto">
          <div className="w-8 h-8 rounded-full bg-primary/50 animate-pulse" />
        </div>
        <div>
          <p className="text-foreground font-medium">{title}</p>
          {subtitle && <p className="text-foreground-subtle text-sm mt-1">{subtitle}</p>}
        </div>
      </motion.div>
    </div>
  );
}

// Inline loading spinner (small)
export function InlineLoading({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="w-4 h-4 rounded-full border-2 border-card-border border-t-white/60 animate-spin" />
    </div>
  );
}

// Button loading state
export function ButtonLoading({ text = "Loading..." }: { text?: string }) {
  return (
    <span className="flex items-center gap-2">
      <div className="w-4 h-4 rounded-full border-2 border-card-border border-t-white/60 animate-spin" />
      {text}
    </span>
  );
}

// Add shimmer keyframes to global CSS
const shimmerStyles = `
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.animate-shimmer {
  animation: shimmer 1.5s infinite;
}
`;

// Inject shimmer styles
if (typeof document !== "undefined") {
  const styleId = "skeleton-shimmer-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = shimmerStyles;
    document.head.appendChild(style);
  }
}
