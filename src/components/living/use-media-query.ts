'use client'

/**
 * Living Connection OS · P1 —— 媒体查询订阅
 *
 * 用 `useSyncExternalStore` 把 `matchMedia` 当**外部系统状态**订阅，
 * 而不是在 `useEffect` 里 `setState`（后者会触发级联渲染，被
 * `react-hooks/set-state-in-effect` 拦 —— P0 已踩过）。
 *
 * 服务端快照固定返回 `false`，保证首屏 SSR 与 hydration 一致。
 */

import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onStoreChange)
      return () => mql.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
