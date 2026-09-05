"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// Lightweight, dependency-free windowing hook for chat message lists.
//
// Why this exists: the broker blocks installing @tanstack/react-virtual, so we
// implement a small dynamic-measurement virtualizer inline. It only renders the
// visible slice of a (potentially huge) message array and absolutely-positions
// each row by a measured prefix-offset, so a 5k-message conversation costs the
// same as a ~30-message window.
//
// Safety: variable heights are measured via getBoundingClientRect; measurements
// are cached by a stable key (msgId) so they survive re-renders and prepends.
// ============================================================================

export interface MessageWindow {
  /** Total scrollable height of all items (px). */
  totalSize: number;
  /** First item index to render (inclusive). */
  rangeStart: number;
  /** Last item index to render (inclusive). */
  rangeEnd: number;
  /** Cumulative offset (px) of the item at `index`. */
  offsetOf: (index: number) => number;
  /** Call from each rendered row's ref callback to feed back its measured height. */
  measure: (key: string, el: HTMLElement | null) => void;
  /** Jump the scroll container to the bottom (newest message). */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** True when the viewport is within 120px of the bottom. */
  isAtBottom: () => boolean;
}

export function useMessageWindowing<T>({
  items,
  getKey,
  estimateSize = 64,
  overscan = 10,
  getScrollElement,
}: {
  items: T[];
  getKey: (item: T, index: number) => string;
  estimateSize?: number;
  overscan?: number;
  getScrollElement: () => HTMLElement | null;
}): MessageWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);
  const measurements = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number | null>(null);

  const getMeasured = useCallback(
    (index: number) => measurements.current.get(getKey(items[index], index)) ?? estimateSize,
    [items, getKey, estimateSize],
  );

  // Prefix offsets + total height. Recomputed when items change or a measurement
  // lands (measureVersion bump).
  const { offsets, totalSize } = useMemo(() => {
    const n = items.length;
    const offs = new Array<number>(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      offs[i] = acc;
      acc += measurements.current.get(getKey(items[i], i)) ?? estimateSize;
    }
    return { offsets: offs, totalSize: acc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, estimateSize, getKey, measureVersion]);

  // Track scroll position + viewport height (rAF-throttled scroll).
  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setScrollTop(el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      setViewport(el.clientHeight);
      setScrollTop(el.scrollTop);
    });
    ro.observe(el);
    setScrollTop(el.scrollTop);
    setViewport(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [getScrollElement]);

  // Feed measured heights back; only bump when it actually changed.
  const measure = useCallback((key: string, el: HTMLElement | null) => {
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    const prev = measurements.current.get(key);
    if (prev === undefined || Math.abs(prev - h) > 0.5) {
      measurements.current.set(key, h);
      setMeasureVersion((v) => v + 1);
    }
  }, []);

  // Visible range from current scroll + viewport.
  const { rangeStart, rangeEnd } = useMemo(() => {
    const n = items.length;
    if (n === 0) return { rangeStart: 0, rangeEnd: -1 };
    if (viewport === 0) return { rangeStart: 0, rangeEnd: Math.min(n - 1, overscan) };
    const top = scrollTop;
    const bottom = scrollTop + viewport;
    let first = n;
    for (let i = 0; i < n; i++) {
      if (offsets[i] + getMeasured(i) > top) {
        first = i;
        break;
      }
    }
    if (first === n) first = n - 1;
    let last = first;
    for (let i = first; i < n; i++) {
      if (offsets[i] >= bottom) break;
      last = i;
    }
    return {
      rangeStart: Math.max(0, first - overscan),
      rangeEnd: Math.min(n - 1, last + overscan),
    };
  }, [items, scrollTop, viewport, overscan, getKey, offsets, getMeasured]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = getScrollElement();
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [getScrollElement],
  );

  const isAtBottom = useCallback(() => {
    const el = getScrollElement();
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, [getScrollElement]);

  return {
    totalSize,
    rangeStart,
    rangeEnd,
    offsetOf: (i: number) => offsets[i] ?? 0,
    measure,
    scrollToBottom,
    isAtBottom,
  };
}
