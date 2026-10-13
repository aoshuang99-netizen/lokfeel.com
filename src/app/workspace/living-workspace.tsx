'use client'

/**
 * Living Workspace —— 主工作区（P1 · 生成式工作空间）
 *
 * 依据：`docs/implementation/DESIGN/01-design-to-api-map.md`（设计 → 真实 API 映射）
 *       与 `DESIGN/02-plan.md` P1。
 *
 * 🔴 硬约束（由 `npm run check:ui-invariants` 把守）：
 *   1. **每个数字都来自真实端点**；没有端点的能力一律 `ready:false` → 不可点 + 写明原因。
 *      **不放假数据、不留空按钮**。
 *   2. **三态齐全**：每个数据区都必须有 loading / 空 / 错误三种**真实**反馈。
 *   3. **不用 `setTimeout` 伪造执行成功**；只有服务端返回了才算成功。
 *   4. **画布只渲染 `WorkspaceSpec`**（见 `src/lib/workspace-spec`）——
 *      模型/规则都不得直接产 HTML/React。
 *
 * P1 新增（相对 P0）：
 *   - 底部 Composer 从"只收集文本"升级为 **Intent-to-UI Compiler** 入口：
 *     文本 → `WorkspaceSpec`（zod 严格校验）→ Living Canvas 白名单渲染。
 *   - 动作就绪性来自 **`GET /api/v1/org` 的真实 `capabilities`**
 *     （服务端注释明确：该字段"供界面做降级展示，不是授权依据"，
 *      因此这里只用来**禁用**，真正的授权仍在服务端重做）。
 */

import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AlertCircle, Bell, Compass, Inbox, Loader2, MessageSquare, Wand2 } from 'lucide-react'
import LivingShell, { type LivingNavItem } from '@/components/living/living-shell'
import LivingCanvas from '@/components/living/living-canvas'
import { useApiGet } from '@/hooks/use-api'
import {
  MIN_GOAL_LENGTH,
  compileWorkspaceSpec,
  type CompileResult,
} from '@/lib/workspace-spec'

// ── 真实端点响应形状（与 route.ts 一致） ──────────────────────────────
interface NotificationsRes {
  notifications: Array<{
    id: string
    title?: string | null
    message?: string | null
    body?: string | null
    isRead?: boolean | null
    createdAt?: string | null
  }>
  unreadCount: number
}
interface ChatCountRes {
  unreadCount: number
  totalChats: number
}
interface MatchesRes {
  matches: Array<{ id: string; matchType?: string | null; createdAt?: string | null }>
  pagination: { total: number; limit: number; offset: number }
}
/** `GET /api/v1/org` —— 社群档案 + **我的角色与能力**。 */
interface OrgOverviewRes {
  organization: { id: string; name: string; slug: string; status: string }
  myRole: string
  capabilities: string[]
  memberTotal: number
}

const NO_ORG_REASON =
  '需要 ACTIVE 社群成员身份（本端点为租户域，服务端 `withTenant()` 对非成员一律 403）。'

const NAV: LivingNavItem[] = [
  { key: 'now', label: 'Now', hint: '今日工作台', ready: true },
  { key: 'studio', label: 'Studio', hint: '目标编译器（自然语言 → 工作区）', ready: true },
  { key: 'field', label: 'Field', hint: '连接场（我的匹配）', ready: true },
  { key: 'missions', label: 'Missions', hint: '连接任务', ready: false, reason: NO_ORG_REASON },
  { key: 'outcomes', label: 'Outcomes', hint: '成果与成本', ready: false, reason: NO_ORG_REASON },
  {
    key: 'agents',
    label: 'Agents',
    hint: '智能体协作',
    ready: false,
    reason: 'Agent Runtime（T09）尚未交付 —— 本页不做假的 Agent 拓扑。',
  },
]

/** 统一的「真实三态」渲染器：loading / error / empty 都必须是真的。 */
function Loadable({
  isLoading,
  error,
  empty,
  emptyText,
  children,
}: {
  isLoading: boolean
  error: string | null
  empty: boolean
  emptyText: string
  children: React.ReactNode
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-lf-text-muted" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        正在读取…
      </div>
    )
  }
  if (error) {
    return (
      <div
        className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger"
        role="alert"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>读取失败：{error}</span>
      </div>
    )
  }
  if (empty) {
    return <div className="rounded-lf border border-dashed border-lf-line p-4 text-sm text-lf-text-muted">{emptyText}</div>
  }
  return <>{children}</>
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: number | null
  hint: string
  icon: typeof Bell
}) {
  return (
    <div className="rounded-lf border border-lf-line bg-lf-surface p-3">
      <div className="flex items-center gap-2 text-xs text-lf-text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value === null ? '—' : value}</div>
      <div className="mt-0.5 text-[11px] text-lf-text-faint">{hint}</div>
    </div>
  )
}

export default function LivingWorkspace() {
  const { data: session } = useSession()
  const [activeKey, setActiveKey] = useState('now')
  const [draft, setDraft] = useState('')
  const [compiled, setCompiled] = useState<CompileResult | null>(null)

  const notifications = useApiGet<NotificationsRes>('/api/notifications')
  const chats = useApiGet<ChatCountRes>('/api/chats/unread-count')
  const matches = useApiGet<MatchesRes>('/api/matches')
  // 真实能力探测：403 即说明当前账号不是任何 ACTIVE 社群的成员。
  const org = useApiGet<OrgOverviewRes>('/api/v1/org')

  const unreadNotifications = notifications.data?.unreadCount ?? null
  const unreadChats = chats.data?.unreadCount ?? null
  const matchTotal = matches.data?.pagination?.total ?? null

  const latestNotifications = useMemo(
    () => (notifications.data?.notifications ?? []).slice(0, 6),
    [notifications.data],
  )

  /** 服务端下发的真实能力集合；取不到就是空集（取严，不放行）。 */
  const capabilities = useMemo(() => new Set(org.data?.capabilities ?? []), [org.data])

  /** 把当前 spec 的动作能力映射为就绪性。未探测到（org 仍加载/失败）→ 不视为就绪。 */
  const capabilityProbe = useMemo(() => {
    if (!compiled?.ok) return {}
    const probe: Record<string, boolean> = {}
    for (const action of compiled.spec.availableActions) {
      probe[action.capability] = capabilities.has(action.capability)
    }
    return probe
  }, [compiled, capabilities])

  const canCompile = draft.trim().length >= MIN_GOAL_LENGTH

  const runCompile = () => {
    setCompiled(compileWorkspaceSpec(draft))
    setActiveKey('studio')
  }

  const inspector = (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">Evidence Lens · 这些数字从哪来</h3>
        <ul className="mt-2 space-y-2 text-xs text-lf-text-muted">
          <li>
            <code className="text-lf-signal">GET /api/notifications</code> → 未读 {unreadNotifications ?? '—'}
          </li>
          <li>
            <code className="text-lf-signal">GET /api/chats/unread-count</code> → 未读 {unreadChats ?? '—'} / 会话{' '}
            {chats.data?.totalChats ?? '—'}
          </li>
          <li>
            <code className="text-lf-signal">GET /api/matches</code> → 匹配 {matchTotal ?? '—'}
          </li>
          <li>
            <code className="text-lf-signal">GET /api/v1/org</code> → 能力{' '}
            {org.isLoading ? '探测中…' : org.error ? `探测失败（${org.error}）` : `${capabilities.size} 项`}
          </li>
        </ul>
      </section>

      {compiled && (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">编译结果</h3>
          {compiled.ok ? (
            <ul className="mt-2 space-y-1 text-xs text-lf-text-muted">
              <li>
                意图类型：<span className="text-lf-text">{compiled.intentClass}</span>
              </li>
              <li>
                命中词：
                <span className="text-lf-text">
                  {compiled.matchedKeywords.length ? compiled.matchedKeywords.join('、') : '（无）'}
                </span>
              </li>
              <li>
                节点：<span className="text-lf-text">{compiled.spec.nodes.length}</span> 个 · 契约 v
                {compiled.spec.version}
              </li>
            </ul>
          ) : (
            <p className="mt-2 rounded-lf border border-lf-line p-2 text-xs text-lf-text-muted">
              未生成工作区：{compiled.reason}
            </p>
          )}
        </section>
      )}

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">尚未接通（不会假装可用）</h3>
        <ul className="mt-2 space-y-2 text-xs">
          {NAV.filter((n) => !n.ready).map((n) => (
            <li key={n.key} className="rounded-lf border border-lf-line p-2">
              <span className="font-medium text-lf-text-faint">{n.label}</span>
              <p className="mt-1 text-lf-text-muted">{n.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">身份</h3>
        <p className="mt-2 break-all text-xs text-lf-text-muted">{session?.user?.email ?? '（未取到会话）'}</p>
        {org.data && (
          <p className="mt-1 text-xs text-lf-text-muted">
            角色 <span className="text-lf-text">{org.data.myRole}</span> · 社群{' '}
            <span className="text-lf-text">{org.data.organization.name}</span>（{org.data.organization.status}）
          </p>
        )}
      </section>
    </div>
  )

  const composer = (
    <div className="space-y-2">
      <label htmlFor="lf-composer" className="sr-only">
        描述你的目标
      </label>
      <textarea
        id="lf-composer"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="描述一个目标，例如：帮助我们社群在 30 天内促成 20 次高质量的渠道合作交流…"
        className="lf-focus-ring w-full resize-none rounded-lf bg-lf-surface-2 p-2 text-sm text-lf-text placeholder:text-lf-text-faint"
        style={{ transitionDuration: 'var(--lf-dur-fast)' }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] text-lf-text-faint">
          编译在本地完成（规则式，纯函数）；只有真正创建 Mission 才需要服务端权限。
        </p>
        {/* 编译是纯前端动作 → 只要有足够文本就一定可用；不足则**禁用并说明差多少**。 */}
        <button
          type="button"
          disabled={!canCompile}
          aria-disabled={!canCompile}
          title={canCompile ? '编译为工作区' : `至少输入 ${MIN_GOAL_LENGTH} 个字符`}
          onClick={runCompile}
          className={[
            'lf-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lf border px-3 py-1.5 text-xs',
            canCompile
              ? 'border-lf-line-strong text-lf-text hover:bg-lf-surface-2'
              : 'cursor-not-allowed border-lf-line text-lf-text-faint',
          ].join(' ')}
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
          编译工作区
        </button>
      </div>
    </div>
  )

  return (
    <LivingShell
      nav={NAV}
      activeKey={activeKey}
      onNavigate={setActiveKey}
      title="My Workspace"
      contextExtra={
        <span className="hidden items-center gap-1 rounded-lf border border-lf-line px-2 py-1 text-xs text-lf-text-muted sm:inline-flex">
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          {unreadNotifications === null ? '—' : unreadNotifications}
        </span>
      }
      inspector={inspector}
      composer={composer}
    >
      {activeKey === 'now' && (
        <div className="space-y-4">
          <h1 className="text-lg font-semibold">今日工作台</h1>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="未读通知" value={unreadNotifications} hint="来自 /api/notifications" icon={Bell} />
            <StatCard label="未读消息" value={unreadChats} hint="来自 /api/chats/unread-count" icon={MessageSquare} />
            <StatCard label="我的匹配" value={matchTotal} hint="来自 /api/matches" icon={Inbox} />
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-lf-text-muted">待处理</h2>
            <Loadable
              isLoading={notifications.isLoading}
              error={notifications.error}
              empty={latestNotifications.length === 0}
              emptyText="没有待处理事项。这是真实结果 —— 本页不会为了填满而生成内容。"
            >
              <ul className="space-y-2">
                {latestNotifications.map((n) => (
                  <li key={n.id} className="rounded-lf border border-lf-line bg-lf-surface p-3">
                    <p className="text-sm">{n.title || n.message || n.body || '（无标题）'}</p>
                    {n.createdAt && (
                      <p className="mt-1 text-[11px] text-lf-text-faint">{new Date(n.createdAt).toLocaleString()}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Loadable>
          </section>
        </div>
      )}

      {activeKey === 'studio' && (
        <div className="space-y-4">
          <h1 className="text-lg font-semibold">Mission Studio</h1>
          <p className="text-sm text-lf-text-muted">
            在下方输入目标后点击「编译工作区」：文本会被编译为受约束的 <code className="text-lf-signal">WorkspaceSpec</code>
            （zod 严格校验），再由<strong className="font-medium text-lf-text">白名单组件</strong>渲染到画布上 ——
            任何一步都不允许产出 HTML/React 代码。
          </p>

          {compiled === null && (
            <div className="rounded-lf border border-dashed border-lf-line p-6 text-center">
              <Compass className="mx-auto h-6 w-6 text-lf-text-faint" aria-hidden="true" />
              <p className="mt-2 text-sm text-lf-text-muted">还没有工作区。先在底部输入一个目标。</p>
            </div>
          )}

          {compiled && !compiled.ok && (
            <div className="space-y-2 rounded-lf border border-lf-line bg-lf-surface p-3" role="alert">
              <p className="flex items-start gap-2 text-sm text-lf-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{compiled.reason}</span>
              </p>
              <div>
                <p className="text-xs text-lf-text-muted">当前支持的目标类型：</p>
                <ul className="mt-1 space-y-1 text-xs text-lf-text-muted">
                  {compiled.suggestions.map((s) => (
                    <li key={s} className="break-words">
                      · {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {compiled?.ok && (
            <LivingCanvas
              spec={compiled.spec}
              capabilityProbe={capabilityProbe}
              onAction={() => {
                /* P1 不含服务端执行动作；动作按钮的就绪性来自真实能力探测，
                   点击后的执行接线在 T09/后续切片落地（此处不伪造成功）。 */
              }}
            />
          )}
        </div>
      )}

      {activeKey === 'field' && (
        <div className="space-y-4">
          <h1 className="text-lg font-semibold">连接场</h1>
          <p className="text-sm text-lf-text-muted">
            这里展示你的<strong className="font-medium text-lf-text">个人匹配</strong>（真实数据）。社群内的候选与关系网络需要 ACTIVE
            社群权限（T04/T05）。
          </p>
          <Loadable
            isLoading={matches.isLoading}
            error={matches.error}
            empty={(matches.data?.matches?.length ?? 0) === 0}
            emptyText="暂无匹配。没有候选时本页不会伪造匹配对象（AC-13）。"
          >
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(matches.data?.matches ?? []).map((m) => (
                <li key={m.id} className="rounded-lf border border-lf-line bg-lf-surface p-3">
                  <p className="text-sm">匹配 {m.id.slice(0, 8)}…</p>
                  <p className="mt-1 text-[11px] text-lf-text-faint">
                    {m.matchType ?? '—'}
                    {m.createdAt ? ` · ${new Date(m.createdAt).toLocaleDateString()}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </Loadable>
        </div>
      )}
    </LivingShell>
  )
}
