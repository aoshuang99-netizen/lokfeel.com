'use client'

/**
 * T07 · Console Dashboard（Slice 1）
 *
 * 消费 T06 已就绪的运营视图 API —— BACKLOG §7 的原话：
 * > 运营视图 API（`/api/v1/workflow/*`）已就绪，但**只有 API，没有界面** ——
 * > T07 的 Console 是最自然的消费方（`needsAttention` / `stalled` 正好是"运营待办"列表的数据源）。
 *
 * 四条数据，全部来自真实接口，**没有任何占位数字**：
 *   1. 队列健康度（各状态任务计数）；
 *   2. **需人处置**（死信 / 已接管 / 永久失败）—— 运营的待办；
 *   3. **停滞**的连接（阶段超时未推进）—— 流程卡住 ≠ 任务失败；
 *   4. 投递计数（`sent` / `captured` / `failed` / `pending`）。
 *
 * 🔴 AC-09 的诚实要求：`captured`（沙箱捕获）**不并入** `sent`。
 *    把它算作"已送达"就是虚报外部服务已接通。
 *
 * ⚠️ 本屏刻意**没有**任何跳转到尚未实现屏幕的链接（那会变成 AC-18 说的"空按钮"）。
 *    待处置条目渲染为纯展示行，落地页在 Slice 2/3 补上后再加链接。
 */

import { AlertTriangle, Clock, Inbox, Mail, RefreshCw, Target } from 'lucide-react'
import { useApiGet } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
  meta?: { total?: number; page?: number; pageSize?: number; totalPages?: number }
}

interface WorkflowJobRow {
  id: string
  kind: string
  status: string
  proposalId: string | null
  missionId: string | null
  attempts: number
  maxAttempts: number
  lastError: string | null
  createdAt: string
}

interface WorkflowOverviewDto {
  counts: Record<string, number>
  needsAttention: WorkflowJobRow[]
  stalled: Array<{ proposalId: string; stage: string; stageEnteredAt: string }>
  deliveries: { sent: number; captured: number; failed: number; pending: number }
}

/** 与 `stage-machine.ts` 的 `STAGE_LABELS` 保持一致的展示文案。 */
const STAGE_LABEL: Record<string, string> = {
  PROPOSED: '已提案',
  CONSENT_PENDING: '等待同意',
  INTRODUCED: '已介绍',
  COORDINATING: '协调中',
  ACTION_COMPLETED: '已行动',
  OUTCOME_RECORDED: '已记录结果',
}

/** 队列里"在飞"的状态：运营最关心它们会不会积压。 */
const IN_FLIGHT = ['PENDING', 'RUNNING'] as const

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: number | string
  hint?: string
  tone?: 'default' | 'warn' | 'danger'
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warn'
        ? 'text-warning'
        : 'text-foreground'
  return (
    <div className="rounded-xl border border-card-border bg-background-secondary p-4">
      <p className="text-xs text-foreground-muted mb-1">{label}</p>
      <p className={`text-2xl font-semibold font-display ${toneClass}`}>{value}</p>
      {hint ? <p className="text-[11px] text-foreground-subtle mt-1">{hint}</p> : null}
    </div>
  )
}

function Panel({
  title,
  icon: Icon,
  count,
  emptyText,
  children,
}: {
  title: string
  icon: typeof Inbox
  count: number
  emptyText: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-card-border bg-background-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-foreground-muted" />
        <h2 className="text-sm font-semibold text-foreground font-display">{title}</h2>
        <span className="ml-auto text-xs text-foreground-muted">{count}</span>
      </div>
      {count === 0 ? (
        <p className="text-sm text-foreground-muted">{emptyText}</p>
      ) : (
        children
      )}
    </section>
  )
}

export default function ConsoleDashboardPage() {
  const overview = useApiGet<ApiEnvelope<WorkflowOverviewDto>>('/api/v1/workflow/overview')
  const missions = useApiGet<ApiEnvelope<unknown>>('/api/v1/missions?page=1&pageSize=1')

  if (overview.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
        <RefreshCw className="w-4 h-4 animate-spin" />
        正在读取队列状态…
      </div>
    )
  }

  if (overview.error || !overview.data?.data) {
    return (
      <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
        <div className="flex items-center gap-2 text-warning mb-2">
          <AlertTriangle className="w-4 h-4" />
          <p className="text-sm font-medium">暂时读不到队列状态</p>
        </div>
        <p className="text-sm text-foreground-muted mb-4">
          {overview.error ?? '接口没有返回可用的数据。'}
        </p>
        <button
          type="button"
          onClick={() => overview.refetch()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          重新加载
        </button>
      </div>
    )
  }

  const data = overview.data.data
  const inFlight = IN_FLIGHT.reduce((sum, s) => sum + (data.counts[s] ?? 0), 0)
  const dead = data.counts.DEAD ?? 0
  const missionTotal = missions.data?.meta?.total ?? null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground font-display">社群总览</h1>
        <p className="text-xs text-foreground-muted mt-0.5">
          连接从提案到介绍的全过程是否顺畅 —— 数据每秒都在变，这里读的是**此刻**。
        </p>
      </div>

      {/* ── 关键数字 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="在飞任务" value={inFlight} hint="PENDING + RUNNING，队列里还没做完的" />
        <Stat
          label="需人处置"
          value={data.needsAttention.length}
          hint="死信 / 已接管 / 永久失败"
          tone={data.needsAttention.length > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="停滞连接"
          value={data.stalled.length}
          hint="阶段超时未推进（默认 7 天）"
          tone={data.stalled.length > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="死信"
          value={dead}
          hint="自动重试已用尽，等人接管"
          tone={dead > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* ── 待办 ── */}
      <Panel
        title="需人处置"
        icon={AlertTriangle}
        count={data.needsAttention.length}
        emptyText="当前没有需要人工处置的任务。任务的自动重试与死信晋升都在正常工作。"
      >
        <ul className="space-y-2">
          {data.needsAttention.map((job) => (
            <li
              key={job.id}
              className="rounded-lg border border-card-border bg-background-tertiary/40 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">
                  {job.status}
                </span>
                <span className="text-foreground-muted">{job.kind}</span>
                <span className="ml-auto text-foreground-subtle">
                  尝试 {job.attempts}/{job.maxAttempts}
                </span>
              </div>
              {job.lastError ? (
                <p className="text-[11px] text-foreground-subtle mt-1 break-all">{job.lastError}</p>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-foreground-subtle mt-3">
          接管与手动重试入口在「连接」屏（Slice 3），接口已就绪：`/api/v1/workflow/jobs/&lt;id&gt;/takeover`。
        </p>
      </Panel>

      {/* ── 停滞 ── */}
      <Panel
        title="停滞的连接"
        icon={Clock}
        count={data.stalled.length}
        emptyText="没有卡住的连接。所有进行中的连接都在预期时间内推进。"
      >
        <ul className="space-y-2">
          {data.stalled.map((s) => (
            <li
              key={s.proposalId}
              className="rounded-lg border border-card-border bg-background-tertiary/40 px-3 py-2 flex items-center gap-2 text-xs"
            >
              <span className="px-1.5 py-0.5 rounded bg-background-tertiary text-foreground-muted">
                {STAGE_LABEL[s.stage] ?? s.stage}
              </span>
              <span className="text-foreground-subtle">
                自 {new Date(s.stageEnteredAt).toLocaleDateString()} 起未推进
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ── 投递（AC-09 的诚实口径） ── */}
      <Panel
        title="消息投递"
        icon={Mail}
        count={data.deliveries.sent + data.deliveries.captured}
        emptyText="还没有任何投递记录。"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="已送出" value={data.deliveries.sent} hint="站内信真实落库" />
          <Stat
            label="沙箱捕获"
            value={data.deliveries.captured}
            hint="无邮件凭据时只记录「意图」，≠ 已送达"
            tone={data.deliveries.captured > 0 ? 'warn' : 'default'}
          />
          <Stat label="失败" value={data.deliveries.failed} tone={data.deliveries.failed > 0 ? 'danger' : 'default'} />
          <Stat label="待投" value={data.deliveries.pending} />
        </div>
        <p className="text-[11px] text-foreground-subtle mt-3">
          「沙箱捕获」表示系统记下了要发什么、但**没有**真实外发（未配置邮件凭据）。
          它**不**计入「已送出」—— 把两者混在一起就是虚报外部服务已接通。
        </p>
      </Panel>

      {/* ── 任务（第二个数据面，Slice 2 展开） ── */}
      <section className="rounded-2xl border border-card-border bg-background-secondary p-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-foreground-muted" />
          <h2 className="text-sm font-semibold text-foreground font-display">连接任务</h2>
        </div>
        <p className="text-sm text-foreground-muted mt-2">
          {missionTotal === null
            ? '正在读取任务总数…'
            : `本社群共有 ${missionTotal} 条任务。`}
        </p>
        <p className="text-[11px] text-foreground-subtle mt-1">
          任务列表、意图与暂停操作在「任务」屏（Slice 2）。
        </p>
      </section>
    </div>
  )
}
