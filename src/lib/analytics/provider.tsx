/**
 * Analytics Provider — Global tracking initialization
 * 
 * Wrap your root layout with this to auto-initialize the tracker.
 * Handles page view tracking on route changes.
 */

'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { initTracker, getTracker, type TrackerConfig } from './tracker';

interface AnalyticsProviderProps {
  children: ReactNode;
  appVersion?: string;
  endpoint?: string;
  sampleRate?: number;
  debug?: boolean;
}

export function AnalyticsProvider({
  children,
  appVersion,
  endpoint,
  sampleRate,
  debug,
}: AnalyticsProviderProps) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const tracker = initTracker({
      appVersion,
      endpoint,
      sampleRate,
      debug: debug ?? (typeof window !== 'undefined' && window.location.hostname === 'localhost'),
      autoTrack: true,
    });

    // Track initial page view
    tracker.trackPageView();

    // Track route changes (Next.js App Router)
    // Note: Next.js 16 with Turbopack handles navigation differently
    const handleRouteChange = () => {
      tracker.trackPageView();
    };

    window.addEventListener('popstate', handleRouteChange);

    // For Next.js Link clicks, patch pushState/replaceState
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
      originalPushState(...args);
      handleRouteChange();
    };

    history.replaceState = function (...args) {
      originalReplaceState(...args);
      handleRouteChange();
    };

    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, [appVersion, endpoint, sampleRate, debug]);

  return <>{children}</>;
}

/**
 * Convenience function: identify user after login
 */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  try {
    const tracker = getTracker();
    tracker.identify(userId, traits);
  } catch {
    // Silently ignore if tracker not initialized
  }
}
