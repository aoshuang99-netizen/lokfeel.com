'use client'

/**
 * T03 · 意图表单（客户端）—— 移动优先、**逐字段披露**
 *
 * 三条设计约束：
 *   1. **字段目录由服务端传入**，前端不再维护第二份清单（否则会出现"界面没有开关、
 *      但后端仍在往外发"的漂移）。
 *   2. **默认值分两层**：`suggested` 只是*建议勾选*（用户点"采用建议"才生效）；
 *      API 侧缺省恒为 `SELF`。两者语义不同，UI 文案要区分开。
 *   3. **受保护字段（email 等）渲染成说明**，而不是开关 —— 因为后端在
 *      结构性层面拒绝授权它们（400），给个开关只会制造"以为能开"的错觉。
 *
 * 提交走真实 API（`/api/v1/intents`），新建带 `Idempotency-Key`（网络重试不产生重复）。
 */

import { useState } from 'react'

export interface DisclosureFieldProp {
  key: string
  label: string
  group: string
  sensitive: boolean
  disclosable: boolean
  defaultAudience: string
}

export interface InitialIntentProp {
  id: string
  need: string
  offer: string
  constraints: string[]
  disclosure: Record<string, string>
  expiresAt: string | null
  status: string
}

export interface AudienceOptionProp {
  value: string
  label: string
}

export interface IntentFormProps {
  missionId: string
  missionOpen: boolean
  joined: boolean
  fields: DisclosureFieldProp[]
  suggested: Record<string, string>
  /**
   * 受众档位清单（含中文标签），由**服务端**从字段目录下发。
   *
   * 为什么不让前端自己写死三项：T03 已经因为"前端维护第二份清单"吃过亏。
   * 若这里硬编码 `SELF/ORGANIZER/COUNTERPARTY`，T04 新增 `CANDIDATE` 档时
   * 前端会**静默**少一个选项 —— 用户无从把字段开给"同任务的伙伴"，
   * 而后端投影却已经支持这一档。这是"界面没有开关、数据却能往外走"的镜像版本：
   * 用户以为自己没有选择，实际上系统已经替他把这档留好了。
   */
  audiences: AudienceOptionProp[]
  initialIntent: InitialIntentProp | null
}

const GROUP_LABELS: Record<string, string> = {
  identity: '身份',
  professional: '职业',
  background: '背景（敏感）',
  preference: '偏好',
  contact: '联系方式',
}

/** ISO → `datetime-local` 输入值（本地时区）。 */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function IntentForm(props: IntentFormProps) {
  // `props.audiences` 是**档位清单**；下面 useState 里的 `audiences` 是
  // "每个字段当前选了哪一档"。语义不同，故在解构处改名，避免混淆。
  const {
    missionId,
    missionOpen,
    joined,
    fields,
    suggested,
    audiences: audienceOptions,
    initialIntent,
  } = props

  const [need, setNeed] = useState(initialIntent?.need ?? '')
  const [offer, setOffer] = useState(initialIntent?.offer ?? '')
  const [constraintsText, setConstraintsText] = useState(
    (initialIntent?.constraints ?? []).join('、')
  )
  const [expiresAt, setExpiresAt] = useState(toLocalInput(initialIntent?.expiresAt ?? null))
  const [audiences, setAudiences] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of fields) {
      if (!f.disclosable) continue
      init[f.key] = initialIntent?.disclosure?.[f.key] ?? 'SELF'
    }
    return init
  })

  const [savedId, setSavedId] = useState<string | null>(initialIntent?.id ?? null)
  const [savedStatus, setSavedStatus] = useState<string>(initialIntent?.status ?? '')
  const [preview, setPreview] = useState<{
    organizer: Record<string, unknown>
    candidate: Record<string, unknown>
    counterparty: Record<string, unknown>
  } | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const withdrawn = savedStatus === 'WITHDRAWN'
  const disabled = busy || !missionOpen || !joined || withdrawn

  function applySuggestion() {
    const next: Record<string, string> = {}
    for (const f of fields) {
      if (!f.disclosable) continue
      next[f.key] = suggested[f.key] ?? 'SELF'
    }
    setAudiences(next)
    setMessage({ kind: 'ok', text: '已采用建议的披露范围（仍可逐项修改）。' })
  }

  async function loadPreview(intentId: string) {
    try {
      const res = await fetch(`/api/v1/intents/${intentId}/disclosure`)
      if (!res.ok) return
      const body = await res.json()
      setPreview({
        organizer: body?.data?.preview?.organizer ?? {},
        candidate: body?.data?.preview?.candidate ?? {},
        counterparty: body?.data?.preview?.counterparty ?? {},
      })
    } catch {
      /* 预览失败不影响主流程 */
    }
  }

  async function submit() {
    setBusy(true)
    setMessage(null)
    try {
      const payload: Record<string, unknown> = {
        need,
        offer,
        constraints: constraintsText
          .split(/[,，、\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        disclosure: audiences,
      }
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString()

      const isUpdate = Boolean(savedId)
      if (!isUpdate) payload.missionId = missionId

      const res = await fetch(isUpdate ? `/api/v1/intents/${savedId}` : '/api/v1/intents', {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(isUpdate ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
        },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        setMessage({
          kind: 'err',
          text: body?.error?.message ?? `提交失败（HTTP ${res.status}）`,
        })
        return
      }

      const data = body?.data
      setSavedId(data.id)
      setSavedStatus(data.status)
      setMessage({ kind: 'ok', text: isUpdate ? '意图已更新。' : '意图已提交。' })
      await loadPreview(data.id)
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    if (!savedId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/intents/${savedId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage({ kind: 'err', text: body?.error?.message ?? '撤销失败' })
        return
      }
      setSavedStatus(body?.data?.status ?? 'WITHDRAWN')
      setPreview({ organizer: {}, candidate: {}, counterparty: {} })
      setMessage({ kind: 'ok', text: '已撤销。你的资料不再出现在任何匹配与披露中。' })
    } finally {
      setBusy(false)
    }
  }

  const grouped = fields.reduce<Record<string, DisclosureFieldProp[]>>((acc, f) => {
    ;(acc[f.group] ??= []).push(f)
    return acc
  }, {})

  return (
    <div className="space-y-6" data-testid="intent-form">
      {!joined ? (
        <p
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          data-testid="intent-need-join"
        >
          你需要先加入这个任务，才能提交意图。
        </p>
      ) : null}
      {!missionOpen ? (
        <p
          className="rounded-xl border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground"
          data-testid="intent-mission-closed"
        >
          该任务当前不接受新的意图提交。
        </p>
      ) : null}

      {/* ── 意图正文 ── */}
      <section className="space-y-4">
        {/*
          ⚠️ 这条声明是**功能前提**，不是装饰文案：T04 的候选列表会把
          「我需要什么 / 我能提供什么」展示给**同任务的参与者**（否则他们
          无从判断要不要建立连接）。用户必须在**提交之前**就被告知这一点 ——
          悄悄扩大一个用户没被告知过的可见范围，正是 AC-03 要防的事。
          删掉这段就等同于把 need/offer 变成未声明的披露面。
        */}
        <p
          className="rounded-xl border border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground"
          data-testid="intent-text-visibility"
        >
          下面两段内容会展示给<strong className="text-foreground">同任务的参与者</strong>
          （用于互相判断是否值得建立连接），这是任务内匹配所必需的。
          档案字段（昵称、城市、职业…）<strong className="text-foreground">不会</strong>
          随之披露，它们各自独立受下方逐项开关控制。
        </p>
        <div>
          <label htmlFor="intent-need" className="text-sm font-medium text-foreground">
            我需要什么
          </label>
          <textarea
            id="intent-need"
            data-testid="intent-need"
            value={need}
            onChange={(e) => setNeed(e.target.value)}
            rows={3}
            placeholder="例如：需要东南亚本地的分销与清关伙伴"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-[15px] text-foreground"
          />
        </div>
        <div>
          <label htmlFor="intent-offer" className="text-sm font-medium text-foreground">
            我能提供什么
          </label>
          <textarea
            id="intent-offer"
            data-testid="intent-offer"
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            rows={3}
            placeholder="例如：样品支持、合规材料模板、工厂验厂资源"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-[15px] text-foreground"
          />
        </div>
        <div>
          <label htmlFor="intent-constraints" className="text-sm font-medium text-foreground">
            约束（可选，用「、」分隔）
          </label>
          <input
            id="intent-constraints"
            data-testid="intent-constraints"
            value={constraintsText}
            onChange={(e) => setConstraintsText(e.target.value)}
            placeholder="例如：仅限东南亚、不接受独家代理"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-[15px] text-foreground"
          />
        </div>
        <div>
          <label htmlFor="intent-expires" className="text-sm font-medium text-foreground">
            有效期（可选）
          </label>
          <input
            id="intent-expires"
            data-testid="intent-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-[15px] text-foreground"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            到期后你的资料会自动停止披露，无需手动撤销。
          </p>
        </div>
      </section>

      {/* ── 逐字段披露 ── */}
      <section className="rounded-2xl border border-border bg-card/40 p-5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">谁能看到我的哪些信息</h2>
          <button
            type="button"
            onClick={applySuggestion}
            data-testid="intent-suggest"
            className="ml-auto rounded-lg border border-border px-3 py-1 text-xs text-foreground"
          >
            采用建议
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          默认<strong className="text-foreground">不披露</strong>任何字段。选项按「能看到的人从少到多」
          排列：<strong className="text-foreground">组织者</strong>= 只给发起该任务的主理人；
          <strong className="text-foreground">匹配后的对手方</strong>= 只给已经与你双向同意的对方
          （外加组织者）；<strong className="text-foreground">同任务的伙伴</strong>= 给同一条任务里
          所有与你互补的成员（最宽，已覆盖前两种人）。
        </p>

        {Object.entries(grouped).map(([group, list]) => (
          <div key={group} className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {GROUP_LABELS[group] ?? group}
            </h3>
            <div className="mt-2 divide-y divide-border">
              {list.map((f) => (
                <div key={f.key} className="py-2.5" data-testid={`intent-field-${f.key}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{f.label}</span>
                    {f.sensitive ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">
                        敏感
                      </span>
                    ) : null}
                  </div>
                  {f.disclosable ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {audienceOptions.map((opt) => (
                        <label
                          key={opt.value}
                          className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${
                            audiences[f.key] === opt.value
                              ? 'border-blue-500/50 bg-blue-500/15 text-blue-100'
                              : 'border-border text-muted-foreground'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`aud-${f.key}`}
                            value={opt.value}
                            checked={audiences[f.key] === opt.value}
                            onChange={() => setAudiences((p) => ({ ...p, [f.key]: opt.value }))}
                            data-testid={`intent-aud-${f.key}-${opt.value}`}
                            className="sr-only"
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p
                      className="mt-1 text-xs text-muted-foreground"
                      data-testid={`intent-protected-${f.key}`}
                    >
                      此类信息不能在这里授权 —— 只有双方同意建立连接后，才会通过专门的同意流程交换。
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ── 操作 ── */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          data-testid="intent-submit"
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? '处理中…' : savedId ? '保存修改' : '提交我的意图'}
        </button>
        {savedId && !withdrawn ? (
          <button
            type="button"
            onClick={withdraw}
            disabled={busy}
            data-testid="intent-withdraw"
            className="rounded-xl border border-border px-5 py-3 text-sm text-foreground disabled:opacity-40"
          >
            撤销
          </button>
        ) : null}
      </div>

      {message ? (
        <p
          data-testid="intent-message"
          className={`text-sm ${
            message.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {savedId ? (
        <p className="text-xs text-muted-foreground" data-testid="intent-status">
          当前状态：{savedStatus || 'ACTIVE'}
        </p>
      ) : null}

      {/* ── 披露预览（"即将披露给谁哪些信息"）── */}
      {preview ? (
        <section className="rounded-2xl border border-border bg-card/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">披露预览</h2>
          {/*
            三个受众按"由宽到窄"排列：组织者 ⊇ 同任务的伙伴 ⊇ 匹配后的对手方。
            顺序不是审美 —— 用户要能一眼看出"收紧哪一档会少给谁看"。
          */}
          <PreviewGroup
            testId="intent-preview-organizer"
            title="组织者将看到"
            values={preview.organizer}
            fields={fields}
          />
          <PreviewGroup
            testId="intent-preview-candidate"
            title="同任务的伙伴将看到"
            values={preview.candidate}
            fields={fields}
          />
          <PreviewGroup
            testId="intent-preview-counterparty"
            title="匹配后的对手方将看到"
            values={preview.counterparty}
            fields={fields}
          />
        </section>
      ) : null}
    </div>
  )
}

/** 披露预览中的一个受众分组。抽出来是为了让多档渲染**不可能**出现不一致。 */
function PreviewGroup({
  testId,
  title,
  values,
  fields,
}: {
  testId: string
  title: string
  values: Record<string, unknown>
  fields: DisclosureFieldProp[]
}) {
  return (
    <div className="mt-3" data-testid={testId}>
      <h3 className="text-xs text-muted-foreground">{title}</h3>
      {Object.keys(values).length === 0 ? (
        <p className="text-sm text-muted-foreground">（无）</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm text-foreground">
          {Object.entries(values).map(([k, v]) => (
            <li key={k}>
              {fields.find((f) => f.key === k)?.label ?? k}：{String(v)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
