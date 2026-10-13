'use client'

/**
 * Living Connection OS · P1 —— Living Canvas（DOM/SVG 混合，**不引 3D**）
 *
 * 依据：`DESIGN/02-plan.md` P1「Living Canvas：P1 用 DOM/SVG 混合；节点可展开/聚焦/拖动
 * （布局本地状态）」。
 *
 * 关键决定：
 *   - **不引 `three` / `@xyflow/react`**：P1 只需要"流程 + 连线 + 拖动"，
 *     DOM + 一层 SVG 连线足够。引入画布库要等 P2 的关系网络（那里 2.5D 才是必要的表达）。
 *   - **`position` 只在本地**（`useState`），**不落库** —— 见 `DESIGN/01` §6-③。
 *     刷新后回到自动布局，不会出现"本地布局与库不一致"的假状态。
 *   - **`<1024px` 降级为卡片流**（无绝对定位、无拖动），避免 360px 横向溢出（阻断标准 #13）。
 *   - **不使用任何定时器**（R1）：拖动的每次位移都来自真实指针事件，没有"假装执行"。
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { LayoutGrid, RotateCcw } from 'lucide-react'
import type { WorkspaceSpec, WorkspaceNode } from '@/lib/workspace-spec'
import NodeCard from './node-card'
import { useMediaQuery } from './use-media-query'

const NODE_W = 320
const GAP_X = 72
const PAD = 24
const NODE_H_EST = 220

interface Position {
  x: number
  y: number
}

export interface LivingCanvasProps {
  spec: WorkspaceSpec
  /**
   * 运行期能力探测：`capability → true | false | undefined`。
   * `undefined` = 尚未探测到 → 不为 true 一律视为不可用（取严）。
   */
  capabilityProbe?: Record<string, boolean>
  /** 已就绪动作被点击时触发（真实调用由上层完成）。 */
  onAction?: (key: string) => void
  /** 正在执行的动作 key（用于禁用并显示进行中）。 */
  pendingActionKey?: string | null
}

/** 确定性自动布局：横向链式排布（同一输入恒得同一布局）。 */
function autoLayout(nodes: WorkspaceNode[]): Record<string, Position> {
  const out: Record<string, Position> = {}
  nodes.forEach((n, i) => {
    out[n.id] = { x: PAD + i * (NODE_W + GAP_X), y: PAD }
  })
  return out
}

export default function LivingCanvas({
  spec,
  capabilityProbe,
  onAction,
  pendingActionKey = null,
}: LivingCanvasProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const initial = useMemo(() => autoLayout(spec.nodes), [spec.nodes])
  const [positions, setPositions] = useState<Record<string, Position>>(initial)
  const [collapsedIds, setCollapsedIds] = useState<readonly string[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const resetLayout = useCallback(() => {
    setPositions(autoLayout(spec.nodes))
    setFocusedId(null)
  }, [spec.nodes])

  // ── 拖动（仅桌面档；布局是本地状态，不落库） ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      const surface = surfaceRef.current
      const pos = positions[id]
      if (!surface || !pos) return
      const rect = surface.getBoundingClientRect()
      dragRef.current = {
        id,
        dx: e.clientX - rect.left - pos.x,
        dy: e.clientY - rect.top - pos.y,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [positions],
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const surface = surfaceRef.current
    if (!drag || !surface) return
    const rect = surface.getBoundingClientRect()
    // 夹到非负区域，避免把节点拖出画布产生"看不见但存在"的状态。
    const x = Math.max(0, e.clientX - rect.left - drag.dx)
    const y = Math.max(0, e.clientY - rect.top - drag.dy)
    setPositions((prev) => ({ ...prev, [drag.id]: { x, y } }))
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针可能已被系统取消 —— 不影响布局状态 */
    }
  }, [])

  const surfaceSize = useMemo(() => {
    const xs = spec.nodes.map((n) => positions[n.id]?.x ?? 0)
    const ys = spec.nodes.map((n) => positions[n.id]?.y ?? 0)
    return {
      width: Math.max(NODE_W + PAD * 2, ...xs.map((x) => x + NODE_W + PAD)),
      height: Math.max(NODE_H_EST + PAD * 2, ...ys.map((y) => y + NODE_H_EST + PAD)),
    }
  }, [spec.nodes, positions])

  const actions = spec.availableActions
  const readyCount = actions.filter((a) => capabilityProbe?.[a.capability] === true).length

  return (
    <section aria-label="Living Canvas" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-lf-text-muted">
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
          {spec.title}
        </h2>
        <span className="rounded-lf border border-lf-line px-1.5 py-0.5 text-[10px] text-lf-text-faint">
          {spec.nodes.length} 个节点 · spec v{spec.version}
        </span>
        {isDesktop && (
          <button
            type="button"
            onClick={resetLayout}
            className="lf-focus-ring ml-auto inline-flex items-center gap-1 rounded-lf border border-lf-line px-2 py-1 text-[11px] text-lf-text-muted hover:text-lf-text"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            重置布局
          </button>
        )}
      </div>

      {spec.summary && <p className="text-xs text-lf-text-muted">{spec.summary}</p>}

      {/* ── 可用动作条：就绪性来自**运行期能力探测**，编译期一律 false ── */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lf border border-lf-line bg-lf-surface p-2">
          {actions.map((a) => {
            const ready = capabilityProbe?.[a.capability] === true
            const pending = pendingActionKey === a.key
            const blockedReason =
              a.reason ?? `未探测到 ${a.capability} 能力 —— 不与服务端确认前不会放行该动作。`
            return ready ? (
              <button
                key={a.key}
                type="button"
                disabled={pending}
                onClick={() => onAction?.(a.key)}
                className="lf-focus-ring rounded-lf border border-lf-line-strong px-2.5 py-1 text-xs text-lf-text hover:bg-lf-surface-2 disabled:cursor-wait disabled:text-lf-text-faint"
              >
                {pending ? `${a.label}（提交中…）` : a.label}
              </button>
            ) : (
              // 🔴 未就绪 → 禁用 + 写明原因（R2 门禁；AC-18「无空按钮」）
              <button
                key={a.key}
                type="button"
                disabled
                aria-disabled="true"
                title={blockedReason}
                className="cursor-not-allowed rounded-lf border border-lf-line px-2.5 py-1 text-xs text-lf-text-faint"
              >
                {a.label}
              </button>
            )
          })}
          <span className="ml-auto text-[10px] text-lf-text-faint">
            {readyCount}/{actions.length} 个动作当前可用
          </span>
        </div>
      )}

      {/* ── 桌面：绝对定位 + SVG 连线 + 可拖动 ── */}
      {isDesktop ? (
        <div className="min-w-0 overflow-x-auto rounded-lf border border-lf-line bg-lf-bg">
          <div ref={surfaceRef} className="relative" style={{ width: surfaceSize.width, height: surfaceSize.height }}>
            {/* 连线层：纯展示，不接收指针事件 */}
            <svg
              className="pointer-events-none absolute inset-0"
              width={surfaceSize.width}
              height={surfaceSize.height}
              aria-hidden="true"
            >
              {spec.nodes.slice(0, -1).map((n, i) => {
                const next = spec.nodes[i + 1]
                const a = positions[n.id]
                const b = positions[next.id]
                if (!a || !b) return null
                const x1 = a.x + NODE_W
                const y1 = a.y + 40
                const x2 = b.x
                const y2 = b.y + 40
                const mx = (x1 + x2) / 2
                return (
                  <path
                    key={`${n.id}->${next.id}`}
                    d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="text-lf-line-strong"
                  />
                )
              })}
            </svg>

            {spec.nodes.map((n) => {
              const pos = positions[n.id] ?? { x: PAD, y: PAD }
              return (
                <div
                  key={n.id}
                  className="absolute"
                  style={{ left: pos.x, top: pos.y, width: NODE_W }}
                >
                  {/* 拖动把手：装饰性（布局不改变任何业务数据），因此不进 Tab 序列 */}
                  <div
                    aria-hidden="true"
                    title="拖动以调整布局"
                    onPointerDown={(e) => handlePointerDown(e, n.id)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className="mb-1 h-2 cursor-move touch-none rounded-lf bg-lf-line-strong/40"
                  />
                  <NodeCard
                    node={n}
                    collapsed={collapsedIds.includes(n.id)}
                    onToggleCollapse={toggleCollapse}
                    onFocusNode={setFocusedId}
                    focused={focusedId === n.id}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ── <1024px：卡片流降级（无绝对定位 → 不会横向溢出） ── */
        <ul className="min-w-0 space-y-3">
          {spec.nodes.map((n) => (
            <li key={n.id} className="min-w-0">
              <NodeCard
                node={n}
                collapsed={collapsedIds.includes(n.id)}
                onToggleCollapse={toggleCollapse}
                onFocusNode={setFocusedId}
                focused={focusedId === n.id}
              />
            </li>
          ))}
        </ul>
      )}

      {spec.notes.length > 0 && (
        <ul className="space-y-1 rounded-lf border border-lf-line bg-lf-surface p-3 text-[11px] text-lf-text-muted">
          {spec.notes.map((note) => (
            <li key={note} className="break-words">
              · {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
