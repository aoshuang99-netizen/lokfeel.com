"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ZoomIn, ZoomOut, Check, RotateCcw } from "lucide-react";

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCropComplete: (croppedImage: string) => void;
}

export function ImageCropModal({ isOpen, imageSrc, onClose, onCropComplete }: ImageCropModalProps) {
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.5));
  const handleReset = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setPosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const getCroppedImage = useCallback(() => {
    if (!imageSrc) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 400;
    canvas.height = 400;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const sourceX = (img.width - size) / 2;
      const sourceY = (img.height - size) / 2;

      ctx.drawImage(
        img,
        sourceX - position.x / zoom,
        sourceY - position.y / zoom,
        size / zoom,
        size / zoom,
        0,
        0,
        400,
        400
      );

      const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      onCropComplete(croppedDataUrl);
    };
    img.src = imageSrc;
  }, [imageSrc, position, zoom, onCropComplete]);

  if (!isOpen || !imageSrc) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.9)" }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-md bg-background-tertiary rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <h3 className="text-lg font-semibold text-foreground">Crop Photo</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-background-tertiary transition-colors"
            >
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>

          {/* Crop Area */}
          <div className="relative aspect-square overflow-hidden bg-black">
            <div
              className="absolute inset-0 flex items-center justify-center cursor-move"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <img
                src={imageSrc}
                alt="Crop preview"
                className="max-w-none select-none"
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                  transition: isDragging ? "none" : "transform 0.1s ease-out",
                }}
                draggable={false}
              />
            </div>

            {/* Overlay */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Dark overlay outside crop area */}
              <div className="absolute inset-0" style={{
                background: `radial-gradient(circle at center, transparent 150px, rgba(0,0,0,0.7) 150px)`,
              }} />
              {/* Crop border */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] border-2 border-white rounded-lg" />
            </div>
          </div>

          {/* Controls */}
          <div className="p-4 space-y-4">
            {/* Zoom Slider */}
            <div className="flex items-center gap-3">
              <ZoomOut className="w-4 h-4 text-foreground-muted" />
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="flex-1 h-1 bg-background-tertiary rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, white ${((zoom - 0.5) / 2.5) * 100}%, rgba(255,255,255,0.2) ${((zoom - 0.5) / 2.5) * 100}%)`,
                }}
              />
              <ZoomIn className="w-4 h-4 text-foreground-muted" />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-card-border text-foreground-muted hover:bg-background-tertiary transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
              <button
                onClick={getCroppedImage}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white text-black font-medium hover:bg-white/90 transition-colors"
              >
                <Check className="w-4 h-4" />
                Apply
              </button>
            </div>

            <p className="text-xs text-center text-foreground-subtle">
              Drag to position • Use slider to zoom
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
