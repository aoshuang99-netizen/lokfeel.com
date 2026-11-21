'use client'

/**
 * V21 · C05 —— 任务（Missions）视图：列表 + 详情 + 状态迁移。
 *
 * 服务端早已提供全部端点（列表/详情/迁移），本组件只是**第一次把它们接给用户**：
 *   - `GET /api/v1/missions` 列表（真实分页与计数，`participantCount` 来自 groupBy）
 *   - `GET /api/v1/missions/{id}` 详情
 *   - `POST /api/v1/missions/{id}/pause` `{action}` 状态迁移（服务端 TRANSITIONS 裁决）
 *
 * 🔴 纪律：
 *   1. **没有点了必 403/409 的按钮**：迁移选项由 `missionTransitions(status, has能力)`
 *      给出（与服务端同构），能力不足或终态就不渲染按钮。
 *   2. **迁移成功只认服务端返回**：2xx 后用响应里的任务刷新本条，再整表 refetch。
 *   3. **三态齐全**：loading / error / empty 都是真实反馈；读不到不显示 0。
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Users } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useApiGet } from '@/hooks/use-api'
import { parseListEnvelope, type ListEnvelopeResult } from '@/lib/living/api/envelope'
import {
  isPublicMissionStatus,
  missionStatusLabel,
  missionTransitions,
  type MissionAction,
  type PublicMissionStatus,
} from '@/lib/living/missions/labels'
import ExecutionPanel from './execution-panel'
import MissionSpecSection from './mission-spec-section'

/**
 * 单对象详情（`GET /api/v1/missions/{id}`）的信封。列表读取**不用**这个形状，
 * 一律走 `parseListEnvelope`（见下方 useMissionList），避免权限错误被读成「没有任务」。
 */
type ApiEnvelope<T> = {
  success: boolean
  data: T
  meta?: { page: number; pageSize: number; total: number; totalPages: number }
  error?: { code: string; message: string }
}

export interface MissionDto {
  id: string
  title: string
  goal: string
  offer: string
  constraints: string[] | null
  successCriteria: string
  status: string
  /** Mission ↔ AgentRun 真实关联锚点（V21 第二批服务端 DTO 新增）。 */
  sourceRunId: string | null
  sharePath?: string
  maxParticipants: number | null
  expiresAt: string | null
  publishedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  participantCount: number
}

function StatusBadge({ status }: { status: PublicMissionStatus }) {
  const tone =
    status === 'ACTIVE'
      ? 'border-lf-signal/50 bg-lf-signal-soft text-lf-signal'
      : status === 'CLOSED'
        ? 'border-lf-line bg-lf-surface-2 text-lf-text-faint'
        : 'border-lf-line bg-lf-surface-2 text-lf-text-muted'
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {missionStatusLabel(status)}
    </span>
  )
}

function Loadable({
  isLoading,
  error,
  errorSuffix,
  abnormal,
  empty,
  emptyText,
  children,
}: {
  isLoading: boolean
  error: string | null
  errorSuffix?: string
  abnormal?: string | null
  empty: boolean
  emptyText: string
  children: React.ReactNode
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-lf-text-muted" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        正在读取…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>读取失败：{error}{errorSuffix}</span>
      </div>
    )
  }
  // 形状不认识 / 前置非空断言失败：不是合法空态，更不是「没有任务」，单独报错。
  if (abnormal) {
    return (
      <div className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>数据异常：{abnormal}</span>
      </div>
    )
  }
  if (empty) {
    return <div className="rounded-lf border border-dashed border-lf-line p-4 text-sm text-lf-text-muted">{emptyText}</div>
  }
  return <>{children}</>
}

/**
 * 列表读取：一律走 `parseListEnvelope`（含 HTTP status），绝不把权限错误 / 畸形载荷
 * 静默当成空列表。refetch 供状态迁移成功后重读。
 */
function useMissionList(url: string): {
  result: ListEnvelopeResult<MissionDto>
  isLoading: boolean
  refetch: () => void
} {
  const { status: authStatus } = useSession()
  const [result, setResult] = useState<ListEnvelopeResult<MissionDto>>({
    kind: 'unexpected',
    items: [],
    count: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  // set-state-in-effect：请求键变化时把 loading 置真移到渲染期（官方 props 变更模式）。
  const fetchKey = `${url}|${authStatus}|${nonce}`
  const [syncedFetchKey, setSyncedFetchKey] = useState(fetchKey)
  if (syncedFetchKey !== fetchKey) {
    setSyncedFetchKey(fetchKey)
    setIsLoading(true)
  }

  useEffect(() => {
    if (authStatus === 'loading') return
    let active = true
    fetch(url)
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!active) return
        setResult(parseListEnvelope<MissionDto>(payload, { status: res.status }))
      })
      .catch(() => {
        if (active) setResult({ kind: 'unexpected', items: [], count: 0 })
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [url, authStatus, nonce])

  return { result, isLoading, refetch }
}

export default function MissionBoard({
  capabilities,
  onSelectMission,
  selectedMissionId,
}: {
  capabilities: Set<string>
  onSelectMission?: (missionId: string | null) => void
  selectedMissionId?: string | null
}) {
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [transitioning, setTransitioning] = useState<MissionAction | null>(null)

  const list = useMissionList('/api/v1/missions?page=1&pageSize=10')
  const detail = useApiGet<ApiEnvelope<MissionDto>>(
    selectedMissionId ? `/api/v1/missions/${selectedMissionId}` : null,
  )

  const items = list.result.items
  const canUpdate = capabilities.has('mission.update')
  const selected = detail.data?.data ?? null

  // 列表前置非空断言：kind='ok' 却 count===0 视为异常（不假绿）；
  // kind='error' 显示权限错误原文，绝不当作「没有任务」。
  const listError =
    list.result.kind === 'error' ? (list.result.message ?? '列表读取失败') : null
  const listAbnormal =
    list.result.kind === 'unexpected'
      ? '任务列表响应形状异常，无法确认是否有数据（不显示为空列表）。'
      : list.result.kind === 'ok' && list.result.count === 0
        ? '列表前置非空断言失败：服务端返回成功但集合为空。'
        : null

  /** 迁移：成功只认服务端返回；无论成败都重读列表与详情。 */
  const runTransition = async (missionId: string, action: MissionAction) => {
    setTransitioning(action)
    setTransitionError(null)
    try {
      const res = await fetch(`/api/v1/missions/${missionId}/pause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json().catch(() => null)) as ApiEnvelope<MissionDto> | null
      if (!res.ok) {
        setTransitionError(json?.error?.message ?? `HTTP ${res.status}`)
        return
      }
      list.refetch()
      detail.refetch()
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : '网络错误')
    } finally {
      setTransitioning(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-lf-text">我的任务</h1>
        <p className="mt-1 text-sm text-lf-text-muted">
          从「开始」屏写下目标、创建的任务都会出现在这里；状态每一步都是服务端裁决的。
        </p>
      </div>

      <Loadable
        isLoading={list.isLoading}
        error={listError}
        errorSuffix={list.result.permissionDenied ? '（这是权限错误，不是「没有任务」）' : undefined}
        abnormal={listAbnormal}
        empty={list.result.kind === 'empty'}
        emptyText="还没有任务。写下一个目标，创建后会在这里跟进。"
      >
        <ul className="space-y-2" data-testid="mission-list">
          {items.map((m) => {
            const status = isPublicMissionStatus(m.status) ? m.status : 'DRAFT'
            const active = m.id === selectedMissionId
            return (
              <li key={m.id}>
                <button
                  type="button"
                  data-testid="mission-item"
                  aria-pressed={active}
                  onClick={() => onSelectMission?.(active ? null : m.id)}
                  className={[
                    'lf-focus-ring w-full rounded-lf border p-3 text-left transition-colors',
                    active ? 'border-lf-signal/60 bg-lf-surface-2' : 'border-lf-line bg-lf-surface hover:bg-lf-surface-2/60',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-sm font-medium text-lf-text">{m.title}</span>
                    <StatusBadge status={status} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-lf-text-muted">{m.goal}</p>
                  <p className="mt-1.5 flex items-center gap-3 text-[11px] text-lf-text-faint">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" aria-hidden="true" />
                      {m.participantCount} 人已加入
                    </span>
                    <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      </Loadable>

      {transitionError && (
        <div className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>操作没生效：{transitionError}</span>
        </div>
      )}

      {selected && (
        <section
          aria-label="任务详情"
          className="space-y-3 rounded-lf-lg border border-lf-line bg-lf-surface p-4"
          data-testid="mission-detail"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-lf-text">{selected.title}</h2>
            {isPublicMissionStatus(selected.status) && <StatusBadge status={selected.status} />}
          </div>

          <div className="space-y-2 text-sm">
            <p className="leading-relaxed text-lf-text-muted">{selected.goal}</p>
            <dl className="space-y-1.5 text-xs">
              {selected.offer && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-lf-text-faint">对价</dt>
                  <dd className="text-lf-text-muted">{selected.offer}</dd>
                </div>
              )}
              {selected.successCriteria && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-lf-text-faint">判据</dt>
                  <dd className="text-lf-text-muted">{selected.successCriteria}</dd>
                </div>
              )}
              {selected.constraints && selected.constraints.length > 0 && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-lf-text-faint">约束</dt>
                  <dd className="text-lf-text-muted">{selected.constraints.join('、')}</dd>
                </div>
              )}
              {selected.expiresAt && (
                <div className="flex gap-2">
                  <dt className="shrink-0 text-lf-text-faint">期限</dt>
                  <dd className="text-lf-text-muted">{new Date(selected.expiresAt).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          </div>

          {isPublicMissionStatus(selected.status) &&
            (() => {
              const options = missionTransitions(selected.status, canUpdate)
              if (options.length === 0) return null
              return (
                <div className="flex flex-wrap items-center gap-2 border-t border-lf-line pt-3">
                  {canUpdate ? (
                    options.map((t) => (
                      <button
                        key={t.action}
                        type="button"
                        data-testid={`mission-transition-${t.action}`}
                        disabled={transitioning !== null}
                        onClick={() => void runTransition(selected.id, t.action)}
                        className="lf-focus-ring min-h-9 rounded-lf border border-lf-line-strong px-3 text-xs font-medium text-lf-text transition-colors hover:bg-lf-surface-2 disabled:opacity-50"
                      >
                        {transitioning === t.action ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : t.to === 'CLOSED' ? (
                          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                        ) : null}
                        {t.label}
                      </button>
                    ))
                  ) : (
                    <p className="text-[11px] text-lf-text-faint">
                      当前角色不能改动任务状态（需要更高的组织角色）。
                    </p>
                  )}
                </div>
              )
            })()}

          {/* V21 第二批 · C04：字段级编辑 + 版本历史（刷新不丢、409 冲突可见） */}
          <MissionSpecSection
            missionId={selected.id}
            sourceRunId={selected.sourceRunId ?? null}
            locked={selected.status === 'CLOSED'}
          />

          {/* V21 第二批：服务端真实闭环（运行 / 审批 / 执行 / 回执 / 独立核验） */}
          <ExecutionPanel mission={selected} capabilities={capabilities} />
        </section>
      )}
    </div>
  )
}
