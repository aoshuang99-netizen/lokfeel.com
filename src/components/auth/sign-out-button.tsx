'use client'

/**
 * 登出按钮（V20.5 · Batch 3）
 *
 * 此前产品里**没有**任何登出入口（详见 `/api/auth/logout` 的文件头）。
 * 这个组件是那唯一的入口，同时被两套骨架复用（Console 七屏 + Workspace 六屏）——
 * 所以样式不写死，由调用方用 `className` 注入各自的主题令牌：
 *   · Console：`text-foreground-muted` / `border-card-border`
 *   · Living ：`text-lf-text-muted` / `border-lf-line` / `lf-focus-ring`
 *
 * 行为约定（都是可验证的）：
 *   1. **先等服务端清 cookie 成功再跳转**。直接 `window.location = '/login'`
 *      会跳到一个"cookie 还在、于是又被弹回 /console"的循环里 —— 表面看是
 *      "登录页抽风"，实际是登出没生效。
 *   2. 失败时**不跳转**，把按钮文案改成「退出失败·重试」，让用户能重试；
 *      静默失败比报错更糟（用户以为已经下线，实际没有）。
 *   3. `aria-busy` + `disabled` 防重复提交；`aria-label` 恒定，
 *      不随文案变化而漂移（否则屏幕阅读器读到的是"退出中…"这类瞬时状态）。
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export interface SignOutButtonProps {
  /** 颜色/边框/尺寸等外观令牌，由调用方按所在骨架注入。 */
  className?: string
  /** 窄屏是否隐藏文字（只留图标 + aria-label）。 */
  hideLabelBelow?: 'sm' | 'lg'
}

export default function SignOutButton({ className = '', hideLabelBelow }: SignOutButtonProps) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const router = useRouter()

  async function signOut() {
    if (state === 'busy') return
    setState('busy')
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        // 不带 cookie 也能过（登出对匿名是幂等的），但要带上才清得掉当前会话
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`logout failed: ${res.status}`)
      // 用 `replace` 而不是 `push`：登出后按 Back 不该回到刚离开的那个账号的页面。
      // 紧接着 `refresh()` 让当前 RSC 树用"无会话"状态重算 ——
      // 否则 `/console` 的服务端布局会命中上一次的客户端缓存，
      // 表现成"登出后还看得见上一个人的社群"。
      // 更彻底的兜底在服务端：`/console/layout.tsx` 是 force-dynamic，
      // 没有会话时一律 redirect 到 /login，所以任何一次真实请求都不会漏数据。
      router.replace('/login?loggedOut=1')
      router.refresh()
    } catch {
      setState('failed')
    }
  }

  const label = state === 'busy' ? '退出中…' : state === 'failed' ? '退出失败·重试' : '退出登录'

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={state === 'busy'}
      aria-busy={state === 'busy'}
      aria-label="退出登录"
      title={state === 'failed' ? '退出没有成功，点一下重试' : '退出当前账号'}
      data-lf-signout="1"
      className={className}
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
      <span className={hideLabelBelow === 'sm' ? 'hidden sm:inline' : hideLabelBelow === 'lg' ? 'hidden lg:inline' : ''}>
        {label}
      </span>
    </button>
  )
}
