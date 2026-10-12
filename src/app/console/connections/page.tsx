'use client'

/**
 * T07 · Console — 连接屏
 *
 * 数据源：`GET /api/v1/connections/pipeline`（**本切片新增**，能力 `workflow.read` = OPERATOR+）。
 *
 * 🔴 「无空按钮」在这里的落实：
 *   1. 「发送介绍」按钮**只在 `canIntroduce === true` 时渲染**。`canIntroduce` 由服务端用
 *      与 `POST /connections/{id}/introduce` **同一个**判据（`introductionBlockersByProposal`）算出，
 *      所以"能点"与"点了成功"是同一件事的两种呈现 —— 不存在"必然 409 的按钮"。
 *   2. 判为不可介绍时，**不渲染禁用按钮**，而是列出**具体原因**（`introduceBlockers`）。
 *      禁用而不说原因，是另一种形式的坏交互。
 *   3. 接管 / 重试死信任务属**任务队列**（不是连接），本屏不渲染；总览屏有待办列表。
 *
 * ⚠️ 分页是"派生过滤之后再分页"（见 `operations.ts`），因此响应里的 `truncated`
 *    必须显示出来 —— 否则"共 N 条"会被读成全量。
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Link2, RefreshCw } from 'lucide-react'
import { useApiGet, useApiPost } from '@/hooks/use-api'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

type ConnectionBucket = 'ALL' | 'PENDING_CONSENT' | 'READY_TO_INTRODUCE' | 'INTRODUCED' | 'CLOSED'

interface OrgConnectionRow {
  proposalId: string
  missionId: string
  missionTitle: string | null
  state: string
  bucket: Exclude<ConnectionBucket, 'ALL'>
  introduced: boolean
  introducedAt: string | null
  closedAt: string | null
  createdAt: string
  stage: string | null
  stageEnteredAt: string | null
  stalled: boolean
  canIntroduce: boolean
  introduceBlockers: string[]
}

interface PipelineDto {
  items: OrgConnectionRow[]
  total: number
  page: number
  pageSize: number
  scanned: number
  truncated: boolean
  summary: Record<ConnectionBucket, number>
}

const BUCKET_TABS: ReadonlyArray<{ value: ConnectionBucket; label: string; hint: string }> = [
  { value: 'ALL', label: '全部', hint: '本社群全部连接提案' },
  { value: 'PENDING_CONSENT', label: '待表态', hint: '至少一方还没表态' },
  { value: 'READY_TO_INTRODUCE', label: '待介绍', hint: '双方已同意，等你推进' },
  { value: 'INTRODUCED', label: '已介绍', hint: '已建立连接，看阶段进度' },
  { value: 'CLOSED', label: '已结束', hint: '拒绝 / 撤销 / 过期' },
]

const BUCKET_BADGE: Record<string, string> = {
  PENDING_CONSENT: 'bg-background-tertiary text-foreground-muted',
  READY_TO_INTRODUCE: 'bg-primary/15 text-primary',
  INTRODUCED: 'bg-success/15 text-success',
  CLOSED: 'bg-background-tertiary text-foreground-subtle',
}

const BUCKET_LABEL: Record<string, string> = {
  PENDING_CONSENT: '待表态',
  READY_TO_INTRODUCE: '待介绍',
  INTRODUCED: '已介绍',
  CLOSED: '已结束',
}

/** 与 `stage-machine.ts` 的 `STAGE_LABELS` 一致的展示文案。 */
const STAGE_LABEL: Record<string, string> = {
  PROPOSED: '已发起提案',
  CONSENT_PENDING: '等待双方同意',
  INTRODUCED: '已介绍',
  COORDINATING: '协调中',
  ACTION_COMPLETED: '行动已完成',
  OUTCOME_RECORDED: '成果已记录',
}

/** 不可介绍的原因 → 人话。新增 blocker 时这里会显示原值，不会静默丢掉信息。 */
const BLOCKER_LABEL: Record<string, string> = {
  already_introduced: '已经介绍过了',
  rejected: '一方已拒绝',
  revoked: '一方已撤销',
  expired: '提案已过期',
  not_mutually_accepted: '双方还没有都同意',
  proposer_intent_not_live: '发起方的意图已失效或已撤回',
  candidate_intent_not_live: '被介绍方的意图已失效或已撤回',
}

const PAGE_SIZE = 20

export default function ConsoleConnectionsPage() {
  const [bucket, setBucket] = useState<ConnectionBucket>('ALL')
  const [stalledOnly, setStalledOnly] = useState(false)
  const [page, setPage] = useState(1)

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (bucket !== 'ALL') p.set('bucket', bucket)
    if (stalledOnly) p.set('stalled', '1')
    return `/api/v1/connections/pipeline?${p.toString()}`
  }, [bucket, stalledOnly, page])

  const pipeline = useApiGet<ApiEnvelope<PipelineDto>>(url)
  const { post, isLoading: isActing, error: actionError } = useApiPost()
  const [actingId, setActingId] = useState<string | null>(null)

  const data = pipeline.data?.data
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const truncated = data?.truncated ?? false
  const scanned = data?.scanned ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const introduce = async (proposalId: string) => {
    setActingId(proposalId)
    const res = await post(`/api/v1/connections/${proposalId}/introduce`)
    setActingId(null)
    if (res) pipeline.refetch()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground font-display">连接</h1>
          <p className="text-xs text-foreground-muted mt-0.5">
            从提案到介绍的推进情况 —— 谁在等表态、谁等你按下「介绍」、谁卡住了。
          </p>
        </div>
        <button
          type="button"
          onClick={() => pipeline.refetch()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${pipeline.isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── 过滤：四个语义桶 + 只看停滞 ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {BUCKET_TABS.map((t) => {
          const count = data?.summary?.[t.value]
          return (
            <button
              key={t.value}
              type="button"
              title={t.hint}
              onClick={() => {
                setBucket(t.value)
                setPage(1)
              }}
              aria-pressed={bucket === t.value}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                bucket === t.value
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
              }`}
            >
              {t.label}
              {typeof count === 'number' ? <span className="ml-1 opacity-70">{count}</span> : null}
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => {
            setStalledOnly((v) => !v)
            setPage(1)
          }}
          aria-pressed={stalledOnly}
          className={`ml-auto px-3 py-1.5 rounded-lg text-xs transition-colors ${
            stalledOnly
              ? 'bg-warning/15 text-warning font-medium'
              : 'border border-card-border text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
          }`}
        >
          只看停滞
        </button>
      </div>

      {pipeline.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-10">
          <RefreshCw className="w-4 h-4 animate-spin" />
          正在读取连接…
        </div>
      ) : pipeline.error ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <p className="text-sm text-warning mb-1">
            {/permission|403/i.test(pipeline.error) ? '权限不足' : '读不到连接列表'}
          </p>
          <p className="text-sm text-foreground-muted">
            {/permission|403/i.test(pipeline.error)
              ? '查看全社群的连接推进情况需要「运营」及以上角色。你在本社群的角色不够 —— 这不是错误，而是权限边界。'
              : pipeline.error}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-background-secondary p-6">
          <div className="flex items-center gap-2 text-foreground-muted mb-2">
            <Link2 className="w-4 h-4" />
            <p className="text-sm font-medium text-foreground">
              {stalledOnly
                ? '没有停滞的连接'
                : bucket === 'ALL'
                  ? '本社群还没有连接提案'
                  : `没有「${BUCKET_LABEL[bucket] ?? bucket}」的连接`}
            </p>
          </div>
          <p className="text-sm text-foreground-muted">
            {stalledOnly
              ? '所有进行中的连接都在预期时间内推进（阶段超过 7 天未推进才算停滞）。'
              : bucket === 'ALL'
                ? '提案由运营在任务里发起；成员在分享页表态后，双方同意即出现在这里等你介绍。'
                : '换个分组看看，或等成员完成表态。'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => (
            <li
              key={row.proposalId}
              className="rounded-xl border border-card-border bg-background-secondary p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    BUCKET_BADGE[row.bucket] ?? 'bg-background-tertiary text-foreground-muted'
                  }`}
                >
                  {BUCKET_LABEL[row.bucket] ?? row.bucket}
                </span>

                {row.stage ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-muted">
                    {STAGE_LABEL[row.stage] ?? row.stage}
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-background-tertiary text-foreground-subtle">
                    未建流程
                  </span>
                )}

                {row.stalled ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning">
                    <AlertTriangle className="w-3 h-3" />
                    停滞
                  </span>
                ) : null}

                <span className="text-sm text-foreground truncate max-w-[22rem]">
                  {row.missionTitle ?? '（任务已删除）'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-foreground-subtle">
                <span>提案于 {new Date(row.createdAt).toLocaleDateString()}</span>
                {row.introducedAt ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="w-3 h-3" />
                    介绍于 {new Date(row.introducedAt).toLocaleDateString()}
                  </span>
                ) : null}
                {row.closedAt ? <span>结束于 {new Date(row.closedAt).toLocaleDateString()}</span> : null}
                {row.stalled && row.stageEnteredAt ? (
                  <span>自 {new Date(row.stageEnteredAt).toLocaleDateString()} 起未推进</span>
                ) : null}
              </div>

              {/* ── 唯一动作：介绍（判据与服务端同一来源，见文件头 🔴 1） ── */}
              {row.canIntroduce ? (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isActing && actingId === row.proposalId}
                    onClick={() => introduce(row.proposalId)}
                    className="px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isActing && actingId === row.proposalId ? '正在介绍…' : '发送介绍'}
                  </button>
                  <span className="text-[11px] text-foreground-subtle">
                    双方已同意 —— 发出一封正式介绍，把这条连接交给他们。
                  </span>
                </div>
              ) : row.bucket === 'READY_TO_INTRODUCE' ? (
                <p className="mt-2 text-[11px] text-warning">
                  暂时不能介绍：
                  {row.introduceBlockers
                    .map((b) => BLOCKER_LABEL[b] ?? b)
                    .join('、')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {actionError ? <p className="text-xs text-danger">操作失败：{actionError}</p> : null}

      {!pipeline.isLoading && !pipeline.error && totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-foreground-muted">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border border-card-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页 · 共 {total} 条
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg border border-card-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            下一页
          </button>
        </div>
      ) : null}

      {/* ── 口径声明：截断与过滤范围必须写出来（AC-09 的诚实要求） ── */}
      {!pipeline.isLoading && !pipeline.error ? (
        <p className="text-[11px] text-foreground-subtle">
          {truncated
            ? `⚠️ 只统计了最近 ${scanned} 条提案（更早的未纳入），因此上面的分组数字不是全量。`
            : `分组数字基于全部 ${scanned} 条提案。`}
          「停滞」= 阶段超过 7 天未推进。需要人工接管的死信任务列在「总览」屏待办里
          （接管/重试的操作界面尚未实现，接口已就绪）。
        </p>
      ) : null}
    </div>
  )
}
