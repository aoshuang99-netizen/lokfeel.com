"use client";

import { Component, ReactNode } from "react";
import { AlertCircle, RefreshCw, Home, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error("Error caught by boundary:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

// Preset error fallback component
export function ErrorFallback({
  error,
  title = "Something went wrong",
  description = "We're sorry, but something unexpected happened. Please try again.",
  onRetry,
  showHome = true,
}: {
  error?: Error | null;
  title?: string;
  description?: string;
  onRetry?: () => void;
  showHome?: boolean;
}) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
      {/* Icon */}
      <div className="w-20 h-20 rounded-full bg-error/10 flex items-center justify-center mb-6">
        <AlertCircle className="w-10 h-10 text-error" />
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold text-white mb-2">{title}</h2>

      {/* Description */}
      <p className="text-white/60 max-w-md mb-6">{description}</p>

      {/* Error details (dev only) */}
      {process.env.NODE_ENV === "development" && error && (
        <div className="w-full max-w-lg mb-6 p-4 rounded-xl bg-white/5 border border-white/10 text-left overflow-auto">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Error Details</p>
          <pre className="text-xs text-error/80 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        )}

        {showHome && (
          <Link href="/dashboard" className="btn-secondary flex items-center gap-2">
            <Home className="w-4 h-4" />
            Go Home
          </Link>
        )}
      </div>
    </div>
  );
}

// Inline error message component
export function InlineError({
  error,
  onDismiss,
  onRetry,
  className = "",
}: {
  error: string | Error | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl bg-error/10 border border-error/20 ${className}`}>
      <AlertCircle className="w-5 h-5 text-error flex-shrink-0" />
      <p className="flex-1 text-sm text-error">{errorMessage}</p>
      <div className="flex items-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="p-1.5 rounded-lg hover:bg-error/10 transition-colors"
            aria-label="Retry"
          >
            <RefreshCw className="w-4 h-4 text-error" />
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg hover:bg-error/10 transition-colors"
            aria-label="Dismiss"
          >
            <span className="text-error text-lg leading-none">×</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Network error component
export function NetworkError({
  onRetry,
  className = "",
}: {
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`text-center py-12 ${className}`}>
      <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-8 h-8 text-warning" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">Connection Issue</h3>
      <p className="text-white/60 text-sm mb-4">
        Unable to connect to the server. Please check your internet connection.
      </p>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </button>
      )}
    </div>
  );
}

// Page-level error handler
export function PageErrorHandler({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  );
}

// Auth error redirect
export function AuthError({ message = "Please sign in to continue" }: { message?: string }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <AlertCircle className="w-10 h-10 text-primary" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">Authentication Required</h2>
      <p className="text-white/60 max-w-md mb-6">{message}</p>
      <Link href="/login" className="btn-primary">
        Sign In
      </Link>
    </div>
  );
}
