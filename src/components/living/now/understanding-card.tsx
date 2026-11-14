'use client'

/**
 * V21 · C02/C03 —— 理解卡：把「系统怎么理解你的目标」摊在用户面前。
 *
 * 三层信息，一层比一层深：
 *   1. **来源徽章**（必显）：AI 理解 / 规则方案 —— 规则永不冒充 AI（F02 硬约束）。
 *   2. **降级原因 / 注入告警**（有才显）：note 是服务端或本地兜底的人话解释；
 *      注入告警只陈述事实（"检测到可疑指令，已转人工确认"），不渲染原文。
 *   3. **运行证据**（折叠）：runId / 状态 / 归因 —— 证据按需展开，不占首屏（V21-G13）。
 */

import { AlertTriangle, CheckCircle2, Sparkles, Wand2 } from 'lucide-react'
import { provenanceBadge, type IntentOutcome } from '@/lib/living/now/intent-gateway'

export default function UnderstandingCard({
  outcome,
  onReset,
}: {
  outcome: Extract<IntentOutcome, { kind: 'ok' }>
  onReset?: () => void
}) {
  const badge = provenanceBadge(outcome.provenance)
  const isAi = outcome.provenance === 'ai'

  return (
    <section
      aria-label="系统对你的目标的理解"
      className="rounded-lf-lg border border-lf-line bg-lf-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          data-testid="intent-provenance-badge"
          title={badge.detail}
          className={[
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
            isAi
              ? 'border-lf-signal/50 bg-lf-signal-soft text-lf-signal'
              : 'border-lf-line bg-lf-surface-2 text-lf-text-muted',
          ].join(' ')}
        >
          {isAi ? (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {badge.label}
        </span>
        <span className="flex items-center gap-1 text-xs text-lf-text-faint">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          已生成可编辑方案
        </span>
      </div>

      <h2 className="mt-3 text-base font-semibold text-lf-text">{outcome.spec.title}</h2>
      {outcome.spec.summary && (
        <p className="mt-1 text-sm leading-relaxed text-lf-text-muted">{outcome.spec.summary}</p>
      )}

      {outcome.note && (
        <p
          className="mt-3 rounded-lf border border-lf-line bg-lf-surface-2 p-2.5 text-xs leading-relaxed text-lf-text-muted"
          role="note"
        >
          {outcome.note}
        </p>
      )}

      {outcome.meta.injectionFlagged && (
        <p
          className="mt-2 flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-2.5 text-xs leading-relaxed text-lf-danger"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          目标文本里检测到疑似指令的内容，已按数据对待、未执行；如需对外动作会先请求你的确认。
        </p>
      )}

      <details className="mt-3 rounded-lf border border-lf-line bg-lf-surface-2/40">
        <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-lf-text-muted transition-colors hover:text-lf-text">
          本次理解的来源与证据
        </summary>
        <ul className="space-y-1 border-t border-lf-line px-3 py-2 text-[11px] text-lf-text-muted">
          <li>
            来源：<span className="text-lf-text">{badge.label}</span>
          </li>
          <li>
            运行记录：<span className="text-lf-text">{outcome.meta.runId ?? '（本地规则，无服务端运行）'}</span>
          </li>
          {outcome.meta.status && (
            <li>
              服务端状态：<span className="text-lf-text">{outcome.meta.status}</span>
              {outcome.meta.replayed ? '（重复提交，返回同一次运行）' : ''}
            </li>
          )}
          {outcome.meta.degradeCode && (
            <li>
              降级原因码：<span className="text-lf-text">{outcome.meta.degradeCode}</span>
            </li>
          )}
        </ul>
      </details>

      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="lf-focus-ring mt-3 rounded-lf px-2 py-1 text-xs text-lf-text-muted transition-colors hover:text-lf-text"
        >
          换一个目标
        </button>
      )}
    </section>
  )
}
