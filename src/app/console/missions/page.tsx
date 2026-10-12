'use client'

/**
 * T07 · Console — 任务（Missions）列表屏
 *
 * 数据源：`GET /api/v1/missions`（T02 已就绪，`mission.read` = OPERATOR+）。
 *
 * 🔴 AC-18 的「无空按钮」在这里的三条落实：
 *   1. 状态过滤条是真按钮（点了真的改查询，不是装饰）；
 *   2. 每行是真的 `<Link>`，落地页 `[missionId]` 已实现；
 *   3. **没有「新建任务」按钮** —— 创建流程（含 `Idempotency-Key` 契约）尚未做界面，
 *      所以这里不渲染它，而是把事实写出来。渲染一个点了没反应的"新建"就是空按钮。
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, RefreshCw, Target, Users } from 'lucide-react'
import { useApiGet } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
  meta?: { total?: number; page?: number; pageSize?: number; totalPages?: number }
}

interface MissionDto {
  id: string
  title: string
  goal: string
  status: string
  publicPreview: boolean
  participantCount: number
  maxParticipants: number | null
  createdAt: string
  publishedAt: string | null
  closedAt: string | null
}

const STATUS_FILTERS = [
  { value: 'ALL', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'ACTIVE', label: '进行中' },
  { value: 'PAUSED', label: '已暂停' },
  { value: 'CLOSED', label: '已关闭' },
] as const

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-background-tertiary text-foreground-muted' },
  ACTIVE: { label: '进行中', className: 'bg-success/15 text-success' },
  PAUSED: { label: '已暂停', className: 'bg-warning/15 text-warning' },
  CLOSED: { label: '已关闭', className: 'bg-background-tertiary text-foreground-subtle' },
}

const PAGE_SIZE = 20

export default function ConsoleMissionsPage() {
  const [status, setStatus] = useState<string>('ALL')
  const [page, setPage] = useState(1)

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (status !== 'ALL') p.set('status', status)
    return `/api/v1/missions?${p.toString()}`
  }, [status, page])

  const missions = useApiGet<ApiEnvelope<MissionDto[]>>(url)

  const items = missions.data?.data ?? []
  const meta = missions.data?.meta
  const total = meta?.total ?? 0
  const totalPages = meta?.totalPages ?? 1

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground font-display">连接任务</h1>
          <p className="text-xs text-foreground-muted mt-0.5">
            社群发起的连接任务 —— 每条任务是一个「大家想一起做成的事」的入口。
          </p>
        </div>
        <button
          type="button"
          onClick={() => missions.refetch()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${missions.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── 状态过滤：真按钮（点了真的改查询） ── */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setStatus(f.value)
              setPage(1)
            }}
            aria-pressed={status === f.value}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              status === f.value
                ? 'bg-primary/15 text-primary font-medium'
                : 'border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {missions.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
          <RefreshCw className="w-4 h-4 animate-spin" />
          正在读取任务…
        </div>
      ) : missions.error ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <p className="text-sm text-warning mb-1">读不到任务列表</p>
          <p className="text-sm text-foreground-muted">{missions.error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <div className="flex items-center gap-2 text-foreground-muted mb-2">
            <Target className="w-4 h-4" />
            <p className="text-sm font-medium text-foreground">
              {status === 'ALL' ? '本社群还没有连接任务' : '这个状态下没有任务'}
            </p>
          </div>
          <p className="text-sm text-foreground-muted">
            {status === 'ALL'
              ? '任务需要通过 API 创建（POST /api/v1/missions，契约要求 Idempotency-Key）。创建界面在后续切片，这里先不渲染"新建"按钮 —— 一个点了没反应的按钮比没有按钮更糟。'
              : '换个状态看看，或切回「全部」。'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => {
            const badge = STATUS_BADGE[m.status] ?? {
              label: m.status,
              className: 'bg-background-tertiary text-foreground-muted',
            }
            return (
              <li key={m.id}>
                <Link
                  href={`/console/missions/${m.id}`}
                  className="block rounded-xl border border-card-border bg-background-secondary p-4 hover:bg-background-tertiary/40 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    {m.publicPreview ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-muted">
                        公开预览
                      </span>
                    ) : null}
                    <ChevronRight className="w-4 h-4 ml-auto text-foreground-subtle" />
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{m.title}</p>
                  <p className="text-xs text-foreground-muted mt-0.5 line-clamp-2">{m.goal}</p>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-foreground-subtle">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      感兴趣 {m.participantCount}
                      {m.maxParticipants ? ` / ${m.maxParticipants}` : ''}
                    </span>
                    <span>创建于 {new Date(m.createdAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── 分页：只在真有多页时渲染（单页渲染分页控件是另一种空按钮） ── */}
      {!missions.isLoading && !missions.error && totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-foreground-muted">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border border-card-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页 · 共 {total} 条
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg border border-card-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  )
}
