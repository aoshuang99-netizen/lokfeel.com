/**
 * Analytics React Hooks — type-safe event tracking
 * 
 * Usage:
 *   useTrackPageView('/dashboard');
 *   useTrackEvent('swipe_right', { target_user_id: '123' });
 *   const { track } = useTracker();
 */

'use client';

import { useEffect, useCallback, useRef } from 'react';
import { getTracker } from './tracker';

/**
 * Auto-track page view on mount and path changes
 */
export function useTrackPageView(path?: string): void {
  useEffect(() => {
    const tracker = getTracker();
    tracker.trackPageView(path);
  }, [path]);
}

/**
 * Track an event once (useful for lifecycle events)
 */
export function useTrackEvent(
  event: string,
  properties?: Record<string, unknown>,
  deps: unknown[] = [],
): void {
  const hasFired = useRef(false);

  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;

    const tracker = getTracker();
    tracker.track(event, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Get tracker instance and track function for manual use
 */
export function useTracker() {
  const tracker = getTracker();

  const track = useCallback(
    (event: string, properties?: Record<string, unknown>) => {
      tracker.track(event, properties);
    },
    [],
  );

  const identify = useCallback(
    (userId: string, traits?: Record<string, unknown>) => {
      tracker.identify(userId, traits);
    },
    [],
  );

  return { track, identify, tracker };
}

/**
 * Track component mount/unmount lifecycle
 */
export function useTrackLifecycle(
  componentName: string,
  properties?: Record<string, unknown>,
): void {
  useEffect(() => {
    const tracker = getTracker();
    tracker.track(`${componentName}_mounted`, properties);
    return () => {
      tracker.track(`${componentName}_unmounted`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentName]);
}
