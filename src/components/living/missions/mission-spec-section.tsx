'use client'

/**
 * V21 · 第二批 · C04 —— 任务详情里的「方案版本」区。
 *
 * 真实数据来源（不伪造、不凭空造 spec）：
 *   1. `GET /api/v1/missions/{id}/spec` → 已保存的版本与历史（对象 data）。
 *   2. 若还没有保存过任何版本，且任务由意图运行创建（sourceRunId 非空），
 *      再读 `GET /api/v1/agents/runs/{runId}` 的 `proposal` 作为**初始方案**。
 *   3. 两者都没有 ⇒ 明确显示「还没有可编辑的方案」，绝不造一个空壳 spec 充数。
 *
 * 读到的 proposal 仍要过一遍 `WorkspaceSpecSchema`：它是跨网络来的 JSON，
 * 校验不过就不渲染编辑器（与 IntentGateway 的防御纵深同源）。
 *
 * 「刷新不丢」靠服务端版本表；并发冲突与锁定由服务端 409 裁决
 * （SpecEditor 会把 SPEC_VERSION_CONFLICT / MISSION_LOCKED 原样显示）。
 */

import { AlertCircle, Loader2 } from 'lucide-react'
import { useApiGet } from '@/hooks/use-api'
import SpecEditor from '@/components/living/now/spec-editor'
import { WorkspaceSpecSchema } from '@/lib/workspace-spec'

interface SpecEnvelope {
  success?: boolean
  data?: {
    missionId?: string
    currentVersion?: number
    current?: { version?: number; spec?: unknown; changeNote?: string | null } | null
    history?: Array<{ version?: number; actorId?: string; createdAt?: string; changeNote?: string | null }>
  } | null
  error?: { code?: string; message?: string }
}

interface RunEnvelope {
  success?: boolean
  data?: { proposal?: unknown; status?: string } | null
  error?: { code?: string; message?: string }
}

export default function MissionSpecSection({
  missionId,
  sourceRunId,
  locked,
}: {
  missionId: string
  sourceRunId: string | null
  /** CLOSED 等终态：UI 只做提示，真正的锁定由服务端 409 裁决。 */
  locked: boolean
}) {
  const specRes = useApiGet<SpecEnvelope>(`/api/v1/missions/${missionId}/spec`)
  const saved = specRes.data?.data ?? null
  const hasSavedSpec = Boolean(saved?.current?.spec)

  /** 只有「还没存过版本」且「有真实关联运行」时才去读 run 的 proposal。 */
  const runRes = useApiGet<RunEnvelope>(
    sourceRunId && !hasSavedSpec && !specRes.isLoading && !specRes.error
      ? `/api/v1/agents/runs/${sourceRunId}`
      : null,
  )

  const candidate = saved?.current?.spec ?? runRes.data?.data?.proposal ?? null
  const parsed = candidate === null ? null : WorkspaceSpecSchema.safeParse(candidate)
  const currentVersion = saved?.currentVersion ?? 0
  const history = saved?.history ?? []

  return (
    <section
      aria-label="方案版本"
      className="space-y-3 rounded-lf border border-lf-line bg-lf-surface-2/40 p-3"
      data-testid="mission-spec-section"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-lf-text">方案与版本</h3>
          <p className="mt-0.5 text-[11px] text-lf-text-faint">
            可直接改期限、对价、约束与验收条件；每次保存留一个版本，冲突由服务端裁决。
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-lf-line px-2 py-0.5 text-[11px] text-lf-text-muted">
          v{currentVersion}
        </span>
      </div>

      {specRes.isLoading && (
        <div className="flex items-center gap-2 py-2 text-xs text-lf-text-muted" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          正在读取方案版本…
        </div>
      )}

      {/* 权限错误 ≠ 没有数据：不能把 403 显示成「还没有方案」。 */}
      {specRes.error && (
        <div className="flex items-start gap-2 rounded-lf border border-lf-danger/40 p-2 text-xs text-lf-danger" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>读取方案失败：{specRes.error}（这不是「没有方案」）</span>
        </div>
      )}

      {!specRes.isLoading && !specRes.error && parsed?.success && (
        <SpecEditor
          missionId={missionId}
          spec={parsed.data}
          currentVersion={currentVersion}
          locked={locked}
          onSaved={specRes.refetch}
        />
      )}

      {!specRes.isLoading && !specRes.error && parsed && !parsed.success && (
        <p className="text-xs text-lf-danger" data-testid="mission-spec-invalid">
          关联运行里的方案不符合 WorkspaceSpec v1.2，已停止渲染（不猜测字段）。
        </p>
      )}

      {!specRes.isLoading && !specRes.error && !parsed && (
        <p className="text-xs text-lf-text-muted" data-testid="mission-spec-empty">
          {runRes.isLoading
            ? '正在读取这次理解产生的方案…'
            : '这个任务还没有可编辑的方案；由「开始」屏写下目标后创建的任务会自动带上。'}
        </p>
      )}

      {history.length > 0 && (
        <details className="text-xs text-lf-text-muted" data-testid="mission-spec-history">
          <summary className="lf-focus-ring cursor-pointer">版本记录（{history.length}）</summary>
          <ul className="mt-2 space-y-1">
            {history.map((row, index) => (
              <li key={`${row.version ?? index}-${row.createdAt ?? ''}`} className="flex flex-wrap gap-2">
                <span className="text-lf-text-faint">v{row.version ?? '—'}</span>
                {row.createdAt && <span>{new Date(row.createdAt).toLocaleString()}</span>}
                {row.changeNote && <span className="text-lf-text-muted">· {row.changeNote}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
