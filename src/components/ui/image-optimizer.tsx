"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { getOptimalAvatarUrl, preloadLightboxImage } from "@/lib/avatar-utils";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  size?: "thumb" | "preview" | "full";
  priority?: boolean;
  enableLightbox?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

interface BlurPlaceholderProps {
  color?: string;
  className?: string;
}

// ═══════════════════════════════════════════════════════════════
// BLUR PLACEHOLDER
// ═══════════════════════════════════════════════════════════════

function BlurPlaceholder({ color = "#1a1a2e", className = "" }: BlurPlaceholderProps) {
  return (
    <div
      className={`absolute inset-0 animate-pulse ${className}`}
      style={{
        background: `linear-gradient(135deg, ${color}40, ${color}20)`,
        backdropFilter: "blur(20px)",
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// OPTIMIZED IMAGE COMPONENT
// ═══════════════════════════════════════════════════════════════

export function OptimizedImage({
  src,
  alt,
  className = "",
  containerClassName = "",
  size = "preview",
  priority = false,
  enableLightbox = false,
  onLoad,
  onError,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get optimal URL based on size
  const optimizedSrc = React.useMemo(() => {
    return getOptimalAvatarUrl(src, size === "thumb" ? 200 : size === "preview" ? 600 : 1200);
  }, [src, size]);

  // Preload if priority
  useEffect(() => {
    if (priority && typeof window !== "undefined") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = optimizedSrc;
    }
  }, [priority, optimizedSrc]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setError(true);
    onError?.();
  }, [onError]);

  const handleMouseEnter = useCallback(() => {
    if (enableLightbox) {
      preloadLightboxImage(src);
    }
  }, [enableLightbox, src]);

  const handleClick = useCallback(() => {
    if (enableLightbox) {
      setLightboxOpen(true);
    }
  }, [enableLightbox]);

  return (
    <>
      <div
        ref={containerRef}
        className={`relative overflow-hidden ${containerClassName}`}
        onMouseEnter={handleMouseEnter}
        onClick={handleClick}
        role={enableLightbox ? "button" : undefined}
        tabIndex={enableLightbox ? 0 : undefined}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && enableLightbox) {
            setLightboxOpen(true);
          }
        }}
      >
        {/* Blur placeholder while loading */}
        {!loaded && !error && <BlurPlaceholder />}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-red-500/10 to-red-500/5">
            <Loader2 className="w-6 h-6 text-red-400/50 animate-spin" />
          </div>
        )}

        {/* Actual image */}
        <img
          ref={imgRef}
          src={optimizedSrc}
          alt={alt}
          className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "sync" : "async"}
          crossOrigin="anonymous"
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>

      {/* Lightbox */}
      {enableLightbox && lightboxOpen && (
        <ImageLightbox
          src={src}
          alt={alt}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMAGE LIGHTBOX — Full resolution viewer
// ═══════════════════════════════════════════════════════════════

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [loaded, setLoaded] = useState(false);

  // Full resolution URL
  const fullResUrl = src.replace(/w=\d+&h=\d+/, "w=1200&h=1600");

  // Close on escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={onClose}
    >
      {/* Loading indicator */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
        </div>
      )}

      {/* Full-resolution image */}
      <motion.img
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: loaded ? 1 : 0.85, opacity: loaded ? 1 : 0 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        src={fullResUrl}
        alt={alt}
        className="max-w-[90vw] max-h-[85vh] object-contain rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onLoad={() => setLoaded(true)}
        draggable={false}
        loading="eager"
        decoding="async"
        style={{ willChange: "transform" }}
      />

      {/* Close hint */}
      <p className="absolute bottom-6 text-white/30 text-xs">
        Tap anywhere to close
      </p>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESPONSIVE IMAGE
// ═══════════════════════════════════════════════════════════════

interface ResponsiveImageProps {
  src: string;
  alt: string;
  sizes?: string;
  className?: string;
  containerClassName?: string;
  priority?: boolean;
}

export function ResponsiveImage({
  src,
  alt,
  sizes = "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
  className = "",
  containerClassName = "",
  priority = false,
}: ResponsiveImageProps) {
  const [loaded, setLoaded] = useState(false);

  // Generate srcset for responsive loading
  const srcSet = React.useMemo(() => {
    const widths = [200, 400, 600, 800, 1200];
    return widths
      .map((w) => {
        const url = src.replace(/w=\d+/, `w=${w}`).replace(/h=\d+/, `h=${Math.round(w * 1.33)}`);
        return `${url} ${w}w`;
      })
      .join(", ");
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${containerClassName}`}>
      {!loaded && <BlurPlaceholder />}
      <img
        src={src}
        alt={alt}
        srcSet={srcSet}
        sizes={sizes}
        className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        crossOrigin="anonymous"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROGRESSIVE IMAGE
// ═══════════════════════════════════════════════════════════════

interface ProgressiveImageProps {
  thumbnailSrc: string;
  fullSrc: string;
  alt: string;
  className?: string;
  containerClassName?: string;
}

export function ProgressiveImage({
  thumbnailSrc,
  fullSrc,
  alt,
  className = "",
  containerClassName = "",
}: ProgressiveImageProps) {
  const [phase, setPhase] = useState<"placeholder" | "thumbnail" | "full">("placeholder");

  useEffect(() => {
    // Load thumbnail first
    const thumbImg = new Image();
    thumbImg.crossOrigin = "anonymous";
    thumbImg.onload = () => setPhase("thumbnail");
    thumbImg.src = thumbnailSrc;

    // Then load full resolution
    const fullImg = new Image();
    fullImg.crossOrigin = "anonymous";
    fullImg.onload = () => setPhase("full");
    fullImg.src = fullSrc;
  }, [thumbnailSrc, fullSrc]);

  return (
    <div className={`relative overflow-hidden ${containerClassName}`}>
      {phase === "placeholder" && <BlurPlaceholder />}

      {phase === "thumbnail" && (
        <img
          src={thumbnailSrc}
          alt={alt}
          className={`transition-opacity duration-500 ${className}`}
          style={{ filter: "blur(10px)", transform: "scale(1.1)" }}
        />
      )}

      {(phase === "thumbnail" || phase === "full") && (
        <img
          src={fullSrc}
          alt={alt}
          className={`absolute inset-0 transition-opacity duration-700 ${
            phase === "full" ? "opacity-100" : "opacity-0"
          } ${className}`}
          crossOrigin="anonymous"
        />
      )}
    </div>
  );
}
