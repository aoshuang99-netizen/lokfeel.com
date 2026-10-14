'use client'

/**
 * P2 · Outcome Observatory —— 成果时间轴与商业指标
 *
 * 依据：`docs/implementation/DESIGN/02-plan.md` §P2「Outcome Observatory 时间轴
 *       （`outcomes` + `metrics`）」。
 *
 * 🔴 两条呈现纪律：
 *
 *   ① **「验证成功」与否只读服务端下发的 `verified` 布尔**。前端不写
 *      `level === 'EXTERNALLY_VERIFIED'` 这类比较 —— T08 的 `isVerified()` 是唯一实现，
 *      散落的比较在日后新增第四级时会**静默漏算**（不报错，只少算）。
 *
 *   ② **口径与假设必须显示**。`metrics` 的金额是"按一份假设算出来的"，
 *      假设随响应下发（单价、每次介入分钟数）。只显示金额、不显示假设，
 *      会让用户把估算当成财务事实 —— 这正是 T08 把 `assumptions` 放进响应的原因。
 */

import { useMemo, useState } from 'react'
import { BadgeCheck, CircleDashed, Clock } from 'lucide-react'
import {
  OBSERVATORY_LEVEL_LABELS,
  assembleObservatoryMetrics,
  assembleObservatoryTimeline,
  formatCurrency,
  observatoryActionRequest,
  type ObservatoryMetricsView,
  type ObservatoryTimeline,
  type ObservatoryTimelineEntry,
} from '@/lib/living/observatory'
import { useApiGet } from '@/hooks/use-api'
import {
  LivingActionResult,
  LivingErrorBox,
  LivingLoadable,
  LivingLoading,
  LivingNotes,
} from '@/components/living/living-states'
import { useLivingPost, type LivingEnvelope } from '@/components/living/use-living-post'

interface OutcomesListPayload {
  items: unknown[]
  count: number
  unverifiedCount: number
}

export interface ObservatoryData {
  timeline: ObservatoryTimeline | null
  timelineLoading: boolean
  timelineError: string | null
  metrics: ObservatoryMetricsView | null
  metricsLoading: boolean
  metricsError: string | null
  action: { ok: boolean; message: string | null } | null
  pendingUrl: string | null
  runAction: (outcomeId: string, action: 'confirm' | 'verify') => void
}

export function useOutcomeObservatoryData(enabled = true): ObservatoryData {
  const outcomesRes = useApiGet<LivingEnvelope<OutcomesListPayload>>(
    enabled ? '/api/v1/outcomes' : null,
  )
  const metricsRes = useApiGet<LivingEnvelope<unknown>>(
    enabled ? '/api/v1/outcomes/metrics' : null,
  )

  const timelineOutcome = useMemo(() => {
    const payload = outcomesRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleObservatoryTimeline(payload)
  }, [outcomesRes.data])

  const metricsOutcome = useMemo(() => {
    const payload = metricsRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleObservatoryMetrics(payload)
  }, [metricsRes.data])

  const { run, pendingUrl } = useLivingPost()
  const [action, setAction] = useState<{ ok: boolean; message: string | null } | null>(null)

  const runAction = (outcomeId: string, outcomeAction: 'confirm' | 'verify') => {
    const req = observatoryActionRequest(outcomeId, outcomeAction)
    void run(req.url, req.body).then((res) => {
      setAction({ ok: res.ok, message: res.message })
      if (res.ok) {
        // 验证级别是派生值 ⇒ 提升后列表与指标都会变，两边都要重取。
        outcomesRes.refetch()
        metricsRes.refetch()
      }
    })
  }

  return {
    timeline: timelineOutcome?.ok ? timelineOutcome.value : null,
    timelineLoading: outcomesRes.isLoading,
    timelineError:
      outcomesRes.error ?? (timelineOutcome && !timelineOutcome.ok ? timelineOutcome.error : null),
    metrics: metricsOutcome?.ok ? metricsOutcome.value : null,
    metricsLoading: metricsRes.isLoading,
    metricsError:
      metricsRes.error ?? (metricsOutcome && !metricsOutcome.ok ? metricsOutcome.error : null),
    action,
    pendingUrl,
    runAction,
  }
}

// ═══════════════════════════════════════════════════════════
// 主视图
// ═══════════════════════════════════════════════════════════

export interface OutcomeObservatoryProps {
  data: ObservatoryData
  selectedOutcomeId: string | null
  onSelectOutcome: (id: string | null) => void
}

export default function OutcomeObservatory({
  data,
  selectedOutcomeId,
  onSelectOutcome,
}: OutcomeObservatoryProps) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Outcome Observatory · 成果时间轴与指标</h1>
        <p className="mt-1 max-w-3xl text-sm text-lf-text-muted">
          「已验证」与否读的是服务端派生的布尔值 ——
          <strong className="font-medium text-lf-text">自报不算验证成功</strong>。
          指标区的金额是按响应里那份假设算出来的，假设会一并显示。
        </p>
      </header>

      {/* ── ① 指标 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-lf-text-muted">商业指标（本社群）</h2>
        {data.metricsLoading ? (
          <LivingLoading label="正在读取指标…" />
        ) : data.metricsError ? (
          <LivingErrorBox message={data.metricsError} />
        ) : data.metrics ? (
          <MetricsPanel metrics={data.metrics} />
        ) : null}
      </section>

      {/* ── ② 时间轴 ── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-lf-text-muted">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          成果时间轴
          {data.timeline && (
            <span className="ml-1 font-normal text-[11px] text-lf-text-faint">
              共 {data.timeline.counts.total} 条 · 已验证 {data.timeline.counts.verified} · 未验证{' '}
              {data.timeline.counts.unverified}（均取自服务端）
            </span>
          )}
        </h2>
        <LivingLoadable
          isLoading={data.timelineLoading}
          error={data.timelineError}
          empty={(data.timeline?.entries.length ?? 0) === 0}
          emptyText="当前没有任何成果记录。这是查询成功后的结论，不是读取失败。"
        >
          <ol className="relative space-y-3 border-l border-lf-line pl-4">
            {(data.timeline?.entries ?? []).map((e) => (
              <TimelineItem
                key={e.id}
                entry={e}
                selected={e.id === selectedOutcomeId}
                onSelect={onSelectOutcome}
                pendingUrl={data.pendingUrl}
                onAction={data.runAction}
              />
            ))}
          </ol>
        </LivingLoadable>

        {data.action && (
          <LivingActionResult
            ok={data.action.ok}
            message={data.action.message}
            successText="验证记录已写入。级别由服务端从记录集派生，本页不自行提升。"
          />
        )}
        <LivingNotes notes={data.timeline?.notes ?? []} title="时间轴说明" />
      </section>
    </div>
  )
}

function TimelineItem({
  entry,
  selected,
  onSelect,
  pendingUrl,
  onAction,
}: {
  entry: ObservatoryTimelineEntry
  selected: boolean
  onSelect: (id: string | null) => void
  pendingUrl: string | null
  onAction: (outcomeId: string, action: 'confirm' | 'verify') => void
}) {
  const confirmReq = observatoryActionRequest(entry.id, 'confirm')
  const verifyReq = observatoryActionRequest(entry.id, 'verify')

  return (
    <li className="relative min-w-0">
      <span
        className={[
          'absolute -left-[21px] top-2 h-2 w-2 rounded-full',
          entry.verified ? 'bg-lf-success' : 'bg-lf-line-strong',
        ].join(' ')}
        aria-hidden="true"
      />
      <div
        className={[
          'min-w-0 rounded-lf border bg-lf-surface p-3',
          selected ? 'border-lf-signal' : 'border-lf-line',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : entry.id)}
            className="lf-focus-ring rounded-lf border border-lf-line px-1.5 py-0.5 text-[11px] text-lf-text"
          >
            {entry.levelLabel}
          </button>
          {entry.verified ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-lf-success">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
              已验证
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-lf-text-faint">
              <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
              未验证（仅自报）
            </span>
          )}
          <span className="text-[11px] text-lf-text-muted">{entry.myRoleLabel}</span>
        </div>

        <p className="mt-2 break-words text-sm text-lf-text">{entry.summary}</p>

        <p className="mt-1 text-[11px] text-lf-text-faint">
          发生 {entry.occurredAt.slice(0, 10)} · 上报 {entry.reportedAt.slice(0, 10)}
          {entry.verifications.length > 0
            ? ` · 验证记录 ${entry.verifications.length} 条`
            : ''}
        </p>

        {(entry.canConfirm || entry.canVerify) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {entry.canConfirm && (
              <button
                type="button"
                disabled={pendingUrl === confirmReq.url}
                aria-disabled={pendingUrl === confirmReq.url}
                onClick={() => onAction(entry.id, 'confirm')}
                className="lf-focus-ring rounded-lf border border-lf-line-strong px-2.5 py-1 text-xs text-lf-text hover:bg-lf-surface-2 disabled:cursor-wait disabled:text-lf-text-faint"
              >
                对手方确认
              </button>
            )}
            {entry.canVerify && (
              <button
                type="button"
                disabled={pendingUrl === verifyReq.url}
                aria-disabled={pendingUrl === verifyReq.url}
                onClick={() => onAction(entry.id, 'verify')}
                className="lf-focus-ring rounded-lf border border-lf-line-strong px-2.5 py-1 text-xs text-lf-text hover:bg-lf-surface-2 disabled:cursor-wait disabled:text-lf-text-faint"
              >
                外部核验
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

// ═══════════════════════════════════════════════════════════
// 指标面板
// ═══════════════════════════════════════════════════════════

function MetricsPanel({ metrics }: { metrics: ObservatoryMetricsView }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* 漏斗 */}
        <div className="min-w-0 rounded-lf border border-lf-line bg-lf-surface p-3">
          <h3 className="text-xs font-medium text-lf-text-muted">
            转化漏斗 · {metrics.scopeLabel}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {metrics.funnel.map((row) => (
              <li key={row.stage} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-lf-text-muted">{row.label}</span>
                  <span className="shrink-0 text-sm tabular-nums text-lf-text">{row.count}</span>
                </div>
                {row.rateToNext !== null && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-lf-surface-2">
                    <div
                      className="h-full bg-lf-signal"
                      style={{ width: `${Math.max(0, Math.min(100, row.rateToNext))}%` }}
                    />
                  </div>
                )}
                {row.rateToNext !== null && row.rateLabel && (
                  <p className="mt-0.5 text-[10px] text-lf-text-faint">
                    {row.rateLabel} {row.rateToNext}%
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-lf-text-faint">
            其中仍在等表态 {metrics.consentPending} 条（是「已发起提案」的子集，不属于漏斗的一级）。
          </p>
        </div>

        {/* 成本与人工 */}
        <div className="min-w-0 rounded-lf border border-lf-line bg-lf-surface p-3">
          <h3 className="text-xs font-medium text-lf-text-muted">成本估算 · {metrics.currency}</h3>
          <ul className="mt-2 space-y-1 text-xs text-lf-text-muted">
            {metrics.cost.rows.map((r) => (
              <li key={r.unit} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  {r.label} × {r.units}
                </span>
                <span className="shrink-0 tabular-nums text-lf-text">
                  {formatCurrency(r.costCents, metrics.currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-baseline justify-between gap-2 border-t border-lf-line pt-2 text-xs">
            <span className="text-lf-text-muted">合计</span>
            <span className="tabular-nums text-sm text-lf-text">
              {formatCurrency(metrics.cost.totalCostCents, metrics.currency)}
            </span>
          </p>

          <h3 className="mt-3 text-xs font-medium text-lf-text-muted">人工介入估算</h3>
          <ul className="mt-1 space-y-1 text-xs text-lf-text-muted">
            <li>
              接管 {metrics.workload.takeovers} · 死信 {metrics.workload.deadLettered} = 需介入{' '}
              <span className="text-lf-text">{metrics.workload.interventions}</span> 次
            </li>
            <li>
              每次 {metrics.workload.minutesPerIntervention} 分钟 ⇒ 约{' '}
              <span className="text-lf-text">{metrics.workload.estimatedHumanHours}</span> 小时
            </li>
          </ul>
        </div>
      </div>

      {/* 假设 —— 必须显示 */}
      <div className="rounded-lf border border-lf-line bg-lf-surface-2 p-3">
        <h3 className="text-xs font-medium text-lf-text-muted">口径与假设（这些数字是这么来的）</h3>
        <ul className="mt-1.5 space-y-1 text-[11px] text-lf-text-muted">
          <li>
            「已验证」判定用的档位：
            {metrics.verifiedLevels.length === 0
              ? '服务端未下发（本页不自行推断）'
              : metrics.verifiedLevels.map((l) => OBSERVATORY_LEVEL_LABELS[l]).join('、')}
          </li>
          <li>每次人工介入按 {metrics.assumptions.minutesPerIntervention} 分钟估算</li>
          {metrics.assumptions.unitCosts.map((line) => (
            <li key={line}>单价假设 · {line}</li>
          ))}
          <li>指标生成时间 {metrics.generatedAt}</li>
        </ul>
        <LivingNotes notes={metrics.notes} title="指标说明" />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// 详情面板
// ═══════════════════════════════════════════════════════════

export function ObservatoryInspector({
  data,
  selectedOutcomeId,
}: {
  data: ObservatoryData
  selectedOutcomeId: string | null
}) {
  const entry = data.timeline?.entries.find((e) => e.id === selectedOutcomeId) ?? null

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          Outcome Lens · 一条成果的依据
        </h3>
        {!entry ? (
          <p className="mt-2 text-xs text-lf-text-muted">
            点击时间轴上某条成果的档位徽章，这里显示它的验证记录与角色。
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="break-words text-sm text-lf-text">{entry.summary}</p>
            <dl className="space-y-2 text-xs">
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">当前档位（服务端派生）</dt>
                <dd className="text-lf-text">
                  {entry.levelLabel}
                  {entry.verified ? '（计入已验证）' : '（不计入已验证）'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">我相对本条的角色</dt>
                <dd className="text-lf-text">{entry.myRoleLabel}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">验证记录</dt>
                <dd className="text-lf-text">
                  {entry.verifications.length === 0 ? (
                    <span className="text-lf-text-faint">
                      无记录 —— 自报本身不产生记录，这正是「自报不算验证成功」的体现。
                    </span>
                  ) : (
                    <ul className="space-y-1">
                      {entry.verifications.map((v) => (
                        <li key={`${v.level}-${v.at}`}>
                          {v.levelLabel} · {v.at.slice(0, 10)}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">时间</dt>
                <dd className="text-lf-text">
                  发生 {entry.occurredAt} · 上报 {entry.reportedAt}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-lf-text-faint">
              记录只给级别与时间：拒绝/核验的理由与证据不外发（服务端刻意不含它们）。
            </p>
          </div>
        )}
      </section>

      <LivingNotes notes={data.timeline?.notes ?? []} title="时间轴说明" />
    </div>
  )
}
