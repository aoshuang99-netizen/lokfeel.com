"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MotionDiv, LazyAnimatePresence } from "@/components/ui/motion-lazy";
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
  /** Whether to show save-to-gallery option (Tab: Save to Gallery) */
  showSaveToGallery?: boolean;
  /** Default action tab: "avatar" or "gallery" */
  defaultAction?: "avatar" | "gallery";
  /** Max output long side in pixels (default: 1024) */
  maxOutputSize?: number;
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
  defaultAction = "avatar",
  maxOutputSize = 1024,
}: ImageCropModalProps) {
  const [zoom, setZoom] = useState(0.85);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isCapturing, setIsCapturing] = useState(false);
  const [actionTab, setActionTab] = useState<"avatar" | "gallery">(defaultAction);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Reset tab when modal opens with a new default
  useEffect(() => {
    if (isOpen) {
      setActionTab(defaultAction);
    }
  }, [isOpen, defaultAction]);

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
    e.preventDefault(); // Prevent iOS Safari elastic scrolling during crop drag
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault(); // Prevent iOS Safari elastic scrolling during crop drag
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
    // Cap camera capture to 512px long side for avatar
    const MAX_SIDE = 512;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let outW: number, outH: number;
    if (vw >= vh) {
      outW = Math.min(vw, MAX_SIDE);
      outH = Math.round(outW * (vh / vw));
    } else {
      outH = Math.min(vh, MAX_SIDE);
      outW = Math.round(outH * (vw / vh));
    }
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    stopCamera();
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

  // ─── Crop Logic ───
  const getCropDimensions = useCallback((imgWidth: number, imgHeight: number) => {
    let ratio: number;
    switch (aspectRatio) {
      case "portrait": ratio = 3 / 4; break;
      case "landscape": ratio = 4 / 3; break;
      case "square": default: ratio = 1; break;
    }
    if (typeof aspectRatio === "number") ratio = aspectRatio;

    let cropW: number, cropH: number;
    const imgRatio = imgWidth / imgHeight;
    if (imgRatio > ratio) {
      cropH = imgHeight;
      cropW = cropH * ratio;
    } else {
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

    let completed = false; // Guard against timeout + onload double-fire
    const img = new Image();
    // ⚠️ Do NOT set crossOrigin for data: URLs — Safari silently refuses to load them
    img.onload = () => {
      if (completed) return;
      completed = true;
      console.log("[Crop] Image loaded, natural size:", img.naturalWidth, "x", img.naturalHeight);
      try {
        const { cropW, cropH } = getCropDimensions(img.width, img.height);
        // Use configurable max output size
        const OUTPUT_LONG_SIDE = maxOutputSize;
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

        const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
        console.log("[Crop] Canvas output length:", croppedDataUrl.length, `(${outW}x${outH})`);

        // Fallback: if canvas output is empty/invalid, use original imageSrc
        if (croppedDataUrl.length < 100) {
          console.warn("[Crop] Canvas output too small, using original image");
          onCropComplete(imageSrc);
        } else {
          onCropComplete(croppedDataUrl);
        }
      } catch (err) {
        // toDataURL can throw on tainted canvas
        console.error("[Crop] Canvas operation failed:", err);
        onCropComplete(imageSrc);
      }
    };
    img.onerror = (e) => {
      if (completed) return;
      completed = true;
      // If image fails to load, pass original through as fallback
      console.warn("[Crop] Image failed to load, using original. Event:", e);
      onCropComplete(imageSrc);
    };
    img.src = imageSrc;

    // Timeout safety — if img never loads (e.g. Safari data URL block), use original after 3s
    setTimeout(() => {
      if (!completed && !canvas.width) {
        completed = true;
        console.warn("[Crop] Image load timed out, using original");
        onCropComplete(imageSrc);
      }
    }, 3000);
  }, [imageSrc, position, zoom, onCropComplete, getCropDimensions, maxOutputSize]);

  const handleSaveToGallery = useCallback(() => {
    if (!imageSrc || !onSaveToGallery) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let completed = false; // Guard against timeout + onload double-fire
    const img = new Image();
    // ⚠️ Do NOT set crossOrigin for data: URLs — Safari silently refuses to load them
    img.onload = () => {
      if (completed) return;
      completed = true;
      try {
        const { cropW, cropH } = getCropDimensions(img.width, img.height);
        // Gallery: use configurable max output size
        const OUTPUT_LONG_SIDE = maxOutputSize;
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

        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        if (dataUrl.length < 100) {
          console.warn("[Gallery] Canvas output too small, using original");
          onSaveToGallery(imageSrc);
        } else {
          onSaveToGallery(dataUrl);
        }
      } catch (err) {
        console.error("[Gallery] Canvas operation failed:", err);
        onSaveToGallery(imageSrc);
      }
    };
    img.onerror = (e) => {
      if (completed) return;
      completed = true;
      console.warn("[Gallery] Image failed to load, using original. Event:", e);
      onSaveToGallery(imageSrc);
    };
    img.src = imageSrc;

    // Timeout safety — if img never loads, use original after 3s
    setTimeout(() => {
      if (!completed && !canvas.width) {
        completed = true;
        console.warn("[Gallery] Image load timed out, using original");
        onSaveToGallery(imageSrc);
      }
    }, 3000);
  }, [imageSrc, position, zoom, onSaveToGallery, getCropDimensions, maxOutputSize]);

  if (!isOpen) return null;

  // ─── Camera Capture Mode ───
  if (isCapturing) {
    return (
      <LazyAnimatePresence>
        <MotionDiv
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.95)" }}
        >
          <MotionDiv
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{
              background: "var(--background-secondary, #f5f0eb)",
              border: "1px solid var(--card-border, rgba(0,0,0,0.08))",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-4 border-b"
              style={{ borderColor: "var(--card-border, rgba(0,0,0,0.08))" }}
            >
              <h3 className="text-lg font-semibold text-foreground">Take a Selfie</h3>
              <button onClick={stopCamera} className="p-2 rounded-lg hover:bg-black/5 transition-colors">
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
                style={{ transform: "scaleX(-1)" }}
              />
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="border-2 border-white/60 rounded-lg" style={{ width: "80%", height: "80%" }}>
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
                className="w-16 h-16 rounded-full border-4 border-primary flex items-center justify-center hover:bg-primary/10 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-primary" />
              </button>
            </div>

            <canvas ref={canvasRef} className="hidden" />
          </MotionDiv>
        </MotionDiv>
      </LazyAnimatePresence>
    );
  }

  // ─── Normal Crop Mode ───
  if (!imageSrc) return null;

  const isAvatarTab = actionTab === "avatar";
  const confirmLabel = isAvatarTab ? "Set as Avatar" : "Save to Gallery";

  return (
    <LazyAnimatePresence>
      <MotionDiv
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: "rgba(0,0,0,0.6)" }}
      >
        <MotionDiv
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col"
          style={{
            maxHeight: "min(90vh, 700px)",
            background: "var(--background-secondary, #f5f0eb)",
            border: "1px solid var(--card-border, rgba(0,0,0,0.08))",
          }}
        >
          {/* Header — fixed at top */}
          <div
            className="flex items-center justify-between p-4 border-b shrink-0"
            style={{ borderColor: "var(--card-border, rgba(0,0,0,0.08))" }}
          >
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-black/5 transition-colors"
            >
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>

          {/* Crop Area — capped height, can shrink on small screens */}
          <div className="relative overflow-hidden bg-black shrink min-h-0" style={{ maxHeight: "55vh", aspectRatio: "1 / 1", width: "100%" }}>
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
              <div className="absolute inset-0" style={{
                background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 70%)`,
              }} />
              <div
                className="border-2 border-white/80 rounded-lg relative"
                style={{ width: "80%", height: "80%" }}
              >
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white" />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white" />
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/20" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
              </div>
            </div>
          </div>

          {/* Controls — fixed at bottom, always visible, scrollable if needed */}
          <div className="p-4 space-y-3 shrink-0 overflow-y-auto">
            {/* Zoom Slider */}
            <div className="flex items-center gap-3">
              <ZoomOut className="w-4 h-4 text-foreground-muted shrink-0" />
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--primary, #b5644b) ${((zoom - 0.5) / 2.5) * 100}%, var(--background-tertiary, #e8e0d8) ${((zoom - 0.5) / 2.5) * 100}%)`,
                }}
              />
              <ZoomIn className="w-4 h-4 text-foreground-muted shrink-0" />
            </div>

            {/* Tab Switcher: Set as Avatar / Save to Gallery */}
            {showSaveToGallery && onSaveToGallery && (
              <div
                className="flex rounded-xl overflow-hidden p-1"
                style={{ background: "var(--background-tertiary, #e8e0d8)" }}
              >
                <button
                  onClick={() => setActionTab("avatar")}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all"
                  style={{
                    background: isAvatarTab
                      ? "var(--background-secondary, #f5f0eb)"
                      : "transparent",
                    color: isAvatarTab
                      ? "var(--foreground, #1a1a1a)"
                      : "var(--foreground-muted, #888)",
                    boxShadow: isAvatarTab
                      ? "0 1px 3px rgba(0,0,0,0.08)"
                      : "none",
                  }}
                >
                  <Camera className="w-4 h-4" />
                  Set as Avatar
                </button>
                <button
                  onClick={() => setActionTab("gallery")}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all"
                  style={{
                    background: !isAvatarTab
                      ? "var(--background-secondary, #f5f0eb)"
                      : "transparent",
                    color: !isAvatarTab
                      ? "var(--foreground, #1a1a1a)"
                      : "var(--foreground-muted, #888)",
                    boxShadow: !isAvatarTab
                      ? "0 1px 3px rgba(0,0,0,0.08)"
                      : "none",
                  }}
                >
                  <Upload className="w-4 h-4" />
                  Save to Gallery
                </button>
              </div>
            )}

            {/* Confirm + Reset Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-foreground-muted hover:bg-black/5 transition-colors shrink-0"
                style={{ borderColor: "var(--card-border, rgba(0,0,0,0.12))" }}
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
              {showCamera && (
                <button
                  onClick={startCamera}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-foreground-muted hover:bg-black/5 transition-colors shrink-0"
                  style={{ borderColor: "var(--card-border, rgba(0,0,0,0.12))" }}
                >
                  <Camera className="w-4 h-4" />
                  Retake
                </button>
              )}
              <button
                onClick={() => {
                  console.log("[CropModal] Confirm clicked, actionTab:", actionTab, "hasSaveToGallery:", !!onSaveToGallery);
                  if (actionTab === "gallery" && onSaveToGallery) {
                    handleSaveToGallery();
                  } else {
                    getCroppedImage();
                  }
                }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-white transition-colors"
                style={{
                  background: "var(--primary, #b5644b)",
                }}
              >
                <Check className="w-4 h-4" />
                {confirmLabel}
              </button>
            </div>

            <p className="text-xs text-center text-foreground-muted">
              Drag to position &middot; Zoom to adjust &middot; Tap <strong>{confirmLabel}</strong> to confirm
            </p>
          </div>
        </MotionDiv>
      </MotionDiv>
    </LazyAnimatePresence>
  );
}
