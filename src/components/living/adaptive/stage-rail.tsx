'use client'

/**
 * Adaptive Dual World —— 阶段条（设计 C 的"变形驱动源"）
 *
 * 为什么需要它：审计（`docs/v16/04_UX_AUDIT_13_SCREENS.md` F-06）发现
 * 六屏之间没有"我现在在哪、下一步该我做什么"的连续性 —— 用户得自己记住
 * 提案在 Consent、批准在 Agents、核验在 Outcomes。
 *
 * 这条轨道把**同一条流水线**横向摊开，并如实标出每段的真实计数：
 *   · 数字来自 `buildOsStages`（纯函数，见 `src/lib/living/adaptive/stages.ts`）；
 *   · 读不到的段落显示「—」，**不是 0**；
 *   · 点一段 = 聚焦到对应的屏（这是"随阶段变形"的唯一驱动方式，
 *     ⚠️ 不做"自动跳屏"：把用户正在读的页面从底下换掉是敌意行为）。
 */

import Link from 'next/link'
import { ArrowRight, CircleDot } from 'lucide-react'
import type { OsStage } from '@/lib/living/adaptive/stages'
import { focusStage, stageStatusLabel } from '@/lib/living/adaptive/stages'

export interface StageRailProps {
  stages: readonly OsStage[]
  /** 当前所在屏（`NAV` 的 key），用于标记"你正在这里"。 */
  activeView: string
  /** 点某段时聚焦到该屏；用 `onFocusView` 而不是内部 `router.push`，便于单页内切视图。 */
  onFocusView?: (view: string) => void
}

export default function StageRail({ stages, activeView, onFocusView }: StageRailProps) {
  const focused = focusStage(stages)

  return (
    <nav aria-label="任务阶段" className="mb-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-lf-text-faint">Mission pipeline</p>
        <p className="text-[11px] text-lf-text-faint">
          计数口径：提案 / 同意 / 执行 / 成果 四个真实端点
        </p>
      </div>

      <ol className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        {stages.map((stage, index) => {
          const isFocused = stage.key === focused
          const isHere = stage.view === activeView
          const status = stageStatusLabel(stage, isFocused)
          const label = `${stage.label}：${
            stage.count === null ? '数据未就绪' : `${stage.count} 项`
          }${isFocused ? '，当前阶段' : ''}${isHere ? '，你正在这一屏' : ''}`

          const body = (
            <>
              <span className="flex items-center gap-1.5">
                {isFocused ? (
                  <CircleDot className="h-3 w-3 shrink-0 text-lf-signal" aria-hidden="true" />
                ) : (
                  <span
                    className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border border-lf-line text-[8px] leading-none text-lf-text-faint"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                )}
                <span className="text-xs font-medium">{stage.label}</span>
                <span className="ml-auto text-sm tabular-nums text-lf-text">
                  {stage.count === null ? '—' : stage.count}
                </span>
              </span>
              <span className="mt-1 block truncate text-[10px] text-lf-text-faint">{status}</span>
            </>
          )

          const className = [
            'lf-focus-ring min-w-[7.5rem] flex-1 rounded-lf border px-2.5 py-2 text-left transition-colors',
            isFocused
              ? 'border-lf-signal/50 bg-lf-signal-soft'
              : 'border-lf-line bg-lf-surface hover:bg-lf-surface-2',
          ].join(' ')

          return (
            <li key={stage.key} className="flex min-w-0 flex-1 items-center gap-1.5">
              {onFocusView ? (
                <button
                  type="button"
                  onClick={() => onFocusView(stage.view)}
                  aria-label={label}
                  aria-current={isFocused ? 'step' : undefined}
                  title={`${stage.hint}\n${stage.countHint}`}
                  className={className}
                >
                  {body}
                </button>
              ) : (
                <Link
                  href={stage.view === 'consent' ? '#consent' : `#${stage.view}`}
                  aria-label={label}
                  aria-current={isFocused ? 'step' : undefined}
                  title={`${stage.hint}\n${stage.countHint}`}
                  className={className}
                >
                  {body}
                </Link>
              )}
              {index < stages.length - 1 && (
                <ArrowRight className="hidden h-3 w-3 shrink-0 text-lf-text-faint sm:block" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>

      {focused && (
        <p className="mt-2 text-[11px] text-lf-text-muted">
          下一步：{stages.find((s) => s.key === focused)?.hint}
        </p>
      )}
    </nav>
  )
}
