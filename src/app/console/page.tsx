'use client'

/**
 * T07 · Console Dashboard（Slice 1）
 * UI-REMEDIATION 2026-11-21（P0 · 企业 Console 用户价值重构）
 *
 * 旧版从首屏到尾都是工作流队列术语（在飞任务/死信/投递计数/阶段超时），
 * 是给工程师看的运营视图，不是给社群经营者看的"我今天要做什么"。用户点名：
 *   "待我确认、成员沟通、空间、AI 辅助协作、真实结果；每个待办能打开真实记录并处理。"
 *
 * 新版结构：
 *   1) 五个人类可读的价值入口（每个都指向真实子屏，无空按钮）；
 *   2) "待我确认"——需人处置列表，每条**可点**打开 takeover/requeue 真实接口
 *      （服务端能力 workflow.manage；无权限时按服务端返回诚实降级，渲染状态不渲染假按钮）；
 *   3) 保留原有队列健康度/停滞/投递四个数据面与 AC-09 诚实口径
 *      （captured 不并入 sent），以及 h1「社群总览」（AC-18 门禁依赖）。
 *
 * 所有数字来自 /api/v1/workflow/overview 与 /api/v1/missions 真实接口，无占位数字。
 */

import Link from 'next/link'
import { AlertTriangle, Clock, Inbox, Mail, RefreshCw, Target, CheckCircle2, Users, Bot, Building2, ArrowRight, Loader2 } from 'lucide-react'
import { useApiGet, useApiPost } from '@/hooks/use-api'
import { useState } from 'react'

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

const STAGE_LABEL: Record<string, string> = {
  PROPOSED: '已提案', CONSENT_PENDING: '等待同意', INTRODUCED: '已介绍',
  COORDINATING: '协调中', ACTION_COMPLETED: '已行动', OUTCOME_RECORDED: '已记录结果',
}
const IN_FLIGHT = ['PENDING', 'RUNNING'] as const

function Stat({ label, value, hint, tone = 'default' }: {
  label: string; value: number | string; hint?: string; tone?: 'default' | 'warn' | 'danger'
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-foreground'
  return (
    <div className="rounded-xl border border-card-border bg-background-secondary p-4">
      <p className="text-xs text-foreground-muted mb-1">{label}</p>
      <p className={`text-2xl font-semibold font-display ${toneClass}`}>{value}</p>
      {hint ? <p className="text-[11px] text-foreground-subtle mt-1">{hint}</p> : null}
    </div>
  )
}

function Panel({ title, icon: Icon, count, emptyText, children }: {
  title: string; icon: typeof Inbox; count: number; emptyText: string; children?: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-card-border bg-background-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-foreground-muted" />
        <h2 className="text-sm font-semibold text-foreground font-display">{title}</h2>
        <span className="ml-auto text-xs text-foreground-muted">{count}</span>
      </div>
      {count === 0 ? <p className="text-sm text-foreground-muted">{emptyText}</p> : children}
    </section>
  )
}

export default function ConsoleDashboardPage() {
  const overview = useApiGet<ApiEnvelope<WorkflowOverviewDto>>('/api/v1/workflow/overview')
  const missions = useApiGet<ApiEnvelope<unknown>>('/api/v1/missions?page=1&pageSize=1')
  const { post } = useApiPost()
  const [acting, setActing] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<{ jobId: string; text: string } | null>(null)

  const valueEntries = [
    { label: '待我确认', desc: '需要人处理的连接与任务', href: '#needs-attention', icon: CheckCircle2, tone: 'text-warning' },
    { label: '成员沟通', desc: '查看成员、角色与邀请', href: '/console/members', icon: Users, tone: 'text-primary' },
    { label: '协作空间', desc: '任务、连接与成果', href: '/console/missions', icon: Building2, tone: 'text-secondary' },
    { label: 'AI 辅助协作', desc: '智能体运行与审批', href: '/console/agents', icon: Bot, tone: 'text-primary' },
    { label: '真实结果', desc: '已记录的成果与核验', href: '/console/outcomes', icon: Target, tone: 'text-success' },
  ] as const

  async function actOn(job: WorkflowJobRow, action: 'takeover' | 'requeue') {
    setActing(job.id)
    setActionResult(null)
    const result = await post(`/api/v1/workflow/jobs/${encodeURIComponent(job.id)}/${action}`, action === 'takeover' ? { note: '从控制台待办处理' } : {})
    setActing(null)
    setActionResult({ jobId: job.id, text: result ? `${action === 'takeover' ? '已接管' : '已重新排队'} · ${job.kind}` : '操作未完成：可能无权限或状态已变化' })
    if (result) overview.refetch()
  }

  if (overview.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
        <h1 className="sr-only">社群总览</h1>
        <RefreshCw className="w-4 h-4 animate-spin" />
        正在读取队列状态…
      </div>
    )
  }

  if (overview.error || !overview.data?.data) {
    const denied = /permission|forbidden|403/i.test(overview.error ?? '')
    return (
      <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
        <h1 className="sr-only">社群总览</h1>
        <div className="flex items-center gap-2 text-warning mb-2">
          <AlertTriangle className="w-4 h-4" />
          <p className="text-sm font-medium">{denied ? '权限不足' : '暂时读不到队列状态'}</p>
        </div>
        <p className="text-sm text-foreground-muted mb-4">
          {denied
            ? '队列视图需要「运营」及以上角色。你在本社群的角色不够 —— 这不是错误，而是权限边界。'
            : (overview.error ?? '接口没有返回可用的数据。')}
        </p>
        <button type="button" onClick={() => overview.refetch()} className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 重新加载
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
          你今天要处理什么 —— 待确认、成员、空间、AI 协作与结果，数据来自此刻的真实接口。
        </p>
      </div>

      {/* ── 五个人类可读的价值入口 ── */}
      <nav aria-label="社群工作台入口" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {valueEntries.map((e) => {
          const Icon = e.icon
          const inner = (
            <>
              <Icon className={`w-5 h-5 ${e.tone}`} />
              <p className="mt-2 text-sm font-semibold text-foreground">{e.label}</p>
              <p className="mt-0.5 text-[11px] text-foreground-muted">{e.desc}</p>
              <ArrowRight className="w-3.5 h-3.5 text-foreground-subtle mt-2" />
            </>
          )
          return e.href.startsWith('#') ? (
            <a key={e.label} href={e.href} className="rounded-xl border border-card-border bg-background-secondary p-3.5 min-h-[110px] hover:border-primary/40 transition-colors block">{inner}</a>
          ) : (
            <Link key={e.label} href={e.href} className="rounded-xl border border-card-border bg-background-secondary p-3.5 min-h-[110px] hover:border-primary/40 transition-colors block">{inner}</Link>
          )
        })}
      </nav>

      {/* ── 待我确认：可操作的真实待办 ── */}
      <section id="needs-attention" className="rounded-2xl border border-card-border bg-background-secondary p-4 scroll-mt-24">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-4 h-4 text-warning" />
          <h2 className="text-sm font-semibold text-foreground font-display">待我确认</h2>
          <span className="ml-auto text-xs text-foreground-muted">{data.needsAttention.length}</span>
        </div>
        {data.needsAttention.length === 0 ? (
          <p className="text-sm text-foreground-muted">当前没有需要人工处置的任务。自动重试与死信晋升都在正常工作。</p>
        ) : (
          <>
            <ul className="space-y-2">
              {data.needsAttention.map((job) => (
                <li key={job.id} className="rounded-lg border border-card-border bg-background-tertiary/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">{job.status}</span>
                    <span className="text-foreground-muted">{job.kind}</span>
                    <span className="ml-auto text-foreground-subtle">尝试 {job.attempts}/{job.maxAttempts}</span>
                  </div>
                  {job.lastError ? <p className="text-[11px] text-foreground-subtle mt-1 break-all">{job.lastError}</p> : null}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" disabled={acting === job.id} onClick={() => actOn(job, 'takeover')} className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 disabled:opacity-50 transition-colors">
                      {acting === job.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} 接管处理
                    </button>
                    <button type="button" disabled={acting === job.id} onClick={() => actOn(job, 'requeue')} className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-foreground-muted text-xs hover:text-foreground hover:bg-background-tertiary disabled:opacity-50 transition-colors">
                      重新排队
                    </button>
                    {job.missionId ? (
                      <Link href={`/console/missions/${job.missionId}`} className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-foreground-muted text-xs hover:text-foreground hover:bg-background-tertiary">
                        查看任务记录 →
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {actionResult ? <p role="status" className="text-[11px] text-foreground-muted mt-3">{actionResult.text}</p> : null}
            <p className="text-[11px] text-foreground-subtle mt-3">
              接管/重试调用真实接口 <code>/api/v1/workflow/jobs/&lt;id&gt;/takeover</code> 与 <code>/requeue</code>；
              需要「运营」及以上角色，无权限时服务端拒绝并如实提示，不渲染空按钮。
            </p>
          </>
        )}
      </section>

      {/* ── 关键数字 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="在飞任务" value={inFlight} hint="PENDING + RUNNING" />
        <Stat label="需人处置" value={data.needsAttention.length} hint="死信 / 已接管 / 永久失败" tone={data.needsAttention.length > 0 ? 'warn' : 'default'} />
        <Stat label="停滞连接" value={data.stalled.length} hint="阶段超时未推进" tone={data.stalled.length > 0 ? 'warn' : 'default'} />
        <Stat label="死信" value={dead} hint="自动重试已用尽，等人接管" tone={dead > 0 ? 'danger' : 'default'} />
      </div>

      {/* ── 停滞 ── */}
      <Panel title="停滞的连接" icon={Clock} count={data.stalled.length} emptyText="没有卡住的连接。所有进行中的连接都在预期时间内推进。">
        <ul className="space-y-2">
          {data.stalled.map((s) => (
            <li key={s.proposalId} className="rounded-lg border border-card-border bg-background-tertiary/40 px-3 py-2 flex items-center gap-2 text-xs">
              <span className="px-1.5 py-0.5 rounded bg-background-tertiary text-foreground-muted">{STAGE_LABEL[s.stage] ?? s.stage}</span>
              <span className="text-foreground-subtle">自 {new Date(s.stageEnteredAt).toLocaleDateString()} 起未推进</span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ── 投递（AC-09 诚实口径） ── */}
      <Panel title="消息投递" icon={Mail} count={data.deliveries.sent + data.deliveries.captured} emptyText="还没有任何投递记录。">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="已送出" value={data.deliveries.sent} hint="站内信真实落库" />
          <Stat label="沙箱捕获" value={data.deliveries.captured} hint="无邮件凭据时只记录意图，≠ 已送达" tone={data.deliveries.captured > 0 ? 'warn' : 'default'} />
          <Stat label="失败" value={data.deliveries.failed} tone={data.deliveries.failed > 0 ? 'danger' : 'default'} />
          <Stat label="待投" value={data.deliveries.pending} />
        </div>
        <p className="text-[11px] text-foreground-subtle mt-3">
          「沙箱捕获」记下了要发什么但没有真实外发，不计入「已送出」——把两者混在一起就是虚报外部服务已接通。
        </p>
      </Panel>

      {/* ── 任务 ── */}
      <section className="rounded-2xl border border-card-border bg-background-secondary p-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-foreground-muted" />
          <h2 className="text-sm font-semibold text-foreground font-display">连接任务</h2>
          <Link href="/console/missions" className="ml-auto inline-flex min-h-6 items-center gap-1 px-1 text-xs text-primary hover:underline">查看全部 <span aria-hidden="true">→</span></Link>
        </div>
        <p className="text-sm text-foreground-muted mt-2">
          {missionTotal === null ? '正在读取任务总数…' : `本社群共有 ${missionTotal} 条任务。`}
        </p>
      </section>
    </div>
  )
}
