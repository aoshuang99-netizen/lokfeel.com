'use client'

/**
 * P2 · Agent 区 —— 运行面板、审批与用量
 *
 * 依据：`docs/implementation/DESIGN/02-plan.md` §P2「Agent 区等 T09；T09 落地后接
 *       `agent` 节点类型」（T09 已交付：`/api/v1/agents/runs` + `approve|reject` + `usage`）。
 *
 * 🔴 三条诚实纪律（T09 反复强调，界面必须原样体现）：
 *
 *   ① **「批准」不等于「执行」**。能否执行由服务端下发（`execution.available` +
 *      `reason`），本区**原样显示**、自己不判一遍 —— 否则"点了批准到底会发生什么"
 *      在界面上就没有答案。
 *
 *   ② **前端不重写状态机**。本区不给 `canApprove` 这类前端推导的判据：
 *      服务端 `decideAgentRun` 才是判据（已有裁决 / 状态不允许都返回 409 并给出原因）。
 *      前端自己判一遍会产生两种坏结果 —— 按钮被错误禁用（静默失效），
 *      或按钮可用但必然失败（误导）。所以按钮总是渲染，并写明"服务端会重新判定"。
 *
 *   ③ **「花 0 分」不等于「模型免费」**。`usage.provider` 诚实块说明真实调用
 *      到底开没开；未开启时必须显式说明走的是规则式兜底。
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react'
import {
  LIVING_AGENT_PROVIDER_LABELS,
  agentDecisionRequest,
  assembleAgentBoard,
  assembleAgentUsage,
  formatMicroCents,
  type LivingAgentBoardModel,
  type LivingAgentRunRow,
  type LivingAgentUsageModel,
} from '@/lib/living/agents'
import { useApiGet } from '@/hooks/use-api'
import {
  LivingActionResult,
  LivingErrorBox,
  LivingLoadable,
  LivingLoading,
  LivingNotes,
} from '@/components/living/living-states'
import { useLivingPost, type LivingEnvelope } from '@/components/living/use-living-post'

export interface AgentBoardData {
  board: LivingAgentBoardModel | null
  boardLoading: boolean
  boardError: string | null
  usage: LivingAgentUsageModel | null
  usageLoading: boolean
  usageError: string | null
  action: { ok: boolean; message: string | null } | null
  pendingUrl: string | null
  runDecision: (runId: string, decision: 'approve' | 'reject') => void
}

export function useAgentBoardData(enabled = true): AgentBoardData {
  const runsRes = useApiGet<LivingEnvelope<unknown>>(enabled ? '/api/v1/agents/runs' : null)
  const usageRes = useApiGet<LivingEnvelope<unknown>>(enabled ? '/api/v1/agents/usage' : null)

  const boardOutcome = useMemo(() => {
    const payload = runsRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleAgentBoard(payload)
  }, [runsRes.data])

  const usageOutcome = useMemo(() => {
    const payload = usageRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleAgentUsage(payload)
  }, [usageRes.data])

  const { run, pendingUrl } = useLivingPost()
  const [action, setAction] = useState<{ ok: boolean; message: string | null } | null>(null)

  const runDecision = (runId: string, decision: 'approve' | 'reject') => {
    const req = agentDecisionRequest(runId, decision)
    void run(req.url, req.body).then((res) => {
      setAction({ ok: res.ok, message: res.message })
      if (res.ok) {
        runsRes.refetch()
        usageRes.refetch()
      }
    })
  }

  return {
    board: boardOutcome?.ok ? boardOutcome.value : null,
    boardLoading: runsRes.isLoading,
    boardError: runsRes.error ?? (boardOutcome && !boardOutcome.ok ? boardOutcome.error : null),
    usage: usageOutcome?.ok ? usageOutcome.value : null,
    usageLoading: usageRes.isLoading,
    usageError:
      usageRes.error ?? (usageOutcome && !usageOutcome.ok ? usageOutcome.error : null),
    action,
    pendingUrl,
    runDecision,
  }
}

// ═══════════════════════════════════════════════════════════
// 主视图
// ═══════════════════════════════════════════════════════════

export interface AgentBoardProps {
  data: AgentBoardData
  selectedRunId: string | null
  onSelectRun: (id: string | null) => void
}

export default function AgentBoard({ data, selectedRunId, onSelectRun }: AgentBoardProps) {
  const needsAttention = data.board?.runs.filter((r) => r.needsAttention).length ?? 0

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Agent 运行与审批</h1>
        <p className="mt-1 max-w-3xl text-sm text-lf-text-muted">
          这里能看到每一次 Agent 运行的产出、成本与审批状态。
          <strong className="font-medium text-lf-text">批准不等于执行</strong> ——
          本次交付没有注册执行器，因此批准只把状态写到「已批准」，不会自动发出任何消息或披露任何资料。
        </p>
      </header>

      {/* ── 诚实块：真实调用开没开 ── */}
      {data.usage && (
        <div
          className={[
            'rounded-lf border p-3 text-xs',
            data.usage.provider.realCallsEnabled
              ? 'border-lf-line bg-lf-surface text-lf-text-muted'
              : 'border-lf-warning/40 bg-lf-surface-2 text-lf-warning',
          ].join(' ')}
          role="status"
        >
          <p className="flex items-start gap-1.5">
            {!data.usage.provider.realCallsEnabled && (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="break-words">
              {data.usage.provider.realCallsEnabled
                ? '真实模型调用已启用。下方成本是真实调用产生的。'
                : `真实模型调用未启用：${data.usage.provider.reason} —— 因此下方「花费 0 分」不代表模型免费，而是本批次没有产生真实调用。`}
            </span>
          </p>
        </div>
      )}

      {/* ── ① 运行列表 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-lf-text-muted">
          运行记录
          {data.board && (
            <span className="ml-1 font-normal text-[11px] text-lf-text-faint">
              共 {data.board.runs.length} 条
              {needsAttention > 0 ? ` · 其中 ${needsAttention} 条需要关注` : ''}
            </span>
          )}
        </h2>
        <LivingLoadable
          isLoading={data.boardLoading}
          error={data.boardError}
          empty={(data.board?.runs.length ?? 0) === 0}
          emptyText="当前没有任何 Agent 运行记录。这是查询成功后的结论，不是读取失败。"
          errorHint="本端点需要 OPERATOR 及以上的 agent.run 能力。"
        >
          <ul className="space-y-3">
            {(data.board?.runs ?? []).map((r) => (
              <RunCard
                key={r.id}
                run={r}
                selected={r.id === selectedRunId}
                onSelect={onSelectRun}
                pendingUrl={data.pendingUrl}
                onDecision={data.runDecision}
              />
            ))}
          </ul>
        </LivingLoadable>

        {data.action && (
          <LivingActionResult
            ok={data.action.ok}
            message={data.action.message}
            successText="裁决已写入。本切片不执行副作用 —— 批准只把状态推进到「已批准」。"
          />
        )}
        <LivingNotes notes={data.board?.notes ?? []} title="列表说明" />
      </section>

      {/* ── ② 用量与额度 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-lf-text-muted">用量与额度</h2>
        {data.usageLoading ? (
          <LivingLoading label="正在读取用量…" />
        ) : data.usageError ? (
          <LivingErrorBox message={data.usageError} />
        ) : data.usage ? (
          <UsagePanel usage={data.usage} />
        ) : null}
      </section>
    </div>
  )
}

function RunCard({
  run,
  selected,
  onSelect,
  pendingUrl,
  onDecision,
}: {
  run: LivingAgentRunRow
  selected: boolean
  onSelect: (id: string | null) => void
  pendingUrl: string | null
  onDecision: (runId: string, decision: 'approve' | 'reject') => void
}) {
  const approveReq = agentDecisionRequest(run.id, 'approve')
  const rejectReq = agentDecisionRequest(run.id, 'reject')

  return (
    <li className="min-w-0">
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
            onClick={() => onSelect(selected ? null : run.id)}
            className="lf-focus-ring rounded-lf border border-lf-line px-1.5 py-0.5 text-[11px] text-lf-text"
          >
            {run.skillLabel}
          </button>
          <span
            className={[
              'rounded-lf border px-1.5 py-0.5 text-[11px]',
              run.needsAttention ? 'border-lf-warning/50 text-lf-warning' : 'border-lf-line text-lf-text-muted',
            ].join(' ')}
          >
            {run.statusLabel}
          </span>
          <span className="text-[11px] text-lf-text-muted">{run.riskLabel}</span>
          {run.injectionFlagged && (
            <span className="inline-flex items-center gap-1 text-[11px] text-lf-warning">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              提示词注入信号已命中（仅作升级审批的旁证）
            </span>
          )}
        </div>

        <p className="mt-2 break-words text-sm text-lf-text">{run.goal}</p>
        <p className="mt-1 text-[11px] text-lf-text-faint">
          {run.statusHint}
        </p>
        <p className="mt-1 text-[11px] text-lf-text-faint">
          调用 {run.callCount} 次 · 成本 {run.costLabel} · {run.providerLabel}
          {run.subjectLabel ? ` · 对象 ${run.subjectLabel}` : ''}
        </p>

        {run.approval && (
          <p className="mt-1 text-[11px] text-lf-text-muted">
            裁决：{run.approval.decisionLabel}（{run.approval.deciderRole}）·
            {run.approval.note ? ` 备注 ${run.approval.note}` : ' 无备注'}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pendingUrl === approveReq.url}
            aria-disabled={pendingUrl === approveReq.url}
            onClick={() => onDecision(run.id, 'approve')}
            className="lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border border-lf-line-strong px-2.5 py-1 text-xs text-lf-text hover:bg-lf-surface-2 disabled:cursor-wait disabled:text-lf-text-faint"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            批准
          </button>
          <button
            type="button"
            disabled={pendingUrl === rejectReq.url}
            aria-disabled={pendingUrl === rejectReq.url}
            onClick={() => onDecision(run.id, 'reject')}
            className="lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border border-lf-line px-2.5 py-1 text-xs text-lf-text-muted hover:text-lf-text disabled:cursor-wait disabled:text-lf-text-faint"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            驳回
          </button>
          <span className="text-[11px] text-lf-text-faint">
            服务端会在裁决时重新判定；已有裁决或状态不允许会返回 409 并给出原因。
          </span>
        </div>
      </div>
    </li>
  )
}

function UsagePanel({ usage }: { usage: LivingAgentUsageModel }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lf border border-lf-line bg-lf-surface p-3">
          <h3 className="text-xs font-medium text-lf-text-muted">额度（期次 {usage.periodKey}）</h3>
          <p className="mt-2 text-sm text-lf-text">
            {usage.quota.usedLabel} / {usage.quota.maxLabel}
            {usage.quota.usedPercent !== null ? ` · ${usage.quota.usedPercent}%` : ''}
          </p>
          {usage.quota.usedPercent !== null && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-lf-surface-2">
              <div className="h-full bg-lf-signal" style={{ width: `${usage.quota.usedPercent}%` }} />
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-lf-text-faint">
            剩余 {formatMicroCents(usage.quota.remainingMicroCents)} · 高成本调用{' '}
            {usage.quota.highCostCalls} / {usage.quota.maxHighCostCalls}
          </p>
        </div>

        <div className="min-w-0 rounded-lf border border-lf-line bg-lf-surface p-3">
          <h3 className="text-xs font-medium text-lf-text-muted">本期调用</h3>
          <ul className="mt-2 space-y-1 text-xs text-lf-text-muted">
            <li>
              调用 <span className="text-lf-text">{usage.totals.calls}</span> 次（成功{' '}
              {usage.totals.okCalls} / 失败 {usage.totals.failedCalls}）
            </li>
            <li>
              token：输入 {usage.totals.inputTokens} · 输出 {usage.totals.outputTokens}
            </li>
            <li>
              成本 <span className="text-lf-text">{usage.totals.costLabel}</span>
            </li>
            <li>高成本调用 {usage.totals.highCostCalls} 次</li>
          </ul>
          {usage.runsByStatus.length > 0 && (
            <p className="mt-2 text-[11px] text-lf-text-faint">
              运行状态分布：
              {usage.runsByStatus.map((s) => `${s.statusLabel} ${s.count}`).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {usage.bySkill.length > 0 && (
        <div className="rounded-lf border border-lf-line bg-lf-surface p-3">
          <h3 className="text-xs font-medium text-lf-text-muted">按技能分摊</h3>
          <ul className="mt-2 space-y-1 text-xs text-lf-text-muted">
            {usage.bySkill.map((s) => (
              <li key={s.skill} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">{s.skillLabel}</span>
                <span className="shrink-0 tabular-nums text-lf-text">
                  {s.calls} 次 · {s.costLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lf border border-lf-line bg-lf-surface-2 p-3">
        <h3 className="text-xs font-medium text-lf-text-muted">口径与假设（这些数字是这么来的）</h3>
        <ul className="mt-1.5 space-y-1 text-[11px] text-lf-text-muted">
          <li>额度来源：{usage.assumptions.quota}</li>
          <li>单价：{usage.assumptions.price}</li>
          <li>期次口径：{usage.assumptions.period}</li>
          <li>
            Provider：{LIVING_AGENT_PROVIDER_LABELS[usage.provider.provider as 'openai' | 'stub' | 'rules'] ?? usage.provider.provider}
            {' · '}
            {usage.provider.realCallsEnabled ? '可发起真实调用' : '不可发起真实调用'}
          </li>
        </ul>
        <LivingNotes notes={usage.notes} title="用量说明" />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// 详情面板
// ═══════════════════════════════════════════════════════════

export function AgentsInspector({
  data,
  selectedRunId,
}: {
  data: AgentBoardData
  selectedRunId: string | null
}) {
  const run = data.board?.runs.find((r) => r.id === selectedRunId) ?? null

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          Agent Lens · 一条运行的依据
        </h3>
        {!run ? (
          <p className="mt-2 text-xs text-lf-text-muted">
            点击运行记录里的技能徽章，这里显示它的状态含义、审批结果与执行可用性。
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="break-words text-sm text-lf-text">{run.goal}</p>
            <p className="break-all text-[11px] text-lf-text-faint">run {run.id}</p>
            <dl className="space-y-2 text-xs">
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">状态含义</dt>
                <dd className="text-lf-text-muted">{run.statusHint}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">能否执行（服务端判据）</dt>
                <dd className="text-lf-text">
                  {run.execution.available ? '可执行' : '不可执行'}
                  <span className="mt-0.5 block text-lf-text-muted">{run.execution.reason}</span>
                </dd>
              </div>
              {run.degradeLabel && (
                <div className="min-w-0">
                  <dt className="text-[11px] text-lf-text-faint">降级原因</dt>
                  <dd className="text-lf-text">{run.degradeLabel}</dd>
                </div>
              )}
              {run.reason && (
                <div className="min-w-0">
                  <dt className="text-[11px] text-lf-text-faint">服务端附注</dt>
                  <dd className="break-words text-lf-text-muted">{run.reason}</dd>
                </div>
              )}
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">成本</dt>
                <dd className="text-lf-text">
                  {run.costLabel} · 调用 {run.callCount} 次 · {run.providerLabel}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">裁决</dt>
                <dd className="text-lf-text">
                  {run.approval
                    ? `${run.approval.decisionLabel}（${run.approval.deciderRole}）· ${run.approval.decidedAt.slice(0, 10)}`
                    : '尚未裁决'}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-lf-text-faint">
              模型的原始输出不在本页：服务端刻意不把它放进接口响应（它只是审计证据）。
              可渲染的只有过了结构契约的那份产出。
            </p>
          </div>
        )}
      </section>

      <LivingNotes notes={data.board?.notes ?? []} title="列表说明" />
    </div>
  )
}
