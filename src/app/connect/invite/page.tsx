'use client'

/**
 * `/connect/invite?code=INV-XXXXXX` —— 个人好友邀请的落地页
 *
 * 这是 `/register?ref=` 断链的正解：旧流程生成邀请码、注册页却从不消费，
 * 对方注册完什么关系都没有。现在：
 *   · 链接带 code → 本页先**只读**查邀请状态（不建联）；
 *   · 未登录 → 引导注册/登录，把 code 带在 callbackUrl 里回来；
 *   · 已登录且邀请 PENDING → 展示"某位用户邀请你连接"，必须**显式点接受**
 *     才会调用 /api/invites/accept 建立真实关系（Match + Conversation）。
 *
 * ⚠️ 与 `/invitations/accept`（企业成员邀请）刻意分开：
 *     个人好友关系 ≠ 企业组织成员，前者不需要 ADMIN 权限。
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, CheckCircle2, Loader2, ShieldAlert, UserPlus } from 'lucide-react'

type Phase =
  | { kind: 'checking' }
  | { kind: 'ready'; code: string; status: string }
  | { kind: 'working' }
  | { kind: 'done'; conversationId: string; chatUrl: string }
  | { kind: 'error'; code?: string; message: string; needAuth?: boolean }

function describe(code: string | undefined, message: string): { text: string; hint?: string } {
  switch (code) {
    case 'INVALID_CODE':
      return { text: '邀请码无效或不存在。', hint: '请让邀请人重新生成一张邀请。' }
    case 'EXPIRED':
      return { text: '这个邀请已经过期（7 天有效）。', hint: '请让邀请人重新生成一张邀请。' }
    case 'ALREADY_ACCEPTED':
      return { text: '这个邀请已经被接受过了。', hint: '你可以直接进入聊天，查看与对方的消息。' }
    case 'INVITE_REVOKED':
      return { text: '邀请人已撤回这个邀请。', hint: '请让邀请人重新生成一张邀请。' }
    case 'SELF_INVITE':
      return { text: '不能接受自己发出的邀请。' }
    default:
      return { text: message || '处理失败，请稍后重试。' }
  }
}

function ConnectInviteInner() {
  const params = useSearchParams()
  const router = useRouter()
  const rawCode = params.get('code') ?? ''
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })

  const lookup = useCallback(async () => {
    if (!rawCode) {
      setPhase({ kind: 'error', code: 'INVALID_CODE', message: '链接缺少邀请码' })
      return
    }
    setPhase({ kind: 'checking' })
    try {
      // GET /api/invites 需要登录；未登录时用一个只读的公开校验端点。
      const res = await fetch(`/api/invites/lookup?code=${encodeURIComponent(rawCode)}`)
      const json = await res.json().catch(() => null)
      if (res.status === 404) {
        setPhase({ kind: 'error', code: 'INVALID_CODE', message: '邀请码无效或不存在' })
        return
      }
      if (!res.ok) {
        setPhase({
          kind: 'error',
          code: json?.code,
          message: json?.message ?? '无法确认邀请',
        })
        return
      }
      const data = json?.data ?? json
      if (data.status === 'EXPIRED' || data.status === 'REVOKED' || data.status === 'ACCEPTED') {
        setPhase({
          kind: 'error',
          code: data.status === 'ACCEPTED' ? 'ALREADY_ACCEPTED' : data.status,
          message: '邀请当前不可接受',
        })
        return
      }
      setPhase({ kind: 'ready', code: rawCode, status: data.status ?? 'PENDING' })
    } catch {
      setPhase({ kind: 'error', message: '网络异常，请稍后重试' })
    }
  }, [rawCode])

  useEffect(() => {
    // 显式异步边界：把带 setState 的 lookup 移出 effect 的同步体，
    // 避免 cascading-render 告警（与仓库 v21 的队列惯例一致）。
    queueMicrotask(() => void lookup())
  }, [lookup])

  const accept = useCallback(async () => {
    if (phase.kind !== 'ready') return
    setPhase({ kind: 'working' })
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: phase.code }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 401) {
        setPhase({ kind: 'error', needAuth: true, message: '请先登录或注册，再接受邀请' })
        return
      }
      if (!res.ok) {
        setPhase({
          kind: 'error',
          code: json?.code ?? json?.error?.code,
          message: json?.message ?? json?.error?.message ?? `请求失败（${res.status}）`,
        })
        return
      }
      setPhase({
        kind: 'done',
        conversationId: json.conversationId ?? '',
        chatUrl: json.chatUrl ?? '/dashboard/chats',
      })
    } catch {
      setPhase({ kind: 'error', message: '网络异常，请稍后重试' })
    }
  }, [phase])

  const callbackUrl = `/connect/invite?code=${encodeURIComponent(rawCode)}`

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-background-secondary p-6 space-y-5">
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-[0.12em] uppercase text-primary">LokFeel</span>
        </div>

        {phase.kind === 'checking' ? (
          <div className="flex items-center gap-2 text-sm text-foreground-muted" role="status">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在确认邀请…
          </div>
        ) : null}

        {phase.kind === 'ready' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">有人邀请你连接</p>
                <p className="text-sm text-foreground-muted mt-1">
                  一位 LokFeel 用户想与你建立连接。接受后，你们会出现在彼此的聊天列表里，
                  可以立即开始双向沟通。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void accept()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-background text-sm font-semibold hover:brightness-110 transition"
            >
              接受连接
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-xs text-foreground-subtle text-center">
              只有你明确点击后才会建立连接，不会自动建联。
            </p>
          </div>
        ) : null}

        {phase.kind === 'working' ? (
          <div className="flex items-center gap-2 text-sm text-foreground-muted" role="status">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在建立连接…
          </div>
        ) : null}

        {phase.kind === 'done' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">连接已建立</p>
                <p className="text-xs text-foreground-muted mt-1">
                  你们现在可以互相收发消息了。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(phase.chatUrl)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-background text-sm font-semibold hover:brightness-110 transition"
            >
              去聊天
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {phase.kind === 'error' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {phase.needAuth ? '请先登录或注册' : describe(phase.code, phase.message).text}
                </p>
                {phase.needAuth ? (
                  <p className="text-xs text-foreground-muted mt-1">邀请链接会保留，完成后会自动回来。</p>
                ) : describe(phase.code, phase.message).hint ? (
                  <p className="text-xs text-foreground-muted mt-1">{describe(phase.code, phase.message).hint}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {phase.needAuth ? (
                <>
                  <Link
                    href={`/register?ref=${encodeURIComponent(rawCode)}&callbackUrl=${encodeURIComponent(callbackUrl)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-background text-sm font-medium hover:brightness-110 transition"
                  >
                    注册并连接
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-card-border text-sm text-foreground hover:bg-background-tertiary transition"
                  >
                    已有账号，去登录
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void lookup()}
                  className="px-3 py-2 rounded-lg border border-card-border text-sm text-foreground-muted hover:text-foreground transition"
                >
                  重试
                </button>
              )}
              <Link href="/" className="px-3 py-2 rounded-lg text-sm text-foreground-subtle hover:text-foreground transition">
                返回首页
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

export default function ConnectInvitePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="flex items-center gap-2 text-sm text-foreground-muted" role="status">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在加载邀请…
          </div>
        </main>
      }
    >
      <ConnectInviteInner />
    </Suspense>
  )
}
