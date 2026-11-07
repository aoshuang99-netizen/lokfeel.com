'use client'

/**
 * `/invitations/accept?token=...` —— 接受邀请的落地页
 *
 * 为什么它必须是页面而不是 API：邀请链接是**发到邮箱里**的，收件人点开时
 * 还没有会话，甚至还没有账号。API 只能返回 JSON，用户会看到一屏 `{"error":...}`。
 *
 * 三态：
 *   1. 未登录 → 不自动提交，给一个"登录后接受"的按钮（把 token 带到 callbackUrl）
 *      —— 自动跳转会在用户不知情时丢掉 token，登录回来发现"邀请不存在"。
 *   2. 已登录但邮箱不匹配 → 明确告知"这封邀请不是发给这个账号的"，并给切换账号的路。
 *   3. 成功 → 说明加入了哪个组织、以什么角色，并给出进入工作区的入口。
 *
 * ⚠️ token 只放在 URL 里，不写 localStorage / cookie：它是一次性凭据，
 *    落盘只会扩大暴露面。
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'

interface AcceptResult {
  organizationId: string
  role: string
  reactivated: boolean
}

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; result: AcceptResult }
  | { kind: 'error'; code?: string; message: string }

const ROLE_LABEL: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  OPERATOR: '运营',
  MEMBER: '成员',
}

/** 把服务端的拒绝码翻译成"下一步该做什么"，而不是把英文错误直接丢给用户。 */
function explain(code: string | undefined, message: string): { text: string; hint?: string } {
  switch (code) {
    case 'EMAIL_MISMATCH':
      return {
        text: '这封邀请不是发给当前登录账号的。',
        hint: '请用被邀请的那个邮箱登录后再打开这个链接。',
      }
    case 'EXPIRED':
      return { text: '这个邀请已经过期。', hint: '请让邀请你的人重新发一封（新链接会替换旧链接）。' }
    case 'NOT_PENDING':
      return { text: '这个邀请已经被使用或已撤销。', hint: '如果你已经是成员，直接进入工作区即可。' }
    case 'INVALID_TOKEN':
      return { text: '邀请链接无效。', hint: '链接可能被截断，请让邀请人重新发一次。' }
    case 'ALREADY_MEMBER':
      return { text: '你已经是这个组织的成员。', hint: '不需要再接受一次，直接进入工作区。' }
    default:
      return { text: message || '接受邀请失败，请重试。' }
  }
}

function AcceptInvitationInner() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<State>({ kind: 'idle' })
  const started = useRef(false)

  const accept = useCallback(async () => {
    if (!token) {
      setState({ kind: 'error', code: 'INVALID_TOKEN', message: '缺少邀请链接中的 token' })
      return
    }
    setState({ kind: 'working' })
    try {
      const res = await fetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 401) {
        setState({ kind: 'error', code: 'UNAUTHENTICATED', message: '请先登录' })
        return
      }
      if (!res.ok) {
        setState({
          kind: 'error',
          code: json?.error?.details?.code ?? json?.error?.code,
          message: json?.error?.message ?? `请求失败（${res.status}）`,
        })
        return
      }
      setState({ kind: 'done', result: json?.data as AcceptResult })
    } catch {
      setState({ kind: 'error', message: '服务暂时不可用，请稍后重试。' })
    }
  }, [token])

  // 只在**第一次**自动尝试：避免 401 后无限重试。
  useEffect(() => {
    if (started.current) return
    started.current = true
    void accept()
  }, [accept])

  const callbackUrl = `/invitations/accept?token=${encodeURIComponent(token)}`

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-background-secondary p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-[0.12em] uppercase text-primary">LokFeel</span>
        </div>

        {state.kind === 'working' || state.kind === 'idle' ? (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在确认邀请…
          </div>
        ) : null}

        {state.kind === 'done' ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  你已加入组织，角色：{ROLE_LABEL[state.result.role] ?? state.result.role}
                </p>
                <p className="text-xs text-foreground-muted mt-1">
                  {state.result.reactivated
                    ? '你之前的成员关系已被恢复，历史记录仍在。'
                    : '现在可以在工作区里查看任务、审批与成果。'}
                </p>
              </div>
            </div>
            <Link
              href="/workspace"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-background text-sm font-medium hover:brightness-110 transition"
            >
              进入工作区
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div>
                {state.code === 'UNAUTHENTICATED' ? (
                  <>
                    <p className="text-sm font-medium text-foreground">请先登录，再接受邀请</p>
                    <p className="text-xs text-foreground-muted mt-1">
                      邀请链接会保留，登录后会自动继续。
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">{explain(state.code, state.message).text}</p>
                    {explain(state.code, state.message).hint ? (
                      <p className="text-xs text-foreground-muted mt-1">
                        {explain(state.code, state.message).hint}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {state.code === 'UNAUTHENTICATED' ? (
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-background text-sm font-medium hover:brightness-110 transition"
                >
                  去登录
                  <ArrowRight className="w-4 h-4" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => void accept()}
                  className="px-3 py-2 rounded-lg border border-card-border text-sm text-foreground-muted hover:text-foreground transition-colors"
                >
                  重试
                </button>
              )}
              <Link
                href="/"
                className="px-3 py-2 rounded-lg text-sm text-foreground-subtle hover:text-foreground transition-colors"
              >
                返回首页
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

/**
 * `useSearchParams()` 在静态渲染时必须包在 Suspense 里，否则构建期会报
 * "missing-suspense-with-csr-bailout"。这里的 fallback 不是装饰：
 * 它保证在客户端接管之前，用户看到的不是空白页。
 */
export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在加载邀请…
          </div>
        </main>
      }
    >
      <AcceptInvitationInner />
    </Suspense>
  )
}
