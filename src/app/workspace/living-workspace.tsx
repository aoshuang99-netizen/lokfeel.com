'use client'

/**
 * Living Workspace —— 主工作区（P1 · 生成式工作空间 · 收口）
 *
 * 依据：`docs/implementation/DESIGN/01-design-to-api-map.md`（设计 → 真实 API 映射）
 *       与 `DESIGN/02-plan.md` P1、`DESIGN/04-changes-p1.md` §8（P1 未完项）。
 *
 * 🔴 硬约束（由 `npm run check:ui-invariants` 把守）：
 *   1. **每个数字都来自真实端点**；没有端点的能力一律 `ready:false` → 不可点 + 写明原因。
 *      **不放假数据、不留空按钮**。
 *   2. **三态齐全**：每个数据区都必须有 loading / 空 / 错误三种**真实**反馈。
 *   3. **不用 `setTimeout` 伪造执行成功**；只有服务端返回了才算成功。
 *   4. **画布只渲染 `WorkspaceSpec`**（见 `src/lib/workspace-spec`）——
 *      模型/规则都不得直接产 HTML/React。
 *
 * P1 收口新增（相对 P1 首版）：
 *   - **三类节点接上真实数据**：`consent` ← `GET /api/v1/connections/proposals`、
 *     `action` ← `GET /api/v1/workflow/jobs`、`outcome` ← `GET /api/v1/outcomes`。
 *     装配是纯函数（`src/lib/workspace-spec/assemble.ts`），本组件只负责取数与合并。
 *   - **`POST /api/v1/missions` 真正接线**：`create-mission` 动作带 `Idempotency-Key`
 *     真发请求；成功只认服务端返回的 id，失败原样展示服务端原因。
 *   - 🔴 修一处**静默失效**：`GET /api/v1/org` 是 `{success, data}` 信封，首版按裸对象
 *     读 `data.capabilities` → 能力集**恒为空** → 所有租户动作永久禁用。
 *     "看着安全"所以没被发现；现在按信封读。
 */

import { useCallback, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AlertCircle, Bell, CheckCircle2, Compass, Inbox, Loader2, MessageSquare, Wand2 } from 'lucide-react'
import LivingShell, { type LivingNavItem } from '@/components/living/living-shell'
import LivingCanvas from '@/components/living/living-canvas'
import FieldCanvas from '@/components/living/field/field-canvas'
import FieldInspector from '@/components/living/field/field-inspector'
import { useApiGet } from '@/hooks/use-api'
import type { FieldGraphNode } from '@/lib/living/field'
import {
  MIN_GOAL_LENGTH,
  assembleTenantNodes,
  compileWorkspaceSpec,
  mergeTenantNodes,
  missionDraftFromSpec,
  type CompileResult,
  type Source,
  type WorkspaceSpec,
} from '@/lib/workspace-spec'

// ── 真实端点响应形状（与 route.ts 一致） ──────────────────────────────
/** B2C 遗留端点（**不带**信封）。 */
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

/** `/api/v1/*` 的统一信封（`src/lib/api-response.ts`）。 */
interface ApiEnvelope<T> {
  success: boolean
  data: T
  error?: { code: string; message: string }
}

/** `GET /api/v1/org` —— 社群档案 + **我的角色与能力**。 */
interface OrgOverview {
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
  { key: 'field', label: 'Field', hint: '连接场 · 2.5D 关系网络', ready: true },
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

/** 已接线到真实端点的动作。其余动作**显式禁用**（不允许"点了没反应"）。 */
const WIRED_ACTION_KEYS: ReadonlySet<string> = new Set(['create-mission', 'create-mission-2'])

/** 幂等键：稳定 → 重试复用同一键（真幂等）；草稿变了 → 换新键（是新一次创建）。 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `k-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface Loaded<T> {
  data: T | null
  error: string | null
  isLoading: boolean
}

/**
 * 把一次 `useApiGet` 的结果折成装配器要的 `Source`。
 * `null` = **仍在读**（此时既不产节点也不产说明，避免"正在读取"被写进说明里抖动）。
 */
function tenantSource<T>(
  state: Loaded<ApiEnvelope<T>>,
  pick: (payload: T) => unknown,
  label: string,
): Source | null {
  if (state.isLoading && !state.data) return null
  if (state.error) return { ok: false, reason: `读取失败（${state.error}）` }
  const payload = state.data?.data
  if (payload === undefined || payload === null) return { ok: false, reason: '端点返回了空载荷' }
  const items = pick(payload)
  if (!Array.isArray(items)) return { ok: false, reason: `${label}载荷形状与装配器约定不一致（期望数组）` }
  return { ok: true, items }
}

type CreateResult =
  | { kind: 'ok'; missionId: string; title: string | null; status: string | null; replayed: boolean }
  | { kind: 'error'; message: string }

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
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<CreateResult | null>(null)
  /** 幂等键与它所属的请求体指纹（**同体复用、异体换新**）。 */
  const [attempt, setAttempt] = useState<{ sig: string; key: string } | null>(null)
  /** P2 · Field：当前选中的网络节点（详情面板的输入）。 */
  const [fieldSelection, setFieldSelection] = useState<FieldGraphNode | null>(null)

  const notifications = useApiGet<NotificationsRes>('/api/notifications')
  const chats = useApiGet<ChatCountRes>('/api/chats/unread-count')
  const matches = useApiGet<MatchesRes>('/api/matches')
  // 真实能力探测：403 即说明当前账号不是任何 ACTIVE 社群的成员。
  const org = useApiGet<ApiEnvelope<OrgOverview>>('/api/v1/org')
  // P1 收口：三类节点的真实来源。
  const proposals = useApiGet<ApiEnvelope<{ proposals: unknown[] }>>('/api/v1/connections/proposals')
  const jobs = useApiGet<ApiEnvelope<{ jobs: unknown[] }>>('/api/v1/workflow/jobs')
  const outcomes = useApiGet<ApiEnvelope<{ items: unknown[] }>>('/api/v1/outcomes')

  const unreadNotifications = notifications.data?.unreadCount ?? null
  const unreadChats = chats.data?.unreadCount ?? null
  const matchTotal = matches.data?.pagination?.total ?? null

  const latestNotifications = useMemo(
    () => (notifications.data?.notifications ?? []).slice(0, 6),
    [notifications.data],
  )

  /**
   * 服务端下发的真实能力集合。
   * ⚠️ `GET /api/v1/org` 是 `{success, data}` 信封 —— 读错层级会得到一个**恒空**的集合，
   *    而"全部禁用"看起来与"权限不足"一模一样，因而极难发现。
   */
  const orgOverview = org.data?.data ?? null
  const capabilities = useMemo(() => new Set(orgOverview?.capabilities ?? []), [orgOverview])

  // 拆出原始字段（而不是把 hook 返回的整个对象塞进依赖数组）：
  // `useApiGet` 每次渲染都返回**新对象**，直接依赖它会让 useMemo 每次都重算。
  const { data: proposalsData, error: proposalsError, isLoading: proposalsLoading } = proposals
  const { data: jobsData, error: jobsError, isLoading: jobsLoading } = jobs
  const { data: outcomesData, error: outcomesError, isLoading: outcomesLoading } = outcomes

  const sources = useMemo(
    () => ({
      proposals: tenantSource({ data: proposalsData, error: proposalsError, isLoading: proposalsLoading }, (p) => p.proposals, '提案'),
      jobs: tenantSource({ data: jobsData, error: jobsError, isLoading: jobsLoading }, (p) => p.jobs, '任务'),
      outcomes: tenantSource({ data: outcomesData, error: outcomesError, isLoading: outcomesLoading }, (p) => p.items, '成果'),
    }),
    [proposalsData, proposalsError, proposalsLoading, jobsData, jobsError, jobsLoading, outcomesData, outcomesError, outcomesLoading],
  )

  const tenantSettled = sources.proposals !== null && sources.jobs !== null && sources.outcomes !== null

  const assembly = useMemo(
    () =>
      assembleTenantNodes({
        proposals: sources.proposals ?? undefined,
        jobs: sources.jobs ?? undefined,
        outcomes: sources.outcomes ?? undefined,
      }),
    [sources],
  )

  /** 编译结果 + 社群真实节点 → 一张画布（合并后再过一遍契约校验）。 */
  const merged = useMemo(() => {
    if (!compiled?.ok) return null
    return mergeTenantNodes(compiled.spec, assembly)
  }, [compiled, assembly])
  const mergedSpec: WorkspaceSpec | null = merged?.ok ? merged.spec : null

  /** 把当前 spec 的动作能力映射为就绪性。未探测到（org 仍加载/失败）→ 不视为就绪。 */
  const capabilityProbe = useMemo(() => {
    if (!compiled?.ok) return {}
    const probe: Record<string, boolean> = {}
    for (const action of compiled.spec.availableActions) {
      probe[action.capability] = capabilities.has(action.capability)
    }
    return probe
  }, [compiled, capabilities])

  /** 创建 Mission 的请求体 + **如实**报出的缺口（缺字段时恒为 null，不凑默认值）。 */
  const missionDraft = useMemo(() => (compiled?.ok ? missionDraftFromSpec(compiled.spec) : null), [compiled])

  /**
   * 能力之外**由数据本身**决定的阻断。两件事都不该让用户点了才知道：
   *   ① 创建 Mission 的必填项在描述里根本没写（服务端会 400）；
   *   ② 动作尚未接线（P1 收口只接线了「创建连接任务」）。
   */
  const blockedActions = useMemo(() => {
    if (!compiled?.ok) return undefined
    const out: Record<string, string> = {}
    const missing = missionDraft?.missing ?? []
    for (const a of compiled.spec.availableActions) {
      if (WIRED_ACTION_KEYS.has(a.key)) {
        if (missing.length > 0) out[a.key] = `还不能创建：缺少 ${missing.join('、')}。`
      } else {
        out[a.key] = '该动作尚未接线（P1 收口只接线了「创建连接任务」）—— 这里不会出现点了没反应的按钮。'
      }
    }
    return out
  }, [compiled, missionDraft])

  const canCompile = draft.trim().length >= MIN_GOAL_LENGTH

  const runCompile = () => {
    setCompiled(compileWorkspaceSpec(draft))
    setCreateResult(null)
    setAttempt(null)
    setActiveKey('studio')
  }

  /**
   * 真正创建 Mission。
   *
   * 🔴 纪律：**只有服务端返回了 id 才算成功**。返回码 2xx 但没有 id、或响应无法解析，
   *    一律按失败处理 —— "乐观成功"是这类接线最典型的自欺。
   */
  const runCreateMission = useCallback(async () => {
    const body = missionDraft?.body
    if (!body) {
      setCreateResult({
        kind: 'error',
        message: `还不能创建：缺少 ${missionDraft?.missing.join('、') ?? '必要字段'}。`,
      })
      return
    }

    const sig = JSON.stringify(body)
    const key = attempt?.sig === sig ? attempt.key : newIdempotencyKey()
    setAttempt({ sig, key })
    setCreating(true)
    setCreateResult(null)

    try {
      const res = await fetch('/api/v1/missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        body: sig,
      })
      const json = (await res.json().catch(() => null)) as ApiEnvelope<{ id?: string; title?: string; status?: string }> | null
      if (!res.ok) {
        setCreateResult({ kind: 'error', message: json?.error?.message ?? `HTTP ${res.status}` })
        return
      }
      const mission = json?.data
      if (!mission?.id) {
        setCreateResult({ kind: 'error', message: '服务端未返回任务 id —— 按失败处理，不报告成功。' })
        return
      }
      setCreateResult({
        kind: 'ok',
        missionId: mission.id,
        title: mission.title ?? null,
        status: mission.status ?? null,
        replayed: res.headers.get('Idempotent-Replayed') === 'true',
      })
    } catch (e) {
      setCreateResult({ kind: 'error', message: e instanceof Error ? e.message : '网络错误' })
    } finally {
      setCreating(false)
    }
  }, [missionDraft, attempt])

  const handleAction = useCallback(
    (key: string) => {
      if (WIRED_ACTION_KEYS.has(key)) {
        void runCreateMission()
        return
      }
      setCreateResult({ kind: 'error', message: `动作「${key}」尚未接线。` })
    },
    [runCreateMission],
  )

  const evidenceInspector = (
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
          <li>
            <code className="text-lf-signal">GET /api/v1/connections/proposals</code> →{' '}
            {sources.proposals === null
              ? '读取中…'
              : sources.proposals.ok
                ? `${sources.proposals.items.length} 条提案`
                : `未展示（${sources.proposals.reason}）`}
          </li>
          <li>
            <code className="text-lf-signal">GET /api/v1/workflow/jobs</code> →{' '}
            {sources.jobs === null
              ? '读取中…'
              : sources.jobs.ok
                ? `${sources.jobs.items.length} 个任务`
                : `未展示（${sources.jobs.reason}）`}
          </li>
          <li>
            <code className="text-lf-signal">GET /api/v1/outcomes</code> →{' '}
            {sources.outcomes === null
              ? '读取中…'
              : sources.outcomes.ok
                ? `${sources.outcomes.items.length} 条成果`
                : `未展示（${sources.outcomes.reason}）`}
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
                节点：草稿 <span className="text-lf-text">{compiled.spec.nodes.length}</span> 个
                {merged?.ok ? (
                  <>
                    {' '}
                    → 合并社群数据后 <span className="text-lf-text">{merged.spec.nodes.length}</span> 个
                  </>
                ) : null}{' '}
                · 契约 v{compiled.spec.version}
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
        {orgOverview && (
          <p className="mt-1 text-xs text-lf-text-muted">
            角色 <span className="text-lf-text">{orgOverview.myRole}</span> · 社群{' '}
            <span className="text-lf-text">{orgOverview.organization.name}</span>（{orgOverview.organization.status}）
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

  /**
   * P2：Field 区自带详情面板（"点选节点 → 看它的依据"是这一区的核心交互）；
   * 其余区沿用原来的 Evidence Lens。`inspector` 只是一个 ReactNode，
   * 所以按当前区切换即可 —— shell 不需要知道差异。
   */
  const inspector = activeKey === 'field' ? <FieldInspector node={fieldSelection} /> : evidenceInspector

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
            <div className="space-y-3">
              {merged && !merged.ok && (
                <div
                  className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{merged.reason}</span>
                </div>
              )}

              {mergedSpec && (
                <LivingCanvas
                  spec={mergedSpec}
                  capabilityProbe={capabilityProbe}
                  blockedActions={blockedActions}
                  onAction={handleAction}
                  pendingActionKey={creating ? 'create-mission' : null}
                />
              )}

              {!tenantSettled && (
                <p className="flex items-center gap-2 text-xs text-lf-text-muted" role="status" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  正在读取社群真实状态（提案 / 任务队列 / 成果）…
                </p>
              )}

              {missionDraft && missionDraft.missing.length > 0 && (
                <div className="rounded-lf border border-lf-line bg-lf-surface p-3">
                  <p className="text-xs font-medium text-lf-text">还不能创建连接任务</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-lf-text-muted">
                    {missionDraft.missing.map((m) => (
                      <li key={m} className="break-words">
                        · {m}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-lf-text-faint">
                    服务端要求这三项都非空。这里<strong className="font-medium">不会</strong>替你编一个默认对价或判据 ——
                    把缺的补进描述里再重新编译即可。
                  </p>
                </div>
              )}

              {createResult?.kind === 'ok' && (
                <div className="rounded-lf border border-lf-signal/40 bg-lf-surface p-3" role="status">
                  <p className="flex items-center gap-2 text-sm text-lf-text">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-lf-signal" aria-hidden="true" />
                    {createResult.replayed ? '服务端判定为重复提交（幂等重放），已返回同一条任务。' : '连接任务已创建。'}
                  </p>
                  <p className="mt-1 break-all text-xs text-lf-text-muted">
                    id <span className="text-lf-text">{createResult.missionId}</span>
                    {createResult.title ? ` · ${createResult.title}` : ''}
                    {createResult.status ? ` · ${createResult.status}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] text-lf-text-faint">
                    幂等键 {attempt?.key ?? '—'}（同一份草稿重试会复用该键，因此不会重复创建）。
                  </p>
                </div>
              )}

              {createResult?.kind === 'error' && (
                <div
                  className="flex items-start gap-2 rounded-lf border border-lf-danger/40 bg-lf-surface-2 p-3 text-sm text-lf-danger"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="break-words">创建失败：{createResult.message}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeKey === 'field' && (
        <FieldCanvas onSelectNode={setFieldSelection} selectedNodeId={fieldSelection?.id ?? null} />
      )}
    </LivingShell>
  )
}
