'use client'

/**
 * T07 · 组织态骨架（客户端）
 *
 * 职责只有三件：**顶部上下文**（这是哪个社群、我是什么角色）、**七屏导航**、
 * 以及**把未就绪的入口诚实地标出来**。
 *
 * 🔴 「施工中」为什么不渲染成链接：
 *   AC-18 的判据是"可达且**无空按钮**"。一个指向尚未实现路由的 `<a>` 点进去就是 404 ——
 *   那正是"空按钮"。所以未就绪项渲染为 `<span>`（不可点）+ 明确的状态标签：
 *   既不是死链，也不是假按钮。这条与 `plan.md` §2 的约定一致。
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  Building2,
  LayoutDashboard,
  Link2,
  Lock,
  Settings,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react'

interface ConsoleNavItem {
  href: string
  label: string
  icon: LucideIcon
  /** 该屏是否已实现（未实现 → 渲染为不可点的"施工中"）。 */
  ready: boolean
  /** 需要的租户能力（与服务端 `withTenant(...)` 口径一致）。 */
  capability: string
}

const CONSOLE_NAV: readonly ConsoleNavItem[] = [
  { href: '/console', label: '总览', icon: LayoutDashboard, ready: true, capability: 'workflow.read' },
  { href: '/console/missions', label: '任务', icon: Target, ready: false, capability: 'mission.read' },
  { href: '/console/members', label: '成员', icon: Users, ready: false, capability: 'member.read' },
  { href: '/console/connections', label: '连接', icon: Link2, ready: false, capability: 'proposal.read' },
  { href: '/console/agents', label: '智能体', icon: Bot, ready: false, capability: 'outcome.read' },
  { href: '/console/outcomes', label: '成果', icon: BadgeCheck, ready: false, capability: 'outcome.read' },
  { href: '/console/settings', label: '设置', icon: Settings, ready: false, capability: 'org.update' },
]

export interface ConsoleShellProps {
  organizationName: string
  capabilities: readonly string[]
  tenantCount: number
  children: React.ReactNode
}

export default function ConsoleShell({
  organizationName,
  capabilities,
  tenantCount,
  children,
}: ConsoleShellProps) {
  const pathname = usePathname()
  const held = new Set(capabilities)

  const isActive = (href: string) =>
    href === '/console' ? pathname === '/console' : pathname.startsWith(href)

  return (
    <div className="min-h-screen bg-background">
      {/* ── 顶部上下文：这是哪个社群 + 唯一的跨态出口 ── */}
      <header className="sticky top-0 z-20 border-b border-card-border bg-background-secondary/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-foreground truncate font-display">
                {organizationName}
              </h1>
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary">
                社群模式
              </span>
            </div>
            <p className="text-[11px] text-foreground-muted truncate">
              社群经营工作台 · 你所属的社群 {tenantCount} 个
            </p>
          </div>
          <Link
            href="/dashboard"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            个人模式
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 flex flex-col lg:flex-row gap-6">
        {/* ── 七屏导航：桌面在左，移动端横向滚动 ── */}
        <nav aria-label="社群控制台导航" className="lg:w-52 shrink-0">
          <ul className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
            {CONSOLE_NAV.map((item) => {
              const Icon = item.icon
              const allowed = held.has(item.capability)
              const active = isActive(item.href)

              if (!item.ready || !allowed) {
                return (
                  <li key={item.href} className="shrink-0 lg:shrink">
                    <span
                      aria-disabled="true"
                      title={!allowed ? '你的角色没有查看这一屏的权限' : '这一屏还在施工中'}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground-subtle cursor-not-allowed whitespace-nowrap"
                    >
                      {allowed ? <Icon className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      <span>{item.label}</span>
                      <span className="ml-auto hidden lg:inline text-[10px] text-foreground-subtle">
                        {!allowed ? '无权限' : '施工中'}
                      </span>
                    </span>
                  </li>
                )
              }

              return (
                <li key={item.href} className="shrink-0 lg:shrink">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
