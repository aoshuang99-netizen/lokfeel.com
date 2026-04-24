"use client";

import { RefreshCw } from "lucide-react";

interface InlineErrorProps {
  error: string;
  onRetry?: () => void;
  className?: string;
}

export default function InlineError({ error, onRetry, className = "" }: InlineErrorProps) {
  return (
    <div className={`glass-card border-error/30 p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-error/20 flex items-center justify-center flex-shrink-0">
          <span className="text-error text-lg">!</span>
        </div>
        <div className="flex-1">
          <p className="text-sm text-foreground">{error}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="p-2 rounded-lg hover:bg-background-tertiary text-foreground-muted hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
