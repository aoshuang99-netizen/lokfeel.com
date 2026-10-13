'use client'

/**
 * Living Connection OS · P1 —— 节点白名单渲染器
 *
 * 🔴 这是「模型不得直接产 HTML/React」这条纪律的**收口处**：
 *   `WorkspaceSpec` 只是数据，**唯一**的渲染路径就是本文件的 `switch`。
 *   新增一种节点类型必须**同时**改三处（编译器/契约/本渲染器），无法绕过。
 *
 * 纪律：
 *   - 绝不用 `dangerouslySetInnerHTML` / `eval` —— spec 里的文本一律当**文本**渲染。
 *   - 未知类型 → 渲染"已阻止"提示（防御性兜底），而不是忽略（忽略会让"少渲染"看起来像"渲染成功"）。
 *   - 空数据 → 真实空态，**不补默认内容**（AC-13）。
 *   - 每个 `<button>` 都必须有 `onClick` 或 `disabled`（R2 门禁）。
 */

import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { WorkspaceNode } from '@/lib/workspace-spec'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-lf-text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-lf-text">{children}</dd>
    </div>
  )
}

/** 空态：说清"为什么空"以及"怎么才会有内容"。 */
function NodeEmpty({ text }: { text: string }) {
  return (
    <p className="rounded-lf border border-dashed border-lf-line p-3 text-xs text-lf-text-muted">{text}</p>
  )
}

export interface NodeCardProps {
  node: WorkspaceNode
  collapsed: boolean
  onToggleCollapse: (id: string) => void
  onFocusNode: (id: string) => void
  focused: boolean
}

export default function NodeCard({ node, collapsed, onToggleCollapse, onFocusNode, focused }: NodeCardProps) {
  const body = renderBody(node)

  return (
    <article
      aria-label={node.title}
      data-node-id={node.id}
      data-node-type={node.type}
      className={[
        'flex min-w-0 flex-col rounded-lf border bg-lf-surface',
        focused ? 'border-lf-signal' : 'border-lf-line',
      ].join(' ')}
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-lf-line px-3 py-2">
        <button
          type="button"
          onClick={() => onToggleCollapse(node.id)}
          aria-expanded={!collapsed}
          className="lf-focus-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-lf text-left"
          title={collapsed ? '展开节点' : '收起节点'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-lf-text-muted" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-lf-text-muted" aria-hidden="true" />
          )}
          <span className="truncate text-sm font-medium">{node.title}</span>
          <span className="ml-1 shrink-0 rounded-lf border border-lf-line px-1.5 py-0.5 text-[10px] text-lf-text-faint">
            {node.type}
          </span>
        </button>
        {!focused && (
          <button
            type="button"
            onClick={() => onFocusNode(node.id)}
            className="lf-focus-ring shrink-0 rounded-lf px-2 py-1 text-[11px] text-lf-text-muted hover:text-lf-text"
          >
            聚焦
          </button>
        )}
      </header>

      {!collapsed && <div className="min-w-0 p-3">{body}</div>}
    </article>
  )
}

/** 每种节点类型一个渲染分支。`default` 用 `never` 断言保证新增类型时会**编译失败**。 */
function renderBody(node: WorkspaceNode): React.ReactNode {
  switch (node.type) {
    case 'intent': {
      const d = node.data
      return (
        <dl className="grid grid-cols-1 gap-3">
          <Field label="目标">{d.goal}</Field>
          {d.offer ? <Field label="可提供的对价">{d.offer}</Field> : null}
          <Field label="约束">
            {d.constraints.length === 0 ? (
              <span className="text-xs text-lf-text-faint">描述里未提到约束 —— 不会补默认值。</span>
            ) : (
              <ul className="list-inside list-disc text-sm">
                {d.constraints.map((c) => (
                  <li key={c} className="break-words">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field label="成功判据">
            {d.successCriteria.length === 0 ? (
              <span className="text-xs text-lf-text-faint">描述里未给可量化判据。</span>
            ) : (
              <ul className="list-inside list-disc text-sm">
                {d.successCriteria.map((c) => (
                  <li key={c} className="break-words">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Field>
          {d.expiresAt ? <Field label="期限（草稿折算）">{d.expiresAt.slice(0, 10)}</Field> : null}
        </dl>
      )
    }

    case 'candidate': {
      const items = node.data.candidates
      return items.length === 0 ? (
        <NodeEmpty text="暂无候选。真实候选由服务端按权限召回（需 ACTIVE 社群成员身份）—— 本页不会预填任何候选，也不会伪造匹配。" />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="rounded-lf border border-lf-line p-2">
              <p className="text-sm">{c.label}</p>
              <p className="mt-1 text-xs text-lf-text-muted">依据：{c.rationale}</p>
              {c.evidence.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-[11px] text-lf-text-faint">
                  {c.evidence.map((e) => (
                    <li key={e} className="break-words">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )
    }

    case 'consent': {
      const d = node.data
      return (
        <dl className="grid grid-cols-1 gap-3">
          <Field label="状态">
            <span className="rounded-lf border border-lf-line px-1.5 py-0.5 text-xs">{d.status}</span>
            <span className="ml-2 text-[11px] text-lf-text-faint">
              （服务端派生值；单方接受不会进入执行）
            </span>
          </Field>
          <Field label="披露字段">
            {d.fields.length === 0 ? (
              <span className="text-xs text-lf-text-faint">没有可显示的披露字段（服务端未下发，或当前阶段尚未授权）。</span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {d.fields.map((f) => (
                  <li key={f} className="rounded-lf bg-lf-surface-2 px-1.5 py-0.5 text-[11px]">
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </dl>
      )
    }

    case 'action': {
      const jobs = node.data.jobs
      return jobs.length === 0 ? (
        <NodeEmpty text="暂无执行任务。状态来自服务端任务队列，不由前端推测。" />
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-lf border border-lf-line p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">{j.kind}</span>
                <span className="shrink-0 rounded-lf border border-lf-line px-1.5 py-0.5 text-[10px]">{j.status}</span>
              </div>
              <p className="mt-1 text-[11px] text-lf-text-faint">尝试 {j.attempts} 次</p>
              {j.lastError && (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-lf-danger">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="break-words">{j.lastError}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )
    }

    case 'outcome': {
      const items = node.data.outcomes
      return items.length === 0 ? (
        <NodeEmpty text="暂无成果记录。验证级别由服务端派生，前端不会自行推断。" />
      ) : (
        <ul className="space-y-2">
          {items.map((o) => (
            <li key={o.id} className="rounded-lf border border-lf-line p-2">
              <p className="text-sm">{o.label}</p>
              <p className="mt-1 text-[11px] text-lf-text-faint">
                {o.level}
                {o.occurredAt ? ` · ${o.occurredAt.slice(0, 10)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )
    }

    default: {
      // 防御性兜底：契约层理论上不会放过未知类型；真出现了就**显式阻止**，
      // 而不是静默忽略 —— 静默忽略会让"少渲染"看起来像"渲染成功"。
      const exhaustive: never = node
      void exhaustive
      return (
        <p className="flex items-start gap-2 rounded-lf border border-lf-danger/40 p-3 text-xs text-lf-danger">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          未知节点类型，已阻止渲染（契约层应已拦截，出现即缺陷）。
        </p>
      )
    }
  }
}
