'use client'

/**
 * T07 · Console — 任务详情屏（含状态迁移）
 *
 * 数据源：
 *   `GET  /api/v1/missions/{id}`         （`mission.read`）
 *   `POST /api/v1/missions/{id}/pause`   （`mission.update`，body `{ action }`）
 *
 * 🔴 「无空按钮」的关键落点 —— 动作按钮**由状态机派生**，而不是写死四个：
 *   `lib/connection/missions.ts` 的 `TRANSITIONS` 是唯一事实来源：
 *     publish: DRAFT|PAUSED → ACTIVE
 *     pause:   ACTIVE        → PAUSED
 *     resume:  PAUSED        → ACTIVE
 *     close:   DRAFT|ACTIVE|PAUSED → CLOSED
 *   本页据此为每个状态列出**当前合法**的动作。两个后果：
 *   1. 非法动作不会渲染 —— 用户点不到必然 409 的按钮；
 *   2. `PAUSED` 下 `publish` 与 `resume` 都合法（同义），**只渲染 `resume`** ——
 *      同一件事给两个按钮是另一种形式的坏设计。
 *   `CLOSED` 是终态 → 不渲染任何动作按钮，只说明原因。
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, RefreshCw, Users } from 'lucide-react'
import { useApiGet, useApiPost } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

interface MissionDto {
  id: string
  title: string
  goal: string
  offer: string
  constraints: string[]
  successCriteria: string
  status: string
  publicPreview: boolean
  maxParticipants: number | null
  sharePath: string
  participantCount: number
  expiresAt: string | null
  publishedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

type MissionAction = 'publish' | 'pause' | 'resume' | 'close'

/** 与 `TRANSITIONS` 同源的状态 → 合法动作映射（见文件头 🔴）。 */
const ACTIONS_BY_STATUS: Record<string, Array<{ action: MissionAction; label: string; primary: boolean }>> = {
  DRAFT: [
    { action: 'publish', label: '发布', primary: true },
    { action: 'close', label: '关闭', primary: false },
  ],
  ACTIVE: [
    { action: 'pause', label: '暂停', primary: false },
    { action: 'close', label: '关闭', primary: false },
  ],
  PAUSED: [
    { action: 'resume', label: '恢复', primary: true },
    { action: 'close', label: '关闭', primary: false },
  ],
  CLOSED: [],
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-background-tertiary text-foreground-muted' },
  ACTIVE: { label: '进行中', className: 'bg-success/15 text-success' },
  PAUSED: { label: '已暂停', className: 'bg-warning/15 text-warning' },
  CLOSED: { label: '已关闭', className: 'bg-background-tertiary text-foreground-subtle' },
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-card-border bg-background-secondary p-3">
      <p className="text-[11px] text-foreground-subtle mb-1">{label}</p>
      <div className="text-sm text-foreground whitespace-pre-wrap break-words">{children}</div>
    </div>
  )
}

export default function ConsoleMissionDetailPage() {
  const params = useParams<{ missionId: string }>()
  const missionId = params?.missionId ?? ''
  const detail = useApiGet<ApiEnvelope<MissionDto>>(missionId ? `/api/v1/missions/${missionId}` : null)
  const { post, isLoading: isActing, error: actionError } = useApiPost()

  const mission = detail.data?.data
  const actions = useMemo(
    () => (mission ? (ACTIONS_BY_STATUS[mission.status] ?? []) : []),
    [mission]
  )

  const run = async (action: MissionAction) => {
    const res = await post(`/api/v1/missions/${missionId}/pause`, { action })
    if (res) detail.refetch()
  }

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
        <RefreshCw className="w-4 h-4 animate-spin" />
        正在读取任务…
      </div>
    )
  }

  if (detail.error || !mission) {
    return (
      <div className="space-y-4">
        <Link
          href="/console/missions"
          className="inline-flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回任务列表
        </Link>
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <div className="flex items-center gap-2 text-warning mb-2">
            <AlertTriangle className="w-4 h-4" />
            <p className="text-sm font-medium">读不到这条任务</p>
          </div>
          <p className="text-sm text-foreground-muted">
            {detail.error ?? '它可能已被删除，或不属于当前社群。'}
          </p>
        </div>
      </div>
    )
  }

  const badge = STATUS_BADGE[mission.status] ?? {
    label: mission.status,
    className: 'bg-background-tertiary text-foreground-muted',
  }

  return (
    <div className="space-y-5">
      <Link
        href="/console/missions"
        className="inline-flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        返回任务列表
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
          {badge.label}
        </span>
        {mission.publicPreview ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-muted">
            公开预览
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 text-[11px] text-foreground-subtle">
          <Users className="w-3 h-3" />
          感兴趣 {mission.participantCount}
          {mission.maxParticipants ? ` / ${mission.maxParticipants}` : ''}
        </span>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-foreground font-display break-words">
          {mission.title}
        </h1>
        <p className="text-[11px] text-foreground-subtle mt-1">
          创建于 {new Date(mission.createdAt).toLocaleString()}
          {mission.publishedAt ? ` · 发布于 ${new Date(mission.publishedAt).toLocaleString()}` : ''}
          {mission.closedAt ? ` · 关闭于 ${new Date(mission.closedAt).toLocaleString()}` : ''}
        </p>
      </div>

      {/* ── 状态迁移：按钮由状态机派生 ── */}
      <section className="rounded-2xl border border-card-border bg-background-secondary p-4">
        <h2 className="text-sm font-semibold text-foreground font-display mb-1">任务状态</h2>
        {actions.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            已关闭的任务是**终态**，不能再发布、暂停或恢复 —— 需要继续推进时请新建一条任务。
          </p>
        ) : (
          <>
            <p className="text-xs text-foreground-muted mb-3">
              当前状态下可执行的迁移（未列出的动作在服务端会以 409 拒绝，因此这里不渲染它们）。
            </p>
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <button
                  key={a.action}
                  type="button"
                  disabled={isActing}
                  onClick={() => run(a.action)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    a.primary
                      ? 'bg-primary text-primary-foreground hover:opacity-90'
                      : 'border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </>
        )}
        {actionError ? (
          <p className="text-xs text-danger mt-3">操作失败：{actionError}</p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="目标">{mission.goal}</Field>
        <Field label="提供">{mission.offer}</Field>
        <Field label="成功标准">{mission.successCriteria}</Field>
        <Field label="约束">
          {mission.constraints.length ? mission.constraints.join('\n') : '（无）'}
        </Field>
      </div>

      <section className="rounded-xl border border-card-border bg-background-secondary p-3">
        <p className="text-[11px] text-foreground-subtle mb-1">分享路径</p>
        <p className="text-xs text-foreground-muted break-all">
          {mission.sharePath}
          <span className="ml-2 text-foreground-subtle">
            （站内路径；绝对域名由服务端按公开 origin 生成，不在此拼）
          </span>
        </p>
      </section>
    </div>
  )
}
