'use client'

/**
 * T05 · 提案表态按钮（客户端）—— 接受 / 拒绝 / 撤回
 *
 * 三条约束：
 *   1. **动作清单由服务端下发**（`actions` prop）：前端**不**自己推断
 *      "这条提案现在能不能接受" —— 过期、已关闭、已介绍这些判据都在服务端，
 *      前端复刻一份只会与它漂移。服务端说没有任何动作，这里就不渲染按钮。
 *   2. **同意类输入严格等值**：请求体里的 `decision` 必须是 `accept` / `reject`
 *      （小写），与 `parseConsentDecision()` 的契约一致。写错大小写会得到 400，
 *      这是**刻意**的 —— 同意不接受模糊输入。
 *   3. **401 一律跳登录**：与会话过期相比，直接把用户送到登录页（带 callbackUrl
 *      回来）才是最短路径，也避免用户以为"点了没反应"。
 *
 * 端点（与契约逐字对齐）：
 *   POST /api/v1/connections/{connectionId}/consent   { decision: 'accept' | 'reject' }
 *   POST /api/v1/connections/{connectionId}/revoke    （空 body 合法）
 *
 * ⚠️ 路径只有 **3 段**：`{connectionId}` 就是提案 id，**没有** `proposals` 中间段 ——
 *    多写一段会 404，而单测（直接 import handler、手工传 params）发现不了（见 `changes.md` §4）。
 *
 * ⚠️ 这里**没有**「介绍」按钮：介绍是运营动作（`proposal.create`），
 * 由具备该能力的界面触发。放一个普通成员点不了、或点了必然 403 的按钮，
 * 比不放更糟 —— 用户会以为自己的连接卡住了。
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProposalAction } from '@/lib/connection'

const LABELS: Record<ProposalAction, string> = {
  ACCEPT: '同意',
  REJECT: '拒绝',
  REVOKE: '撤回',
}

/** 动作 → 按钮样式。同意是主行动，撤回是次级/危险，拒绝居中。 */
const CLASSES: Record<ProposalAction, string> = {
  ACCEPT: 'bg-blue-600 text-white',
  REJECT: 'border border-rose-500/40 bg-rose-500/10 text-rose-200',
  REVOKE: 'border border-border text-muted-foreground',
}

/** 确认文案：这三个动作都不可逆（终态），点之前必须让用户看清后果。 */
const CONFIRM: Record<ProposalAction, string> = {
  ACCEPT: '同意之后还需要对方也同意 —— 单方同意不会产生介绍。确定同意吗？',
  REJECT: '拒绝后这条提案会关闭，且无法重新打开。确定拒绝吗？',
  REVOKE: '撤回后这条提案会关闭，不会再产生介绍。确定撤回吗？',
}

export function ProposalActions({
  proposalId,
  actions,
}: {
  proposalId: string
  actions: ProposalAction[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<ProposalAction | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function run(action: ProposalAction) {
    if (!window.confirm(CONFIRM[action])) return

    setBusy(action)
    setMessage(null)
    try {
      // ⚠️ 契约路径是 `/connections/{connectionId}/consent|revoke`（`[connectionId]` 是
      //    提案 id），**没有** `proposals` 这一段 —— 多写一段会得到 404，
      //    而这种错误单测（直接调 handler）发现不了，只有端到端能暴露。
      const url =
        action === 'REVOKE'
          ? `/api/v1/connections/${encodeURIComponent(proposalId)}/revoke`
          : `/api/v1/connections/${encodeURIComponent(proposalId)}/consent`

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body:
          action === 'REVOKE'
            ? JSON.stringify({})
            : JSON.stringify({ decision: action === 'ACCEPT' ? 'accept' : 'reject' }),
      })

      if (res.status === 401) {
        // 会话已过期 → 送到登录页并带回跳地址。
        // ⚠️ 用 `router.push()` 而不是 `window.location.href = ...`：后者会被
        //    `react-hooks/immutability` 判为"修改组件外定义的值"（error），
        //    也触发 `@next/next/no-location-assign-relative-destination`（warning）。
        const here = `${window.location.pathname}${window.location.search}`
        router.push(`/login?callbackUrl=${encodeURIComponent(here)}`)
        return
      }

      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage({
          kind: 'err',
          text: body?.error?.message ?? `操作失败（HTTP ${res.status}）`,
        })
        return
      }

      // 关键：单方同意后状态仍是"待决"（AC-04）。文案要解释这一点，
      // 否则用户会以为按钮坏了 —— 明明点了同意，却还显示待处理。
      setMessage({
        kind: 'ok',
        text:
          action === 'ACCEPT'
            ? '已同意。还需要对方也同意，之后由运营发出介绍。'
            : action === 'REJECT'
              ? '已拒绝，这条提案已关闭。'
              : '已撤回，这条提案已关闭。',
      })
      // 让服务端重新渲染（状态、动作清单、投影都会随之刷新）。
      router.refresh()
    } catch {
      setMessage({ kind: 'err', text: '网络异常，请稍后再试。' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2" data-testid="proposal-actions">
      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => run(action)}
            disabled={busy !== null}
            data-testid={`proposal-action-${action.toLowerCase()}`}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-40 ${CLASSES[action]}`}
          >
            {busy === action ? '处理中…' : LABELS[action]}
          </button>
        ))}
      </div>
      {message ? (
        <p
          data-testid="proposal-action-message"
          className={`text-xs ${message.kind === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
