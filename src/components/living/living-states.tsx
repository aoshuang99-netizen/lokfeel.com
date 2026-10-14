'use client'

/**
 * P2 · Living 区的**共享三态渲染**与说明块。
 *
 * 为什么单列一处：三个新区（Consent / Observatory / Agents）与 P2 · Field 都需要同一套
 * "loading / 空 / 错误 / 装配说明"的呈现，而它们最容易出现的一种缺陷是
 * **把不同意思的空态混成一个**：
 *
 *   - `isLoading`   = 还在读
 *   - `error`       = **读不到**（403 / 网络 / 服务端错）
 *   - `empty`       = 读到了，但**确实没有数据**
 *
 * 三者共用一句"暂无数据"时，"没权限"会看起来像"没有内容" —— 用户会去补数据，
 * 而真正该做的是补权限。所以这里把 `error` 的措辞单独写死：明确说"这是读取失败"。
 * 同一条纪律见 `check:ui-invariants` 的 R4（未就绪必须有 reason）。
 */

import { AlertCircle, Info, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

export function LivingLoading({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-lf-text-muted" role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

export function LivingErrorBox({ message, hint }: { message: string; hint?: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="break-words">读取失败：{message}</span>
        <span className="mt-1 block text-[11px] text-lf-text-muted">
          这是<strong className="font-medium">读取失败</strong>，不是「没有数据」 —— 本页不会把它显示成空态。
          {hint ? ` ${hint}` : ''}
        </span>
      </span>
    </div>
  )
}

export function LivingEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-lf border border-dashed border-lf-line p-4 text-sm text-lf-text-muted">{text}</div>
  )
}

export function LivingLoadable({
  isLoading,
  error,
  empty,
  emptyText,
  errorHint,
  loadingLabel,
  children,
}: {
  isLoading: boolean
  error: string | null
  empty: boolean
  emptyText: string
  errorHint?: string
  loadingLabel?: string
  children: ReactNode
}) {
  if (isLoading) return <LivingLoading label={loadingLabel} />
  if (error) return <LivingErrorBox message={error} hint={errorHint} />
  if (empty) return <LivingEmpty text={emptyText} />
  return <>{children}</>
}

/**
 * 装配器产出的说明（来源不可用 / 载荷不认识 / 发生截断 / 口径提示）。
 *
 * 🔴 这些**必须显示**：它们是"为什么这里和我想的不一样"的唯一出口。
 *    藏起说明、只显示结论，会让"读不到"看起来像"没有"。
 */
export function LivingNotes({ notes, title = '说明' }: { notes: readonly string[]; title?: string }) {
  if (notes.length === 0) return null
  return (
    <section className="rounded-lf border border-lf-line bg-lf-surface p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-lf-text-muted">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1 text-xs text-lf-text-muted">
        {notes.map((n) => (
          <li key={n} className="break-words">
            · {n}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 动作结果条（成功 / 失败都**只用服务端的话**说话）。 */
export function LivingActionResult({
  ok,
  message,
  successText,
}: {
  ok: boolean
  message: string | null
  successText: string
}) {
  if (ok) {
    return (
      <p className="rounded-lf border border-lf-signal/40 bg-lf-surface p-2 text-xs text-lf-text" role="status">
        {successText}
      </p>
    )
  }
  return (
    <p
      className="flex items-start gap-1.5 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-2 text-xs text-lf-danger"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="break-words">{message ?? '操作失败（服务端未给出原因）。'}</span>
    </p>
  )
}
