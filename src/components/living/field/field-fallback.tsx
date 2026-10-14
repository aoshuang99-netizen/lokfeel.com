'use client'

/**
 * P2 · Field —— **列表视图**（同时是 <1024px 的默认形态与画布库失败时的兜底）
 *
 * 为什么它不是一个"看不了图时的妥协"：
 *   1. 阻断标准 #13 要求 360px 宽度无横向溢出 —— 径向网络图在小屏上必然挤成一团，
 *      所以窄屏**默认就是列表**，不是"图挂了才降级"。
 *   2. 阻断标准 #14 要求键盘操作与可见焦点。xyflow 的画布对读屏器不友好，
 *      列表是**完全可达**的那一份表达。
 *   3. 画布库（`@xyflow/react`）是运行期动态加载的。它加载失败时（chunk 404、
 *      CSP 拦截、旧浏览器），**Field 依然可用** —— 与 P3 首页 3D 的纪律同源
 *      （阻断标准 #12：「3D 挂了首页仍可用」）。
 *
 * 数据与图**同源**：两边都消费同一个 `FieldGraph`（`src/lib/living/field/graph.ts`），
 * 因此不存在"列表和图说的不一样"这种漂移。
 *
 * ⚠️ 展示一律走**文案表**而不是原始码：`CONSENT_PENDING` / `PENDING_CONSENT`
 *    是给程序看的取值，直接秀给用户等于把实现细节当界面语言。
 */

import { AlertTriangle, CircleSlash, GitBranch, Users } from 'lucide-react'
import {
  FIELD_BUCKET_LABELS,
  FIELD_PROPOSAL_STATE_LABELS,
  type FieldGraph,
} from '@/lib/living/field'

export interface FieldListViewProps {
  graph: FieldGraph
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export default function FieldListView({ graph, selectedId, onSelect }: FieldListViewProps) {
  const viewer = graph.nodes.find((n) => n.kind === 'viewer') ?? null
  const candidates = graph.nodes.filter((n) => n.kind === 'candidate')
  const proposals = graph.nodes.filter((n) => n.kind === 'proposal')

  return (
    <div className="min-w-0 space-y-4">
      {viewer && (
        <section className="rounded-lf-lg border border-lf-line-strong bg-lf-surface-2 p-3">
          <p className="text-xs text-lf-text-faint">网络中心</p>
          <p className="mt-0.5 truncate text-sm font-medium text-lf-text">{viewer.label}</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          候选（{candidates.length}）
        </h3>

        {candidates.length === 0 ? (
          <p className="rounded-lf border border-lf-line p-3 text-xs text-lf-text-muted">
            图中没有候选节点 —— 具体原因见下方「说明」（本页不会把「读不到」写成「暂时没有人」）。
          </p>
        ) : (
          <ul className="space-y-2">
            {candidates.map((n) => {
              const d = n.detail
              const selected = n.id === selectedId
              const edge = graph.edges.find((e) => e.target === n.id && e.kind === 'reciprocal')
              return (
                <li key={n.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelect(selected ? null : n.id)}
                    aria-pressed={selected}
                    className={[
                      'lf-focus-ring w-full min-w-0 rounded-lf border p-3 text-left transition-colors',
                      selected ? 'border-lf-signal bg-lf-signal-soft' : 'border-lf-line bg-lf-surface hover:border-lf-line-strong',
                    ].join(' ')}
                  >
                    <p className="truncate text-sm font-medium text-lf-text">{n.label}</p>
                    <p className="mt-0.5 text-[11px] text-lf-text-faint">
                      双向命中 {d?.matchedTokens ?? 0} 个词元
                      {d && !d.named ? ' · 未授权姓名' : ''}
                    </p>
                    {edge && <p className="mt-1 truncate text-[11px] text-lf-text-muted">{edge.label}</p>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-lf-text-muted">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          提案（{proposals.length}）
        </h3>

        {proposals.length === 0 ? (
          <p className="rounded-lf border border-lf-line p-3 text-xs text-lf-text-muted">
            图中没有提案节点 —— 原因见下方「说明」。
          </p>
        ) : (
          <ul className="space-y-2">
            {proposals.map((n) => {
              const p = n.proposal
              const selected = n.id === selectedId
              return (
                <li key={n.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelect(selected ? null : n.id)}
                    aria-pressed={selected}
                    className={[
                      'lf-focus-ring w-full min-w-0 rounded-lf border p-3 text-left transition-colors',
                      selected ? 'border-lf-signal bg-lf-signal-soft' : 'border-lf-line bg-lf-surface hover:border-lf-line-strong',
                    ].join(' ')}
                  >
                    <p className="truncate text-sm font-medium text-lf-text">{n.label}</p>
                    <p className="mt-0.5 text-[11px] text-lf-text-faint">
                      {p
                        ? `${FIELD_PROPOSAL_STATE_LABELS[p.state] ?? p.state} · ${FIELD_BUCKET_LABELS[p.bucket] ?? p.bucket}`
                        : '—'}
                    </p>
                    {p && p.blockers.length > 0 && (
                      <p className="mt-1 flex items-start gap-1 text-[11px] text-lf-warning">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words">
                          尚不可介绍：{p.blockers.map((b) => b.label).join('、')}
                        </span>
                      </p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {graph.notes.length > 0 && (
        <section className="space-y-1 rounded-lf border border-lf-line bg-lf-surface p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-lf-text-muted">
            <CircleSlash className="h-3.5 w-3.5" aria-hidden="true" />
            说明（先说清楚，再让用户看图）
          </h3>
          <ul className="space-y-1 text-[11px] text-lf-text-muted">
            {graph.notes.map((note) => (
              <li key={note} className="break-words">
                · {note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
