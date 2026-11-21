'use client'

/**
 * V21 · 第二批 —— SpecEditor：WorkspaceSpec v1.2 字段级编辑器
 *
 * 用 `src/lib/living/spec/edit.ts` 的纯函数（editableFields / applySpecFieldEdit /
 * specDiff）编辑四个可编辑字段，提交到 `POST /api/v1/missions/{id}/spec`，
 * 带 `expectedVersion` 做乐观并发。
 *
 * 🔴 诚实边界：
 *   - `owner`：WorkspaceSpec v1.2 的 intent.data 是 strictObject，**没有负责人字段**，
 *     editableFields().owner 恒为 null —— 如实显示，不伪造输入框。
 *   - 这里保存的是「用户修订过的方案」，不是「任务已完成」，保存不产生对外动作。
 *   - 409 SPEC_VERSION_CONFLICT / MISSION_LOCKED 按语义码分别给刷新 / 锁定文案；
 *     含禁用字段的负例由服务端裁决（这里只发白名单字段）。
 *
 * props 里的 spec / currentVersion 由挂载方先 GET spec 得到；本组件自管草稿状态，
 * 409 冲突时的「刷新」自己重读 spec 端点，不依赖父级重新传 props。
 */

import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save } from 'lucide-react'
import type { WorkspaceSpec } from '@/lib/workspace-spec/schema'
import {
  applySpecFieldEdit,
  editableFields,
  specDiff,
  type EditableField,
} from '@/lib/living/spec/edit'

export interface SpecEditorProps {
  missionId: string
  spec: WorkspaceSpec
  currentVersion: number
  locked: boolean
  onSaved?: () => void
}

interface FormState {
  offer: string
  successCriteria: string
  constraints: string
  expiresAt: string
}

interface DraftResult {
  draft: WorkspaceSpec
  errors: Partial<Record<EditableField, string>>
}

interface SpecEnvelope {
  success?: boolean
  data?: {
    missionId?: string
    currentVersion?: number
    current?: { version?: number; spec?: WorkspaceSpec } | null
  }
  error?: {
    code?: string
    message?: string
    details?: { code?: string; expectedVersion?: unknown; currentVersion?: unknown }
  }
}

interface SaveFailure {
  message: string
  code: string | null
  status: number | null
}

type Conflict =
  | { kind: 'SPEC_VERSION_CONFLICT'; currentVersion: number }
  | { kind: 'MISSION_LOCKED' }
  | null

function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function formFromSpec(spec: WorkspaceSpec): FormState {
  const f = editableFields(spec)
  return {
    offer: f.offer ?? '',
    successCriteria: f.successCriteria.map((s) => s.trim()).join('\n'),
    constraints: f.constraints.map((s) => s.trim()).join('\n'),
    expiresAt: f.expiresAt ?? '',
  }
}

/** 从基线 spec 依次应用四个字段编辑；某字段非法时保留其旧值并记错误。 */
function buildDraft(base: WorkspaceSpec, form: FormState): DraftResult {
  let spec = base
  const errors: Partial<Record<EditableField, string>> = {}
  const edits: Array<{ field: EditableField; value: unknown }> = [
    { field: 'offer', value: form.offer.trim() === '' ? null : form.offer },
    { field: 'successCriteria', value: splitLines(form.successCriteria) },
    { field: 'constraints', value: splitLines(form.constraints) },
    { field: 'expiresAt', value: form.expiresAt.trim() === '' ? null : form.expiresAt.trim() },
  ]
  for (const edit of edits) {
    const result = applySpecFieldEdit(spec, edit)
    if (result.ok) spec = result.spec
    else errors[edit.field] = result.reason
  }
  return { draft: spec, errors }
}

function fieldLabel(field: EditableField): string {
  switch (field) {
    case 'offer':
      return '提议内容（offer）'
    case 'successCriteria':
      return '成功判据（每行一条）'
    case 'constraints':
      return '约束条件（每行一条）'
    case 'expiresAt':
      return '过期时间（ISO 日期时间，留空清除）'
  }
}

export default function SpecEditor({
  missionId,
  spec,
  currentVersion,
  locked,
  onSaved,
}: SpecEditorProps) {
  // 基线用「规范化后的草稿」初始化，保证初始 diff 为空（不把规范化误报成用户改动）。
  const [savedSpec, setSavedSpec] = useState<WorkspaceSpec>(() =>
    buildDraft(spec, formFromSpec(spec)).draft,
  )
  const [form, setForm] = useState<FormState>(() => formFromSpec(spec))
  const [version, setVersion] = useState<number>(currentVersion)
  const [changeNote, setChangeNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [refetching, setRefetching] = useState(false)
  const [saveError, setSaveError] = useState<SaveFailure | null>(null)
  const [conflict, setConflict] = useState<Conflict>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

  // 父级重新传入（刷新 / 切换任务）时同步本地草稿。
  // set-state-in-effect：改到渲染期按「spec+version 键」检测变化后重置（官方 props 变更模式），
  // 避免在 effect 里同步 setState 造成级联渲染；行为与原 effect 完全一致。
  const sourceKey = `${currentVersion}|${JSON.stringify(spec)}`
  const [syncedSourceKey, setSyncedSourceKey] = useState(sourceKey)
  if (syncedSourceKey !== sourceKey) {
    setSyncedSourceKey(sourceKey)
    setSavedSpec(buildDraft(spec, formFromSpec(spec)).draft)
    setForm(formFromSpec(spec))
    setVersion(currentVersion)
    setChangeNote('')
    setSaveError(null)
    setConflict(null)
    setSavedNotice(null)
  }

  const built = useMemo(() => buildDraft(savedSpec, form), [savedSpec, form])
  const diffs = useMemo(() => specDiff(savedSpec, built.draft), [savedSpec, built.draft])
  const hasFieldErrors = Object.keys(built.errors).length > 0
  const canSave = !locked && !saving && !hasFieldErrors && diffs.length > 0

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSavedNotice(null)
  }

  const refresh = async () => {
    setRefetching(true)
    setSaveError(null)
    setConflict(null)
    setSavedNotice(null)
    try {
      const res = await fetch(`/api/v1/missions/${missionId}/spec`)
      const env = (await res.json().catch(() => null)) as SpecEnvelope | null
      if (!res.ok || !env || env.success === false) {
        setSaveError({
          message: env?.error?.message ?? `HTTP ${res.status}`,
          code: env?.error?.details?.code ?? env?.error?.code ?? null,
          status: res.status,
        })
        return
      }
      const state = env.data
      const latestSpec = state?.current?.spec ?? spec
      const latestVersion =
        typeof state?.currentVersion === 'number' ? state.currentVersion : currentVersion
      const normalized = buildDraft(latestSpec, formFromSpec(latestSpec)).draft
      setSavedSpec(normalized)
      setForm(formFromSpec(latestSpec))
      setVersion(latestVersion)
      setSavedNotice(`已刷新到服务端最新版本 v${latestVersion}，请基于新版本重新编辑。`)
      onSaved?.()
    } catch (e) {
      setSaveError({
        message: e instanceof Error ? e.message : '网络错误',
        code: null,
        status: null,
      })
    } finally {
      setRefetching(false)
    }
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    setConflict(null)
    setSavedNotice(null)
    try {
      const res = await fetch(`/api/v1/missions/${missionId}/spec`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 只发白名单字段；未知字段 / 模型字段由服务端 strict 校验裁决。
        body: JSON.stringify({
          spec: built.draft,
          expectedVersion: version,
          ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}),
        }),
      })
      const env = (await res.json().catch(() => null)) as SpecEnvelope | null

      if (!res.ok || !env || env.success === false) {
        const err = env?.error
        const code = err?.details?.code ?? err?.code ?? null
        const message = err?.message ?? `HTTP ${res.status} 请求失败`
        if (res.status === 409 && code === 'SPEC_VERSION_CONFLICT') {
          const cv = err?.details?.currentVersion
          setConflict({
            kind: 'SPEC_VERSION_CONFLICT',
            currentVersion: typeof cv === 'number' ? cv : version,
          })
        } else if (res.status === 409 && code === 'MISSION_LOCKED') {
          setConflict({ kind: 'MISSION_LOCKED' })
        }
        setSaveError({ message, code, status: res.status })
        return
      }

      // 成功只认 2xx + 响应体（同形状 MissionSpecState）
      const nextVersion =
        typeof env.data?.currentVersion === 'number' ? env.data.currentVersion : version + 1
      setSavedSpec(built.draft)
      setForm(formFromSpec(built.draft))
      setVersion(nextVersion)
      setChangeNote('')
      setSavedNotice(`已保存为 v${nextVersion}（服务端确认）。这仅是方案修订，不是任务已完成。`)
      onSaved?.()
    } catch (e) {
      setSaveError({
        message: e instanceof Error ? e.message : '网络错误',
        code: null,
        status: null,
      })
    } finally {
      setSaving(false)
    }
  }

  const fields: EditableField[] = ['offer', 'successCriteria', 'constraints', 'expiresAt']

  return (
    <section
      aria-label="方案编辑器"
      data-testid="spec-editor"
      className="space-y-3 rounded-lf-lg border border-lf-line bg-lf-surface p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-lf-text">方案编辑（WorkspaceSpec v1.2）</h3>
          <p className="mt-0.5 text-[11px] text-lf-text-muted">
            当前基于 <span className="text-lf-text">v{version}</span>；保存后成为下一版。
            这里保存的是用户修订过的方案，不是「任务已完成」，也不产生对外动作。
          </p>
        </div>
        <button
          type="button"
          data-testid="spec-refresh"
          onClick={() => void refresh()}
          disabled={refetching}
          className="lf-focus-ring inline-flex shrink-0 items-center gap-1 rounded-lf border border-lf-line-strong px-2 py-1 text-[11px] text-lf-text-muted transition-colors hover:bg-lf-surface-2 disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          刷新
        </button>
      </div>

      {/* owner：v1.2 无负责人字段，如实显示，不伪造输入 */}
      <p
        data-testid="spec-owner"
        className="rounded-lf border border-lf-line bg-lf-surface-2 p-2 text-[11px] leading-relaxed text-lf-text-muted"
      >
        负责人（owner）：<span className="text-lf-text">WorkspaceSpec v1.2 暂无负责人字段</span>
        （editableFields().owner = null），因此不提供该输入，也不伪造字段。
      </p>

      {locked && (
        <p
          data-testid="spec-conflict"
          role="alert"
          className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-2.5 text-xs leading-relaxed text-lf-danger"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          任务已结束或执行已发生，历史方案不可覆盖（MISSION_LOCKED）。编辑已锁定。
        </p>
      )}

      {/* 四字段 */}
      <div className="space-y-2.5">
        {fields.map((field) => {
          const isArea = field === 'successCriteria' || field === 'constraints'
          const key = field as keyof FormState
          const shared = {
            id: `spec-${field}`,
            'data-testid': `spec-field-${field}`,
            value: form[key],
            disabled: locked,
            className:
              'lf-focus-ring w-full rounded-lf border border-lf-line bg-lf-surface px-2 py-1.5 text-xs text-lf-text disabled:opacity-50',
          }
          return (
            <div key={field}>
              <label htmlFor={`spec-${field}`} className="mb-1 block text-[11px] font-medium text-lf-text-muted">
                {fieldLabel(field)}
              </label>
              {isArea ? (
                <textarea
                  {...shared}
                  rows={3}
                  placeholder="每行一条"
                  onChange={(e) => updateField(key, e.target.value)}
                />
              ) : (
                <input
                  {...shared}
                  type="text"
                  onChange={(e) => updateField(key, e.target.value)}
                />
              )}
              {built.errors[field] && (
                <p className="mt-1 text-[11px] text-lf-danger">{built.errors[field]}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* 修订说明（可选） */}
      <div>
        <label htmlFor="spec-change-note" className="mb-1 block text-[11px] font-medium text-lf-text-muted">
          修订说明（可选）
        </label>
        <input
          id="spec-change-note"
          data-testid="spec-change-note"
          type="text"
          value={changeNote}
          disabled={locked}
          onChange={(e) => setChangeNote(e.target.value)}
          placeholder="这一版改了什么"
          className="lf-focus-ring w-full rounded-lf border border-lf-line bg-lf-surface px-2 py-1.5 text-xs text-lf-text disabled:opacity-50"
        />
      </div>

      {/* 人话 diff */}
      <div data-testid="spec-diff" className="rounded-lf border border-lf-line bg-lf-surface-2 p-2.5">
        <p className="text-[11px] font-medium text-lf-text-muted">本次改动（人话 diff）</p>
        {diffs.length === 0 ? (
          <p className="mt-1 text-[11px] text-lf-text-faint">暂无改动。</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {diffs.map((d) => (
              <li key={d.field} className="text-[11px] leading-relaxed text-lf-text-muted">
                <CheckCircle2 className="mr-1 inline h-3 w-3 text-lf-signal" aria-hidden="true" />
                {d.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 409 语义码分支 */}
      {conflict?.kind === 'SPEC_VERSION_CONFLICT' && (
        <div
          data-testid="spec-conflict"
          role="alert"
          className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-2.5 text-xs leading-relaxed text-lf-danger"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div>
            <p>版本已被他人更新（当前 v{conflict.currentVersion}），请刷新后重试。</p>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refetching}
              className="lf-focus-ring mt-1.5 inline-flex items-center gap-1 rounded-lf border border-lf-danger/50 px-2 py-1 text-[11px] font-medium hover:bg-lf-surface disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              刷新到最新版本
            </button>
          </div>
        </div>
      )}
      {conflict?.kind === 'MISSION_LOCKED' && (
        <p
          data-testid="spec-conflict"
          role="alert"
          className="rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-2.5 text-xs leading-relaxed text-lf-danger"
        >
          任务已结束或执行已发生，历史方案不可覆盖（MISSION_LOCKED）。
        </p>
      )}

      {/* 一般错误（展示 message + details.code，尤其 409） */}
      {saveError && !conflict && (
        <div
          data-testid="spec-editor-error"
          role="alert"
          className="rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-2.5 text-xs leading-relaxed text-lf-danger"
        >
          <p>保存失败：{saveError.message}</p>
          {(saveError.code || saveError.status) && (
            <p className="mt-0.5 text-[11px] text-lf-text-faint">
              错误码：{saveError.code ?? '—'}
              {saveError.status ? `（HTTP ${saveError.status}）` : ''}
            </p>
          )}
        </div>
      )}

      {savedNotice && (
        <p
          data-testid="spec-saved-notice"
          role="status"
          className="rounded-lf border border-lf-signal/40 bg-lf-signal-soft p-2 text-[11px] leading-relaxed text-lf-signal"
        >
          {savedNotice}
        </p>
      )}

      <button
        type="button"
        data-testid="spec-save"
        disabled={!canSave}
        onClick={() => void save()}
        className="lf-focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-lf border border-lf-signal/50 bg-lf-signal-soft px-3 text-xs font-medium text-lf-signal transition-colors hover:bg-lf-surface-2 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        保存为下一版（v{version + 1}）
      </button>
    </section>
  )
}
