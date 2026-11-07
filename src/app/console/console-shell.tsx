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
import { useLivingTheme } from '@/components/theme/living-theme'
import OrgSwitcher from '@/components/console/org-switcher'
import SignOutButton from '@/components/auth/sign-out-button'
import {
  ArrowLeft,
  BadgeCheck,
  Contrast,
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
  /** 未就绪时**必须**写明原因（R4：不许"敬请期待"式空话）。 */
  reason?: string
}

const CONSOLE_NAV: readonly ConsoleNavItem[] = [
  { href: '/console', label: '总览', icon: LayoutDashboard, ready: true, capability: 'workflow.read' },
  { href: '/console/missions', label: '任务', icon: Target, ready: true, capability: 'mission.read' },
  { href: '/console/members', label: '成员', icon: Users, ready: true, capability: 'member.read' },
  { href: '/console/connections', label: '连接', icon: Link2, ready: true, capability: 'workflow.read' },
  // T09：Agents 屏已实现。gate 的是**读**能力 —— 该屏的两个数据面
  //（`GET /api/v1/agents/runs` 与 `/usage`）都要求 `agent.run`（OPERATOR+），
  // 所以这里也 gate `agent.run`：MEMBER 会看到"无权限"而不是一个进去就 403 的死入口。
  // 能不能批准/执行由页面读服务端下发的 canApprove / canReject / execution.available 决定。
  { href: '/console/agents', label: '智能体', icon: Bot, ready: true, capability: 'agent.run' },
  // T08：成果屏已实现。gate 的是**读**能力（`outcome.read`，所有成员都有）——
  // 能不能确认/核验由页面按服务端下发的 canConfirm / canVerify 降级渲染。
  { href: '/console/outcomes', label: '成果', icon: BadgeCheck, ready: true, capability: 'outcome.read' },
  // ⚠️ 设置屏的**读**是 `org.read`（所有成员都有），所以这里 gate 的是读而不是写 ——
  //    若 gate 成 `org.update`（仅 OWNER），ADMIN/OPERATOR 会连"看看社群叫什么"都做不到。
  //    能不能编辑由页面自己按能力降级（`GET /api/v1/org` 会下发 capabilities）。
  { href: '/console/settings', label: '设置', icon: Settings, ready: true, capability: 'org.read' },
]

export interface ConsoleShellProps {
  organizationName: string
  capabilities: readonly string[]
  tenantCount: number
  /** 我所属的全部社群（切换器数据源）。少于 2 个时切换器不渲染。 */
  tenants: readonly { organizationId: string; name: string; role: string }[]
  /** 当前正在看的社群（由 cookie 软偏好解析而来，见 `lib/tenancy/active-org.ts`）。 */
  activeOrganizationId: string
  children: React.ReactNode
}

export default function ConsoleShell({
  organizationName,
  capabilities,
  tenantCount,
  tenants,
  activeOrganizationId,
  children,
}: ConsoleShellProps) {
  const pathname = usePathname()
  const held = new Set(capabilities)
  // 主题真值与 Workspace 六屏共用一份实现（`@/components/theme/living-theme`）。
  // V20.5 之前 Console 七屏不参与双主题：13 屏 × 2 主题的矩阵里有 56 格是
  // THEME_NA —— 审计如实记为缺口，现在补上。
  const { theme, toggleTheme } = useLivingTheme()

  const isActive = (href: string) =>
    href === '/console' ? pathname === '/console' : pathname.startsWith(href)

  return (
    <div data-lf-console="1" data-lf-theme={theme} className="min-h-screen bg-background">
      {/* ── 顶部上下文：这是哪个社群 + 唯一的跨态出口 ── */}
      <header className="sticky top-0 z-20 border-b border-card-border bg-background-secondary/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {/*
                🔴 这里刻意**不是** <h1>（V16 审计 F-04）。
                组织名在七个屏里都一样，一旦做成 h1，每页就会出现**两个 h1**，
                而且 DOM 里第一个永远是同一个组织名 —— 屏幕阅读器按 H 键跳标题时
                七屏无法区分，审计脚本读到的首标题也恒为组织名。
                组织名是**上下文**，不是页面标题；页面标题由各屏自己声明唯一的 h1。
              */}
              <p className="text-sm font-semibold text-foreground truncate font-display">
                {organizationName}
              </p>
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary">
                社群模式
              </span>
            </div>
            <p className="text-[11px] text-foreground-muted truncate">
              社群经营工作台 · 你所属的社群 {tenantCount} 个
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'paper'}
            aria-label={theme === 'paper' ? '切换到深色主题（Deep Field）' : '切换到浅色主题（Living Paper）'}
            title={theme === 'paper' ? '当前：Living Paper · 点击切到 Deep Field' : '当前：Deep Field · 点击切到 Living Paper'}
            className="shrink-0 inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            <Contrast className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{theme === 'paper' ? '纸面' : '深色'}</span>
          </button>
          <Link
            href="/dashboard"
            className="shrink-0 inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            个人模式
          </Link>
          {/*
            登出（V20.5 Batch 3）。此前产品里根本没有登出入口 ——
            共享设备上换人只能清浏览器数据。放在最右：它是"离开"类动作，
            与左侧"我在哪 / 我是谁"的上下文区离得越远越好。
          */}
          <SignOutButton
            hideLabelBelow="lg"
            className="shrink-0 inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors disabled:opacity-60"
          />
        </div>

        {/*
          社群切换器（V20.5 Batch 3）。此前多社群用户**只能**看到最早加入的那个，
          第二个社群在 UI 上不存在。只在真的有 ≥2 个社群时渲染 ——
          一个只有一项的下拉是"空控件"（与 AC-18 同类）。
        */}
        {tenants.length >= 2 && (
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 pb-2">
            <span className="shrink-0 text-[11px] text-foreground-muted">当前社群</span>
            <OrgSwitcher tenants={tenants} activeOrganizationId={activeOrganizationId} />
          </div>
        )}
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
                    className={`flex min-h-11 items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
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
