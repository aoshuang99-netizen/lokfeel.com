'use client'

/**
 * T07 · Console — 设置屏
 *
 * 数据源：
 *   `GET   /api/v1/org`   （`org.read` —— **所有 ACTIVE 成员**都有）
 *   `PATCH /api/v1/org`   （`org.update` —— **仅 OWNER**）
 *
 * 🔴 「无空按钮」在这里的落实：
 *   读是公共的（谁都能看社群名），写只有所有者能做。因此本屏**不是**"要么全有要么全无"：
 *   - 有 `org.update` → 渲染可编辑表单 + 保存按钮；
 *   - 没有 → **不渲染表单**，只渲染只读信息 + 一句说明（"仅社群所有者可修改"）。
 *     渲染一个禁用/点了 403 的保存按钮，正是 AC-18 要排除的「空按钮」。
 *
 * ⚠️ 前端拿 `capabilities` 只用于**决定渲染什么**，不做授权判断 ——
 *    真正的拒绝由服务端 `withTenant()` 完成。
 *
 * ⚠️ 刻意**没有**「转让所有权」「删除社群」按钮：能力（`org.transfer` / `org.delete`）
 *    已在矩阵里，但流程（二次确认、审计、级联处理）尚未实现。这里只陈述事实。
 */

import { useState } from 'react'
import { AlertTriangle, Building2, Hash, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { invalidateCache, useApiGet } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

interface OrganizationDto {
  id: string
  name: string
  slug: string
  status: string
  createdAt: string
  updatedAt: string
}

interface OrgOverviewDto {
  organization: OrganizationDto
  myRole: string
  capabilities: string[]
  memberTotal: number
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  OPERATOR: '运营',
  MEMBER: '成员',
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '正常',
  SUSPENDED: '已停用',
}

/** PATCH 一个小工具：`use-api` 里只有 POST/DELETE，而这里语义上就是部分更新。 */
async function patchJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const err = (json as { error?: { message?: string } | string } | null)?.error
      const message =
        typeof err === 'string' ? err : (err?.message ?? `请求失败（${res.status}）`)
      return { ok: false, error: message }
    }
    return { ok: true, data: json }
  } catch {
    return { ok: false, error: '服务暂时不可用' }
  }
}

function Field({
  label,
  icon: Icon,
  value,
}: {
  label: string
  icon: typeof Hash
  value: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-card-border bg-background-secondary p-3">
      <p className="text-[11px] text-foreground-subtle mb-1 inline-flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </p>
      <div className="text-sm text-foreground break-words">{value}</div>
    </div>
  )
}

/**
 * 编辑表单 —— **独立组件**，表单初值取自 props。
 *
 * 为什么要拆出来 + 用 `key={organization.updatedAt}`：
 *   如果放在页面里用 `useEffect` 把已加载的数据"灌进"表单状态，会触发
 *   `react-hooks/set-state-in-effect`（级联渲染），而且用户在后台刷新时会被重置输入。
 *   正确做法是让"表单的初值"由挂载时刻决定：保存成功后 `updatedAt` 变化 → key 变 → 重新挂载。
 */
function OrgEditForm({
  organization,
  onSaved,
}: {
  organization: OrganizationDto
  onSaved: () => void
}) {
  const [name, setName] = useState(organization.name)
  const [slug, setSlug] = useState(organization.slug)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const dirty = name.trim() !== organization.name || slug.trim() !== organization.slug

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    setSaveError(null)
    setSavedAt(null)

    const body: Record<string, string> = {}
    if (name.trim() !== organization.name) body.name = name.trim()
    if (slug.trim() !== organization.slug) body.slug = slug.trim()

    const res = await patchJson('/api/v1/org', body)
    setSaving(false)

    if (!res.ok) {
      setSaveError(res.error ?? '保存失败')
      return
    }
    setSavedAt(new Date().toLocaleTimeString())
    onSaved()
  }

  return (
    <>
      <p className="text-xs text-foreground-muted mb-3">
        名称是展示用的；标识（slug）用于对外寻址，只能用小写字母、数字与连字符。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] text-foreground-subtle">社群名称</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-label="社群名称"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-card-border bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-foreground-subtle">对外标识（slug）</span>
          <input
            type="text"
            value={slug}
            maxLength={63}
            onChange={(e) => setSlug(e.target.value)}
            aria-label="对外标识"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-card-border bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving ? (
          <button
            type="button"
            onClick={() => {
              setName(organization.name)
              setSlug(organization.slug)
              setSaveError(null)
            }}
            className="px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            撤销修改
          </button>
        ) : null}
        {!dirty && savedAt ? (
          <span className="text-[11px] text-success">已保存（{savedAt}）</span>
        ) : null}
        {!dirty && !savedAt ? (
          <span className="text-[11px] text-foreground-subtle">没有改动</span>
        ) : null}
      </div>

      {saveError ? <p className="text-xs text-danger mt-2">保存失败：{saveError}</p> : null}
    </>
  )
}

export default function ConsoleSettingsPage() {
  const org = useApiGet<ApiEnvelope<OrgOverviewDto>>('/api/v1/org')

  const data = org.data?.data
  const organization = data?.organization
  const canEdit = data?.capabilities?.includes('org.update') ?? false

  const afterSave = () => {
    invalidateCache('/api/v1/org')
    org.refetch()
  }

  if (org.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
        <RefreshCw className="w-4 h-4 animate-spin" />
        正在读取社群档案…
      </div>
    )
  }

  if (org.error || !organization) {
    return (
      <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
        <div className="flex items-center gap-2 text-warning mb-2">
          <AlertTriangle className="w-4 h-4" />
          <p className="text-sm font-medium">读不到社群档案</p>
        </div>
        <p className="text-sm text-foreground-muted">{org.error ?? '接口没有返回可用的数据。'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground font-display">设置</h1>
          <p className="text-xs text-foreground-muted mt-0.5">
            本社群的档案与你的权限 —— 这里改的是「社群」这一层，不是你的个人资料。
          </p>
        </div>
        <button
          type="button"
          onClick={() => org.refetch()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${org.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── 基本信息（只读） ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="社群名称" icon={Building2} value={organization.name} />
        <Field
          label="对外标识（slug）"
          icon={Hash}
          value={
            <code className="text-xs bg-background-tertiary px-1.5 py-0.5 rounded">
              {organization.slug}
            </code>
          }
        />
        <Field
          label="状态"
          icon={ShieldCheck}
          value={
            <span className={organization.status === 'ACTIVE' ? 'text-success' : 'text-warning'}>
              {STATUS_LABEL[organization.status] ?? organization.status}
            </span>
          }
        />
        <Field label="成员数" icon={Users} value={`${data?.memberTotal ?? 0} 人`} />
      </div>

      <p className="text-[11px] text-foreground-subtle">
        创建于 {new Date(organization.createdAt).toLocaleString()} · 更新于{' '}
        {new Date(organization.updatedAt).toLocaleString()} · 你在本社群的角色是「
        {ROLE_LABEL[data?.myRole ?? ''] ?? data?.myRole}」
      </p>

      {/* ── 修改（仅所有者见到表单） ── */}
      <section className="rounded-2xl border border-card-border bg-background-secondary p-4">
        <h2 className="text-sm font-semibold text-foreground font-display mb-1">修改社群档案</h2>

        {!canEdit ? (
          <p className="text-sm text-foreground-muted">
            只有社群所有者可以修改档案。你的角色是「
            {ROLE_LABEL[data?.myRole ?? ''] ?? data?.myRole}」，可以查看但不能编辑 ——
            需要修改请联系所有者。这里因此不显示编辑表单。
          </p>
        ) : (
          <OrgEditForm
            key={organization.updatedAt}
            organization={organization}
            onSaved={afterSave}
          />
        )}
      </section>

      {/* ── 危险操作：未实现，只说明 ── */}
      <section className="rounded-2xl border border-card-border bg-background-secondary p-4">
        <h2 className="text-sm font-semibold text-foreground font-display mb-1">转让与删除</h2>
        <p className="text-sm text-foreground-muted">
          「转让所有权」与「删除社群」需要二次确认、审计与级联处理，<b>尚未实现</b>，
          因此这里没有对应按钮 —— 渲染一个点了没反应的按钮比不渲染更糟。
          确有需要请直接联系平台运营。
        </p>
        <p className="text-[11px] text-foreground-subtle mt-2">
          能力已就绪（`org.transfer` / `org.delete`，仅所有者），流程属后续切片。
        </p>
      </section>
    </div>
  )
}
