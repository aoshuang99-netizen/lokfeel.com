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
 *
 * T10 收口新增（Community Bridge）：
 *   - **Consent 区加子面板**（`同意与披露` / `跨社群`），**不新增第八屏** ——
 *     取值见 T10 plan.md §8.3；AC-18 的七屏口径因此保持不变（`NAV` 一个字没动）。
 *   - 跨社群是**独立的一层授权**（两个群主各管一个租户，互不隶属），
 *     **不是** `CONSENT_AUDIENCES` 里多一个受众档位 —— 那会等于给同租户四个受众
 *     多开一个口子，而跨群恰恰不是同一信任域。详见 `src/lib/bridge/types.ts` 文件头。
 *   - 三个投影端点：`GET /api/v1/bridges`、`GET /api/v1/bridges/{bridgeId}`、
 *     `GET /api/v1/bridges/{bridgeId}/discovery`；写操作 approve / revoke / opt-in / opt-out。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AlertCircle, Bell, CheckCircle2, Compass, Loader2, Wand2 } from 'lucide-react'
import LivingShell, { type LivingNavItem } from '@/components/living/living-shell'
import StageRail from '@/components/living/adaptive/stage-rail'
import { buildOsStages } from '@/lib/living/adaptive/stages'
import {
  resolveWorkspaceView,
  workspaceViewUrl,
  WORKSPACE_VIEW_PARAM,
} from '@/lib/living/workspace-view'
import LivingCanvas from '@/components/living/living-canvas'
import FieldCanvas from '@/components/living/field/field-canvas'
import FieldInspector from '@/components/living/field/field-inspector'
import AgentBoard, { AgentsInspector, useAgentBoardData } from '@/components/living/agents/agent-board'
import ConsentGate, {
  ConsentInspector,
  useConsentGateData,
} from '@/components/living/consent/consent-gate'
import OutcomeObservatory, {
  ObservatoryInspector,
  useOutcomeObservatoryData,
} from '@/components/living/observatory/outcome-observatory'
import BridgePanel, {
  BridgeInspector,
  useBridgePanelData,
} from '@/components/living/bridge/bridge-panel'
import { useApiGet } from '@/hooks/use-api'
import { NOW_SEEDS } from '@/lib/living/now/seeds'
import { buildEvidenceRows, type EvidenceRow } from '@/lib/living/now/evidence'
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

/**
 * Mission **列表区**尚未接线。
 *
 * 说清楚为什么不是"需要 ACTIVE 社群成员"：那只是**取数时会 403** 的原因，
 * 而这里的问题是**没有这个区**（Mission 创建已在 Studio 完成，画布也在那里）。
 * 把"未接线"写成"需要权限"会让人以为补权限就能用 —— 那是另一回事。
 */
const MISSIONS_REASON =
  '任务列表还没做：创建任务和看画布都在 Studio，这里先不重复入口。'

/**
 * 侧栏七项。`hint` 是 hover 提示，写给用户看 —— 不写"2.5D""逐字段披露"这类设计术语：
 * 用户点开的理由永远是"这对我要办的事有什么用"。
 */
const NAV: LivingNavItem[] = [
  { key: 'now', label: 'Now', hint: '今天要推进什么', ready: true },
  { key: 'studio', label: 'Studio', hint: '把一句话编译成能跑的工作区', ready: true },
  { key: 'field', label: 'Field', hint: '谁认识谁，谁在等你', ready: true },
  { key: 'consent', label: 'Consent', hint: '谁能看到你的哪个字段', ready: true },
  { key: 'outcomes', label: 'Outcomes', hint: '做成了什么，怎么核验', ready: true },
  { key: 'agents', label: 'Agents', hint: 'Agent 干了什么，哪一步等你批', ready: true },
  { key: 'missions', label: 'Missions', hint: '连接任务', ready: false, reason: MISSIONS_REASON },
]

/**
 * 深链接白名单：**由 NAV 派生**，不是另抄一份字面量。
 * `ready:false` 的 `missions` 自动被排除 —— 拼 `?view=missions` 不会绕过「未开放功能不伪装可用」。
 */
const READY_VIEW_KEYS: readonly string[] = NAV.filter((item) => item.ready).map((item) => item.key)

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

/**
 * 一个数字 + 一句人话。
 *
 * 🔴 这里**不写数据来源**（"来自 /api/notifications" 之类）。首屏要回答的是
 *    "有没有事等我做"，不是"这个数字从哪个端点来" —— 后者属于右侧证据面板。
 *    `null` 一律写「暂时读不到」，不写 0：读不到和没有是两件事。
 */
function MetricCell({
  label,
  value,
  unit,
  line,
}: {
  label: string
  value: number | null
  unit: string
  line: string
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-lf-text">
          {value === null ? '—' : value}
        </span>
        {value !== null && <span className="text-[11px] text-lf-text-muted">{unit}</span>}
      </div>
      <p className="mt-1 text-xs text-lf-text">{label}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-lf-text-faint">{line}</p>
    </div>
  )
}

/** 证据面板的一行：人话在上，接口只在折叠层里（见 `@/lib/living/now/evidence`）。 */
function EvidenceRowView({ row }: { row: EvidenceRow }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-lf-text-muted">{row.label}</dt>
      <dd className="shrink-0 text-right">
        <span className={row.ok ? 'tabular-nums text-lf-text' : 'text-lf-text-faint'}>{row.value}</span>
        {row.detail && <span className="mt-0.5 block text-[10px] text-lf-text-faint">{row.detail}</span>}
      </dd>
    </div>
  )
}

/**
 * Consent 区的子面板切换。
 *
 * 🔴 两个 tab 都是 `ready:true` 的**本区**视图，不是"未接通的能力" ——
 *    因此它们**不**进 `NAV`（`NAV` 是跨区导航，进它就会变成第八屏，
 *    那是 T10 plan.md §8.3 明确不取的方案）。
 */
function ConsentSubTabs({
  value,
  onChange,
}: {
  value: 'gate' | 'bridge'
  onChange: (next: 'gate' | 'bridge') => void
}) {
  const tabs = [
    { key: 'gate' as const, label: '同意与披露', hint: '同群：我授权了哪些字段、谁看得到' },
    { key: 'bridge' as const, label: '跨社群', hint: '跨群：两个群主各自划范围、成员逐个加入' },
  ]
  return (
    <div role="tablist" aria-label="Consent 区子面板" className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const active = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`consent-tab-${t.key}`}
            title={t.hint}
            onClick={() => onChange(t.key)}
            className={[
              'lf-focus-ring rounded-lf border px-2.5 py-1 text-xs',
              active
                ? 'border-lf-signal bg-lf-signal-soft text-lf-signal'
                : 'border-lf-line text-lf-text-muted hover:text-lf-text',
            ].join(' ')}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export default function LivingWorkspace() {
  const { data: session } = useSession()
  const [activeKey, setActiveKey] = useState('now')

  /**
   * V20.3 · Continuity（G-03）：把当前屏同步进 URL，使刷新 / 返回 / 分享 / 切端可恢复。
   *
   * 🔴 为什么用 `pushState` 而不是 Next router：切视图**不换路由、不重取数据**，
   * 用 router 会触发 RSC 往返并可能把已加载的业务态冲掉；这里只需要一条可回退的历史记录。
   * `popstate` 由下方 effect 统一同步回 state，避免两套状态源漂移。
   */
  const navigateTo = useCallback((view: string) => {
    if (!READY_VIEW_KEYS.includes(view)) return
    setActiveKey(view)
    if (typeof window === 'undefined') return
    const url = workspaceViewUrl(
      window.location.pathname,
      window.location.search,
      window.location.hash,
      view,
      READY_VIEW_KEYS,
    )
    // 只在 URL 真的变化时压栈，避免重复点击同一页签污染历史记录。
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.pushState({ lfWorkspaceView: view }, '', url)
    }
  }, [])

  /**
   * 首屏从 URL 恢复 + 浏览器前进/后退同步。
   * 初始 state 恒为 'now'（与 SSR 输出一致），恢复放在 effect 里 —— 避免水合不一致。
   */
  useEffect(() => {
    const syncFromUrl = () => {
      const raw = new URLSearchParams(window.location.search).get(WORKSPACE_VIEW_PARAM)
      const view = resolveWorkspaceView(raw, READY_VIEW_KEYS)
      setActiveKey(view ?? 'now')
    }
    syncFromUrl()
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  const [draft, setDraft] = useState('')
  const [compiled, setCompiled] = useState<CompileResult | null>(null)
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<CreateResult | null>(null)
  /** 幂等键与它所属的请求体指纹（**同体复用、异体换新**）。 */
  const [attempt, setAttempt] = useState<{ sig: string; key: string } | null>(null)
  /** P2 · Field：当前选中的网络节点（详情面板的输入）。 */
  const [fieldSelection, setFieldSelection] = useState<FieldGraphNode | null>(null)
  /** P2 · Consent：当前选中的意图与字段（详情面板的输入）。 */
  const [consentIntentId, setConsentIntentId] = useState<string | null>(null)
  const [consentFieldKey, setConsentFieldKey] = useState<string | null>(null)
  /** P2 · Observatory：当前选中的成果（详情面板的输入）。 */
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null)
  /** P2 · Agents：当前选中的运行（详情面板的输入）。 */
  const [selectedAgentRunId, setSelectedAgentRunId] = useState<string | null>(null)
  /**
   * T10 · Consent 区的**子面板**切换：`同意与披露`（T05/T03，同群）/ `跨社群`（T10）。
   * 取子面板而非第八屏的理由见文件头。
   */
  const [consentTab, setConsentTab] = useState<'gate' | 'bridge'>('gate')
  /** T10 · Bridge：当前选中的协议（未选时面板内部取列表第一条）。 */
  const [bridgeSelection, setBridgeSelection] = useState<string | null>(null)

  const notifications = useApiGet<NotificationsRes>('/api/notifications')
  const chats = useApiGet<ChatCountRes>('/api/chats/unread-count')
  // 真实能力探测：403 即说明当前账号不是任何 ACTIVE 社群的成员。
  const org = useApiGet<ApiEnvelope<OrgOverview>>('/api/v1/org')
  // P1 收口：三类节点的真实来源。
  const proposals = useApiGet<ApiEnvelope<{ proposals: unknown[] }>>('/api/v1/connections/proposals')
  const jobs = useApiGet<ApiEnvelope<{ jobs: unknown[] }>>('/api/v1/workflow/jobs')
  const outcomes = useApiGet<ApiEnvelope<{ items: unknown[] }>>('/api/v1/outcomes')

  /**
   * 服务端下发的真实能力集合。
   * ⚠️ `GET /api/v1/org` 是 `{success, data}` 信封 —— 读错层级会得到一个**恒空**的集合，
   *    而"全部禁用"看起来与"权限不足"一模一样，因而极难发现。
   */
  const orgOverview = org.data?.data ?? null
  const capabilities = useMemo(() => new Set(orgOverview?.capabilities ?? []), [orgOverview])

  /**
   * P2 剩余三项的真实来源。
   *
   * 三个 hook 内部完成"取数 + 纯函数装配"，并共享同一份结果给主视图与详情面板
   * （避免两次请求、两次装配）。`enabled` 只在**当前所在的区**为 true ——
   * 这些是租户域端点，没进这一区就没必要去打它们。
   *
   * ⚠️ 三者都是 hook，必须在任何提前 return 之前调用（React 的调用顺序约束）。
   */
    // 🔴 三个租户域数据面**常开**（V16 截图实证）：阶段条在每一屏都要显示四段计数，
  //  按屏开关会让非对应屏永远显示「未就绪」，轨道形同虚设。
  //  三个 hook 内部都是"取数+装配一次，主视图与详情共用"，常开只增加首屏 3 个请求，
  //  却省掉了每次切屏的重复取数。非成员的 403 由 Evidence Lens 如实展示，不额外处理。
  const consentData = useConsentGateData(consentIntentId, true)
    const observatoryData = useOutcomeObservatoryData(true)
    // Agents 端点要求 agent.run（OPERATOR+）：MEMBER 常开会每屏吃一个 403，
  // 所以这里用**已探测到的能力集**开关，而不是无脑常开。
  const agentData = useAgentBoardData(capabilities.has('agent.run'))
  // T10：只有**切到跨社群子面板**才发这三个租户域请求（不在这一区就没必要打，非成员还会吃 403）。
  const bridgeData = useBridgePanelData(bridgeSelection, activeKey === 'consent' && consentTab === 'bridge')

  const unreadNotifications = notifications.data?.unreadCount ?? null
  const unreadChats = chats.data?.unreadCount ?? null

  const latestNotifications = useMemo(
    () => (notifications.data?.notifications ?? []).slice(0, 6),
    [notifications.data],
  )

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
    navigateTo('studio')
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

  /**
   * 阶段条：把「提案 → 同意 → 执行 → 成果」四个**已接线**的真实端点折成一条轨道。
   * 纯函数 `buildOsStages` 只做计数与打标，不发请求；读不到的段落显示「—」而不是 0。
   */
  const stages = useMemo(
    () =>
      buildOsStages({
        proposals: consentData.board?.rows ?? null,
        runs: agentData.board?.runs ?? null,
        outcomes: observatoryData.timeline
          ? {
              total: observatoryData.timeline.counts.total,
              unverified: observatoryData.timeline.counts.unverified,
            }
          : null,
        specReady: compiled?.ok === true,
      }),
    [consentData.board, agentData.board, observatoryData.timeline, compiled],
  )

  /**
   * 证据面板（右侧）—— 三层，默认只露第一层：
   *   ① 人话：六个数字 + 取不到的真实原因
   *   ② 折叠：接口与原始值（可追源，但不占用首屏注意力）
   *   ③ 折叠：尚未接通的能力（诚实清单，不是感叹号）
   *
   * 🔴 顺序不是排版偏好：能力探测排第一，因为后面几行为什么"读不到"，
   *    答案通常是它（非成员 → 403）。先因果，后现象。
   */
  const evidenceRows: EvidenceRow[] = buildEvidenceRows({
    unreadNotifications,
    unreadChats,
    totalChats: chats.data?.totalChats ?? null,
    capabilities: org.isLoading
      ? { state: 'pending', count: 0 }
      : org.error
        ? { state: 'error', count: 0, error: org.error }
        : { state: 'ready', count: capabilities.size },
    pendingProposals: stages.find((s) => s.key === 'proposal')?.count ?? null,
    awaitingApproval: stages.find((s) => s.key === 'execution')?.count ?? null,
    unverifiedOutcomes: stages.find((s) => s.key === 'outcome')?.count ?? null,
  })
  const notWired = NAV.filter((n) => !n.ready)

  const evidenceInspector = (
    <div className="space-y-5">
      <section>
        <h2 className="text-sm font-semibold text-lf-text">这屏的数字，从哪来</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-lf-text-muted">
          每个数字都直接读接口：读到的写数，读不到的写读不到。
        </p>
        <dl className="mt-3 space-y-2.5 text-xs">
          {evidenceRows.map((row) => (
            <EvidenceRowView key={row.key} row={row} />
          ))}
        </dl>
      </section>

      <details className="rounded-lf border border-lf-line bg-lf-surface-2/40">
        <summary className="cursor-pointer px-3 py-2 text-[11px] text-lf-text-muted transition-colors hover:text-lf-text">
          接口与原始值（{evidenceRows.length} 个）
        </summary>
        <ul className="space-y-2 border-t border-lf-line px-3 py-2.5 text-[11px] text-lf-text-muted">
          {evidenceRows.map((row) => (
            <li key={row.key}>
              <code className="text-lf-signal">{row.endpoint}</code>
              <span className="ml-1">→ {row.value}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-lf border border-lf-line bg-lf-surface-2/40">
        <summary className="cursor-pointer px-3 py-2 text-[11px] text-lf-text-muted transition-colors hover:text-lf-text">
          {notWired.length} 项能力尚未接通
        </summary>
        <ul className="space-y-2 border-t border-lf-line px-3 py-2.5 text-[11px]">
          {notWired.map((n) => (
            <li key={n.key}>
              <span className="font-medium text-lf-text">{n.label}</span>
              <p className="mt-0.5 leading-relaxed text-lf-text-muted">{n.reason}</p>
            </li>
          ))}
        </ul>
      </details>

      {compiled && (
        <section>
          <h2 className="text-[11px] uppercase tracking-wide text-lf-text-faint">本次编译</h2>
          {compiled.ok ? (
            <ul className="mt-2 space-y-1 text-[11px] text-lf-text-muted">
              <li>
                意图：<span className="text-lf-text">{compiled.intentClass}</span>
              </li>
              <li>
                命中词：
                <span className="text-lf-text">
                  {compiled.matchedKeywords.length ? compiled.matchedKeywords.join('、') : '（无）'}
                </span>
              </li>
              <li>
                节点：<span className="text-lf-text">{compiled.spec.nodes.length}</span> 个
                {merged?.ok ? ` → 合并社群数据后 ${merged.spec.nodes.length} 个` : ''}
              </li>
            </ul>
          ) : (
            <p className="mt-2 rounded-lf border border-lf-line p-2 text-[11px] text-lf-text-muted">
              未生成工作区：{compiled.reason}
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="text-[11px] uppercase tracking-wide text-lf-text-faint">身份</h2>
        <p className="mt-2 break-all text-[11px] text-lf-text-muted">{session?.user?.email ?? '（未取到会话）'}</p>
        {orgOverview && (
          <p className="mt-1 text-[11px] text-lf-text-muted">
            角色 <span className="text-lf-text">{orgOverview.myRole}</span> · 社群{' '}
            <span className="text-lf-text">{orgOverview.organization.name}</span>（
            {orgOverview.organization.status}）
          </p>
        )}
      </section>
    </div>
  )

  /**
   * 输入框只有一个实例，两个位置：
   *   · `hero` —— Now 屏的正中（首屏主操作）；
   *   · `bar`  —— 其余五屏沿用底部悬浮条。
   *
   * 🔴 不能两处同时渲染：同名 id 会让 label、焦点与自动化断言指向不确定的那一个。
   *    所以由 render 处二选一，而不是 CSS 隐藏。
   */
  const composer = (variant: 'hero' | 'bar') => {
    const hero = variant === 'hero'
    return (
      <div className={hero ? 'space-y-1' : 'space-y-2'}>
        <label htmlFor="lf-composer" className="sr-only">
          描述你的目标
        </label>
        <textarea
          id="lf-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={hero ? 3 : 2}
          placeholder="例如：30 天内对接 20 家渠道伙伴，我们提供联名内容和场地…"
          className={
            hero
              ? 'lf-focus-ring w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-relaxed text-lf-text outline-none placeholder:text-lf-text-faint'
              : 'lf-focus-ring w-full resize-none rounded-lf bg-lf-surface-2 p-2 text-sm text-lf-text placeholder:text-lf-text-faint'
          }
          style={{ transitionDuration: 'var(--lf-dur-fast)' }}
        />
        <div
          className={`flex gap-2 ${hero ? 'flex-col px-1 sm:flex-row sm:items-center sm:justify-between' : 'items-center justify-between'}`}
        >
          <p className="min-w-0 text-[11px] leading-relaxed text-lf-text-faint">
            编译在本地完成；只有真正创建任务时才写入服务端。
          </p>
          {/* 编译是纯前端动作 → 只要有足够文本就一定可用；不足则禁用并说明差多少。 */}
          <button
            type="button"
            disabled={!canCompile}
            aria-disabled={!canCompile}
            title={canCompile ? '编译为工作区' : `至少输入 ${MIN_GOAL_LENGTH} 个字符`}
            onClick={runCompile}
            className={[
              'lf-focus-ring inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lf px-3.5 py-2 text-xs font-medium',
              hero ? 'w-full border border-transparent sm:w-auto' : 'border',
              canCompile
                ? hero
                  ? 'bg-lf-text text-lf-bg hover:opacity-90'
                  : 'border-lf-line-strong text-lf-text hover:bg-lf-surface-2'
                : 'cursor-not-allowed border-lf-line text-lf-text-faint',
            ].join(' ')}
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
            编译工作区
          </button>
        </div>
      </div>
    )
  }

  /**
   * P2：Field / Consent / Outcomes / Agents 四区各自带详情面板
   * （"点选一条记录 → 看它的依据"是这些区的核心交互）；
   * 其余区沿用原来的 Evidence Lens。`inspector` 只是一个 ReactNode，
   * 所以按当前区切换即可 —— shell 不需要知道差异。
   */
  const inspector = (() => {
    if (activeKey === 'field') return <FieldInspector node={fieldSelection} />
    if (activeKey === 'consent')
      return consentTab === 'bridge' ? (
        <BridgeInspector data={bridgeData} />
      ) : (
        <ConsentInspector data={consentData} selectedFieldKey={consentFieldKey} />
      )
    if (activeKey === 'outcomes')
      return <ObservatoryInspector data={observatoryData} selectedOutcomeId={selectedOutcomeId} />
    if (activeKey === 'agents')
      return <AgentsInspector data={agentData} selectedRunId={selectedAgentRunId} />
    return evidenceInspector
  })()

  return (
    <LivingShell
      nav={NAV}
      activeKey={activeKey}
      onNavigate={navigateTo}
      title="My Workspace"
      dualWorld
      stageRail={<StageRail stages={stages} activeView={activeKey} onFocusView={navigateTo} />}
      contextExtra={
        <span className="hidden items-center gap-1 rounded-lf border border-lf-line px-2 py-1 text-xs text-lf-text-muted sm:inline-flex">
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          {unreadNotifications === null ? '—' : unreadNotifications}
        </span>
      }
      inspector={inspector}
      // Now 屏的输入框在画布正中，其余屏沿用底部悬浮条 —— 只渲染一个。
      composer={activeKey === 'now' ? undefined : composer('bar')}
    >
      {activeKey === 'now' && (
        <div className="space-y-4">
          {/*
            Now 屏的范式：**输入在前，状态在后**。
            生成式产品的第一屏不是仪表盘（尤其是仪表盘上全是 0 的时候），
            而是一个"说出你要什么"的入口。三个真实计数退到它下面，只回答
            "有没有事等我"，不再解释自己来自哪个端点。
          */}
          <section className="relative overflow-hidden rounded-lf-lg border border-lf-line bg-lf-surface p-5 lg:p-7">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ background: 'linear-gradient(90deg, transparent, var(--lf-signal), transparent)' }}
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-lf-text-faint">
              Now · 你的工作区
            </p>
            <h1 className="mt-3 text-[1.7rem] font-semibold leading-[1.15] tracking-[-0.02em] text-lf-text lg:text-[2.1rem]">
              今天想推进什么？
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-lf-text-muted">
              一句话说清结果、期限，和你愿意拿出的东西。它会摊成一张能跑的工作区：
              谁提案、谁点头、Agent 做什么、什么算成交。
            </p>

            <div className="mt-5 rounded-lf border border-lf-line bg-lf-bg/40 px-2 pb-1 pt-2 transition-colors focus-within:border-lf-signal/60">
              {composer('hero')}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-lf-text-faint">没想好？从这里开始</span>
              {NOW_SEEDS.map((seed) => (
                <button
                  key={seed.id}
                  type="button"
                  data-testid="now-seed"
                  onClick={() => {
                    setDraft(seed.goal)
                    document.getElementById('lf-composer')?.focus()
                  }}
                  className="lf-focus-ring min-h-9 rounded-full border border-lf-line px-3 text-[12px] text-lf-text-muted transition-colors hover:border-lf-line-strong hover:text-lf-text"
                  style={{ transitionDuration: 'var(--lf-dur-fast)' }}
                >
                  {seed.label}
                </button>
              ))}
            </div>
          </section>

          {/*
            V16 · F-05：第三格原来放「我的匹配 · /api/matches」—— B2C 遗留线，
            会让人以为这是个交友产品。现在换成"待你介绍"：双方已同意、等你牵线。
          */}
          <section className="overflow-hidden rounded-lf-lg border border-lf-line bg-lf-surface">
            <div className="grid grid-cols-1 divide-y divide-lf-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <MetricCell
                label="未读消息"
                value={unreadChats}
                unit="条"
                line={
                  unreadChats === null ? '暂时读不到' : unreadChats === 0 ? '没有新消息' : '还没读'
                }
              />
              <MetricCell
                label="未读通知"
                value={unreadNotifications}
                unit="条"
                line={
                  unreadNotifications === null
                    ? '暂时读不到'
                    : unreadNotifications === 0
                      ? '没有新动静'
                      : '还没看'
                }
              />
              <MetricCell
                label="待你介绍"
                value={stages.find((s) => s.key === 'consent')?.count ?? null}
                unit="位"
                line={
                  (stages.find((s) => s.key === 'consent')?.count ?? null) === null
                    ? '需要社群数据，当前读不到'
                    : (stages.find((s) => s.key === 'consent')?.count ?? 0) === 0
                      ? '没有等你牵线的'
                      : '双方都点头了，等你牵线'
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium text-lf-text">待处理</h2>
              {/* 一句就够的诚实：这页只列真实通知，不补占位。不写成一段自辩。 */}
              <span className="text-[11px] text-lf-text-faint">只列真实通知</span>
            </div>
            <Loadable
              isLoading={notifications.isLoading}
              error={notifications.error}
              empty={latestNotifications.length === 0}
              emptyText="没有需要你处理的事。新的批准、提案和提醒会先出现在这里。"
            >
              <ul className="space-y-2">
                {latestNotifications.map((n) => (
                  <li key={n.id} className="rounded-lf border border-lf-line bg-lf-surface p-3">
                    <p className="text-sm text-lf-text">{n.title || n.message || n.body || '（无标题）'}</p>
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
            用一句话说清你想推进的事，系统会把它摊成可执行的一步一步：要联系谁、要谁同意、
            做成什么算完成、结果怎么核验。每一步都会落到真实记录上，不是画给你看的一张图。
          </p>

          {compiled === null && (
            <div className="rounded-lf border border-dashed border-lf-line p-6 text-center">
              <Compass className="mx-auto h-6 w-6 text-lf-text-faint" aria-hidden="true" />
              <p className="mt-2 text-sm text-lf-text-muted">还没有工作区。先写下一个目标。</p>
              {/* V16 · F-08：空态把主操作拉到眼前，而不是让用户自己找底部悬浮框。 */}
              <button
                type="button"
                onClick={() => document.getElementById('lf-composer')?.focus()}
                className="lf-focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lf border border-lf-line-strong px-3 py-1.5 text-xs text-lf-text hover:bg-lf-surface-2"
              >
                <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                开始输入目标
              </button>
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

      {activeKey === 'consent' && (
        <div className="space-y-4">
          <ConsentSubTabs value={consentTab} onChange={setConsentTab} />
          {consentTab === 'bridge' ? (
            <BridgePanel data={bridgeData} onSelectBridge={setBridgeSelection} />
          ) : (
            <ConsentGate
              data={consentData}
              onSelectIntent={setConsentIntentId}
              selectedFieldKey={consentFieldKey}
              onSelectField={setConsentFieldKey}
            />
          )}
        </div>
      )}

      {activeKey === 'outcomes' && (
        <OutcomeObservatory
          data={observatoryData}
          selectedOutcomeId={selectedOutcomeId}
          onSelectOutcome={setSelectedOutcomeId}
        />
      )}

      {activeKey === 'agents' && (
        <AgentBoard
          data={agentData}
          selectedRunId={selectedAgentRunId}
          onSelectRun={setSelectedAgentRunId}
        />
      )}
    </LivingShell>
  )
}
