"use client";

import { AlertTriangle, X } from "lucide-react";

interface ScreenshotWarningProps {
  isOpen: boolean;
  onClose: () => void;
  onReport?: () => void;
}

export function ScreenshotWarning({ isOpen, onClose, onReport }: ScreenshotWarningProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Privacy Protection</h3>
            <p className="text-sm text-foreground-muted">Screenshot detected</p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <p className="text-foreground">
            Screenshots are not allowed on LokFee! to protect our community&apos;s privacy.
          </p>
          <div className="p-3 rounded-lg bg-background-tertiary border border-card-border">
            <p className="text-sm text-foreground-muted">
              <strong className="text-foreground">Your user ID is embedded in this image.</strong>
              {" "}Any unauthorized sharing can be traced back to your account.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              onReport?.();
              onClose();
            }}
            className="flex-1 py-2.5 px-4 rounded-xl bg-background-tertiary text-foreground font-medium hover:bg-background-tertiary transition-colors"
          >
            I Understand
          </button>
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-background-tertiary text-foreground-subtle hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
