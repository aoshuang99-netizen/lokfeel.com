"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, ZoomIn } from "lucide-react";
import { useState } from "react";

interface AvatarLightboxProps {
  src: string;
  alt?: string;
  children: React.ReactNode;
}

/**
 * Wrap any avatar <img> with this component to enable tap-to-zoom lightbox.
 * Displays the full-resolution image in a fullscreen overlay.
 */
export function AvatarLightbox({ src, alt = "Photo", children }: AvatarLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Clickable trigger */}
      <div
        className="cursor-pointer"
        onClick={() => setIsOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setIsOpen(true); }}
        aria-label="View full size photo"
      >
        {children}
      </div>

      {/* Fullscreen lightbox overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.92)" }}
            onClick={() => setIsOpen(false)}
          >
            {/* Close button */}
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Zoom hint */}
            <div className="absolute top-4 left-4 flex items-center gap-1.5 text-white/50 text-xs">
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Full resolution</span>
            </div>

            {/* Image — Full resolution with fast loading */}
            <motion.img
              key={src}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              src={src}
              alt={alt}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-2xl"
              onClick={(e) => e.stopPropagation()}
              draggable={false}
              loading="eager"
              decoding="async"
              style={{ willChange: 'transform' }}
            />

            {/* Tap anywhere to close hint */}
            <p className="absolute bottom-6 text-white/30 text-xs">
              Tap anywhere to close
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
