'use client'

/**
 * T09 · Console — 智能体（Agent）屏 —— AC-18 的**第七屏**
 *
 * ═══════════════════════════════════════════════════════════════
 * 本屏的唯一新增判据：**每个按钮都由服务端说"你能点"**
 * ═══════════════════════════════════════════════════════════════
 * AC-18 要的是"可达且**无空按钮**"。这一屏最容易破规矩，因为它的动作是**有门槛**的：
 *   · 批准 / 驳回 = `agent.approve`（ADMIN+）且状态允许且尚无裁决；
 *   · 执行        = `agent.execute`（OPERATOR+）且状态机放行且技能注册了执行器。
 *
 * 若在客户端按角色/状态**自己推**该渲染哪个按钮，就会长出第二份状态机与第二份权限表
 * —— 两份表迟早分叉，而分叉的表现正是"点了必然 403/409"的空按钮。
 * 因此本屏**一个判据都不算**，全部读服务端下发的字段：
 *
 *   · `run.canApprove` / `run.canReject` ← 服务层 `can()` × 内核 `canTransition()`
 *     × "尚无裁决"（三者的合取，见 `lib/agents/dto.ts` 的 `AgentRunViewer`）。
 *   · `run.execution.available` + `run.execution.reason` ← 内核 `planExecution()`
 *     的**唯一**答案（`execution.reason` 原样渲染，本屏不重写它）。
 *   · `usage.plan` / `usage.quota` / `usage.assumptions` ← 组织级额度派生结果。
 *
 * ⚠️ 有一条本屏**做不到**、也不假装做到的事：真实模型调用是否开启由服务端
 *    `usage.provider.realCallsEnabled` 下发；为 false 时这里显示的是"规则式兜底"，
 *    而不是把"跑了 3 次、花了 0 分"读成"模型免费"。
 */

import { useMemo, useState } from 'react'
import { Bot, Check, Coins, Play, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useApiGet, useApiPost } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

interface RunExecutionAvailability {
  available: boolean
  reason: string
  code: string | null
  kind: string | null
  channel: string | null
}

interface RunExecutionRecord {
  id: string
  kind: string
  channel: string
  recipientId: string
  deliveryStatus: string
  executedAt: string
}

interface RunDto {
  id: string
  skill: string
  status: string
  risk: string
  requiresApproval: boolean
  requestedBy: string
  subjectLabel: string | null
  goal: string
  proposal: unknown | null
  reason: string | null
  degradeCode: string | null
  providerKind: string
  injectionFlagged: boolean
  costMicroCents: number
  callCount: number
  approval: { decision: string; deciderRole: string; decidedAt: string } | null
  execution: RunExecutionAvailability
  executionRecord: RunExecutionRecord | null
  /** 🔴 服务端派生：观察者能否批准 / 驳回。本屏**只读**，不自己判。 */
  canApprove: boolean
  canReject: boolean
  createdAt: string
}

interface RunListDto {
  items: RunDto[]
  count: number
}

interface UsageDto {
  periodKey: string
  plan: string | null
  totals: { calls: number; okCalls: number; failedCalls: number; microCents: number }
  quota: {
    maxMicroCents: number
    maxHighCostCalls: number
    usedMicroCents: number
    remainingMicroCents: number
    highCostCalls: number
  }
  assumptions: { quota: string; period: string }
  provider: { provider: string; realCallsEnabled: boolean; reason: string }
}

type Filter = 'ALL' | 'AWAITING_APPROVAL' | 'APPROVED' | 'EXECUTED'

const FILTER_TABS: ReadonlyArray<{ value: Filter; label: string; hint: string }> = [
  { value: 'ALL', label: '全部', hint: '本社群全部 Agent 运行' },
  { value: 'AWAITING_APPROVAL', label: '待批准', hint: '高风险产出，等人工裁决' },
  { value: 'APPROVED', label: '已批准', hint: '已批准但尚未执行' },
  { value: 'EXECUTED', label: '已执行', hint: '副作用已经产生（当前为站内回执）' },
]

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: '已提案',
  AWAITING_APPROVAL: '待批准',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  EXECUTED: '已执行',
  DEGRADED: '降级产出',
  BLOCKED_QUOTA: '额度阻止',
  FAILED: '失败',
}

const STATUS_TONE: Record<string, string> = {
  AWAITING_APPROVAL: 'bg-warning/15 text-warning',
  APPROVED: 'bg-primary/15 text-primary',
  EXECUTED: 'bg-success/15 text-success',
  REJECTED: 'bg-danger/15 text-danger',
  BLOCKED_QUOTA: 'bg-danger/15 text-danger',
  FAILED: 'bg-danger/15 text-danger',
  DEGRADED: 'bg-warning/15 text-warning',
}

const SKILL_LABEL: Record<string, string> = {
  INTENT_EXTRACTION: '意图抽取',
  INTRO_DRAFT: '介绍草稿',
  COORDINATION_ADVICE: '协调建议',
}

const RISK_LABEL: Record<string, string> = { LOW: '低', MEDIUM: '中', HIGH: '高' }

const PROVIDER_LABEL: Record<string, string> = {
  openai: '真实模型',
  stub: '测试桩',
  rules: '规则式兜底',
}

/** 微分 → 可读"分"（仅展示，不参与计算）。 */
function microToCents(micro: number): string {
  return (micro / 1_000_000).toFixed(4)
}

/**
 * 「需要人工介入」的档位 —— 与 `LIVING_AGENT_ATTENTION_STATUSES` 同一口径。
 *
 * ⚠️ 本页是 Console 侧（不 import living 的模型层），因此这里显式列出同一组状态；
 *    两处若分叉，`docs/implementation/v19/52a` 的对照表会先红。这不是权限判定，
 *    只是**排序/聚合**用的口径 —— 能不能点仍然只读服务端下发的 `canApprove/canReject`。
 */
const ATTENTION_STATUSES: readonly string[] = [
  'AWAITING_APPROVAL',
  'FAILED',
  'BLOCKED_QUOTA',
  'DEGRADED',
]

interface SkillRollup {
  skill: string
  label: string
  runs: number
  calls: number
  microCents: number
  attention: number
  lastAt: number | null
}

export default function ConsoleAgentsPage() {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [actingId, setActingId] = useState<string | null>(null)

  const url = useMemo(() => {
    const p = new URLSearchParams({ limit: '50' })
    if (filter !== 'ALL') p.set('status', filter)
    return `/api/v1/agents/runs?${p.toString()}`
  }, [filter])

  // 列表按服务端筛选（口径由服务端决定）；名册/关注聚合则**必须**不受筛选影响，
  // 否则「切到已执行」时"待批准 3 条"会变成"待批准 0 条"——那是筛选副作用，不是事实。
  // filter=ALL 时两者是同一个请求，不再多发一次。
  const allRuns = useApiGet<ApiEnvelope<RunListDto>>('/api/v1/agents/runs?limit=50')
  const filteredRuns = useApiGet<ApiEnvelope<RunListDto>>(filter === 'ALL' ? null : url)
  const runs = filter === 'ALL' ? allRuns : filteredRuns
  const usage = useApiGet<ApiEnvelope<UsageDto>>('/api/v1/agents/usage')
  const { post, isLoading: isActing, error: actionError } = useApiPost()

  const items = useMemo(() => runs.data?.data?.items ?? [], [runs.data])
  const allItems = useMemo(() => allRuns.data?.data?.items ?? [], [allRuns.data])
  const u = usage.data?.data ?? null

  /** 按技能聚合（运行数 / 调用数 / 成本 / 最近活跃 / 需关注）——全部由既有字段相加得出。 */
  const rollup = useMemo<SkillRollup[]>(() => {
    const map = new Map<string, SkillRollup>()
    for (const r of allItems) {
      const cur = map.get(r.skill) ?? {
        skill: r.skill,
        label: SKILL_LABEL[r.skill] ?? r.skill,
        runs: 0,
        calls: 0,
        microCents: 0,
        attention: 0,
        lastAt: null,
      }
      cur.runs += 1
      cur.calls += r.callCount
      cur.microCents += r.costMicroCents
      if (ATTENTION_STATUSES.includes(r.status)) cur.attention += 1
      const at = Date.parse(r.createdAt)
      if (Number.isFinite(at) && (cur.lastAt === null || at > cur.lastAt)) cur.lastAt = at
      map.set(r.skill, cur)
    }
    return [...map.values()].sort((a, b) => b.runs - a.runs)
  }, [allItems])

  const maxSkillCost = rollup.reduce((m, r) => Math.max(m, r.microCents), 0)

  const attentionCounts = useMemo(() => {
    const byStatus: Record<string, number> = {}
    let injections = 0
    for (const r of allItems) {
      if (ATTENTION_STATUSES.includes(r.status)) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      }
      if (r.injectionFlagged) injections += 1
    }
    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      injections,
    }
  }, [allItems])

  const inFlight = allItems.filter(
    (r) => r.status === 'AWAITING_APPROVAL' || r.status === 'APPROVED',
  ).length

  const periodCostMicro = u?.totals.microCents ?? 0

  const forbidden =
    /permission|403/i.test(allRuns.error ?? '') ||
    /permission|403/i.test(runs.error ?? '') ||
    /permission|403/i.test(usage.error ?? '')

  const refreshAll = () => {
    allRuns.refetch()
    if (filter !== 'ALL') filteredRuns.refetch()
    usage.refetch()
  }

  const act = async (path: string, body?: unknown) => {
    setActingId(path)
    const res = await post(path, body)
    setActingId(null)
    if (res) refreshAll()
  }

  const usedPct =
    u && u.quota.maxMicroCents > 0
      ? Math.min(100, Math.round((u.quota.usedMicroCents / u.quota.maxMicroCents) * 100))
      : 0

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground font-display">智能体</h1>
          <p className="text-xs text-foreground-muted mt-0.5">
            Agent 产出的是<strong>提案</strong>，不是既成事实。高风险产出必须经人工批准才可能执行；
            批准与执行<strong>不是</strong>同一个人的权限。
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${runs.isLoading || usage.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── 概览三卡（参考图①的 Needs Attention 聚合） ── */}
      <section aria-labelledby="command-summary-heading" className="space-y-2">
        <h2 id="command-summary-heading" className="text-sm font-medium text-foreground">
          运行概览
          <span className="ml-1 font-normal text-[11px] text-foreground-subtle">
            口径：本社群全部运行（不受下方筛选影响）
          </span>
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-card-border bg-background-secondary p-3">
            <p className="text-[11px] text-foreground-subtle">需要人工介入</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                attentionCounts.total > 0 ? 'text-warning' : 'text-foreground'
              }`}
            >
              {allRuns.isLoading ? '—' : attentionCounts.total}
            </p>
            {allRuns.isLoading ? (
              <p className="mt-1 text-[11px] text-foreground-subtle">正在读取…</p>
            ) : attentionCounts.total === 0 ? (
              <p className="mt-1 text-[11px] text-foreground-subtle">
                当前没有待裁决、失败、额度阻止或降级的运行。
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-[11px] text-foreground-muted">
                {ATTENTION_STATUSES.filter((s) => (attentionCounts.byStatus[s] ?? 0) > 0).map((s) => (
                  <li key={s} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">{STATUS_LABEL[s] ?? s}</span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {attentionCounts.byStatus[s]}
                    </span>
                  </li>
                ))}
                {attentionCounts.injections > 0 ? (
                  <li className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">注入信号（旁证）</span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {attentionCounts.injections}
                    </span>
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-card-border bg-background-secondary p-3">
            <p className="text-[11px] text-foreground-subtle">进行中</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {allRuns.isLoading ? '—' : inFlight}
            </p>
            <p className="mt-1 text-[11px] text-foreground-subtle">
              待批准 + 已批准但尚未执行。批准不等于执行 —— 执行是另一次显式动作。
            </p>
          </div>

          <div className="rounded-2xl border border-card-border bg-background-secondary p-3">
            <p className="text-[11px] text-foreground-subtle">本期成本</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {u ? microToCents(periodCostMicro) : '—'}
              <span className="ml-1 text-xs font-normal text-foreground-subtle">分</span>
            </p>
            <p className="mt-1 text-[11px] text-foreground-subtle">
              {u?.provider.realCallsEnabled
                ? '真实模型调用已开启，以上为真实花费。'
                : '真实模型调用未开启 —— 0 分不代表模型免费，见下方额度面板。'}
            </p>
          </div>
        </div>
      </section>

      {/* ── 按技能名册 + 成本分解（参考图①的 roster 表 + Cost Breakdown） ── */}
      <section aria-labelledby="roster-heading" className="space-y-2">
        <h2 id="roster-heading" className="text-sm font-medium text-foreground">
          按技能名册
          <span className="ml-1 font-normal text-[11px] text-foreground-subtle">
            运行数 / 调用数 / 成本 / 最近活跃 / 需关注
          </span>
        </h2>
        {allRuns.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-foreground-muted">
            <RefreshCw className="w-4 h-4 animate-spin" />
            正在汇总…
          </div>
        ) : rollup.length === 0 ? (
          <div className="rounded-2xl border border-card-border bg-background-secondary p-4">
            <p className="text-sm text-foreground-muted">
              还没有可汇总的运行。名册由运行记录聚合而来 —— 没有运行就没有行，这不是读取失败。
            </p>
          </div>
        ) : (
          /*
            `tabIndex={0}` + `role="region"` 不是为了"更规范"，是 WCAG 2.2 的硬性要求：
            一个可横向滚动的容器如果无法聚焦，键盘用户**永远**滚不到右侧那几列
            （axe 规则 scrollable-region-focusable，serious）。
            只在窄视口溢出才需要，但 React 里判断视口要额外的 resize 监听与首次渲染抖动，
            而给所有视口都加一个可聚焦容器**不产生**副作用（不溢出时 Tab 一下即过）。
          */
          <div
            role="region"
            aria-label="Agent 运行名册（可横向滚动）"
            tabIndex={0}
            className="overflow-x-auto rounded-2xl border border-card-border bg-background-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <table className="w-full min-w-[560px] text-left text-xs">
              <caption className="sr-only">
                按技能汇总的 Agent 运行名册：运行数、调用数、成本与最近活跃时间
              </caption>
              <thead>
                <tr className="border-b border-card-border text-[10px] uppercase tracking-wide text-foreground-subtle">
                  <th scope="col" className="px-3 py-2 font-medium">技能</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">运行</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">调用</th>
                  <th scope="col" className="px-3 py-2 font-medium">成本（分）</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">最近活跃</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">需关注</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((r) => (
                  <tr key={r.skill} className="border-t border-card-border first:border-t-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                      {r.label}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{r.runs}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">
                      {r.calls}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-right tabular-nums text-foreground">
                          {microToCents(r.microCents)}
                        </span>
                        <span
                          className="h-1.5 min-w-[2px] flex-1 overflow-hidden rounded-full bg-background-tertiary"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-full bg-primary"
                            style={{
                              width: `${maxSkillCost > 0 ? Math.round((r.microCents / maxSkillCost) * 100) : 0}%`,
                            }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-foreground-muted">
                      {r.lastAt === null ? '—' : new Date(r.lastAt).toLocaleDateString()}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.attention > 0 ? 'text-warning' : 'text-foreground-subtle'
                      }`}
                    >
                      {r.attention}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-foreground-subtle">
          名册只聚合契约里<strong>真实存在</strong>的字段。接口没有「质量分」「趋势」两类数据，
          因此这里不显示评分与涨跌 —— 要显示它们得先在服务端定义口径，而不是在前端编一个。
        </p>
      </section>

      {/* ── 额度面板（组织级，按订阅方案派生） ── */}
      {u ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Coins className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium text-foreground">
              本期（{u.periodKey}）额度
            </p>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-subtle">
              {u.plan === null ? '注入额度（非方案派生）' : `方案 ${u.plan}`}
            </span>
            <span className="text-[11px] text-foreground-subtle ml-auto">
              已用 {microToCents(u.quota.usedMicroCents)} / {microToCents(u.quota.maxMicroCents)} 分
            </span>
          </div>

          <div className="h-2 rounded-full bg-background-tertiary overflow-hidden">
            <div
              className={`h-full ${usedPct >= 90 ? 'bg-danger' : usedPct >= 70 ? 'bg-warning' : 'bg-primary'}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>

          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div>
              <dt className="text-foreground-subtle">调用次数</dt>
              <dd className="text-foreground">{u.totals.calls}（失败 {u.totals.failedCalls}）</dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">高成本调用</dt>
              <dd className="text-foreground">
                {u.quota.highCostCalls} / {u.quota.maxHighCostCalls}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">剩余额度</dt>
              <dd className="text-foreground">{microToCents(u.quota.remainingMicroCents)} 分</dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">真实模型调用</dt>
              <dd className={u.provider.realCallsEnabled ? 'text-success' : 'text-warning'}>
                {u.provider.realCallsEnabled ? '已开启' : '未开启（规则式兜底）'}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] text-foreground-subtle">{u.assumptions.quota}</p>
          <p className="mt-1 text-[11px] text-foreground-subtle">{u.provider.reason}</p>
        </div>
      ) : null}

      {/* ── 过滤 ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            title={t.hint}
            onClick={() => setFilter(t.value)}
            aria-pressed={filter === t.value}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              filter === t.value
                ? 'bg-primary/15 text-primary font-medium'
                : 'border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {runs.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
          <RefreshCw className="w-4 h-4 animate-spin" />
          正在读取运行记录…
        </div>
      ) : runs.error ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <p className="text-sm text-warning mb-1">{forbidden ? '权限不足' : '读不到运行记录'}</p>
          <p className="text-sm text-foreground-muted">
            {forbidden
              ? '查看与发起 Agent 运行需要运营（OPERATOR）及以上角色。你在本社群的角色不够 —— 这不是错误，而是权限边界。'
              : runs.error}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <div className="flex items-center gap-2 text-foreground-muted mb-2">
            <Bot className="w-4 h-4" />
            <p className="text-sm font-medium text-foreground">
              {filter === 'ALL' ? '本社群还没有 Agent 运行' : '这个状态下没有运行记录'}
            </p>
          </div>
          <p className="text-sm text-foreground-muted">
            运行由运营侧发起（意图抽取 / 介绍草稿 / 协调建议）。高风险产出会先进入「待批准」，
            等管理员裁决后才可能被执行。
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((run) => {
            const approvePath = `/api/v1/agents/runs/${run.id}/approve`
            const rejectPath = `/api/v1/agents/runs/${run.id}/reject`
            const executePath = `/api/v1/agents/runs/${run.id}/execute`
            return (
              <li
                key={run.id}
                className="rounded-xl border border-card-border bg-background-secondary p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      STATUS_TONE[run.status] ?? 'bg-background-tertiary text-foreground-muted'
                    }`}
                  >
                    {STATUS_LABEL[run.status] ?? run.status}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-muted">
                    {SKILL_LABEL[run.skill] ?? run.skill}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-subtle">
                    风险 {RISK_LABEL[run.risk] ?? run.risk}
                  </span>
                  {run.injectionFlagged ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning">
                      <ShieldAlert className="w-3 h-3" />
                      检测到疑似注入（仅告警）
                    </span>
                  ) : null}
                  <span className="text-[11px] text-foreground-subtle ml-auto">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>

                <p className="mt-1.5 text-sm text-foreground break-words">{run.goal || '（无目标描述）'}</p>

                <p className="mt-1 text-[11px] text-foreground-subtle">
                  模型 {PROVIDER_LABEL[run.providerKind] ?? run.providerKind} · 调用 {run.callCount} 次 ·
                  花费 {microToCents(run.costMicroCents)} 分
                  {run.requiresApproval ? ' · 需人工批准' : ''}
                  {run.subjectLabel ? ` · 对象：${run.subjectLabel}` : ''}
                </p>

                {run.reason ? (
                  <p className="mt-1 text-[11px] text-foreground-muted">{run.reason}</p>
                ) : null}

                {run.approval ? (
                  <p className="mt-1 text-[11px] text-foreground-subtle">
                    裁决：{run.approval.decision === 'APPROVED' ? '已批准' : '已驳回'} ·
                    角色 {run.approval.deciderRole} · {new Date(run.approval.decidedAt).toLocaleString()}
                  </p>
                ) : null}

                {run.executionRecord ? (
                  <p className="mt-1 text-[11px] text-success">
                    已执行（{run.executionRecord.kind} / {run.executionRecord.channel}，
                    投递状态 {run.executionRecord.deliveryStatus}）·
                    {new Date(run.executionRecord.executedAt).toLocaleString()}
                  </p>
                ) : null}

                {/* ── 动作：全部由服务端下发的字段决定，本屏不做任何判定 ── */}
                {run.canApprove || run.canReject || run.execution.available ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {run.canApprove ? (
                      <button
                        type="button"
                        disabled={isActing && actingId === approvePath}
                        onClick={() => act(approvePath, {})}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {isActing && actingId === approvePath ? '批准中…' : '批准'}
                      </button>
                    ) : null}
                    {run.canReject ? (
                      <button
                        type="button"
                        disabled={isActing && actingId === rejectPath}
                        onClick={() => act(rejectPath, {})}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X className="w-3.5 h-3.5" />
                        {isActing && actingId === rejectPath ? '驳回中…' : '驳回'}
                      </button>
                    ) : null}
                    {run.execution.available ? (
                      <button
                        type="button"
                        disabled={isActing && actingId === executePath}
                        onClick={() => act(executePath)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-success/15 text-success hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {isActing && actingId === executePath ? '执行中…' : '执行'}
                      </button>
                    ) : null}
                    {run.execution.available ? (
                      <span className="text-[11px] text-foreground-subtle">{run.execution.reason}</span>
                    ) : null}
                  </div>
                ) : (
                  // 既不能批也不能驳、也还不到能执行的时候 —— **不渲染任何禁用按钮**，
                  // 而是说明"下一步要等什么"（AC-18：不许留一个点了没反应的按钮）。
                  <p className="mt-2 text-[11px] text-foreground-subtle">{run.execution.reason}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {actionError ? <p className="text-xs text-danger">操作失败：{actionError}</p> : null}

      <p className="text-[11px] text-foreground-subtle">
        执行当前只产生<strong>内部回执</strong>（站内信给发起人），不对外送达。对外送达需要目标身份与
        逐字段披露出口，属后续切片 —— 这条边界由服务端下发的执行说明如实呈现。
      </p>
    </div>
  )
}
