'use client'

/**
 * Living Connection OS — 五区布局外壳（P0 · Design Foundation）
 *
 * 依据：`docs/implementation/DESIGN/02-plan.md` P0「布局系统」。
 * 五区 = 左侧 Dock(64–80) + 顶部 ContextBar(56–64) + 中央 Canvas + 右侧 Inspector(320–400，可收起)
 *        + 底部 Command Composer（浮动、可展开）。
 *
 * 设计约束（都是**可验证的不变量**，由 `npm run check:ui-invariants` 把守）：
 *   1. 未就绪能力**不得**渲染成可点按钮 —— 必须 `disabled` + 明确原因（AC-18「无空按钮」）。
 *   2. 主题与动效**只**作用在本节点的 `data-lf-*` 属性上 → 不影响全站既有页面。
 *   3. 响应式：<1024px 时 Dock 退化为横向条、Inspector 收进浮层；显式 `min-w-0` 防溢出。
 *   4. `prefers-reduced-motion` 时强制 L0（由 globals.css 的媒体查询兜底，这里同步 data 属性）。
 */

import { useCallback, useSyncExternalStore, useState, type ReactNode } from 'react'
import { Contrast, PanelRight, PanelRightClose } from 'lucide-react'

export interface LivingNavItem {
  key: string
  label: string
  hint: string
  /** 是否已就绪（可点）。false 时必须给 `reason`。 */
  ready: boolean
  /** 未就绪原因 —— 会原样展示给用户，不能写"敬请期待"这种没信息量的话。 */
  reason?: string
}

export type LivingTheme = 'field' | 'paper'

interface LivingShellProps {
  nav: LivingNavItem[]
  activeKey: string
  onNavigate: (key: string) => void
  /** 顶部右侧：身份、通知等（由页面提供真实数据）。 */
  contextExtra?: ReactNode
  /** 中央工作区。 */
  children: ReactNode
  /** 右侧证据/详情面板。 */
  inspector?: ReactNode
  /** 底部命令输入区。 */
  composer?: ReactNode
  /** 工作区标题（ContextBar 左）。 */
  title: string
}

const THEME_KEY = 'lf-theme'

// 主题是"外部系统"状态（localStorage + 系统偏好）——用 useSyncExternalStore 订阅，
// 而不是在 useEffect 里 setState（后者会触发级联渲染，被 react-hooks/set-state-in-effect 拦）。
const themeListeners = new Set<() => void>()
function subscribeTheme(cb: () => void) {
  themeListeners.add(cb)
  return () => {
    themeListeners.delete(cb)
  }
}
function readThemeSnapshot(): LivingTheme {
  if (typeof window === 'undefined') return 'field'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'field' || saved === 'paper') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'field'
}
function writeTheme(next: LivingTheme) {
  try {
    window.localStorage.setItem(THEME_KEY, next)
  } catch {
    /* 隐私模式下写不了 localStorage —— 不影响本次会话生效 */
  }
  for (const cb of themeListeners) cb()
}

export default function LivingShell({
  nav,
  activeKey,
  onNavigate,
  contextExtra,
  children,
  inspector,
  composer,
  title,
}: LivingShellProps) {
  // 服务端快照固定 'field' → 首屏与 SSR 一致，挂载后由 useSyncExternalStore 取真实值，不会 hydration 失配。
  const theme = useSyncExternalStore(subscribeTheme, readThemeSnapshot, () => 'field' as LivingTheme)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)

  const toggleTheme = useCallback(() => {
    writeTheme(theme === 'field' ? 'paper' : 'field')
  }, [theme])

  const hasInspector = Boolean(inspector)

  return (
    <div
      data-lf-theme={theme}
      data-lf-motion="2"
      className="flex min-h-dvh flex-col bg-lf-bg text-lf-text"
    >
      {/* ── 顶部 Context Bar（56–64px） ── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-lf-line bg-lf-surface px-3 lg:h-16 lg:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-lf-signal">LOKFEEL</span>
          <span className="hidden text-xs text-lf-text-muted sm:inline">/ {title}</span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {contextExtra}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'field' ? '切换到明亮模式（Living Paper）' : '切换到深色模式（Deep Field）'}
            className="lf-focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lf border border-lf-line text-lf-text-muted transition-colors hover:text-lf-text"
            style={{ transitionDuration: 'var(--lf-dur-fast)' }}
          >
            <Contrast className="h-4 w-4" aria-hidden="true" />
          </button>
          {hasInspector && (
            <button
              type="button"
              onClick={() => setInspectorOpen((v) => !v)}
              aria-label={inspectorOpen ? '收起证据面板' : '展开证据面板'}
              aria-pressed={inspectorOpen}
              className="lf-focus-ring hidden h-9 w-9 items-center justify-center rounded-lf border border-lf-line text-lf-text-muted transition-colors hover:text-lf-text lg:inline-flex"
              style={{ transitionDuration: 'var(--lf-dur-fast)' }}
            >
              {inspectorOpen ? (
                <PanelRightClose className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelRight className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
          {hasInspector && (
            <button
              type="button"
              onClick={() => setMobileInspectorOpen(true)}
              className="lf-focus-ring inline-flex h-9 items-center rounded-lf border border-lf-line px-2 text-xs text-lf-text-muted lg:hidden"
            >
              证据
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ── 左侧 Dock（桌面 64–80px；<1024px 退化为横向条） ── */}
        <nav
          aria-label="工作区导航"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-lf-line bg-lf-surface px-2 py-2 lg:w-20 lg:flex-col lg:overflow-x-visible lg:border-b-0 lg:border-r lg:py-4"
        >
          {nav.map((item) => {
            const active = item.key === activeKey
            if (!item.ready) {
              // 🔴 未就绪：**不可点**，且把原因写进 accessible name —— 不是空按钮。
              return (
                <button
                  key={item.key}
                  type="button"
                  disabled
                  aria-disabled="true"
                  title={item.reason}
                  className="flex shrink-0 cursor-not-allowed flex-col items-center gap-1 rounded-lf px-3 py-2 text-center text-[11px] text-lf-text-faint lg:w-full lg:px-1"
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="whitespace-nowrap text-[10px] text-lf-text-faint">未就绪</span>
                </button>
              )
            }
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                aria-current={active ? 'page' : undefined}
                title={item.hint}
                className={[
                  'lf-focus-ring flex shrink-0 flex-col items-center gap-1 rounded-lf px-3 py-2 text-center text-[11px] transition-colors lg:w-full lg:px-1',
                  active ? 'bg-lf-signal-soft text-lf-signal' : 'text-lf-text-muted hover:text-lf-text',
                ].join(' ')}
                style={{ transitionDuration: 'var(--lf-dur-fast)' }}
              >
                <span className="font-medium">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* ── 中央 Living Canvas ── */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 pb-28 lg:p-5 lg:pb-32">
          {children}
        </main>

        {/* ── 右侧 Context Inspector（≥1024px，可收起） ── */}
        {hasInspector && inspectorOpen && (
          <aside
            aria-label="证据与详情"
            className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-lf-line bg-lf-surface p-4 lg:block"
          >
            {inspector}
          </aside>
        )}
      </div>

      {/* ── 移动端 Inspector 浮层 ── */}
      {hasInspector && mobileInspectorOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="关闭证据面板"
            onClick={() => setMobileInspectorOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-lf-lg border-t border-lf-line bg-lf-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">证据与详情</h2>
              <button
                type="button"
                onClick={() => setMobileInspectorOpen(false)}
                className="lf-focus-ring rounded-lf px-2 py-1 text-xs text-lf-text-muted"
              >
                关闭
              </button>
            </div>
            {inspector}
          </div>
        </div>
      )}

      {/* ── 底部 Command Composer（浮动） ── */}
      {composer && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3 lg:px-6 lg:pb-5">
          <div className="pointer-events-auto w-full max-w-3xl rounded-lf-lg border border-lf-line-strong bg-lf-surface p-2 shadow-lg">
            {composer}
          </div>
        </div>
      )}
    </div>
  )
}
