'use client'

/**
 * Deep Field / Living Paper 的**唯一**主题真值实现。
 *
 * 为什么抽出来：这套逻辑原本长在 `living-shell.tsx` 里（Workspace 六屏在用），
 * Console 七屏没有 —— 于是 13 屏 × 2 主题的矩阵里，Console 那 56 格只能是
 * `THEME_NA`（审计如实记录，但它确实是缺口：同一产品两半，一半能换肤一半不能）。
 * 复制一份到 console 会出现"两份真值"，改一处忘一处是必然的。
 *
 * 三条实现约束（都是在真机上踩出来的，别改）：
 *   1. 主题是**外部系统状态**（localStorage + 系统偏好）。用 `useSyncExternalStore`
 *      订阅，不在 `useEffect` 里 setState —— 后者会级联渲染，且被
 *      `react-hooks/set-state-in-effect` 拦（门禁会红）。
 *   2. 服务端快照固定 `'field'`：首屏与 SSR 一致，挂载后再取真实值，不会有 hydration 失配。
 *   3. 双世界页面（`dualWorld`）的默认值必须是 `'field'` —— 深色画布 + 纸面 Inspector
 *      是设计 C 的品牌识别点。跟随系统偏好只留给非双世界页面，否则浅色系统用户的
 *      第一次打开看到的是全纸面，"双世界"根本没出现。
 */

import { useCallback, useSyncExternalStore } from 'react'

export type LivingTheme = 'field' | 'paper'

const THEME_KEY = 'lf-theme'

const themeListeners = new Set<() => void>()

function subscribeTheme(cb: () => void) {
  themeListeners.add(cb)
  return () => {
    themeListeners.delete(cb)
  }
}

export function readThemeSnapshot(dualDefault = false): LivingTheme {
  if (typeof window === 'undefined') return 'field'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'field' || saved === 'paper') return saved
  if (dualDefault) return 'field'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'field'
}

export function writeTheme(next: LivingTheme) {
  try {
    window.localStorage.setItem(THEME_KEY, next)
  } catch {
    /* 隐私模式下写不了 localStorage —— 不影响本次会话生效 */
  }
  for (const cb of themeListeners) cb()
}

export function useLivingTheme(dualDefault = false): {
  theme: LivingTheme
  toggleTheme: () => void
  setTheme: (t: LivingTheme) => void
} {
  const getTheme = useCallback(() => readThemeSnapshot(dualDefault), [dualDefault])
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'field' as LivingTheme)

  const toggleTheme = useCallback(() => {
    writeTheme(theme === 'field' ? 'paper' : 'field')
  }, [theme])

  return { theme, toggleTheme, setTheme: writeTheme }
}
