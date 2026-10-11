'use client'

/**
 * T05 · 「发起连接」按钮（客户端）—— 仅对具备 `proposal.create` 的访客渲染
 *
 * ⚠️ 为什么默认折叠成"展开表单"而不是常驻可见：牵线是**运营动作**
 * （`proposal.create` = OPERATOR+），而候选页对**所有**已加入成员可见。
 * 页面据 `canPropose`（服务端按真实 membership 角色算出）决定要不要渲染本组件；
 * 渲染出来后仍折叠一层，避免普通浏览被一个运营输入框打断。
 *
 * ⚠️ **界面显隐不等于授权**：这里有没有按钮都不影响安全性 ——
 * 真正的执法在 `/api/v1/connections/proposals` 的 `withTenant('proposal.create')`
 * 与服务层的前置校验里。前端只是不显示点了必然 403 的入口。
 *
 * 契约：`POST /api/v1/connections/proposals`，**要求 `Idempotency-Key`**
 * （网络重试不产生重复提案）。`rationale` 长度与 `PROPOSAL_LIMITS` 对齐（8–500）。
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const RATIONALE_MIN = 8
const RATIONALE_MAX = 500

export function ProposeButton({
  missionId,
  candidateId,
}: {
  missionId: string
  candidateId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rationale, setRationale] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const trimmed = rationale.trim()
  const tooShort = trimmed.length < RATIONALE_MIN

  async function submit() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/v1/connections/proposals', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // 契约要求；键由浏览器生成，重试同一次提交不会产生第二条提案。
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ missionId, candidateId, rationale: trimmed }),
      })

      if (res.status === 401) {
        // 会话已过期 → 送到登录页并带回跳地址。
        // ⚠️ 用 `router.push()` 而不是 `window.location.href = ...`（后者触发
        //    `react-hooks/immutability` error 与 no-location-assign 规则）。
        const here = `${window.location.pathname}${window.location.search}`
        router.push(`/login?callbackUrl=${encodeURIComponent(here)}`)
        return
      }

      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage({
          kind: 'err',
          text: body?.error?.message ?? `发起失败（HTTP ${res.status}）`,
        })
        return
      }

      setDone(true)
      setMessage({
        kind: 'ok',
        text: '已发起连接提案。接下来需要双方各自同意，之后由运营发出介绍。',
      })
      router.refresh()
    } catch {
      setMessage({ kind: 'err', text: '网络异常，请稍后再试。' })
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-sm text-emerald-300" data-testid="propose-done">
        已发起连接提案，等待双方同意。
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="propose-open"
        className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-100"
      >
        发起连接
      </button>
    )
  }

  return (
    <div className="space-y-2" data-testid="propose-form">
      <label htmlFor="propose-rationale" className="text-xs text-muted-foreground">
        推荐理由（{RATIONALE_MIN}–{RATIONALE_MAX} 字，双方都能看到）
      </label>
      <textarea
        id="propose-rationale"
        data-testid="propose-rationale"
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={3}
        maxLength={RATIONALE_MAX}
        placeholder="例如：你需要在东南亚找分销伙伴，而对方正好有本地渠道与清关资源。"
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[15px] text-foreground"
      />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || tooShort}
          data-testid="propose-submit"
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? '处理中…' : '发起连接提案'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setMessage(null)
          }}
          disabled={busy}
          data-testid="propose-cancel"
          className="rounded-xl border border-border px-5 py-2.5 text-sm text-foreground disabled:opacity-40"
        >
          取消
        </button>
      </div>
      {message ? (
        <p
          data-testid="propose-message"
          className={`text-xs ${message.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
