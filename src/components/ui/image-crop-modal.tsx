"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ZoomIn, ZoomOut, Check, RotateCcw, Camera, Upload } from "lucide-react";

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCropComplete: (croppedImage: string) => void;
  onSaveToGallery?: (croppedImage: string) => void;
  /** Aspect ratio of crop area: "square" | "portrait" | "landscape" | number */
  aspectRatio?: "square" | "portrait" | "landscape" | number;
  /** Title of the modal */
  title?: string;
  /** Whether to show camera capture button */
  showCamera?: boolean;
  /** Whether to show save-to-gallery button */
  showSaveToGallery?: boolean;
}

export function ImageCropModal({
  isOpen,
  imageSrc,
  onClose,
  onCropComplete,
  onSaveToGallery,
  aspectRatio = "square",
  title = "Adjust Your Photo",
  showCamera = false,
  showSaveToGallery = false,
}: ImageCropModalProps) {
  // Default zoom slightly zoomed out so face isn't cropped too tightly
  const [zoom, setZoom] = useState(0.85);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isCapturing, setIsCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  // ─── Camera Capture ───
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCapturing(true);
    } catch (err) {
      console.error("Camera access denied:", err);
      alert("Unable to access camera. Please allow camera permissions in your browser settings.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsCapturing(false);
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    stopCamera();
    // Pass captured image back via onCropComplete
    onCropComplete(dataUrl);
  }, [onCropComplete, stopCamera]);

  // Cleanup camera on unmount/close
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setZoom(0.85);
      setPosition({ x: 0, y: 0 });
    }
    return () => stopCamera();
  }, [isOpen, stopCamera]);

  // ─── Crop Logic (rectangular, based on aspect ratio) ───
  const getCropDimensions = useCallback((imgWidth: number, imgHeight: number) => {
    let ratio: number;
    switch (aspectRatio) {
      case "portrait": ratio = 3 / 4; break;
      case "landscape": ratio = 4 / 3; break;
      case "square": default: ratio = 1; break;
    }
    if (typeof aspectRatio === "number") ratio = aspectRatio;

    // Determine crop size based on image dimensions and desired ratio
    let cropW: number, cropH: number;
    const imgRatio = imgWidth / imgHeight;
    if (imgRatio > ratio) {
      // Image is wider than target ratio — crop height is limiting
      cropH = imgHeight;
      cropW = cropH * ratio;
    } else {
      // Image is taller than target ratio — crop width is limiting
      cropW = imgWidth;
      cropH = cropW / ratio;
    }
    return { cropW, cropH, ratio };
  }, [aspectRatio]);

  const getCroppedImage = useCallback(() => {
    if (!imageSrc) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const { cropW, cropH } = getCropDimensions(img.width, img.height);

      // Output size — maintain good quality
      const OUTPUT_LONG_SIDE = 800;
      let outW: number, outH: number;
      if (cropW >= cropH) {
        outW = OUTPUT_LONG_SIDE;
        outH = Math.round(OUTPUT_LONG_SIDE * (cropH / cropW));
      } else {
        outH = OUTPUT_LONG_SIDE;
        outW = Math.round(OUTPUT_LONG_SIDE * (cropW / cropH));
      }
      canvas.width = outW;
      canvas.height = outH;

      // Center the crop on the image, adjusted by user pan
      const sourceX = (img.width - cropW) / 2 - position.x / zoom;
      const sourceY = (img.height - cropH) / 2 - position.y / zoom;
      const sourceW = cropW / zoom;
      const sourceH = cropH / zoom;

      ctx.drawImage(
        img,
        Math.max(0, sourceX),
        Math.max(0, sourceY),
        Math.min(img.width, sourceW),
        Math.min(img.height, sourceH),
        0,
        0,
        outW,
        outH
      );

      const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.92);
      onCropComplete(croppedDataUrl);
    };
    img.src = imageSrc;
  }, [imageSrc, position, zoom, onCropComplete, getCropDimensions]);

  const handleSaveToGallery = useCallback(() => {
    if (!imageSrc || !onSaveToGallery) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const { cropW, cropH } = getCropDimensions(img.width, img.height);
      const OUTPUT_LONG_SIDE = 1200;
      let outW: number, outH: number;
      if (cropW >= cropH) {
        outW = OUTPUT_LONG_SIDE;
        outH = Math.round(OUTPUT_LONG_SIDE * (cropH / cropW));
      } else {
        outH = OUTPUT_LONG_SIDE;
        outW = Math.round(OUTPUT_LONG_SIDE * (cropW / cropH));
      }
      canvas.width = outW;
      canvas.height = outH;

      const sourceX = (img.width - cropW) / 2 - position.x / zoom;
      const sourceY = (img.height - cropH) / 2 - position.y / zoom;
      const sourceW = cropW / zoom;
      const sourceH = cropH / zoom;

      ctx.drawImage(
        img,
        Math.max(0, sourceX),
        Math.max(0, sourceY),
        Math.min(img.width, sourceW),
        Math.min(img.height, sourceH),
        0,
        0,
        outW,
        outH
      );

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      onSaveToGallery(dataUrl);
    };
    img.src = imageSrc;
  }, [imageSrc, position, zoom, onSaveToGallery, getCropDimensions]);

  if (!isOpen) return null;

  // ─── Camera Capture Mode ───
  if (isCapturing) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.95)" }}
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
              <h3 className="text-lg font-semibold text-foreground">Take a Selfie</h3>
              <button onClick={stopCamera} className="p-2 rounded-lg hover:bg-background-tertiary transition-colors">
                <X className="w-5 h-5 text-foreground-muted" />
              </button>
            </div>

            {/* Camera Preview */}
            <div className="relative aspect-square overflow-hidden bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }} // Mirror for selfie feel
              />
              {/* Overlay guide — rectangular frame */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="border-2 border-white/60 rounded-lg" style={{ width: "80%", height: "80%" }}>
                  {/* Corner markers */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white" />
                </div>
              </div>
            </div>

            {/* Capture Button */}
            <div className="p-4 flex justify-center">
              <button
                onClick={capturePhoto}
                className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center hover:bg-white/10 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-white" />
              </button>
            </div>

            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ─── Normal Crop Mode ───
  if (!imageSrc) return null;

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
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
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

            {/* Overlay — rectangular crop frame */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              {/* Dark overlay outside crop area */}
              <div className="absolute inset-0" style={{
                background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 70%)`,
              }} />
              {/* Rectangular crop border */}
              <div
                className="border-2 border-white/80 rounded-lg relative"
                style={{ width: "80%", height: "80%" }}
              >
                {/* Corner markers */}
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white" />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white" />
                {/* Crosshair guides */}
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/20" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
              </div>
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
              {showCamera && (
                <button
                  onClick={startCamera}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-card-border text-foreground-muted hover:bg-background-tertiary transition-colors"
                >
                  <Camera className="w-4 h-4" />
                  Camera
                </button>
              )}
              {showSaveToGallery && (
                <button
                  onClick={handleSaveToGallery}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-card-border text-foreground-muted hover:bg-background-tertiary transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Save
                </button>
              )}
              <button
                onClick={getCroppedImage}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white text-black font-medium hover:bg-white/90 transition-colors"
              >
                <Check className="w-4 h-4" />
                Apply
              </button>
            </div>

            <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
              Drag to position • Zoom to adjust • Tap Apply to confirm
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
