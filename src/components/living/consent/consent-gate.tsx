'use client'

/**
 * P2 · Consent Gate —— 同意状态与**逐字段披露投影**
 *
 * 依据：`docs/implementation/DESIGN/02-plan.md` §P2「Consent Gate 接
 *       `intents/[id]/disclosure` 的逐字段披露投影」。
 *
 * 🔴 这一页只回答一个问题：**「我授权出去的，到底是谁能看到哪些字段」**。
 *    因此它有两条与本项目其它页不同的呈现纪律：
 *
 *    ① **不重算**。三列可见性、各项计数，全部直接读服务端下发的
 *       `visibleToOrganizer / visibleToCounterparty / visibleToCandidate` 与
 *       各受众分组长度。档位可见性是**包含式**的（越宽的档位覆盖越多受众），
 *       前端自己实现一遍就是第二个真相来源，而它写反时**不会报错** ——
 *       只会让用户看到"授权给组织者的字段，候选也能看到"，
 *       要么泄露视觉证据，要么少显示本该可见的值。
 *
 *    ② **三列并存**而不是"选一个受众看"。因为包含式语义下，同一字段本来就会
 *       同时出现在多列 —— 只给一列会暗示它们互斥。
 *
 * 动作（接受 / 拒绝 / 撤销）**只按服务端下发的 `actions` 渲染** ——
 * 前端不自己判权限（服务端 `withTenant('proposal.decide')` 会重新判一遍）。
 */

import { useMemo, useState } from 'react'
import { GitBranch, ShieldOff, UserCheck } from 'lucide-react'
import {
  CONSENT_EXTERNAL_AUDIENCES,
  CONSENT_EXTERNAL_AUDIENCE_LABELS,
  CONSENT_INTENT_STATUS_LABELS,
  CONSENT_PROPOSAL_ACTION_LABELS,
  actionRequest,
  assembleConsentGate,
  assembleProposalBoard,
  type ConsentExternalAudience,
  type ConsentFieldRow,
  type ConsentGateModel,
  type ConsentIntentStatus,
  type ConsentProposalAction,
  type ConsentProposalBoard,
} from '@/lib/living/consent'
import { useApiGet } from '@/hooks/use-api'
import {
  LivingActionResult,
  LivingErrorBox,
  LivingLoadable,
  LivingLoading,
  LivingNotes,
} from '@/components/living/living-states'
import { useLivingPost, type LivingEnvelope } from '@/components/living/use-living-post'

// ── 服务端响应形状（最小投影：只声明本页真正读取的字段） ──────────────
interface IntentLite {
  id: string
  missionId: string
  need: string
  offer: string
  status: ConsentIntentStatus
}

export interface ConsentGateData {
  intents: IntentLite[]
  intentsLoading: boolean
  intentsError: string | null
  effectiveIntentId: string | null
  gate: ConsentGateModel | null
  gateLoading: boolean
  gateError: string | null
  board: ConsentProposalBoard | null
  boardLoading: boolean
  boardError: string | null
  action: { ok: boolean; message: string | null } | null
  pendingUrl: string | null
  runAction: (proposalId: string, action: ConsentProposalAction) => void
}

/**
 * 取数 + 装配（**一次**，供主视图与详情面板共用）。
 *
 * 单列一个 hook 而不是让两个组件各取一遍：`useApiGet` 虽有缓存，但两个组件各自
 * 取数仍会各发一次请求、各算一遍装配。让 workspace 调用一次再往下传，是唯一
 * "请求数与装配数都为 1"的写法。
 *
 * `enabled=false` 时**完全不发请求**（url 传 null）—— 本页有三个租户域端点，
 * 不在这一区时没必要去打它们（非成员还会拿到 403 噪音）。
 */
export function useConsentGateData(intentId: string | null, enabled = true): ConsentGateData {
  const intentsRes = useApiGet<LivingEnvelope<IntentLite[]>>(enabled ? '/api/v1/intents' : null)
  const proposalsRes = useApiGet<LivingEnvelope<{ proposals: unknown[] }>>(
    enabled ? '/api/v1/connections/proposals' : null,
  )

  const intents = useMemo<IntentLite[]>(
    () => (Array.isArray(intentsRes.data?.data) ? intentsRes.data.data : []),
    [intentsRes.data],
  )
  // 未选时**默认取第一条**（而不是取 null 什么都不显示）：用户进这一页最可能想看的就是
  // 最近那条意图的披露情况。
  const effectiveIntentId = intentId ?? intents[0]?.id ?? null

  const disclosureRes = useApiGet<LivingEnvelope<unknown>>(
    enabled && effectiveIntentId
      ? `/api/v1/intents/${encodeURIComponent(effectiveIntentId)}/disclosure`
      : null,
  )

  const gateOutcome = useMemo(() => {
    const payload = disclosureRes.data?.data
    if (payload === undefined || payload === null) return null
    return assembleConsentGate(payload)
  }, [disclosureRes.data])

  const gate = gateOutcome?.ok ? gateOutcome.value : null
  const gateError =
    disclosureRes.error ?? (gateOutcome && !gateOutcome.ok ? gateOutcome.error : null)

  const boardOutcome = useMemo(() => {
    const payload = proposalsRes.data?.data?.proposals
    if (payload === undefined || payload === null) return null
    return assembleProposalBoard(payload)
  }, [proposalsRes.data])

  const board = boardOutcome?.ok ? boardOutcome.value : null
  const boardError =
    proposalsRes.error ?? (boardOutcome && !boardOutcome.ok ? boardOutcome.error : null)

  const { run, pendingUrl } = useLivingPost()
  const [action, setAction] = useState<{ ok: boolean; message: string | null } | null>(null)

  const runAction = (proposalId: string, proposalAction: ConsentProposalAction) => {
    const req = actionRequest(proposalId, proposalAction)
    void run(req.url, req.body).then((res) => {
      setAction({ ok: res.ok, message: res.message })
      if (res.ok) {
        // 表态成功 ⇒ 提案状态与披露投影都可能变（对侧同意后档位会升级）。
        proposalsRes.refetch()
        disclosureRes.refetch()
      }
    })
  }

  return {
    intents,
    intentsLoading: intentsRes.isLoading,
    intentsError: intentsRes.error,
    effectiveIntentId,
    gate,
    gateLoading: disclosureRes.isLoading,
    gateError,
    board,
    boardLoading: proposalsRes.isLoading,
    boardError,
    action,
    pendingUrl,
    runAction,
  }
}

// ═══════════════════════════════════════════════════════════
// 主视图
// ═══════════════════════════════════════════════════════════

export interface ConsentGateProps {
  data: ConsentGateData
  onSelectIntent: (intentId: string) => void
  selectedFieldKey: string | null
  onSelectField: (key: string | null) => void
}

export default function ConsentGate({
  data,
  onSelectIntent,
  selectedFieldKey,
  onSelectField,
}: ConsentGateProps) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Consent Gate · 同意与逐字段披露</h1>
        <p className="mt-1 max-w-3xl text-sm text-lf-text-muted">
          这一页回答一个具体问题：
          <strong className="font-medium text-lf-text">我授权出去的字段，到底是谁能看到</strong>。
          档位是<strong className="font-medium text-lf-text">包含式</strong>的 —— 越宽的档位覆盖越多受众，
          所以同一字段在下面三列里可能同时出现，那不是重复，是语义本身。
        </p>
      </header>

      {/* ── ① 我的意图 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-lf-text-muted">选择一条意图</h2>
        <LivingLoadable
          isLoading={data.intentsLoading}
          error={data.intentsError}
          empty={data.intents.length === 0}
          emptyText="你还没有提交过任何意图。意图需要先在任务里加入，然后提交「我需要什么 / 我能提供什么」。这里不会凭空生成一条。"
        >
          <ul className="flex flex-wrap gap-2">
            {data.intents.map((it) => {
              const active = it.id === data.effectiveIntentId
              return (
                <li key={it.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectIntent(it.id)}
                    className={[
                      'lf-focus-ring max-w-full truncate rounded-lf border px-2.5 py-1.5 text-left text-xs',
                      active
                        ? 'border-lf-signal bg-lf-signal-soft text-lf-signal'
                        : 'border-lf-line text-lf-text-muted hover:text-lf-text',
                    ].join(' ')}
                  >
                    <span className="font-medium">{CONSENT_INTENT_STATUS_LABELS[it.status]}</span>
                    <span className="ml-1.5 text-lf-text-faint">{it.need.slice(0, 24)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </LivingLoadable>
      </section>

      {/* ── ② 逐字段披露投影 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-lf-text-muted">逐字段披露投影</h2>
        {data.gateLoading ? (
          <LivingLoading label="正在读取披露投影…" />
        ) : data.gateError ? (
          <LivingErrorBox message={data.gateError} hint="披露投影端点只返回本人的意图。" />
        ) : data.gate ? (
          <>
            <p className="text-xs text-lf-text-faint">
              点击字段名可在右侧查看它在三个受众下的对比。共 {data.gate.rows.length} 个字段 ·
              当前状态 {data.gate.statusLabel}
            </p>
            <div className="overflow-x-auto rounded-lf border border-lf-line">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <caption className="sr-only">
                  逐字段披露投影：每个字段的授权档位，以及三个受众实际能看到的值
                </caption>
                <thead>
                  <tr className="bg-lf-surface-2 text-left text-[11px] uppercase tracking-wide text-lf-text-muted">
                    <th scope="col" className="px-3 py-2 font-medium">字段</th>
                    <th scope="col" className="px-3 py-2 font-medium">你的档位</th>
                    {CONSENT_EXTERNAL_AUDIENCES.map((a) => (
                      <th key={a} scope="col" className="px-3 py-2 font-medium">
                        {CONSENT_EXTERNAL_AUDIENCE_LABELS[a]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.gate.rows.map((row) => (
                    <FieldRow
                      key={row.key}
                      row={row}
                      selected={row.key === selectedFieldKey}
                      onSelect={onSelectField}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <LivingNotes notes={data.gate.notes} title="披露投影说明" />
          </>
        ) : (
          <LivingEmptyForGate />
        )}
      </section>

      {/* ── ③ 与我相关的提案 + 动作 ── */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-lf-text-muted">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          与我相关的连接提案
        </h2>
        <LivingLoadable
          isLoading={data.boardLoading}
          error={data.boardError}
          empty={(data.board?.rows.length ?? 0) === 0}
          emptyText="当前没有与你相关的连接提案。这是查询成功后的结论，不是读取失败。"
        >
          <ul className="space-y-3">
            {(data.board?.rows ?? []).map((p) => (
              <li key={p.id} className="min-w-0 rounded-lf border border-lf-line bg-lf-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lf border border-lf-line px-1.5 py-0.5 text-[11px]">
                    {p.stateLabel}
                  </span>
                  <span className="text-[11px] text-lf-text-muted">{p.myRoleLabel}</span>
                  <span className="text-[11px] text-lf-text-muted">我的表态：{p.myDecisionLabel}</span>
                  <span className="text-[11px] text-lf-text-muted">
                    对方表态：{p.counterpartDecisionLabel}
                  </span>
                </div>
                <p className="mt-2 break-words text-xs text-lf-text-muted">提案理由：{p.rationale}</p>
                <p className="mt-1 break-words text-[11px] text-lf-text-faint">
                  对方在此阶段披露的字段：
                  {p.counterpartFieldKeys.length === 0
                    ? '（无 —— 对方尚未授权任何字段；这不是读取失败）'
                    : p.counterpartFieldKeys.join('、')}
                </p>
                {p.introducedAt && (
                  <p className="mt-1 text-[11px] text-lf-text-faint">
                    已介绍于 {p.introducedAt.slice(0, 10)}
                    {p.canIntroduce ? ' · 服务端判定当前仍可介绍' : ''}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  {p.availableActions.length === 0 ? (
                    <span className="text-[11px] text-lf-text-faint">
                      当前状态下服务端未下发任何可执行动作（例如已介绍 / 已过期）。
                    </span>
                  ) : (
                    p.availableActions.map((a) => {
                      const isPending = data.pendingUrl === actionRequest(p.id, a).url
                      return (
                        <button
                          key={a}
                          type="button"
                          disabled={isPending}
                          aria-disabled={isPending}
                          onClick={() => data.runAction(p.id, a)}
                          className={[
                            'lf-focus-ring inline-flex items-center gap-1.5 rounded-lf border px-2.5 py-1 text-xs',
                            isPending
                              ? 'cursor-wait border-lf-line text-lf-text-faint'
                              : 'border-lf-line-strong text-lf-text hover:bg-lf-surface-2',
                          ].join(' ')}
                        >
                          {a === 'ACCEPT' ? (
                            <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {CONSENT_PROPOSAL_ACTION_LABELS[a]}
                        </button>
                      )
                    })
                  )}
                </div>
              </li>
            ))}
          </ul>
        </LivingLoadable>

        {data.action && (
          <LivingActionResult
            ok={data.action.ok}
            message={data.action.message}
            successText="表态已提交。状态以服务端返回为准 —— 单方接受不会进入执行，需要双方都表态。"
          />
        )}
        <LivingNotes notes={data.board?.notes ?? []} title="提案说明" />
      </section>
    </div>
  )
}

/** 表格里的一行。字段名是 `<button>`（键盘可达 + 可聚焦），其余单元格是只读投影。 */
function FieldRow({
  row,
  selected,
  onSelect,
}: {
  row: ConsentFieldRow
  selected: boolean
  onSelect: (key: string | null) => void
}) {
  return (
    <tr className={['border-t border-lf-line', selected ? 'bg-lf-signal-soft' : ''].join(' ')}>
      <th scope="row" className="px-3 py-2 text-left align-top font-normal">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(selected ? null : row.key)}
          className="lf-focus-ring rounded-lf text-left text-sm text-lf-text"
        >
          {row.label}
          {row.sensitive && (
            <span className="ml-1.5 text-[10px] text-lf-warning" title="服务端标记为敏感字段">
              敏感
            </span>
          )}
        </button>
        <span className="mt-0.5 block text-[10px] text-lf-text-faint">{row.key}</span>
      </th>
      <td className="px-3 py-2 align-top text-xs text-lf-text-muted">
        {row.protectedFromDisclosure ? '不可授权' : row.audienceLabel}
      </td>
      {CONSENT_EXTERNAL_AUDIENCES.map((a) => (
        <td key={a} className="px-3 py-2 align-top text-xs">
          {row.values[a] === null ? (
            <span className="text-lf-text-faint">
              {row.protectedFromDisclosure ? '联系方式走同意流程' : '未披露'}
            </span>
          ) : (
            <span className="break-all text-lf-text">{row.values[a]}</span>
          )}
        </td>
      ))}
    </tr>
  )
}

function LivingEmptyForGate() {
  return (
    <div className="rounded-lf border border-dashed border-lf-line p-4 text-sm text-lf-text-muted">
      选定一条意图后显示披露投影。若你还没有意图，需要先加入任务并在任务里提交意图。
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// 详情面板
// ═══════════════════════════════════════════════════════════

export function ConsentInspector({
  data,
  selectedFieldKey,
}: {
  data: ConsentGateData
  selectedFieldKey: string | null
}) {
  // ⚠️ 提到 const：`data.gate` 是**属性访问**，TS 的控制流收窄在**回调内部会失效**
  //    （回调何时执行不可知，属性可能已被改写）⇒ 若在 `.map()` 里写 `data.gate.x`，
  //    会报 `possibly null`。提成 const 后，收窄对闭包持续有效。
  const gate = data.gate
  const row = gate?.rows.find((r) => r.key === selectedFieldKey) ?? null

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          Disclosure Lens · 谁能看到什么
        </h3>
        {!gate ? (
          <p className="mt-2 text-xs text-lf-text-muted">选定一条意图后显示。</p>
        ) : (
          <>
            <p className="mt-2 break-all text-xs text-lf-text-muted">
              意图 <span className="text-lf-text">{gate.intentId}</span> · {gate.statusLabel}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-lf-text-muted">
              {CONSENT_EXTERNAL_AUDIENCES.map((a) => (
                <li key={a}>
                  {CONSENT_EXTERNAL_AUDIENCE_LABELS[a]} 可见{' '}
                  <span className="text-lf-text">
                    {
                      {
                        ORGANIZER: gate.totals.disclosedToOrganizer,
                        COUNTERPARTY: gate.totals.disclosedToCounterparty,
                        CANDIDATE: gate.totals.disclosedToCandidate,
                      }[a]
                    }
                  </span>{' '}
                  项
                </li>
              ))}
              <li>
                仅自己（不披露）<span className="text-lf-text">{gate.totals.withheld}</span> 项
              </li>
              <li>
                结构性不可授权
                <span className="text-lf-text"> {gate.totals.protectedFields}</span> 项
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-lf-text-faint">
              以上数字直接取自服务端下发的字段列表长度，前端没有重新计算。
            </p>
          </>
        )}
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          字段对比
        </h3>
        {!row ? (
          <p className="mt-2 text-xs text-lf-text-muted">
            点击表格里的某个字段名，这里显示它在三个受众下的对比。
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-sm font-medium text-lf-text">{row.label}</p>
            <p className="break-all text-[11px] text-lf-text-faint">{row.key}</p>
            <dl className="space-y-2 text-xs">
              <div className="min-w-0">
                <dt className="text-[11px] text-lf-text-faint">你的档位</dt>
                <dd className="text-lf-text">{row.audienceLabel}</dd>
              </div>
              {row.protectedFromDisclosure && (
                <div className="min-w-0">
                  <dt className="text-[11px] text-lf-text-faint">说明</dt>
                  <dd className="text-lf-text-muted">
                    联系方式类字段不通过逐字段开关披露 —— 它们只能走同意流程交换。
                  </dd>
                </div>
              )}
              {CONSENT_EXTERNAL_AUDIENCES.map((a: ConsentExternalAudience) => (
                <div key={a} className="min-w-0">
                  <dt className="text-[11px] text-lf-text-faint">
                    {CONSENT_EXTERNAL_AUDIENCE_LABELS[a]}
                  </dt>
                  <dd className="break-words text-lf-text">
                    {row.values[a] === null ? (
                      <span className="text-lf-text-faint">看不到（未授权或该字段无值）</span>
                    ) : (
                      row.values[a]
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-[11px] text-lf-text-faint">
              值来自服务端投影（对真实档案裁剪后的结果），不是前端按档位推算出来的。
            </p>
          </div>
        )}
      </section>

      <LivingNotes notes={gate?.notes ?? []} title="披露投影说明" />
    </div>
  )
}
