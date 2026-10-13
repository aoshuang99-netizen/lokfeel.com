'use client'

/**
 * T08 · Console — 成果屏
 *
 * 数据源：
 *   - `GET /api/v1/outcomes`（能力 `outcome.read`，**全员**）—— 成果列表与验证级别
 *   - `GET /api/v1/connections/proposals?states=MUTUALLY_ACCEPTED`（自助）——
 *     找"我参与、已介绍、尚未上报成果"的连接，作为**上报入口**的数据面。
 *     （没有它，"上报成果"就得让用户手填 proposalId —— 那是个假入口。）
 *
 * 🔴 AC-15「自报不算验证成功」在界面上的落点：
 *   1. 徽章文案与颜色由服务端下发的 **`verified`** 派生，本屏**不自己比较级别字面量**
 *      （`SELF_REPORTED` 永远显示为"仅自报"，永远不会显示成绿色"已验证"）。
 *   2. 「确认成果」按钮**只在 `canConfirm === true` 时渲染** —— 该字段由服务端按
 *      「我是对手方 且 尚未确认」算出，所以不存在"点了必然 400（自我确认）/403（第三方）"的按钮。
 *      不可确认时**不渲染禁用按钮**，而是在角色标签上说明原因。
 *   3. 「核验」按钮只在 `canVerify === true`（服务端按 `outcome.verify` 能力算）时渲染。
 *
 * 幂等口径：确认/核验重复提交**不报错**（服务端回放），所以界面不做"防重复点击的假状态"，
 * 只在提交期间禁用当条按钮。
 */

import { useMemo, useState } from 'react'
import { BadgeCheck, RefreshCw, Send } from 'lucide-react'
import { useApiGet, useApiPost } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

interface OutcomeDto {
  id: string
  missionId: string
  proposalId: string
  summary: string
  verificationLevel: string
  /** 服务端派生（`isVerified`）。本屏只读它，不比较 `verificationLevel` 字面量。 */
  verified: boolean
  occurredAt: string
  reportedAt: string
  myRole: 'REPORTER' | 'COUNTERPARTY' | 'OBSERVER'
  canConfirm: boolean
  canVerify: boolean
  verifications: Array<{ level: string; at: string }>
}

interface OutcomeListDto {
  items: OutcomeDto[]
  count: number
  /** 仅自报（未被确认）的条数。 */
  unverifiedCount: number
}

interface ProposalDto {
  id: string
  missionId: string
  state: string
  introducedAt: string | null
}

type Filter = 'ALL' | 'SELF_REPORTED' | 'VERIFIED'

const FILTER_TABS: ReadonlyArray<{ value: Filter; label: string; hint: string }> = [
  { value: 'ALL', label: '全部', hint: '本社群全部成果' },
  { value: 'SELF_REPORTED', label: '仅自报', hint: '已上报但尚未被确认或核验' },
  { value: 'VERIFIED', label: '已验证', hint: '对手方已确认，或外部已核验' },
]

const LEVEL_BADGE: Record<string, string> = {
  SELF_REPORTED: 'bg-background-tertiary text-foreground-muted',
  COUNTERPARTY_CONFIRMED: 'bg-primary/15 text-primary',
  EXTERNALLY_VERIFIED: 'bg-success/15 text-success',
}

const LEVEL_LABEL: Record<string, string> = {
  SELF_REPORTED: '仅自报',
  COUNTERPARTY_CONFIRMED: '对手方已确认',
  EXTERNALLY_VERIFIED: '外部已核验',
}

const ROLE_LABEL: Record<string, string> = {
  REPORTER: '我上报的',
  COUNTERPARTY: '与我有关·待我确认',
  OBSERVER: '',
}

export default function ConsoleOutcomesPage() {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [reportFor, setReportFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const url = useMemo(() => {
    const p = new URLSearchParams({ limit: '50' })
    if (filter === 'SELF_REPORTED') p.set('level', 'SELF_REPORTED')
    if (filter === 'VERIFIED') p.set('verified', '1')
    return `/api/v1/outcomes?${p.toString()}`
  }, [filter])

  const outcomes = useApiGet<ApiEnvelope<OutcomeListDto>>(url)
  const mine = useApiGet<ApiEnvelope<{ proposals: ProposalDto[] }>>(
    '/api/v1/connections/proposals?states=MUTUALLY_ACCEPTED&limit=50'
  )
  const { post, isLoading: isActing, error: actionError } = useApiPost()
  const [actingId, setActingId] = useState<string | null>(null)

  const data = outcomes.data?.data
  // `?? []` 每次 render 都会造一个新数组 —— 必须包进 useMemo，否则下面依赖 `items`
  // 的 useMemo 会每帧失效（`react-hooks/exhaustive-deps` 抓的正是这个）。
  const items = useMemo(() => data?.items ?? [], [data])
  const reportedIds = useMemo(() => new Set(items.map((o) => o.proposalId)), [items])

  // 上报入口：我参与、已介绍、且尚无成果记录的连接。
  const reportable = useMemo(() => {
    const proposals = mine.data?.data?.proposals ?? []
    return proposals.filter((p) => p.introducedAt !== null && !reportedIds.has(p.id))
  }, [mine.data, reportedIds])

  const act = async (path: string, body?: unknown) => {
    setActingId(path)
    const res = await post(path, body)
    setActingId(null)
    if (res) {
      outcomes.refetch()
      setReportFor(null)
      setDraft('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground font-display">成果</h1>
          <p className="text-xs text-foreground-muted mt-0.5">
            连接产生了什么 —— 以及它**被验证到什么程度**。自报不等于验证成功。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            outcomes.refetch()
            mine.refetch()
          }}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${outcomes.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── 上报入口：只列"真的可以上报"的连接（避免假入口） ── */}
      {reportable.length > 0 ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <Send className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium text-foreground">
              有 {reportable.length} 条已建立的连接还没有成果记录
            </p>
          </div>
          <ul className="space-y-2">
            {reportable.map((p) => (
              <li key={p.id} className="text-xs text-foreground-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    介绍于{' '}
                    {p.introducedAt ? new Date(p.introducedAt).toLocaleDateString() : '（未知）'}
                  </span>
                  {reportFor === p.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReportFor(null)
                        setDraft('')
                      }}
                      className="px-2 py-1 rounded-lg border border-card-border hover:text-foreground hover:bg-background-tertiary transition-colors"
                    >
                      取消
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setReportFor(p.id)
                        setDraft('')
                      }}
                      className="px-2 py-1 rounded-lg bg-primary/15 text-primary hover:opacity-90 transition-colors"
                    >
                      上报成果
                    </button>
                  )}
                </div>
                {reportFor === p.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="这次连接产生了什么成果？（至少 8 个字；上报本身**不算**验证成功）"
                      className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isActing || draft.trim().length < 8}
                        onClick={() => act('/api/v1/outcomes', { proposalId: p.id, summary: draft.trim() })}
                        className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isActing ? '提交中…' : '提交上报'}
                      </button>
                      <span className="text-[11px] text-foreground-subtle">
                        提交后状态是「仅自报」—— 需要对手方确认才算验证成功。
                      </span>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── 过滤 ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            title={t.hint}
            onClick={() => setFilter(t.value)}
            aria-pressed={filter === t.value}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              filter === t.value
                ? 'bg-primary/15 text-primary font-medium'
                : 'border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
            }`}
          >
            {t.label}
            {t.value === 'SELF_REPORTED' && typeof data?.unverifiedCount === 'number' ? (
              <span className="ml-1 opacity-70">{data.unverifiedCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {outcomes.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
          <RefreshCw className="w-4 h-4 animate-spin" />
          正在读取成果…
        </div>
      ) : outcomes.error ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <p className="text-sm text-warning mb-1">
            {/permission|403/i.test(outcomes.error) ? '权限不足' : '读不到成果列表'}
          </p>
          <p className="text-sm text-foreground-muted">
            {/permission|403/i.test(outcomes.error)
              ? '查看成果需要成员身份。你在本社群的角色不够 —— 这不是错误，而是权限边界。'
              : outcomes.error}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <div className="flex items-center gap-2 text-foreground-muted mb-2">
            <BadgeCheck className="w-4 h-4" />
            <p className="text-sm font-medium text-foreground">
              {filter === 'ALL'
                ? '本社群还没有成果记录'
                : filter === 'VERIFIED'
                  ? '还没有已验证的成果'
                  : '没有仅自报的成果'}
            </p>
          </div>
          <p className="text-sm text-foreground-muted">
            {filter === 'ALL'
              ? '连接被介绍之后，参与方可以在这里上报成果；对手方确认或运营核验后，才算「已验证」。'
              : filter === 'VERIFIED'
                ? '等对手方确认，或由管理员做外部核验。'
                : '这里的成果都已经被确认或核验过了。'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-card-border bg-background-secondary p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    LEVEL_BADGE[row.verificationLevel] ?? 'bg-background-tertiary text-foreground-muted'
                  }`}
                >
                  {LEVEL_LABEL[row.verificationLevel] ?? row.verificationLevel}
                </span>
                {ROLE_LABEL[row.myRole] ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-subtle">
                    {ROLE_LABEL[row.myRole]}
                  </span>
                ) : null}
                <span className="text-[11px] text-foreground-subtle">
                  发生于 {new Date(row.occurredAt).toLocaleDateString()}
                  {row.reportedAt !== row.occurredAt
                    ? ` · 上报于 ${new Date(row.reportedAt).toLocaleDateString()}`
                    : ''}
                </span>
              </div>

              <p className="mt-1.5 text-sm text-foreground whitespace-pre-wrap break-words">
                {row.summary}
              </p>

              {row.verifications.length > 0 ? (
                <p className="mt-1 text-[11px] text-foreground-subtle">
                  验证轨迹：
                  {row.verifications
                    .map(
                      (v) =>
                        `${LEVEL_LABEL[v.level] ?? v.level}（${new Date(v.at).toLocaleDateString()}）`
                    )
                    .join(' → ')}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-warning">
                  尚未收到任何确认 —— 自报**不算**验证成功。
                </p>
              )}

              {/* ── 动作：由服务端算好的 canConfirm / canVerify 派生（AC-18 无空按钮） ── */}
              {row.canConfirm || row.canVerify ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {row.canConfirm ? (
                    <button
                      type="button"
                      disabled={isActing && actingId === `/api/v1/outcomes/${row.id}/confirm`}
                      onClick={() => act(`/api/v1/outcomes/${row.id}/confirm`, {})}
                      className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isActing && actingId === `/api/v1/outcomes/${row.id}/confirm`
                        ? '确认中…'
                        : '确认成果（对手方）'}
                    </button>
                  ) : null}
                  {row.canVerify ? (
                    <button
                      type="button"
                      disabled={isActing && actingId === `/api/v1/outcomes/${row.id}/verify`}
                      onClick={() => act(`/api/v1/outcomes/${row.id}/verify`, {})}
                      className="px-3 py-1.5 rounded-lg text-xs border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isActing && actingId === `/api/v1/outcomes/${row.id}/verify`
                        ? '核验中…'
                        : '外部核验'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {actionError ? <p className="text-xs text-danger">操作失败：{actionError}</p> : null}

      {/* ── 口径声明 ── */}
      {!outcomes.isLoading && !outcomes.error ? (
        <p className="text-[11px] text-foreground-subtle">
          验证级别三级：**仅自报**（上报即得，不算验证成功）→ **对手方已确认** → **外部已核验**。
          级别由验证记录派生，**不能**由客户端直接设置。本屏只列最近 {items.length} 条。
        </p>
      ) : null}
    </div>
  )
}
