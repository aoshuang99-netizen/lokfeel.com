'use client'

/**
 * T02 · 分享页「加入」按钮（客户端）
 *
 * 为什么必须做成客户端组件：加入是**有副作用的写操作**，需要真实的
 * `fetch` → 服务端鉴权（401/403/409）→ 反馈。用 `<form action>` 的渐进增强写法
 * 会让"未登录 → 401"变成一次整页导航，丢失原因文案。
 *
 * 状态机（显式枚举，不留"其他"分支）：
 *   idle → submitting → joined
 *                     ↘ error(message)
 *
 * ⚠️ 401 一律**跳转登录**而不是提示"未登录"：用户此刻的意图是加入，
 * 直接把他送到登录页（带 callbackUrl 回来）才是最短路径。
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Phase = 'idle' | 'submitting' | 'joined' | 'error'

export function JoinButton({
  token,
  disabled,
  disabledReason,
  loginHref,
}: {
  token: string
  disabled: boolean
  disabledReason: string | null
  loginHref: string
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function join() {
    setPhase('submitting')
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/public/missions/${encodeURIComponent(token)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (res.ok) {
        setPhase('joined')
        // 让服务端重新渲染"已加入"状态（名额计数也会刷新）。
        router.refresh()
        return
      }

      if (res.status === 401) {
        // 会话在页面打开后失效 → 直接去登录，回来继续。
        window.location.href = loginHref
        return
      }

      const body = await res.json().catch(() => null)
      const text =
        body?.error?.message || body?.error || body?.message || '加入失败，请稍后再试。'
      setMessage(typeof text === 'string' ? text : '加入失败，请稍后再试。')
      setPhase('error')
    } catch {
      setMessage('网络异常，请稍后再试。')
      setPhase('error')
    }
  }

  if (phase === 'joined') {
    return (
      <div
        className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-center text-sm font-semibold text-emerald-300"
        data-testid="mission-joined"
      >
        你已加入这个任务
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={join}
        disabled={disabled || phase === 'submitting'}
        data-testid="mission-join-button"
        className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === 'submitting' ? '正在加入…' : '加入这个任务'}
      </button>
      {disabled && disabledReason ? (
        <p className="text-center text-xs text-muted-foreground" data-testid="mission-blocked-reason">
          {disabledReason}
        </p>
      ) : null}
      {phase === 'error' && message ? (
        <p className="text-center text-xs text-rose-400" data-testid="mission-join-error">
          {message}
        </p>
      ) : null}
    </div>
  )
}
