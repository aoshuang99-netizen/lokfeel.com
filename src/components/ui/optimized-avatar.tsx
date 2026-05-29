"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import NextImage from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X, ZoomIn, User, Loader2 } from "lucide-react";
import {
  getAvatarKind,
  getAvatarBackground,
  parseEmojiAvatar,
  getRealPhotoAvatarUrl,
  isBrokenAvatarUrl,
  isValidPhotoUrl,
  preloadAvatar,
} from "@/lib/avatar-utils";

// DiceBear URLs must use native <img> — next/image returns 400 INVALID_IMAGE_OPTIMIZE_REQUEST
// because DiceBear SVGs don't have a .svg extension in the URL path
function isDiceBearUrl(src: string): boolean {
  return src?.includes("api.dicebear.com") || false;
}

// Data URLs (base64 photos from upload) must use native <img> — next/image does NOT support data: URLs
function isDataUrl(src: string): boolean {
  return src?.startsWith("data:") || false;
}

// ═══════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════

const TRANSITIONS = {
  fast: { duration: 0.15 },
  medium: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
  spring: { type: "spring" as const, damping: 25, stiffness: 300 },
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface OptimizedAvatarProps {
  src?: string | null;
  alt?: string;
  seed?: string;
  gender?: string;
  age?: number;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  shape?: "circle" | "rounded" | "square";
  priority?: boolean;
  enableLightbox?: boolean;
  className?: string;
  onClick?: () => void;
}

interface LightboxProps {
  src: string;
  alt?: string;
  isOpen: boolean;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════════
// SIZE CONFIG
// ═══════════════════════════════════════════════════════════════

const sizeConfig = {
  xs: { cls: "h-6 w-6", text: "text-[10px]" },
  sm: { cls: "h-8 w-8", text: "text-xs" },
  md: { cls: "h-10 w-10", text: "text-sm" },
  lg: { cls: "h-12 w-12", text: "text-base" },
  xl: { cls: "h-16 w-16", text: "text-lg" },
  "2xl": { cls: "h-24 w-24", text: "text-xl" },
  full: { cls: "w-full h-full", text: "text-2xl" },
};

const shapeConfig = {
  circle: "rounded-full",
  rounded: "rounded-2xl",
  square: "rounded-none",
};

// ═══════════════════════════════════════════════════════════════
// LIGHTBOX COMPONENT — Full-resolution viewer
// ═══════════════════════════════════════════════════════════════

function AvatarLightbox({ src, alt = "Photo", isOpen, onClose }: LightboxProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  // DiceBear SVG is resolution-independent — no URL upgrade needed
  const fullResUrl = src;

  // Preload image when lightbox opens
  useEffect(() => {
    if (isOpen && fullResUrl) {
      setLoaded(false);
      setError(false);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => setLoaded(true);
      img.onerror = () => setError(true);
      img.src = fullResUrl;
    }
  }, [isOpen, fullResUrl]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={TRANSITIONS.fast}
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.92)" }}
          onClick={onClose}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Loading indicator */}
          {!loaded && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-white/50 text-sm">Failed to load image</p>
            </div>
          )}

          {/* Full-resolution image */}
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: loaded ? 1 : 0.85, opacity: loaded ? 1 : 0 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={TRANSITIONS.spring}
            className="relative max-w-[90vw] max-h-[85vh] w-auto h-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <NextImage
              src={fullResUrl}
              alt={alt || "Photo"}
              fill
              className="object-contain rounded-2xl"
              draggable={false}
              style={{ willChange: "transform" }}
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
            />
          </motion.div>

          {/* Tap hint */}
          <p className="absolute bottom-6 text-white/30 text-xs">
            Tap anywhere to close
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════════
// OPTIMIZED AVATAR COMPONENT
// ═══════════════════════════════════════════════════════════════

export function OptimizedAvatar({
  src,
  alt = "User",
  seed,
  gender,
  age,
  size = "md",
  shape = "circle",
  priority = false,
  enableLightbox = false,
  className = "",
  onClick,
}: OptimizedAvatarProps) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const config = sizeConfig[size];
  const shapeCls = shapeConfig[shape];

  // Determine the actual image source
  const { imageSrc, isFallback } = React.useMemo(() => {
    // If src is valid photo URL, use it
    if (isValidPhotoUrl(src)) {
      return { imageSrc: src!, isFallback: false };
    }

    // Otherwise use real photo fallback
    const fallbackSeed = seed || alt || "default";
    const normalizedGender =
      gender?.toLowerCase() === "female" ||
      gender?.toUpperCase() === "FEMALE" ||
      gender?.toUpperCase() === "WOMAN"
        ? "female"
        : gender?.toLowerCase() === "male" ||
          gender?.toUpperCase() === "MALE" ||
          gender?.toUpperCase() === "MAN"
        ? "male"
        : undefined;

    return {
      imageSrc: getRealPhotoAvatarUrl(fallbackSeed, normalizedGender, "preview", age),
      isFallback: true,
    };
  }, [src, seed, alt, gender, age]);

  // Preload if priority
  useEffect(() => {
    if (priority && imageSrc) {
      preloadAvatar(imageSrc);
    }
  }, [priority, imageSrc]);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  const handleLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  const handleClick = useCallback(() => {
    if (enableLightbox) {
      setLightboxOpen(true);
    }
    onClick?.();
  }, [enableLightbox, onClick]);

  // Render emoji avatar
  const kind = getAvatarKind(src);
  if (kind === "emoji") {
    const parsed = parseEmojiAvatar(src);
    return (
      <div
        className={`relative inline-flex items-center justify-center overflow-hidden ${config.cls} ${shapeCls} ${className}`}
        style={{ background: getAvatarBackground(kind, src) }}
        onClick={handleClick}
        role={enableLightbox ? "button" : undefined}
        tabIndex={enableLightbox ? 0 : undefined}
      >
        <span className="text-2xl">{parsed?.emoji}</span>
      </div>
    );
  }

  return (
    <>
      <div
        className={`relative inline-flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/20 to-secondary/10 ${config.cls} ${shapeCls} ${className} ${
          enableLightbox ? "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all" : ""
        }`}
        onClick={handleClick}
        role={enableLightbox ? "button" : undefined}
        tabIndex={enableLightbox ? 0 : undefined}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && enableLightbox) {
            setLightboxOpen(true);
          }
        }}
      >
        {/* Loading skeleton */}
        {!loaded && !error && (
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-white/2 animate-pulse" />
        )}

        {/* Actual image — use <img> for DiceBear SVGs and data URLs (next/image can't handle them) */}
        {!error && (
          (isDiceBearUrl(imageSrc) || isDataUrl(imageSrc)) ? (
            <img
              src={imageSrc}
              alt={alt}
              className={`w-full h-full object-cover object-top transition-opacity duration-300 ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              onLoad={handleLoad}
              onError={handleError}
              crossOrigin="anonymous"
            />
          ) : (
            <NextImage
              src={imageSrc}
              alt={alt}
              fill
              className={`w-full h-full object-cover object-top transition-opacity duration-300 ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
              loading={priority ? "eager" : "lazy"}
              onError={handleError}
              onLoad={handleLoad}
            />
          )
        )}

        {/* Error fallback — initials */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 to-secondary/20">
            <User className="w-1/2 h-1/2 text-foreground-faint" />
          </div>
        )}

        {/* Lightbox indicator */}
        {enableLightbox && loaded && (
          <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ZoomIn className="w-3 h-3 text-white" />
          </div>
        )}
      </div>

      {/* Lightbox */}
      {enableLightbox && (
        <AvatarLightbox
          src={imageSrc}
          alt={alt}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// CARD AVATAR — For user cards (larger, with lightbox enabled)
// ═══════════════════════════════════════════════════════════════

interface CardAvatarProps {
  src?: string | null;
  alt?: string;
  seed?: string;
  gender?: string;
  age?: number;
  className?: string;
}

export function CardAvatar({ src, alt, seed, gender, age, className = "" }: CardAvatarProps) {
  return (
    <OptimizedAvatar
      src={src}
      alt={alt}
      seed={seed}
      gender={gender}
      age={age}
      size="full"
      shape="rounded"
      enableLightbox
      className={className}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// THUMBNAIL AVATAR — For lists, small sizes
// ═══════════════════════════════════════════════════════════════

interface ThumbnailAvatarProps {
  src?: string | null;
  alt?: string;
  seed?: string;
  gender?: string;
  age?: number;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export function ThumbnailAvatar({
  src,
  alt,
  seed,
  gender,
  age,
  size = "md",
  className = "",
}: ThumbnailAvatarProps) {
  return (
    <OptimizedAvatar
      src={src}
      alt={alt}
      seed={seed}
      gender={gender}
      age={age}
      size={size}
      shape="circle"
      className={className}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// GALLERY IMAGE — For profile photo galleries
// ═══════════════════════════════════════════════════════════════

interface GalleryImageProps {
  src: string;
  alt?: string;
  index?: number;
  className?: string;
}

export function GalleryImage({ src, alt, index = 0, className = "" }: GalleryImageProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <div
        className={`relative overflow-hidden rounded-2xl cursor-pointer group ${className}`}
        onClick={() => setLightboxOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setLightboxOpen(true);
        }}
      >
        {!loaded && (
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-white/2 animate-pulse" />
        )}
        <img
          src={src}
          alt={alt || `Photo ${index + 1}`}
          className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          loading={index < 2 ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          crossOrigin="anonymous"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
        <div className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <ZoomIn className="w-4 h-4 text-white" />
        </div>
      </div>

      <AvatarLightbox
        src={src}
        alt={alt}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}
