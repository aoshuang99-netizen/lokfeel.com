'use client'

/**
 * V21 · 第二批 —— ExecutionPanel：任务详情里的「服务端真实闭环」
 *
 * 四段各自独立于真实端点（不聚合、不伪造）：
 *   ① 运行与阶段：GET /agents/runs/{runId} + GET .../events（SSE 文本帧）
 *   ② 审批与执行：POST .../approve|reject|execute（状态机由服务端裁决）
 *   ③ 回执：EXECUTED 后展示 executionRecord（IN_APP 站内信，不是外部动作）
 *   ④ 独立成果核验：GET|POST /missions/{id}/verification（第二人、逐条人工确认）
 *
 * 🔴 诚实边界（写进文案，不靠读代码的人推断）：
 *   - 现有 execute 的唯一真实副作用是一条 IN_APP 站内信回执（kind=RECEIPT），
 *     **不是对外送达**；
 *   - 「Mission CLOSED ≠ Agent EXECUTED」「Agent EXECUTED ≠ Outcome VERIFIED」；
 *   - 回执、模型输出都不是成果证据，第四段只做「第二人按判据逐条核验」；
 *   - SSE 帧是**编排阶段事件**（QUOTA_CHECK/MODEL_CALL/SCHEMA_VALIDATE/PERSISTED/
 *     DEGRADED），不是模型 token 流。
 *
 * 🔴 按钮纪律：不渲染点了必 403/409 的按钮。审批/执行同时看「状态 + 能力 +
 *    服务端下发的 canApprove/canReject/execution.available」，前端不重写状态机。
 *   变更成功只认 2xx + 响应体，随后 refetch 运行详情。
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from 'next-auth/react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════
// 前端投影类型（只声明本面板真正读取的字段；sourceRunId 是 Mission↔AgentRun 锚点）
// ═══════════════════════════════════════════════════════════

export interface MissionDto {
  id: string
  title?: string
  goal?: string
  successCriteria: string
  status?: string
  sourceRunId: string | null
}

interface ExecutionRecordDto {
  deliveryId: string | null
  deliveryStatus: string
  kind: string
  channel: string
}

interface AgentRun {
  id: string
  status: string
  requiresApproval: boolean
  injectionFlagged: boolean
  requestedBy: string
  canApprove: boolean
  canReject: boolean
  execution?: { available: boolean; reason: string; kind: string | null; channel: string | null }
  executionRecord: ExecutionRecordDto | null
}

interface VerificationCriterion {
  label: string
  confirmed: boolean
}

interface VerificationRecord {
  verificationLevel: string
  statement: string
  criteria: VerificationCriterion[]
  evidenceNote?: string | null
  evidence: {
    http: { method: string; path: string; organizationId: string }
    dbRows: { verificationId: string; missionId: string; runId: string; executionId: string }
    auditEventType: string
    receipt: { deliveryId: string | null; deliveryStatus: string; channel: string; kind: string }
  }
}

interface StageFrame {
  seq: number
  stage: string
  at: string
  detail: unknown
  note?: string
}

interface ApiFailure {
  message: string
  code: string | null
  status: number | null
  permissionDenied: boolean
}

// ═══════════════════════════════════════════════════════════
// 信封解析（错误 ≠ 没有数据；列表端点另有 parseListEnvelope，此处是单对象端点）
// ═══════════════════════════════════════════════════════════

interface EnvelopeLike {
  success?: boolean
  data?: unknown
  error?: {
    code?: string
    message?: string
    details?: { code?: string; currentVersion?: unknown; expectedVersion?: unknown }
  }
}

function asEnvelope(json: unknown): EnvelopeLike | null {
  return json && typeof json === 'object' ? (json as EnvelopeLike) : null
}

function readError(env: EnvelopeLike | null, status: number): ApiFailure {
  const err = env?.error
  const detailsCode = typeof err?.details?.code === 'string' ? err.details.code : null
  const code = detailsCode ?? (typeof err?.code === 'string' ? err.code : null)
  const message =
    typeof err?.message === 'string' && err.message.length > 0
      ? err.message
      : `HTTP ${status} 请求失败`
  return {
    message,
    code,
    status,
    permissionDenied:
      status === 401 ||
      status === 403 ||
      code === 'PERMISSION_DENIED' ||
      code === 'UNAUTHORIZED',
  }
}

interface Resource<T> {
  data: T | null
  loading: boolean
  error: ApiFailure | null
  refetch: () => void
}

/** 单对象 GET：自管状态以便拿到完整错误信封（message + details.code + status）。 */
function useJsonResource<T>(url: string | null): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(url))
  const [error, setError] = useState<ApiFailure | null>(null)
  const [nonce, setNonce] = useState(0)
  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  // react-hooks/set-state-in-effect：把「依赖变化时重置本地状态」从 effect 同步调用
  // 移到渲染期（React 官方 "adjusting state when props change" 模式）——
  // 同一个组件在渲染中 setState 会立即重渲染，不会级联，行为与原 effect reset 等价。
  const resourceKey = url ? `${url}|${nonce}` : null
  const [syncedKey, setSyncedKey] = useState<string | null>(resourceKey)
  if (syncedKey !== resourceKey) {
    setSyncedKey(resourceKey)
    setData(null)
    setLoading(Boolean(url))
    setError(null)
  }

  useEffect(() => {
    if (!url) return
    let active = true
    fetch(url)
      .then(async (res) => {
        const env = asEnvelope(await res.json().catch(() => null))
        if (!active) return
        if (!res.ok || !env || env.success === false) {
          setError(readError(env, res.status))
          return
        }
        setData((env.data ?? null) as T)
      })
      .catch((e) => {
        if (!active) return
        setError({
          message: e instanceof Error ? e.message : '网络错误',
          code: null,
          status: null,
          permissionDenied: false,
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [url, nonce])

  return { data, loading, error, refetch }
}

// ═══════════════════════════════════════════════════════════
// SSE 文本帧解析（服务端格式：id: / event: stage / data: JSON；末尾 event: done）
// ═══════════════════════════════════════════════════════════

function parseStageFrames(text: string): StageFrame[] {
  const out: StageFrame[] = []
  for (const block of text.split(/\n\n/)) {
    let event = ''
    let data = ''
    for (const line of block.split(/\n/)) {
      if (line.startsWith(':')) continue // SSE 注释行
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (event !== 'stage' || !data) continue
    try {
      const obj = JSON.parse(data) as Record<string, unknown>
      if (typeof obj.seq === 'number' && typeof obj.stage === 'string') {
        out.push({
          seq: obj.seq,
          stage: obj.stage,
          at: typeof obj.at === 'string' ? obj.at : '',
          detail: obj.detail ?? null,
          note: typeof obj.note === 'string' ? obj.note : undefined,
        })
      }
    } catch {
      // 坏帧跳过，不静默当成「成功读到一帧」
    }
  }
  return out
}

function formatDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return '—'
  try {
    return JSON.stringify(detail)
  } catch {
    return '—'
  }
}

// ═══════════════════════════════════════════════════════════
// 人话标签
// ═══════════════════════════════════════════════════════════

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: '已生成方案（待处理）',
  AWAITING_APPROVAL: '等待人工审批',
  APPROVED: '已批准，待执行',
  REJECTED: '已驳回',
  EXECUTED: '已执行（已生成站内回执）',
  DEGRADED: '已降级',
  FAILED: '运行失败',
  BLOCKED_QUOTA: '额度拦截',
}

const STAGE_LABEL: Record<string, string> = {
  QUOTA_CHECK: '额度检查',
  MODEL_CALL: '模型调用',
  SCHEMA_VALIDATE: '契约校验',
  PERSISTED: '已持久化',
  DEGRADED: '降级',
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

function statusHint(status: string, requiresApproval: boolean): string {
  switch (status) {
    case 'PROPOSED':
      return requiresApproval
        ? '该运行需要审批，请先完成审批再执行。'
        : '低风险运行，无需审批，可由持权者直接执行。'
    case 'AWAITING_APPROVAL':
      return '必须先批准或驳回；此状态不能直接执行，也不能跳过审批。'
    case 'APPROVED':
      return '已获批准，可由持权者执行。'
    case 'EXECUTED':
      return '执行已发生，回执见第 ③ 段。'
    default:
      return '当前状态没有可用的审批 / 执行动作。'
  }
}

// ═══════════════════════════════════════════════════════════
// 小展示件
// ═══════════════════════════════════════════════════════════

function Loading({ text = '正在读取…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 py-3 text-sm text-lf-text-muted" role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  )
}

function Empty({ text, testId }: { text: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="rounded-lf border border-dashed border-lf-line p-3 text-sm text-lf-text-muted"
    >
      {text}
    </div>
  )
}

function ErrBox({ failure, label, testId }: { failure: ApiFailure; label: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        <p>
          {label}：{failure.message}
        </p>
        {(failure.code || failure.status) && (
          <p className="text-[11px] text-lf-text-faint">
            错误码：{failure.code ?? '—'}
            {failure.status ? `（HTTP ${failure.status}）` : ''}
          </p>
        )}
        {failure.permissionDenied && (
          <p className="text-[11px]">这是权限错误，不是「没有数据」。</p>
        )}
      </div>
    </div>
  )
}

interface CriterionRow {
  label: string
  confirmed: boolean
}

function initialCriteria(raw: string): CriterionRow[] {
  const parts = (raw ?? '')
    .split(/[\n；;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0
    ? parts.map((label) => ({ label, confirmed: false }))
    : [{ label: '', confirmed: false }]
}

// ═══════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════

export default function ExecutionPanel({
  mission,
  capabilities,
}: {
  mission: MissionDto
  capabilities: Set<string>
}) {
  const runId = mission.sourceRunId
  const { data: session } = useSession()
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null

  const runRes = useJsonResource<AgentRun>(runId ? `/api/v1/agents/runs/${runId}` : null)
  const verification = useJsonResource<VerificationRecord | null>(
    `/api/v1/missions/${mission.id}/verification`,
  )
  const run = runRes.data

  // ── ① 阶段事件（SSE 文本，不用 JSON 信封） ──
  const [stages, setStages] = useState<StageFrame[]>([])
  const [stagesLoading, setStagesLoading] = useState(false)
  const [stagesError, setStagesError] = useState<ApiFailure | null>(null)
  const [lastSeq, setLastSeq] = useState(0)

  const loadStages = useCallback(
    async (fromSeq: number, append: boolean, setLoading = false) => {
      // 显式异步边界：下面所有 setState 都在 await 之后，effect 调用本函数时
      // 不会在同步执行栈里触发级联渲染（react-hooks/set-state-in-effect 合规）。
      await Promise.resolve()
      if (!runId) return
      // 初始加载的 loading 由渲染期 stagesForRun 同步块设置；只有用户主动续读
      // （事件处理器）才在这里设置，避免在 effect 调用链里同步 setState。
      if (setLoading) {
        setStagesLoading(true)
        setStagesError(null)
      }
      try {
        const headers: Record<string, string> = {}
        if (fromSeq > 0) headers['Last-Event-ID'] = String(fromSeq)
        const res = await fetch(`/api/v1/agents/runs/${runId}/events`, { headers })
        if (!res.ok) {
          const env = asEnvelope(await res.json().catch(() => null))
          setStagesError(readError(env, res.status))
          return
        }
        const text = await res.text()
        const frames = parseStageFrames(text)
        setStages((prev) => {
          const bySeq = new Map<number, StageFrame>()
          for (const f of append ? prev : []) bySeq.set(f.seq, f)
          for (const f of frames) bySeq.set(f.seq, f)
          return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
        })
        setLastSeq(frames.reduce((max, f) => Math.max(max, f.seq), fromSeq))
      } catch (e) {
        setStagesError({
          message: e instanceof Error ? e.message : '网络错误',
          code: null,
          status: null,
          permissionDenied: false,
        })
      } finally {
        setStagesLoading(false)
      }
    },
    [runId],
  )

  // set-state-in-effect：runId 消失时清空阶段列表改到渲染期（官方 props 变更模式）。
  // runId 切换到另一个非空值时，loadStages(0,false) 内部本来就 replace，无需清空。
  const [stagesForRun, setStagesForRun] = useState(runId)
  if (stagesForRun !== runId) {
    setStagesForRun(runId)
    setStagesLoading(Boolean(runId))
    setStagesError(null)
    if (!runId) {
      setStages([])
      setLastSeq(0)
    }
  }

  useEffect(() => {
    if (!runId) return
    // 通过微任务边界触发：初始化拉取是异步副作用，避免把 loadStages 内的
    // setState 归入 effect 同步执行栈（react-hooks/set-state-in-effect）。
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadStages(0, false)
    })
    return () => {
      cancelled = true
    }
  }, [runId, loadStages])

  // ── ② 审批 / 执行动作 ──
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<ApiFailure | null>(null)
  const [actionNote, setActionNote] = useState('')

  const runAction = async (kind: 'approve' | 'reject' | 'execute') => {
    if (!runId) return
    setActionPending(kind)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/agents/runs/${runId}/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body:
          kind === 'execute'
            ? undefined
            : JSON.stringify(actionNote.trim() ? { note: actionNote.trim() } : {}),
      })
      const env = asEnvelope(await res.json().catch(() => null))
      // 成功只认 2xx + 响应体（execute 无 body，approve/reject 可带 note）
      if (!res.ok || !env || env.success === false) {
        setActionError(readError(env, res.status))
        return
      }
      setActionError(null)
      setActionNote('')
      runRes.refetch() // 状态机结论以服务端为准，重读运行详情
    } catch (e) {
      setActionError({
        message: e instanceof Error ? e.message : '网络错误',
        code: null,
        status: null,
        permissionDenied: false,
      })
    } finally {
      setActionPending(null)
    }
  }

  // ── ④ 独立成果核验表单 ──
  const [criteria, setCriteria] = useState<CriterionRow[]>(() =>
    initialCriteria(mission.successCriteria),
  )
  const [evidenceNote, setEvidenceNote] = useState('')
  const [verifyPending, setVerifyPending] = useState(false)
  const [verifyError, setVerifyError] = useState<ApiFailure | null>(null)

  const criteriaValid =
    criteria.length > 0 &&
    criteria.every((c) => c.label.trim().length > 0 && c.confirmed === true)

  const submitVerification = async (e: FormEvent) => {
    e.preventDefault()
    if (!criteriaValid) return
    setVerifyPending(true)
    setVerifyError(null)
    try {
      const res = await fetch(`/api/v1/missions/${mission.id}/verification`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 🔴 只发判据与备注；不含 proposal/modelOutput/spec/verdict/身份字段。
        //    含禁用字段的负例由服务端裁决（400 MODEL_OUTPUT_NOT_EVIDENCE）。
        body: JSON.stringify({
          criteria: criteria.map((c) => ({ label: c.label.trim(), confirmed: c.confirmed })),
          ...(evidenceNote.trim() ? { evidenceNote: evidenceNote.trim() } : {}),
        }),
      })
      const env = asEnvelope(await res.json().catch(() => null))
      if (!res.ok || !env || env.success === false) {
        setVerifyError(readError(env, res.status))
        return
      }
      verification.refetch()
    } catch (e) {
      setVerifyError({
        message: e instanceof Error ? e.message : '网络错误',
        code: null,
        status: null,
        permissionDenied: false,
      })
    } finally {
      setVerifyPending(false)
    }
  }

  const awaiting = run?.status === 'AWAITING_APPROVAL'
  const executableStatus = run?.status === 'PROPOSED' || run?.status === 'APPROVED'
  const canDecideCap = capabilities.has('agent.approve')
  const canExecuteCap = capabilities.has('agent.execute')

  const gates = [
    { label: '任务已关联运行（sourceRunId）', ok: Boolean(runId) },
    { label: '关联运行状态为 EXECUTED', ok: run?.status === 'EXECUTED' },
    { label: '存在真实 AgentExecution 回执', ok: Boolean(run?.executionRecord) },
    { label: '当前用户持有 outcome.verify', ok: capabilities.has('outcome.verify') },
    {
      label: '当前用户不是运行发起人（第二人）',
      ok: Boolean(currentUserId) && Boolean(run) && currentUserId !== run?.requestedBy,
    },
  ]
  const gatesReady = Boolean(run) && gates.every((g) => g.ok)

  return (
    <section
      aria-label="服务端真实执行闭环"
      data-testid="execution-panel"
      className="space-y-3 rounded-lf-lg border border-lf-line bg-lf-surface-2/40 p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-lf-text">服务端真实执行闭环</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-lf-text-muted">
          本面板只呈现服务端真实状态：当前 execute 的唯一副作用是一条 IN_APP 站内回执（kind=RECEIPT），
          <strong className="text-lf-text">不是对外动作</strong>。
          「Mission CLOSED ≠ Agent EXECUTED」「Agent EXECUTED ≠ Outcome VERIFIED」；回执与模型输出都不是成果证明。
        </p>
      </div>

      {/* ═══ ① 运行与阶段 ═══ */}
      <div data-testid="execution-run" className="space-y-2 rounded-lf border border-lf-line bg-lf-surface p-3">
        <h4 className="text-xs font-semibold text-lf-text">① 运行与编排阶段</h4>

        {!runId ? (
          <Empty
            testId="execution-empty-run"
            text="该任务不是由意图运行创建，没有关联执行记录（因此没有运行详情、阶段事件与回执）。"
          />
        ) : runRes.loading ? (
          <Loading />
        ) : runRes.error ? (
          <ErrBox failure={runRes.error} label="运行详情读取失败" testId="execution-run-error" />
        ) : !run ? (
          <Empty text="未读到运行记录（响应为空，请刷新），不显示为 0 条。" />
        ) : (
          <>
            <div
              data-testid="execution-run-status"
              className="rounded-lf border border-lf-line bg-lf-surface-2 p-2.5 text-xs"
            >
              <p className="text-lf-text">
                运行状态：<span className="font-medium text-lf-signal">{statusLabel(run.status)}</span>
                <span className="ml-2 text-lf-text-faint">（{run.status}）</span>
              </p>
              <p className="mt-1 text-lf-text-muted">
                {statusHint(run.status, run.requiresApproval)}
                {run.requiresApproval ? ' 该运行需要审批。' : ' 该运行不需审批。'}
              </p>
            </div>

            {run.injectionFlagged && (
              <p
                data-testid="execution-injection"
                role="alert"
                className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-2.5 text-xs leading-relaxed text-lf-danger"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                检测到注入信号，已升级审批（仅陈述事实，不展示原文）。
              </p>
            )}

            <div className="rounded-lf border border-lf-line bg-lf-surface-2/40 p-2.5">
              <p data-testid="execution-stage-note" className="text-[11px] leading-relaxed text-lf-text-muted">
                下面是<strong className="text-lf-text">编排阶段事件，不是模型 token 流</strong>：
                记录服务端编排走到哪一步（额度检查 / 模型调用 / 契约校验 / 持久化 / 降级），不逐字转发模型生成过程。
              </p>

              {stagesLoading ? (
                <Loading text="正在读取编排阶段事件…" />
              ) : stagesError ? (
                <ErrBox failure={stagesError} label="阶段事件读取失败" testId="execution-stage-error" />
              ) : stages.length === 0 ? (
                <Empty text="暂无编排阶段事件（读不到不显示为 0 条）。" testId="execution-stage-empty" />
              ) : (
                <ol data-testid="execution-stage-list" className="mt-2 space-y-1.5">
                  {stages.map((s) => (
                    <li
                      key={s.seq}
                      data-testid={`execution-stage-${s.seq}`}
                      className="rounded-lf border border-lf-line bg-lf-surface p-2 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-lf-text">
                          #{s.seq} {STAGE_LABEL[s.stage] ?? s.stage}
                        </span>
                        <span className="text-lf-text-faint">{s.at || '—'}</span>
                      </div>
                      <p className="mt-0.5 text-lf-text-faint">{s.note ?? '编排阶段事件'}</p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-lf-text-muted">编排事实</summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-lf-text-muted">
                          {formatDetail(s.detail)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              )}

              <button
                type="button"
                data-testid="execution-stage-resume"
                disabled={stagesLoading || !runId}
                onClick={() => void loadStages(lastSeq, true, true)}
                className="lf-focus-ring mt-2 inline-flex items-center gap-1.5 rounded-lf border border-lf-line-strong px-2.5 py-1 text-[11px] font-medium text-lf-text transition-colors hover:bg-lf-surface-2 disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                从上次断点续读（Last-Event-ID: {lastSeq}）
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ ② 审批与执行 ═══ */}
      <div data-testid="execution-actions" className="space-y-2 rounded-lf border border-lf-line bg-lf-surface p-3">
        <h4 className="text-xs font-semibold text-lf-text">② 审批与执行</h4>
        <p
          data-testid="execution-honesty-note"
          className="rounded-lf border border-lf-line bg-lf-surface-2 p-2 text-[11px] leading-relaxed text-lf-text-muted"
        >
          常驻说明：<strong className="text-lf-text">当前执行效果为站内回执，不是对外送达</strong>。
          执行按钮不暗示任何外部动作；回执不等于任务已完成，更不等于成果达成。
        </p>

        {!runId ? (
          <Empty text="未关联运行，没有可审批 / 可执行的动作。" />
        ) : runRes.loading ? (
          <Loading />
        ) : runRes.error ? (
          <ErrBox failure={runRes.error} label="运行详情读取失败" />
        ) : !run ? (
          <Empty text="未读到运行记录，不渲染任何动作按钮。" />
        ) : (
          <>
            <p className="text-xs text-lf-text-muted">当前：{statusLabel(run.status)}。</p>

            {/* 审批：仅 AWAITING_APPROVAL；能力 + 服务端 canApprove/canReject 双判 */}
            {awaiting && (
              <div className="space-y-1.5">
                {!canDecideCap ? (
                  <p className="text-[11px] text-lf-text-faint">当前角色不能审批（需要 agent.approve）。</p>
                ) : run.canApprove || run.canReject ? (
                  <>
                    <input
                      type="text"
                      data-testid="execution-action-note"
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      placeholder="审批备注（可选）"
                      className="lf-focus-ring w-full rounded-lf border border-lf-line bg-lf-surface px-2 py-1.5 text-xs text-lf-text"
                    />
                    <div className="flex flex-wrap gap-2">
                      {run.canApprove && (
                        <button
                          type="button"
                          data-testid="execution-approve"
                          disabled={actionPending !== null}
                          onClick={() => void runAction('approve')}
                          className="lf-focus-ring min-h-9 rounded-lf border border-lf-signal/50 bg-lf-signal-soft px-3 text-xs font-medium text-lf-signal transition-colors hover:bg-lf-surface-2 disabled:opacity-50"
                        >
                          {actionPending === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
                          批准
                        </button>
                      )}
                      {run.canReject && (
                        <button
                          type="button"
                          data-testid="execution-reject"
                          disabled={actionPending !== null}
                          onClick={() => void runAction('reject')}
                          className="lf-focus-ring min-h-9 rounded-lf border border-lf-danger/50 px-3 text-xs font-medium text-lf-danger transition-colors hover:bg-lf-surface-2 disabled:opacity-50"
                        >
                          驳回
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-lf-text-faint">
                    已有裁决或当前状态不允许改判（服务端判据），审批入口已关闭。
                  </p>
                )}
              </div>
            )}

            {/* 执行：PROPOSED（LOW 不需审批）/ APPROVED；能力 + 服务端 execution.available 双判 */}
            {executableStatus && (
              <div className="space-y-1.5">
                {!canExecuteCap ? (
                  <p className="text-[11px] text-lf-text-faint">当前角色不能执行（需要 agent.execute）。</p>
                ) : run.execution?.available ? (
                  <button
                    type="button"
                    data-testid="execution-execute"
                    disabled={actionPending !== null}
                    onClick={() => void runAction('execute')}
                    className="lf-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lf border border-lf-line-strong bg-lf-surface-2 px-3 text-xs font-medium text-lf-text transition-colors hover:bg-lf-surface disabled:opacity-50"
                  >
                    {actionPending === 'execute' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    执行运行（生成站内回执）
                  </button>
                ) : (
                  <p className="text-[11px] text-lf-text-faint">
                    当前不可执行：{run.execution?.reason ?? '服务端未放行'}。不渲染点了必然失败的执行按钮。
                  </p>
                )}
              </div>
            )}

            {run.status === 'EXECUTED' && (
              <p className="text-[11px] text-lf-text-muted">运行已执行，站内回执见第 ③ 段。</p>
            )}

            {actionError && (
              <ErrBox
                failure={actionError}
                label="操作没生效"
                testId="execution-action-error"
              />
            )}
          </>
        )}
      </div>

      {/* ═══ ③ 回执 ═══ */}
      <div data-testid="execution-receipt-section" className="space-y-2 rounded-lf border border-lf-line bg-lf-surface p-3">
        <h4 className="text-xs font-semibold text-lf-text">③ 站内回执</h4>

        {!runId ? (
          <Empty text="未关联运行，没有站内回执。" />
        ) : runRes.loading ? (
          <Loading />
        ) : runRes.error ? (
          <ErrBox failure={runRes.error} label="运行详情读取失败" />
        ) : !run ? (
          <Empty text="未读到运行记录（读不到不显示为 0 条）。" />
        ) : run.status !== 'EXECUTED' ? (
          <Empty text="运行尚未执行，暂无回执。" />
        ) : !run.executionRecord ? (
          <Empty text="运行已标记为 EXECUTED，但未读到回执记录（请刷新运行详情），不显示为 0 条。" />
        ) : (
          <div data-testid="execution-receipt" className="rounded-lf border border-lf-line bg-lf-surface-2 p-2.5">
            <dl className="space-y-1 text-xs">
              <div className="flex gap-2">
                <dt className="shrink-0 text-lf-text-faint">deliveryId</dt>
                <dd className="break-all text-lf-text-muted">{run.executionRecord.deliveryId ?? '（无）'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-lf-text-faint">deliveryStatus</dt>
                <dd className="text-lf-text-muted">{run.executionRecord.deliveryStatus}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-lf-text-faint">kind</dt>
                <dd className="text-lf-text-muted">{run.executionRecord.kind}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-lf-text-faint">channel</dt>
                <dd className="text-lf-text-muted">{run.executionRecord.channel}</dd>
              </div>
            </dl>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-lf-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              这是内部回执证据（一条 IN_APP 站内信，不是对外送达），不等于成果达成，也不是「任务已完成」。
            </p>
          </div>
        )}
      </div>

      {/* ═══ ④ 独立成果核验 ═══ */}
      <div data-testid="execution-verification" className="space-y-2 rounded-lf border border-lf-line bg-lf-surface p-3">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-lf-text">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ④ 独立成果核验（第二人）
        </h4>
        <p className="text-[11px] leading-relaxed text-lf-text-muted">
          模型输出与回执都不是成果证据。本段只对真实回执按验收判据<strong className="text-lf-text">逐条人工确认</strong>：
          不自动勾选、不自动生成结论；提交内容只含判据与备注。
        </p>

        {verification.loading ? (
          <Loading />
        ) : verification.error ? (
          <ErrBox failure={verification.error} label="核验记录读取失败" testId="execution-verify-error" />
        ) : verification.data ? (
          /* 有记录：四重证据 + verificationLevel + statement 原文 */
          <div data-testid="execution-verification-record" className="space-y-2 rounded-lf border border-lf-line bg-lf-surface-2 p-2.5">
            <p className="text-xs text-lf-text">
              核验档位（verificationLevel）：
              <span className="ml-1 font-medium text-lf-signal">{verification.data.verificationLevel}</span>
            </p>
            <ul data-testid="execution-verification-evidence" className="space-y-1 text-[11px] text-lf-text-muted">
              <li>
                HTTP：{verification.data.evidence.http.method} {verification.data.evidence.http.path}
                （organizationId={verification.data.evidence.http.organizationId}）
              </li>
              <li>
                DB 行：verificationId={verification.data.evidence.dbRows.verificationId} ·
                missionId={verification.data.evidence.dbRows.missionId} ·
                runId={verification.data.evidence.dbRows.runId} ·
                executionId={verification.data.evidence.dbRows.executionId || '（无）'}
              </li>
              <li>审计事件类型：{verification.data.evidence.auditEventType}</li>
              <li>
                回执引用：deliveryId={verification.data.evidence.receipt.deliveryId ?? '（无）'} ·
                deliveryStatus={verification.data.evidence.receipt.deliveryStatus} ·
                kind={verification.data.evidence.receipt.kind} ·
                channel={verification.data.evidence.receipt.channel}
              </li>
            </ul>
            {verification.data.criteria.length > 0 && (
              <ul className="space-y-0.5 text-[11px] text-lf-text-muted">
                {verification.data.criteria.map((c, i) => (
                  <li key={i}>
                    <CheckCircle2 className="mr-1 inline h-3 w-3 text-lf-signal" aria-hidden="true" />
                    {c.label}
                    {c.confirmed ? '（已确认）' : '（未确认）'}
                  </li>
                ))}
              </ul>
            )}
            <blockquote
              data-testid="execution-verification-statement"
              className="border-l-2 border-lf-line pl-2 text-[11px] leading-relaxed text-lf-text-faint"
            >
              {verification.data.statement}
            </blockquote>
          </div>
        ) : (
          /* 无记录：先看五道前置，满足才渲染表单（不渲染点了必 409 的核验按钮） */
          <div className="space-y-2">
            {!runId ? (
              <Empty text="任务未关联运行，无法进行独立核验（前置未满足）。" />
            ) : runRes.loading ? (
              <Loading text="正在读取运行信息以判断核验前置…" />
            ) : runRes.error ? (
              <ErrBox failure={runRes.error} label="运行详情读取失败" />
            ) : (
              <ul data-testid="execution-verification-gates" className="space-y-1 text-[11px]">
                {gates.map((g) => (
                  <li key={g.label} className="flex items-center gap-1.5 text-lf-text-muted">
                    {g.ok ? (
                      <CheckCircle2 className="h-3 w-3 text-lf-signal" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-lf-text-faint" aria-hidden="true" />
                    )}
                    {g.label}：{g.ok ? '满足' : '未满足'}
                  </li>
                ))}
              </ul>
            )}

            {!gatesReady && (
              <p className="text-[11px] leading-relaxed text-lf-text-faint">
                {currentUserId && run && currentUserId === run.requestedBy
                  ? '你是该运行的发起人，需由另一名成员进行独立核验（第二人原则），故不开放核验入口。'
                  : !currentUserId
                    ? '无法确认当前用户身份，暂不开放核验入口。'
                    : '前置未全部满足，服务端会拒绝核验（409），故不渲染提交表单。'}
              </p>
            )}

            {gatesReady && (
              <form
                onSubmit={(e) => void submitVerification(e)}
                className="space-y-2 rounded-lf border border-lf-line bg-lf-surface-2 p-2.5"
              >
                <p className="text-[11px] text-lf-text-muted">
                  判据初始取自任务的成功判据（如需调整方案请在方案编辑器修改）。请逐条勾选确认；不自动勾选。
                </p>
                <ul data-testid="execution-verification-criteria" className="space-y-1.5">
                  {criteria.map((c, i) => (
                    <li
                      key={i}
                      data-testid={`execution-verification-criterion-${i}`}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="checkbox"
                        checked={c.confirmed}
                        onChange={() =>
                          setCriteria((prev) =>
                            prev.map((row, idx) =>
                              idx === i ? { ...row, confirmed: !row.confirmed } : row,
                            ),
                          )
                        }
                        data-testid={`execution-criterion-confirm-${i}`}
                        aria-label={`确认判据 ${i + 1}`}
                        className="lf-focus-ring h-4 w-4"
                      />
                      <input
                        type="text"
                        value={c.label}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((row, idx) =>
                              idx === i ? { ...row, label: e.target.value } : row,
                            ),
                          )
                        }
                        data-testid={`execution-criterion-label-${i}`}
                        placeholder="验收判据"
                        className="lf-focus-ring min-w-0 flex-1 rounded-lf border border-lf-line bg-lf-surface px-2 py-1 text-xs text-lf-text"
                      />
                      <button
                        type="button"
                        onClick={() => setCriteria((prev) => prev.filter((_, idx) => idx !== i))}
                        className="lf-focus-ring rounded-lf px-1.5 py-1 text-[11px] text-lf-text-faint hover:text-lf-danger"
                        aria-label={`删除判据 ${i + 1}`}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setCriteria((prev) => [...prev, { label: '', confirmed: false }])}
                  className="lf-focus-ring rounded-lf border border-lf-line px-2 py-1 text-[11px] text-lf-text-muted hover:text-lf-text"
                >
                  + 添加判据
                </button>
                <textarea
                  data-testid="execution-verification-evidence-note"
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  placeholder="证据备注（可选）"
                  rows={2}
                  className="lf-focus-ring w-full rounded-lf border border-lf-line bg-lf-surface px-2 py-1.5 text-xs text-lf-text"
                />
                <p className="text-[11px] leading-relaxed text-lf-text-faint">
                  提交内容仅含判据与备注；proposal / modelOutput / spec 是模型输出，不是证据，
                  服务端会以 400 MODEL_OUTPUT_NOT_EVIDENCE 拒绝此类字段。
                </p>
                <button
                  type="submit"
                  data-testid="execution-verify-submit"
                  disabled={!criteriaValid || verifyPending}
                  className="lf-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lf border border-lf-signal/50 bg-lf-signal-soft px-3 text-xs font-medium text-lf-signal transition-colors hover:bg-lf-surface-2 disabled:opacity-50"
                >
                  {verifyPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  提交独立核验
                </button>
                {verifyError && (
                  <ErrBox failure={verifyError} label="核验提交失败" testId="execution-verify-error" />
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
