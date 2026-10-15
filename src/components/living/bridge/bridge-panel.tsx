'use client'

/**
 * T10 Slice 4 · Bridge Panel —— 跨社群授权的**可见性面板**
 * （Consent 区的一个子面板；AC-18 的七屏口径因此保持不变）
 *
 * 🔴 这一页只回答三个问题（与 `consent-gate.tsx` 的分工是"同群 / 跨群"）：
 *     ① 「本组织参与了哪些跨群协议，我加入了没有？」（列表 + 我的 opt-in 状态）
 *     ② 「对方能看到我的哪些字段？如果看不到，是**群主**没开还是**我自己**没勾？」
 *        （本人视角的逐字段归因 —— 这是本页存在的主要理由）
 *     ③ 「我能看到对方的哪些成员、哪些字段？」（跨群投影）
 *
 * 🔴 四条呈现纪律：
 *
 *   ① **不重算服务端已算好的东西**。`EXPIRED` 是服务端**派生**的；`canApprove` /
 *      `canRevoke` / `canOptIn` / `canOptOut` 是服务端"能力 ∧ 状态机 ∧ 尚无裁决"的
 *      三态合取。前端自己算一遍就是第二个真相来源，而它写反时的症状是
 *      "点了必然 403/409 的空按钮"（AC-18 明令禁止）。
 *
 *   ② **①环是交集，不是单侧配置**。界面上"已同意共享"只来自 `agreedFieldKeys`
 *      （双方群主配置的交集）；单侧配置只作为**成员 opt-in 的可选范围**。
 *      把单侧键当成"已共享"会让成员以为"我已经给出去了"，而对方根本还没批。
 *
 *   ③ **不动手做"我方的默认值"**。opt-in 的勾选**从服务端已存的 `myOptIn` 起算**，
 *      用户没动过就原样回传。前端替用户"默认勾上全部"是最典型的越权式默认值
 *      （AC-19 要的是**明确** opt-in）。
 *
 *   ④ **三态齐全**：列表 / 详情 / 跨群投影各有一组 loading / 空 / 错误，且空态文案
 *      说的是"查询成功但没有" —— 不与"读不到"共用一句话（见 `living-states.tsx`）。
 *
 * ⚠️ 文本纪律（`check:ui-invariants` 的 R9）：会进界面的字符串里**不得**出现 markdown
 *    强调标记 —— React 会把它原样渲染成两个星号。本文件因此一律用「」引号着重。
 */

import { useMemo, useState } from 'react'
import { Check, ExternalLink, Link2, ShieldOff, UserCheck, Users } from 'lucide-react'
import {
  LivingActionResult,
  LivingEmpty,
  LivingErrorBox,
  LivingLoadable,
  LivingLoading,
  LivingNotes,
} from '@/components/living/living-states'
import { useLivingPost, type LivingEnvelope } from '@/components/living/use-living-post'
import { useApiGet } from '@/hooks/use-api'
import {
  assembleBridgeDetail,
  assembleBridgeDiscovery,
  assembleBridgeList,
  bridgeDecideRequest,
  bridgeOptInRequest,
  bridgeOptOutRequest,
  type BridgeDetailModel,
  type BridgeDiscoveryModel,
  type BridgeListModel,
} from '@/lib/living/bridge'

export interface BridgePanelData {
  list: BridgeListModel | null
  listLoading: boolean
  listError: string | null
  /** 当前选中的协议（未选时取列表第一条 —— 用户进这一区最可能想看的就是它）。 */
  effectiveBridgeId: string | null

  detail: BridgeDetailModel | null
  detailLoading: boolean
  detailError: string | null

  discovery: BridgeDiscoveryModel | null
  discoveryLoading: boolean
  discoveryError: string | null

  /** opt-in 勾选（本地态；未动过时 = 服务端已存的选择）。 */
  selectedKeys: ReadonlySet<string>
  selectionDirty: boolean
  toggleField: (key: string) => void
  resetSelection: () => void

  action: { ok: boolean; message: string | null } | null
  pendingUrl: string | null
  runDecide: (action: 'APPROVE' | 'REVOKE') => void
  runOptIn: () => void
  runOptOut: () => void
}

/**
 * 取数 + 装配（**一次**，主视图与详情面板共用）。
 *
 * `enabled=false` 时**完全不发请求**（url 传 null）—— 本区有三个租户域端点，
 * 不在这一区时没必要去打它们（非成员还会拿到 403 噪音）。
 */
export function useBridgePanelData(bridgeId: string | null, enabled = true): BridgePanelData {
  const listRes = useApiGet<LivingEnvelope<unknown>>(enabled ? '/api/v1/bridges' : null)

  const listOutcome = useMemo(() => {
    const payload = listRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleBridgeList(payload)
  }, [listRes.data])

  const list = listOutcome?.ok ? listOutcome.value : null
  const listError = listRes.error ?? (listOutcome && !listOutcome.ok ? listOutcome.error : null)

  // 未选时**默认取第一条**：进这一区最可能想看的就是最近那份协议的现状。
  const effectiveBridgeId = bridgeId ?? list?.cards[0]?.id ?? null

  const detailRes = useApiGet<LivingEnvelope<unknown>>(
    enabled && effectiveBridgeId ? `/api/v1/bridges/${encodeURIComponent(effectiveBridgeId)}` : null,
  )
  const discoveryRes = useApiGet<LivingEnvelope<unknown>>(
    enabled && effectiveBridgeId
      ? `/api/v1/bridges/${encodeURIComponent(effectiveBridgeId)}/discovery`
      : null,
  )

  const detailOutcome = useMemo(() => {
    const payload = detailRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleBridgeDetail(payload)
  }, [detailRes.data])

  const discoveryOutcome = useMemo(() => {
    const payload = discoveryRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleBridgeDiscovery(payload)
  }, [discoveryRes.data])

  const detail = detailOutcome?.ok ? detailOutcome.value : null
  const detailError = detailRes.error ?? (detailOutcome && !detailOutcome.ok ? detailOutcome.error : null)

  const discovery = discoveryOutcome?.ok ? discoveryOutcome.value : null
  const discoveryError =
    discoveryRes.error ?? (discoveryOutcome && !discoveryOutcome.ok ? discoveryOutcome.error : null)

  /**
   * opt-in 勾选态。
   *
   * 🔴 **不用 `useEffect` 去"同步"** 服务端值 —— 那要区分"服务端刷新了"与
   *    "用户刚点了"，双向同步是同类 bug 的温床（用户刚勾上又被服务端拉回去）。
   *    这里用"**未动过就跟随服务端**"的**单向**规则：本地态不存在、或属于另一份协议时，
   *    勾选态直接来自 `detail`；一旦用户动过，就以本地为准，直到提交成功或显式重置。
   */
  const [selection, setSelection] = useState<{ bridgeId: string; keys: string[] } | null>(null)

  const effectiveSelection = useMemo(() => {
    if (selection && selection.bridgeId === effectiveBridgeId) return new Set(selection.keys)
    return new Set(detail?.card.myOptIn?.disclosedFieldKeys ?? [])
  }, [selection, effectiveBridgeId, detail])

  const selectionDirty = selection !== null && selection.bridgeId === effectiveBridgeId

  const toggleField = (key: string) => {
    if (!effectiveBridgeId) return
    const next = new Set(effectiveSelection)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelection({ bridgeId: effectiveBridgeId, keys: [...next] })
  }
  const resetSelection = () => setSelection(null)

  const { run, pendingUrl } = useLivingPost()
  const [action, setAction] = useState<{ ok: boolean; message: string | null } | null>(null)

  /** 动作成功后，三个投影都可能变（状态机 → 交集 → 可见成员），故一并刷新。 */
  const refreshAll = () => {
    listRes.refetch()
    detailRes.refetch()
    discoveryRes.refetch()
  }

  const runDecide = (decision: 'APPROVE' | 'REVOKE') => {
    if (!effectiveBridgeId) return
    const req = bridgeDecideRequest(effectiveBridgeId, decision)
    void run(req.url, req.body).then((res) => {
      setAction({ ok: res.ok, message: res.message })
      if (res.ok) refreshAll()
    })
  }

  const runOptIn = () => {
    if (!effectiveBridgeId) return
    const req = bridgeOptInRequest(effectiveBridgeId, [...effectiveSelection])
    void run(req.url, req.body).then((res) => {
      setAction({ ok: res.ok, message: res.message })
      if (res.ok) {
        // 服务端已存下 ⇒ 回到"跟随服务端"，本地脏标记清零。
        setSelection(null)
        refreshAll()
      }
    })
  }

  const runOptOut = () => {
    if (!effectiveBridgeId) return
    const req = bridgeOptOutRequest(effectiveBridgeId)
    void run(req.url, req.body).then((res) => {
      setAction({ ok: res.ok, message: res.message })
      if (res.ok) {
        setSelection(null)
        refreshAll()
      }
    })
  }

  return {
    list,
    listLoading: listRes.isLoading,
    listError,
    effectiveBridgeId,
    detail,
    detailLoading: detailRes.isLoading,
    detailError,
    discovery,
    discoveryLoading: discoveryRes.isLoading,
    discoveryError,
    selectedKeys: effectiveSelection,
    selectionDirty,
    toggleField,
    resetSelection,
    action,
    pendingUrl,
    runDecide,
    runOptIn,
    runOptOut,
  }
}

// ═══════════════════════════════════════════════════════════
// 主视图
// ═══════════════════════════════════════════════════════════

export interface BridgePanelProps {
  data: BridgePanelData
  onSelectBridge: (bridgeId: string) => void
}

export default function BridgePanel({ data, onSelectBridge }: BridgePanelProps) {
  return (
    <div className="space-y-5" data-testid="bridge-panel">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          Community Bridge · 跨社群授权
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-lf-text-muted">
          跨群共享的前提是两层授权：双方群主先在协议里各自划定允许共享的字段，成员再逐个选择加入。
          界面上「已同意共享」展示的是两边的「交集」—— 只写了我方一侧的配置，不等于对方已经能看到。
        </p>
      </header>

      {/* ── ① 协议列表 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-lf-text-muted">本组织参与的协议</h2>
        <LivingLoadable
          isLoading={data.listLoading}
          error={data.listError}
          empty={(data.list?.cards.length ?? 0) === 0}
          emptyText="查询成功，但本组织当前没有参与任何跨群协议。发起新协议是管理员动作 —— 本面板不做入口，以免出现点了没反应的按钮。"
          errorHint="这一条需要 bridge.read 能力；非社群成员会拿到 403。"
        >
          <ul className="flex flex-wrap gap-2" data-testid="bridge-list">
            {(data.list?.cards ?? []).map((c) => {
              const active = c.id === data.effectiveBridgeId
              return (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    data-testid={`bridge-list-item-${c.id}`}
                    onClick={() => onSelectBridge(c.id)}
                    className={[
                      'lf-focus-ring max-w-full rounded-lf border px-2.5 py-1.5 text-left text-xs',
                      active
                        ? 'border-lf-signal bg-lf-signal-soft text-lf-signal'
                        : 'border-lf-line text-lf-text-muted hover:text-lf-text',
                    ].join(' ')}
                  >
                    <span className="font-medium">{c.statusLabel}</span>
                    <span className="ml-1.5 text-lf-text-faint">{c.sideLabel}</span>
                    <span className="ml-1.5 text-lf-text-faint">交集 {c.agreedFieldKeys.length} 项</span>
                    <span className="ml-1.5 text-lf-text-faint">
                      {c.myOptIn ? `我已${c.myOptIn.statusLabel}` : '我未加入'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </LivingLoadable>
        <LivingNotes notes={data.list?.notes ?? []} title="协议列表说明" />
      </section>

      {/* ── ② 详情 + 本人视角 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-lf-text-muted">这份协议当前共享了什么</h2>
        {data.detailLoading ? (
          <LivingLoading label="正在读取协议详情…" />
        ) : data.detailError ? (
          <LivingErrorBox
            message={data.detailError}
            hint="详情端点只对协议当事组织可见；跨组织访问一律 404（连「存在」这一事实都不泄露）。"
          />
        ) : data.detail ? (
          <BridgeDetailBody data={data} detail={data.detail} />
        ) : (
          <LivingEmpty text="选定一份协议后显示它的双边配置、我的可见字段与归因。" />
        )}
      </section>

      {/* ── ③ 跨群可见成员 ── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-lf-text-muted">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          对方的可见成员
        </h2>
        {data.discoveryLoading ? (
          <LivingLoading label="正在读取跨群投影…" />
        ) : data.discoveryError ? (
          <LivingErrorBox
            message={data.discoveryError}
            hint="跨群投影是唯一的跨群读取路径；四道闸门（协议生效 / 成员 opt-in / 成员意图 / 三方交集）缺一即空。"
          />
        ) : data.discovery ? (
          <BridgeDiscoveryBody discovery={data.discovery} />
        ) : (
          <LivingEmpty text="选定一份协议后显示对方愿意被我看到的成员。" />
        )}
      </section>

      {data.action && (
        <LivingActionResult
          ok={data.action.ok}
          message={data.action.message}
          successText="操作已提交，以服务端返回为准 —— 本页随即重新拉取三个投影（协议状态 / 我的可见字段 / 跨群成员）。"
        />
      )}
    </div>
  )
}

// ── 详情体 ──────────────────────────────────────────────────

function BridgeDetailBody({ data, detail }: { data: BridgePanelData; detail: BridgeDetailModel }) {
  const card = detail.card
  const dirty = data.selectionDirty
  const pendingIn = data.pendingUrl === bridgeOptInRequest(card.id, []).url
  const pendingOut = data.pendingUrl === bridgeOptOutRequest(card.id).url
  const pendingDecide =
    data.pendingUrl === bridgeDecideRequest(card.id, 'APPROVE').url ||
    data.pendingUrl === bridgeDecideRequest(card.id, 'REVOKE').url
  const busy = pendingIn || pendingOut || pendingDecide

  const selectedCount = [...data.selectedKeys].length
  const selectedInAgreement = [...data.selectedKeys].filter((k) => card.agreedFieldKeys.includes(k)).length

  return (
    <div className="space-y-4" data-testid="bridge-detail">
      {/* 状态条 */}
      <div className="rounded-lf border border-lf-line bg-lf-surface p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-lf border border-lf-line px-1.5 py-0.5" data-testid="bridge-status">
            {card.statusLabel}
          </span>
          <span className="text-lf-text-muted">{card.sideLabel}</span>
          <span className="break-all text-lf-text-faint">
            对方组织 {card.counterpartyOrgId ?? '（未知）'}
          </span>
          <span className="text-lf-text-faint">
            {card.expiresAt ? `有效期至 ${card.expiresAt.slice(0, 10)}` : '无固定有效期'}
          </span>
          <span className="text-lf-text-faint">
            对方批准：{card.recipientApprovedAt ? card.recipientApprovedAt.slice(0, 10) : '尚未批准'}
          </span>
        </div>
        <p className="mt-2 break-words text-xs text-lf-text-muted">用途声明：{card.purpose}</p>
        {card.shareableMissionKinds.length > 0 && (
          <p className="mt-1 break-words text-[11px] text-lf-text-faint">
            可共享的任务类型：{card.shareableMissionKinds.join('、')}
          </p>
        )}

        {/* 协议动作：只按服务端下发的 canX 渲染 */}
        {(card.canApprove || card.canRevoke) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {card.canApprove && (
              <button
                type="button"
                disabled={busy}
                aria-disabled={busy}
                data-testid="bridge-approve"
                onClick={() => data.runDecide('APPROVE')}
                className="lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border border-lf-line-strong px-2.5 py-1 text-xs text-lf-text hover:bg-lf-surface-2"
              >
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                批准这份协议
              </button>
            )}
            {card.canRevoke && (
              <button
                type="button"
                disabled={busy}
                aria-disabled={busy}
                data-testid="bridge-revoke"
                onClick={() => data.runDecide('REVOKE')}
                className="lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border border-lf-line-strong px-2.5 py-1 text-xs text-lf-text hover:bg-lf-surface-2"
              >
                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                撤销
              </button>
            )}
          </div>
        )}
      </div>

      {/* ①环：双边配置交集 */}
      <div className="rounded-lf border border-lf-line bg-lf-surface p-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          双方同意共享的字段（两边配置的交集）
        </h3>
        {card.agreedFieldLabels.length === 0 ? (
          <p className="mt-2 text-xs text-lf-text-muted" data-testid="bridge-agreed-empty">
            两边配置尚无交集 —— 当前没有任何字段可以跨群共享。这不是读取失败。
          </p>
        ) : (
          <p className="mt-2 break-words text-xs text-lf-text" data-testid="bridge-agreed">
            {card.agreedFieldLabels.join('、')}
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-lf-text-faint">
          交集只是上界：成员还要逐个加入、且他自己的披露档位也要覆盖该字段，它才真的可见（见下方归因）。
        </p>
      </div>

      {/* 本人可见性 + 归因 */}
      <div className="rounded-lf border border-lf-line bg-lf-surface p-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          我目前会被对方看到的字段
        </h3>
        {detail.bridgeRefusalLabel ? (
          <p className="mt-2 text-xs text-lf-warning" data-testid="bridge-refusal">
            协议层未放行：{detail.bridgeRefusalLabel} —— 此时你的字段谁也看不到，与你的勾选无关。
          </p>
        ) : detail.mySharedFieldLabels.length === 0 ? (
          <p className="mt-2 text-xs text-lf-text-muted" data-testid="bridge-my-shared-empty">
            当前没有任何字段会被对方看到。若你已加入，逐条原因见下方归因表。
          </p>
        ) : (
          <p className="mt-2 break-words text-xs text-lf-text" data-testid="bridge-my-shared">
            {detail.mySharedFieldLabels.join('、')}
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-lf-text-faint">
          投影档位（服务端自描述）：{detail.profileAudienceLabel}
        </p>

        {detail.narrowed.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-xs" data-testid="bridge-narrowed">
              <caption className="sr-only">被收窄的字段、原因，以及该找谁调整</caption>
              <thead>
                <tr className="bg-lf-surface-2 text-left text-[11px] uppercase tracking-wide text-lf-text-muted">
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    字段
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    被什么挡住
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    该找谁
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.narrowed.map((n) => (
                  <tr key={`${n.key}-${n.reason}`} className="border-t border-lf-line">
                    <th scope="row" className="px-2 py-1.5 text-left font-normal text-lf-text">
                      {n.label}
                    </th>
                    <td className="px-2 py-1.5 text-lf-text-muted">{n.reasonLabel}</td>
                    <td className="px-2 py-1.5 text-lf-text-muted">{n.ownerLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LivingNotes notes={detail.notes} title="可见性说明" />
      </div>

      {/* opt-in */}
      <div className="rounded-lf border border-lf-line bg-lf-surface p-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          我的加入选择（逐个字段）
        </h3>
        <p className="mt-1.5 text-xs text-lf-text-muted" data-testid="bridge-optin-status">
          {card.myOptIn
            ? `当前状态：${card.myOptIn.statusLabel}（${card.myOptIn.optedInAt.slice(0, 10)} 加入）`
            : '当前状态：未加入 —— 未加入时你的任何字段都不会进入跨群投影。'}
        </p>

        {detail.optInOptions.length === 0 ? (
          <p
            className="mt-2 rounded-lf border border-dashed border-lf-line p-3 text-xs text-lf-text-muted"
            data-testid="bridge-optin-nooptions"
          >
            我方在这份协议里尚未配置任何可共享字段，因此暂无可勾选项。这一步需要群主先在协议里划定范围。
          </p>
        ) : (
          <>
            <ul className="mt-2 space-y-1.5" data-testid="bridge-optin-options">
              {detail.optInOptions.map((opt) => {
                const checked = data.selectedKeys.has(opt.key)
                return (
                  <li key={opt.key} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id={`lf-bridge-opt-${opt.key}`}
                      data-testid={`bridge-opt-${opt.key}`}
                      checked={checked}
                      onChange={() => data.toggleField(opt.key)}
                      disabled={!card.canOptIn}
                      aria-disabled={!card.canOptIn}
                      className="lf-focus-ring mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                    <label htmlFor={`lf-bridge-opt-${opt.key}`} className="min-w-0 text-xs text-lf-text">
                      {opt.label}
                      {opt.sensitive && (
                        <span className="ml-1.5 text-[10px] text-lf-warning" title="服务端标记为敏感字段">
                          敏感
                        </span>
                      )}
                      <span className="ml-1.5 block text-[10px] text-lf-text-faint">{opt.key}</span>
                    </label>
                  </li>
                )
              })}
            </ul>

            <p className="mt-2 text-[11px] text-lf-text-faint" data-testid="bridge-selection-summary">
              已勾选 {selectedCount} 项
              {dirty ? '（有未提交的改动）' : '（与服务端一致）'}
              {card.agreedFieldKeys.length > 0 ? ` · 其中落在双边交集内的有 ${selectedInAgreement} 项` : ''}
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!card.canOptIn || busy}
                aria-disabled={!card.canOptIn || busy}
                data-testid="bridge-optin-submit"
                onClick={data.runOptIn}
                title={card.canOptIn ? '提交我的字段选择' : '服务端未下发可加入（协议已撤销或已过期）'}
                className={[
                  'lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border px-2.5 py-1 text-xs',
                  !card.canOptIn || busy
                    ? 'cursor-not-allowed border-lf-line text-lf-text-faint'
                    : 'border-lf-line-strong text-lf-text hover:bg-lf-surface-2',
                ].join(' ')}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                {card.myOptIn && card.myOptIn.status === 'ACTIVE' ? '更新我的选择' : '加入共享'}
              </button>

              <button
                type="button"
                disabled={!card.canOptOut || busy}
                aria-disabled={!card.canOptOut || busy}
                data-testid="bridge-optout"
                onClick={data.runOptOut}
                title={card.canOptOut ? '退出共享（收窄方向，一律允许）' : '当前没有生效中的加入记录'}
                className={[
                  'lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border px-2.5 py-1 text-xs',
                  !card.canOptOut || busy
                    ? 'cursor-not-allowed border-lf-line text-lf-text-faint'
                    : 'border-lf-line-strong text-lf-text hover:bg-lf-surface-2',
                ].join(' ')}
              >
                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                退出共享
              </button>

              {dirty && (
                <button
                  type="button"
                  data-testid="bridge-selection-reset"
                  onClick={data.resetSelection}
                  className="lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border border-lf-line px-2.5 py-1 text-xs text-lf-text-muted hover:text-lf-text"
                >
                  放弃未提交的改动
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 跨群可见成员体 ──────────────────────────────────────────

function BridgeDiscoveryBody({ discovery }: { discovery: BridgeDiscoveryModel }) {
  return (
    <div className="space-y-3" data-testid="bridge-discovery">
      <div className="flex flex-wrap items-center gap-2 text-xs text-lf-text-muted">
        <span className="rounded-lf border border-lf-line px-1.5 py-0.5">{discovery.statusLabel}</span>
        <span>
          可见{' '}
          <span className="text-lf-text" data-testid="bridge-visible-count">
            {discovery.visibleCount}
          </span>{' '}
          位
        </span>
        <span>
          对方已加入{' '}
          <span className="text-lf-text" data-testid="bridge-optedin-count">
            {discovery.optedInCount}
          </span>{' '}
          位
        </span>
        <span className="text-lf-text-faint">投影档位 {discovery.profileAudienceLabel}</span>
      </div>

      {discovery.bridgeRefusalLabel && (
        <p
          className="rounded-lf border border-lf-line bg-lf-surface p-2 text-xs text-lf-warning"
          data-testid="bridge-discovery-refusal"
        >
          协议层当前不可用：{discovery.bridgeRefusalLabel}。这是正常状态（例如等对方群主批准），不是错误 ——
          协议一旦生效，下面会自动出现成员。
        </p>
      )}

      {discovery.members.length === 0 ? (
        <LivingEmpty text="查询成功，但当前没有对方的成员可见。可能原因：对方无人加入，或对方成员尚未在自己的意图里授权任何字段。下方按原因聚合了人数。" />
      ) : (
        <ul className="space-y-3" data-testid="bridge-members">
          {discovery.members.map((m) => (
            <li
              key={m.userId}
              className="min-w-0 rounded-lf border border-lf-line bg-lf-surface p-3"
              data-testid={`bridge-member-${m.userId}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all text-xs text-lf-text-faint">成员 {m.userId}</span>
                <span className="text-[11px] text-lf-text-faint">加入于 {m.optedInAt.slice(0, 10)}</span>
              </div>
              {m.fields.length === 0 ? (
                <p className="mt-2 text-xs text-lf-text-muted">
                  该成员已加入，但当前没有可显示的字段值（交集内的字段在他的档案里是空的）。
                </p>
              ) : (
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  {m.fields.map((f) => (
                    <div key={f.key} className="min-w-0">
                      <dt className="text-[11px] text-lf-text-faint">{f.label}</dt>
                      <dd className="break-words text-xs text-lf-text" data-testid={`bridge-field-${f.key}`}>
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-1.5 break-words text-[11px] text-lf-text-faint">
                可见字段：{m.sharedFieldKeys.length > 0 ? m.sharedFieldKeys.join('、') : '（无）'}
              </p>
            </li>
          ))}
        </ul>
      )}

      {discovery.gatedOut.length > 0 && (
        <div className="rounded-lf border border-lf-line bg-lf-surface p-3" data-testid="bridge-gated-out">
          <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
            已加入但当前不可见的人数（按原因聚合）
          </h3>
          <ul className="mt-1.5 space-y-1 text-xs text-lf-text-muted">
            {discovery.gatedOut.map((g) => (
              <li key={g.code}>
                {g.label}：<span className="text-lf-text">{g.count}</span> 位
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-lf-text-faint">
            这里只有计数 —— 逐字段的归因属于对方组织的内部配置，只在该成员自己的视图里可见。
          </p>
        </div>
      )}

      <LivingNotes notes={discovery.notes} title="跨群投影说明" />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// 详情面板（inspector）
// ═══════════════════════════════════════════════════════════

export function BridgeInspector({ data }: { data: BridgePanelData }) {
  const detail = data.detail
  const discovery = data.discovery
  const list = data.list

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          Bridge Lens · 跨群授权全景
        </h3>
        {!detail ? (
          <p className="mt-2 text-xs text-lf-text-muted">选定一份协议后显示。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-lf-text-muted">
            <li>
              协议总数 <span className="text-lf-text">{list?.total ?? '—'}</span> · 本页取回{' '}
              <span className="text-lf-text">{list?.cards.length ?? '—'}</span> 份
            </li>
            <li>
              双边交集 <span className="text-lf-text">{detail.card.agreedFieldKeys.length}</span> 项
            </li>
            <li>
              我方可选范围 <span className="text-lf-text">{detail.card.myAllowedFieldKeys.length}</span> 项
            </li>
            <li>
              我当前被看到 <span className="text-lf-text">{detail.mySharedFieldKeys.length}</span> 项
            </li>
            <li>
              我被收窄 <span className="text-lf-text">{detail.narrowed.length}</span> 项
            </li>
            <li>
              我的加入状态{' '}
              <span className="text-lf-text">
                {detail.card.myOptIn ? detail.card.myOptIn.statusLabel : '未加入'}
              </span>
            </li>
          </ul>
        )}
        <p className="mt-2 text-[11px] text-lf-text-faint">
          以上数字直接取自服务端下发的字段列表长度，前端没有重新计算。
        </p>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">对方的可见成员</h3>
        {!discovery ? (
          <p className="mt-2 text-xs text-lf-text-muted">选定一份协议后显示。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-lf-text-muted">
            <li>
              可见 <span className="text-lf-text">{discovery.visibleCount}</span> 位 · 对方已加入{' '}
              <span className="text-lf-text">{discovery.optedInCount}</span> 位
            </li>
            {discovery.gatedOut.map((g) => (
              <li key={g.code}>
                {g.label} <span className="text-lf-text">{g.count}</span> 位
              </li>
            ))}
            {discovery.gatedOut.length === 0 && <li>没有「已加入但不可见」的成员。</li>}
          </ul>
        )}
      </section>

      {detail && (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
            被收窄的字段（该找谁）
          </h3>
          {detail.narrowed.length === 0 ? (
            <p className="mt-2 text-xs text-lf-text-muted">
              没有被收窄的字段 —— 交集内的字段你都已经授权。
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs">
              {detail.narrowed.map((n) => (
                <li key={`${n.key}-${n.reason}`} className="rounded-lf border border-lf-line p-2">
                  <p className="text-lf-text">{n.label}</p>
                  <p className="mt-1 text-lf-text-muted">{n.reasonLabel}</p>
                  <p className="mt-0.5 text-[11px] text-lf-text-faint">归属：{n.ownerLabel}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-lf border border-lf-line bg-lf-surface p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-lf-text-muted">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          三个投影各自的端点
        </h3>
        <ul className="mt-1.5 space-y-1 text-[11px] text-lf-text-faint">
          <li>GET /api/v1/bridges</li>
          <li>GET /api/v1/bridges/{'{bridgeId}'}</li>
          <li>GET /api/v1/bridges/{'{bridgeId}'}/discovery</li>
        </ul>
        <p className="mt-1.5 text-[11px] text-lf-text-faint">
          写操作分别是 approve / revoke / opt-in / opt-out 四个端点；opt-in 的请求体就是勾选框里的字段键。
        </p>
      </section>
    </div>
  )
}
