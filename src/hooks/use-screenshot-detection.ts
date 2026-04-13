"use client";

import { useEffect, useState, useCallback } from "react";

interface ScreenshotDetectionOptions {
  onScreenshot?: () => void;
  onVisibilityChange?: (isVisible: boolean) => void;
  onDevToolsOpen?: () => void;
  enabled?: boolean;
}

interface ScreenshotDetectionResult {
  isProtected: boolean;
  warning: string | null;
  reportScreenshot: () => Promise<void>;
  clearWarning: () => void;
}

export function useScreenshotDetection({
  onScreenshot,
  onVisibilityChange,
  onDevToolsOpen,
  enabled = true,
}: ScreenshotDetectionOptions = {}): ScreenshotDetectionResult {
  const [warning, setWarning] = useState<string | null>(null);
  const [isProtected] = useState(true);

  // Report screenshot attempt to backend
  const reportScreenshot = useCallback(async () => {
    try {
      await fetch("/api/privacy/screenshot-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });
    } catch (error) {
      console.error("Failed to report screenshot:", error);
    }
  }, []);

  const clearWarning = useCallback(() => {
    setWarning(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Handle PrintScreen key
    const handleKeyDown = (e: KeyboardEvent) => {
      // PrintScreen key
      if (e.key === "PrintScreen") {
        e.preventDefault();
        setWarning("Screenshots are not allowed for privacy protection");
        onScreenshot?.();
        reportScreenshot();
        return;
      }

      // Common screenshot shortcuts
      // Ctrl+Shift+S (Windows Snipping Tool)
      // Cmd+Shift+5 (Mac Screenshot)
      // Ctrl+Shift+Cmd+4 (Mac)
      if (
        (e.ctrlKey && e.shiftKey && e.key === "s") ||
        (e.metaKey && e.shiftKey && (e.key === "5" || e.key === "4"))
      ) {
        setWarning("Screenshots are not allowed for privacy protection");
        onScreenshot?.();
        reportScreenshot();
      }

      // Print shortcut
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        setWarning("Printing is disabled for privacy protection");
        e.preventDefault();
        onScreenshot?.();
        reportScreenshot();
      }
    };

    // Handle visibility change (switching apps)
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === "visible";
      onVisibilityChange?.(isVisible);

      // If user switches away and comes back quickly, might be screenshot
      if (!isVisible) {
        const hideTime = Date.now();
        const handleReturn = () => {
          const awayTime = Date.now() - hideTime;
          if (awayTime < 5000) {
            // Less than 5 seconds
            // Potential screenshot activity
          }
          document.removeEventListener("visibilitychange", handleReturn);
        };
        setTimeout(() => {
          document.addEventListener("visibilitychange", handleReturn, { once: true });
        }, 100);
      }
    };

    // Detect DevTools (basic detection)
    const detectDevTools = () => {
      const threshold = 160;
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;

      if (widthThreshold || heightThreshold) {
        onDevToolsOpen?.();
      }
    };

    // Prevent right-click on images
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG" || target.closest("[data-protected-image]")) {
        e.preventDefault();
        setWarning("Image saving is disabled for privacy protection");
      }
    };

    // Prevent drag on images
    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG" || target.closest("[data-protected-image]")) {
        e.preventDefault();
      }
    };

    // Add event listeners
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("dragstart", handleDragStart);
    window.addEventListener("resize", detectDevTools);

    // CSS to prevent text selection and image dragging
    const style = document.createElement("style");
    style.textContent = `
      [data-privacy-protected] {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
      }
      [data-privacy-protected] img {
        pointer-events: none !important;
        -webkit-user-drag: none !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("dragstart", handleDragStart);
      window.removeEventListener("resize", detectDevTools);
      document.head.removeChild(style);
    };
  }, [enabled, onScreenshot, onVisibilityChange, onDevToolsOpen, reportScreenshot]);

  return {
    isProtected,
    warning,
    reportScreenshot,
    clearWarning,
  };
}
