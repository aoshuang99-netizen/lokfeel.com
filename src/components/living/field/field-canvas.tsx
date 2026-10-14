'use client'

/**
 * P2 · Field —— 容器：取数 → 装配 → 视图（网络 / 列表）
 *
 * 职责边界（与 P1 的 `assemble.ts` 同一条纪律）：
 *   - **取数**在这里（`useApiGet`），**映射**在 `src/lib/living/field/graph.ts`（纯函数、零 IO）。
 *     因此整条"真实载荷 → 图"的链路可以在单测与隔离库 E2E 里直接喂真实响应复跑。
 *   - 视图切换不是"有没有图"的开关：**窄屏默认列表**（阻断标准 #13），
 *     画布库加载失败时也回落到列表（同 #12 的纪律），而列表与图**同源**同一份 `FieldGraph`。
 *
 * ⚠️ 信封读取：`/api/v1/*` 一律是 `{ success, data, … }`。P1 收口时踩过一次
 *    "按裸对象读 → 整块恒空且不报错"，所以这里每一次都显式折一层 `data.data`。
 */

import dynamic from 'next/dynamic'
import { Component, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { AlertCircle, LayoutGrid, List, Network } from 'lucide-react'
import { useApiGet } from '@/hooks/use-api'
import { useMediaQuery } from '@/components/living/use-media-query'
import type { MissionDto } from '@/lib/connection'
import {
  assembleFieldGraph,
  findFieldNode,
  type FieldCandidateList,
  type FieldGraphNode,
  type FieldPipeline,
} from '@/lib/living/field'
import FieldListView from './field-fallback'

/**
 * 画布是**运行期**加载的（不是 SSR 的一部分）。
 * `ssr: false` 的理由：xyflow 依赖真实 DOM 尺寸做视口计算，服务端渲染出来的是空壳；
 * 而它的失败必须**不影响** Field 可用 —— 见下方 `CanvasBoundary`。
 */
const FieldGraphView = dynamic(() => import('./field-graph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(360px,58vh,640px)] items-center justify-center rounded-lf-lg border border-lf-line bg-lf-bg text-xs text-lf-text-muted">
      正在加载关系画布…（列表视图始终可用，不受此影响）
    </div>
  ),
})

/** React 的函数组件没有错误边界 ⇒ 画布 chunk 加载失败需要一个 class 组件兜住。 */
class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export interface FieldCanvasProps {
  /** 选中节点变化（上层用它在 Inspector 里渲染详情；null = 取消选中）。 */
  onSelectNode: (node: FieldGraphNode | null) => void
  selectedNodeId: string | null
}

export default function FieldCanvas({ onSelectNode, selectedNodeId }: FieldCanvasProps) {
  const { data: session } = useSession()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  /** null = 未手动切换（跟随屏幕；窄屏默认列表）。 */
  const [manualView, setManualView] = useState<'network' | 'list' | null>(null)
  const [missionId, setMissionId] = useState<string | null>(null)

  // ── 取数（三条真实端点；candidates 需要 missionId，未选时不发请求）──
  const missionsRes = useApiGet<ApiEnvelope<MissionDto[]>>('/api/v1/missions')
  const pipelineRes = useApiGet<ApiEnvelope<FieldPipeline>>('/api/v1/connections/pipeline')
  const candidatesRes = useApiGet<ApiEnvelope<FieldCandidateList>>(
    missionId !== null ? `/api/v1/connections/candidates?missionId=${encodeURIComponent(missionId)}` : null,
  )

  const missionList = missionsRes.data?.data ?? []
  // 默认选第一条 —— 但**只在用户没选过时**推断，避免把用户的显式选择覆盖掉。
  const effectiveMissionId = missionId ?? missionList[0]?.id ?? null

  // 拆成原始字段再做依赖：`useApiGet` 每次渲染返回新对象，直接依赖它会让 useMemo 每次重算。
  const candData = candidatesRes.data?.data ?? null
  const candError = candidatesRes.error
  const candLoading = candidatesRes.isLoading
  const pipeData = pipelineRes.data?.data ?? null
  const pipeError = pipelineRes.error
  const pipeLoading = pipelineRes.isLoading

  /**
   * ⚠️ `candidates` 的 URL 依赖 `effectiveMissionId`，但 `useApiGet` 拿到的
   * `missionId` 是**用户显式选择**的那一个。两者不一致时（列表刚到、用户还没选），
   * 请求已经按 URL 发出去了 —— 这里以**实际请求的那个 missionId** 为准，
   * 避免出现"图上显示的是 A 任务的候选、选择器写着 B"这种错配。
   */
  const viewerLabel = session?.user?.name ?? null
  const graph = useMemo(
    () =>
      assembleFieldGraph({
        candidates: { data: candData, error: candError, isLoading: candLoading },
        pipeline: { data: pipeData, error: pipeError, isLoading: pipeLoading },
        viewerLabel,
      }),
    [candData, candError, candLoading, pipeData, pipeError, pipeLoading, viewerLabel],
  )

  const handleSelect = useCallback(
    (id: string | null) => {
      onSelectNode(findFieldNode(graph, id))
    },
    [graph, onSelectNode],
  )

  const view = manualView ?? (isDesktop ? 'network' : 'list')

  const missionPicker = (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="lf-field-mission" className="text-xs text-lf-text-muted">
        任务
      </label>
      <select
        id="lf-field-mission"
        value={effectiveMissionId ?? ''}
        onChange={(e) => setMissionId(e.target.value === '' ? null : e.target.value)}
        disabled={missionList.length === 0}
        className="lf-focus-ring max-w-full rounded-lf border border-lf-line bg-lf-surface px-2 py-1 text-xs text-lf-text disabled:cursor-not-allowed disabled:text-lf-text-faint"
      >
        {missionList.length === 0 ? (
          <option value="">（没有可用的任务）</option>
        ) : (
          missionList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}（{m.status}）
            </option>
          ))
        )}
      </select>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => setManualView('network')}
          aria-pressed={view === 'network'}
          className={[
            'lf-focus-ring inline-flex items-center gap-1 rounded-lf border px-2 py-1 text-[11px]',
            view === 'network' ? 'border-lf-signal text-lf-signal' : 'border-lf-line text-lf-text-muted',
          ].join(' ')}
        >
          <Network className="h-3 w-3" aria-hidden="true" />
          网络
        </button>
        <button
          type="button"
          onClick={() => setManualView('list')}
          aria-pressed={view === 'list'}
          className={[
            'lf-focus-ring inline-flex items-center gap-1 rounded-lf border px-2 py-1 text-[11px]',
            view === 'list' ? 'border-lf-signal text-lf-signal' : 'border-lf-line text-lf-text-muted',
          ].join(' ')}
        >
          <List className="h-3 w-3" aria-hidden="true" />
          列表
        </button>
      </div>
    </div>
  )

  const notes = (
    <ul className="space-y-1 rounded-lf border border-lf-line bg-lf-surface p-3 text-[11px] text-lf-text-muted">
      {graph.notes.map((note) => (
        <li key={note} className="break-words">
          · {note}
        </li>
      ))}
    </ul>
  )

  const hasGraph = graph.nodes.length > 1 || graph.edges.length > 0

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          <LayoutGrid className="h-4 w-4 text-lf-signal" aria-hidden="true" />
          连接场
        </h1>
        <span className="text-xs text-lf-text-faint">
          2.5D 关系网络：半径 = 关系强度（双向命中词元数），越靠近中心越相关
        </span>
      </div>

      {missionPicker}

      <Loadable
        isLoading={missionsRes.isLoading}
        error={missionsRes.error}
        empty={missionList.length === 0}
        emptyText="本社群还没有连接任务。没有任务就没有可匹配的诉求 —— 本页不会为了填满而生成候选。"
      >
        {!hasGraph && !candLoading && !pipeLoading ? (
          <div className="space-y-3">
            {notes}
            <p className="rounded-lf border border-lf-line p-3 text-xs text-lf-text-muted">
              图上目前没有候选或提案节点。上面的「说明」写清了原因 —— 注意区分
              「读不到」与「真的没有」：两者在界面上绝不共用一句话。
            </p>
          </div>
        ) : view === 'network' ? (
          <div className="space-y-3">
            <CanvasBoundary
              fallback={
                <div className="space-y-3">
                  <p
                    className="flex items-start gap-2 rounded-lf border border-lf-warning/40 p-3 text-xs text-lf-warning"
                    role="alert"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      关系画布加载失败（画布库未能运行）。
                      <strong className="font-medium">已自动切换为列表视图</strong> —— 数据完全一致，功能不受影响。
                    </span>
                  </p>
                  <FieldListView graph={graph} selectedId={selectedNodeId} onSelect={handleSelect} />
                </div>
              }
            >
              <FieldGraphView graph={graph} selectedId={selectedNodeId} onSelect={handleSelect} />
            </CanvasBoundary>
            {notes}
          </div>
        ) : (
          <div className="space-y-3">
            <FieldListView graph={graph} selectedId={selectedNodeId} onSelect={handleSelect} />
          </div>
        )}
      </Loadable>
    </div>
  )
}

/** 诚实三态（与 P1 同款：加载 / 错误 / 空都必须有真实反馈）。 */
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
  children: ReactNode
}) {
  if (isLoading) {
    return (
      <p className="rounded-lf border border-lf-line p-3 text-xs text-lf-text-muted" aria-busy="true">
        正在读取…
      </p>
    )
  }
  if (error !== null) {
    return (
      <p
        className="flex items-start gap-2 rounded-lf border border-lf-danger/40 p-3 text-xs text-lf-danger"
        role="alert"
      >
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">
          读取失败：{error}
          <br />
          —— 这是<strong className="font-medium">读取失败</strong>，不是「没有数据」。本页不会把它显示成空态。
        </span>
      </p>
    )
  }
  if (empty) {
    return <p className="rounded-lf border border-lf-line p-3 text-xs text-lf-text-muted">{emptyText}</p>
  }
  return <>{children}</>
}
