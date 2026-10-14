'use client'

/**
 * P2 · Field 关系网络 —— xyflow 渲染层（**唯一**允许引 `@xyflow/react` 的目录）
 *
 * 依据：`DESIGN/02-plan.md` P2「Field 升级为 2.5D 关系网络（P2 引入 `@xyflow/react`；
 *       大规模关系另评估渲染方案，**不强迫一个库承担所有场景**）」。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么这个库值得引（D5：先问"它是否承担了唯一必要的表达"）
 * ═══════════════════════════════════════════════════════════════
 *
 *   P1 的画布是**链**（节点 → 节点），DOM + 一层 SVG 就够，所以当时刻意不引库。
 *   P2 是**网络**（一个中心对多个候选 + 独立外环），需要的是：缩放/平移、
 *   视口变换、命中测试、大量节点的位置管理。这些自己写会变成第二套坐标系，
 *   而且是**不受控地**长出来 —— 引入的是"视口与命中"，不是"好看"。
 *
 * ═══════════════════════════════════════════════════════════════
 * 三条刻意的取舍（都可被证伪）
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. **节点不可拖动**（`nodesDraggable={false}`，但画布可平移/缩放）。
 *      位置在本图里**编码数据**（半径 = 关系强度的 2.5D 投影）。允许拖动会让
 *      "位置"同时表示两件事（用户偏好 + 关系强度），于是"谁更相关"再也读不出来。
 *      要重新排列，用列表视图（`field-fallback.tsx`）—— 那里本来就没有位置语义。
 *
 *   2. **不用箭头 marker**。双向互补是**两面都命中**才成立的关系，单向箭头会
 *      凭空造出一个"谁指向谁"的语义。强度用线宽表达，方向性用边的 label 说明
 *      （label 里两侧词元都列出来）。附带好处：少一类"marker 颜色没跟随主题"的坑。
 *
 *   3. **节点内是 `<button>`**（而不是 div + `onNodeClick`）：这样键盘可达、
 *      屏幕阅读器可读，且 `check:ui-invariants` 的 R2 能继续把守"无空按钮"
 *      （xyflow 自己渲染的控件不在我们的扫描范围内，也不该由我们负责）。
 */

import { useCallback, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './field-graph.css'
import {
  FIELD_PROPOSAL_STATE_LABELS,
  depthToOpacity,
  depthToScale,
  type FieldGraph,
  type FieldGraphNode,
  type FieldNodeKind,
} from '@/lib/living/field'

const NODE_WIDTH: Record<FieldNodeKind, number> = {
  viewer: 176,
  candidate: 150,
  proposal: 150,
}

/** ⚠️ `data` 用**类型别名**而不是 interface：xyflow 的 `Node<T>` 要求
 *  `T extends Record<string, unknown>`，而 interface 不满足隐式索引签名（TS 的已知差异）。 */
type LfNodeData = {
  node: FieldGraphNode
  selected: boolean
  onSelect: (id: string) => void
}

function FieldNodeView({ data }: NodeProps<Node<LfNodeData>>) {
  const { node, selected, onSelect } = data
  const width = NODE_WIDTH[node.kind]
  const isViewer = node.kind === 'viewer'
  const isProposal = node.kind === 'proposal'

  const meta = (() => {
    if (isViewer) return '关系网络以此为中心'
    if (isProposal) {
      const p = node.proposal
      if (!p) return '提案'
      const flags: string[] = []
      if (p.introduced) flags.push('已介绍')
      if (p.stalled) flags.push('⚠ 停滞')
      return flags.length > 0 ? flags.join(' · ') : '提案'
    }
    const d = node.detail
    if (!d) return '候选'
    return d.named ? `双向命中 ${d.matchedTokens} 个词元` : `双向命中 ${d.matchedTokens} 个词元 · 未授权姓名`
  })()

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      title={node.label}
      style={{
        width,
        transform: `scale(${depthToScale(node.depth)})`,
        opacity: depthToOpacity(node.depth),
        transitionDuration: 'var(--lf-dur)',
      }}
      className={[
        'lf-focus-ring block cursor-pointer rounded-lf-lg border px-3 py-2 text-left transition-all',
        selected
          ? 'border-lf-signal bg-lf-signal-soft'
          : 'border-lf-line bg-lf-surface hover:border-lf-line-strong',
        isViewer ? 'border-lf-line-strong bg-lf-surface-2' : '',
      ].join(' ')}
    >
      <span className="block truncate text-[13px] font-medium text-lf-text">{node.label}</span>
      <span className="mt-0.5 block truncate text-[10px] text-lf-text-faint">
        {isProposal && node.proposal
          ? (FIELD_PROPOSAL_STATE_LABELS[node.proposal.state] ?? node.proposal.state)
          : meta}
      </span>
      {isProposal && node.proposal && (
        <span className="mt-0.5 block truncate text-[10px] text-lf-text-faint">{meta}</span>
      )}
    </button>
  )
}

const nodeTypes = { lf: FieldNodeView }

export interface FieldGraphViewProps {
  graph: FieldGraph
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export default function FieldGraphView({ graph, selectedId, onSelect }: FieldGraphViewProps) {
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id === selectedId ? null : id)
    },
    [onSelect, selectedId],
  )

  const rfNodes: Node<LfNodeData>[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'lf',
        position: n.position,
        data: { node: n, selected: n.id === selectedId, onSelect: handleSelect },
        draggable: false,
        // 位置完全由数据决定 ⇒ 布局改动由"重新装配"驱动，不由画布内部状态驱动。
        // 这条同时保证：同一份数据任何时候渲染都在同一处（可断言）。
        selectable: true,
      })),
    [graph.nodes, selectedId, handleSelect],
  )

  const rfEdges: Edge[] = useMemo(() => {
    const activeIds = new Set<string>()
    if (selectedId !== null) {
      for (const e of graph.edges) {
        if (e.source === selectedId || e.target === selectedId) {
          activeIds.add(e.id)
        }
      }
    }
    return graph.edges.map((e) => {
      const active = activeIds.has(e.id)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'straight',
        // 线宽表达强度（真实计数），但不让阈值差异大到看不出层级。
        style: { strokeWidth: Math.min(3, 1 + Math.sqrt(e.weight) / 2) },
        // label 只在选中时出现：24 条边同时挂标签会把画布糊成一片。
        label: active ? e.label : undefined,
        className: active ? 'lf-edge-active' : undefined,
        focusable: false,
      }
    })
  }, [graph.edges, selectedId])

  return (
    <div className="lf-field-network h-[clamp(360px,58vh,640px)] min-w-0 rounded-lf-lg border border-lf-line bg-lf-bg">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        // 节点内部已是 button ⇒ 交给浏览器原生 tab 序列，不再叠一层 xyflow 的键盘导航。
        nodesFocusable={false}
        proOptions={{ hideAttribution: false }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.6}
        onPaneClick={() => onSelect(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}
