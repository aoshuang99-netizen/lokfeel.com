/**
 * T07 · 连接运营视图（**租户级**只读投影）
 *
 * 与 `proposals.ts` 的 `listMyProposals` 的区别就一条，但很关键：
 *   - `listMyProposals` 是**自助**的 —— 谓词是 `OR: [proposerId=me, candidateId=me]`，
 *     只给我看"与我有关"的提案；
 *   - 本文件是**运营**的 —— 谓词只有 `organizationId`，看的是本社群**全部**提案，
 *     并叠加 T06 的阶段与停滞判定。
 *
 * 🔴 隐私边界（改前先读）：
 *   1. 返回**只有聚合与状态**：提案 id、任务 id/标题、状态、阶段、时间、可介绍性。
 *      **不含** rationale（运营判断理由）、**不含**任何一方的档案投影、**不含**表态内容。
 *      运营需要看的是"这条连接走到哪一步了"，不是"这两个人是谁、聊了什么"。
 *   2. 所有查询强制 `organizationId` 谓词 —— 跨租户读表现为"查不到"。
 *   3. `canIntroduce` **不是**这里另算的一套规则，而是复用 `introductionBlockersByProposal()`
 *      （与 `POST /connections/{id}/introduce` 同一判据）。界面据此渲染按钮，
 *      因此"能点"与"执行成功"是同一件事的两种呈现，不会漂移。
 *
 * ⚠️ 分页口径（诚实优先于好看）：
 *   过滤条件里 `bucket` / `stalledOnly` 都是**派生值**（要读 workflow + 算超时），
 *   无法下推到 SQL。所以实现是"取最近 SCAN_LIMIT 条 → 派生 → 过滤 → 内存分页"。
 *   当命中窗口被截断时，`truncated=true` 会随响应返回 —— 调用方必须把它显示出来，
 *   否则"共 N 条"会被当成全量（这正是 AC-09 口径在列表页的落点：不许把估算当事实）。
 */

import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/tenancy'
import { isStageTimedOut } from '@/lib/workflow/job-core'
import { isTerminalStage, type WorkflowStage } from '@/lib/workflow/stage-machine'
import {
  deriveProposalState,
  introductionBlockersByProposal,
  normalizeProposalStatus,
  type IntroductionBlocker,
  type ProposalState,
  type IntroducibleCandidate,
} from './proposals'

/**
 * 扫描窗口上限。一次最多看这么多条最新提案（覆盖绝大多数社群的当期运营面）。
 * 之所以不无限：派生过滤无法下推 SQL，全量加载会把一次列表请求变成全表扫描。
 */
export const SCAN_LIMIT = 300

/**
 * 运营语义分桶。刻意**不**直接暴露 `ProposalState`：
 *   - `MUTUALLY_ACCEPTED` 在库里既包含"等介绍"也包含"已介绍"（见 `deriveProposalState`），
 *     直接当筛选项会让运营以为漏了数据；
 *   - `REJECTED/REVOKED/EXPIRED` 对运营是同一件事：**不会再推进了**。
 *
 * ⚠️ 注意 `PENDING_CONSENT`（桶）≠ `CONSENT_PENDING`（提案状态）—— 词序刻意不同。
 *    前者是运营语义（"在等表态"），后者是状态机取值。两者当前一一对应，
 *    但**不要**因此把它们当成同一个东西互换使用。
 */
export type ConnectionBucket =
  | 'ALL'
  | 'PENDING_CONSENT'
  | 'READY_TO_INTRODUCE'
  | 'INTRODUCED'
  | 'CLOSED'

export const CONNECTION_BUCKETS: readonly ConnectionBucket[] = [
  'ALL',
  'PENDING_CONSENT',
  'READY_TO_INTRODUCE',
  'INTRODUCED',
  'CLOSED',
] as const

export const BUCKET_LABELS: Record<ConnectionBucket, string> = {
  ALL: '全部',
  PENDING_CONSENT: '待表态',
  READY_TO_INTRODUCE: '待介绍',
  INTRODUCED: '已介绍',
  CLOSED: '已结束',
}

/** 单条的运营语义分桶（**先判 introduced**，否则已介绍的会被算进"待介绍"）。 */
export function bucketOf(row: { state: ProposalState; introduced: boolean }): Exclude<ConnectionBucket, 'ALL'> {
  if (row.introduced) return 'INTRODUCED'
  if (row.state === 'MUTUALLY_ACCEPTED') return 'READY_TO_INTRODUCE'
  if (row.state === 'CONSENT_PENDING') return 'PENDING_CONSENT'
  return 'CLOSED'
}

export interface OrgConnectionRow {
  proposalId: string
  missionId: string
  missionTitle: string | null
  /** 派生对外状态（含 `EXPIRED`；已介绍的一律为 `MUTUALLY_ACCEPTED`）。 */
  state: ProposalState
  bucket: Exclude<ConnectionBucket, 'ALL'>
  /** `introducedAt !== null` —— 与"状态"分开，因为状态里读不出这件事。 */
  introduced: boolean
  introducedAt: string | null
  closedAt: string | null
  expiresAt: string | null
  createdAt: string
  /** T06 阶段（未建工作流实例时为 null）。 */
  stage: WorkflowStage | null
  stageEnteredAt: string | null
  /** 停在非终态阶段且超过超时阈值。 */
  stalled: boolean
  /** 此刻可执行「介绍」—— 与 `POST /connections/{id}/introduce` 同一判据。 */
  canIntroduce: boolean
  /** 不可介绍的原因（界面直接展示，避免"按钮禁用但不说为什么"）。 */
  introduceBlockers: IntroductionBlocker[]
}

export interface ListOrgConnectionsOptions {
  bucket?: ConnectionBucket
  stalledOnly?: boolean
  page?: number
  pageSize?: number
}

export interface OrgConnectionsResult {
  items: OrgConnectionRow[]
  total: number
  page: number
  pageSize: number
  /** 本次扫描了多少条（= min(提案总数, SCAN_LIMIT)）。 */
  scanned: number
  /** 是否有提案落在扫描窗口之外 —— 为真时 `total` 只是窗口内的数，不是全量。 */
  truncated: boolean
  /** 窗口内的分桶计数，用于渲染 tab 上的数字（**不受当前过滤影响**）。 */
  summary: Record<ConnectionBucket, number>
}

interface OrgProposalRow {
  id: string
  organizationId: string
  missionId: string
  proposerId: string
  candidateId: string
  status: string
  introducedAt: Date | null
  expiresAt: Date | null
  closedAt: Date | null
  createdAt: Date
}

export async function listOrgConnections(
  ctx: TenantContext,
  options: ListOrgConnectionsOptions = {},
  now: Date = new Date()
): Promise<OrgConnectionsResult> {
  const bucket = options.bucket ?? 'ALL'
  const stalledOnly = options.stalledOnly === true
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)))

  // ── 1. 取窗口内的提案（只读运营需要的列） ──
  const [rawRows, orgTotal] = await Promise.all([
    db.connectionProposal.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
      take: SCAN_LIMIT,
      select: {
        id: true,
        organizationId: true,
        missionId: true,
        proposerId: true,
        candidateId: true,
        status: true,
        introducedAt: true,
        expiresAt: true,
        closedAt: true,
        createdAt: true,
      },
    }),
    db.connectionProposal.count({ where: { organizationId: ctx.organizationId } }),
  ])
  const rows = rawRows as unknown as OrgProposalRow[]

  const emptySummary = (): Record<ConnectionBucket, number> => ({
    ALL: 0,
    PENDING_CONSENT: 0,
    READY_TO_INTRODUCE: 0,
    INTRODUCED: 0,
    CLOSED: 0,
  })

  if (rows.length === 0) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      scanned: 0,
      truncated: false,
      summary: emptySummary(),
    }
  }

  const ids = rows.map((r) => r.id)

  // ── 2. 批量补三条边信息：阶段、任务标题、可介绍性 ──
  // 都是"一次查回"而不是逐条查 —— 一页几十条时逐条会退化成 N+1。
  const [workflows, missions, blockerMap] = await Promise.all([
    db.introductionWorkflow.findMany({
      where: { organizationId: ctx.organizationId, proposalId: { in: ids } },
      select: { proposalId: true, stage: true, stageEnteredAt: true },
    }),
    db.mission.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.missionId))] }, organizationId: ctx.organizationId },
      select: { id: true, title: true },
    }),
    introductionBlockersByProposal(
      rows.map(
        (r): IntroducibleCandidate => ({
          id: r.id,
          organizationId: r.organizationId,
          missionId: r.missionId,
          proposerId: r.proposerId,
          candidateId: r.candidateId,
          status: normalizeProposalStatus(r.status),
          introducedAt: r.introducedAt,
          expiresAt: r.expiresAt,
        })
      ),
      now
    ),
  ])

  const wfByProposal = new Map(workflows.map((w) => [w.proposalId, w]))
  const titleByMission = new Map(missions.map((m) => [m.id, m.title]))

  const all: OrgConnectionRow[] = rows.map((r) => {
    const status = normalizeProposalStatus(r.status)
    const state = deriveProposalState({ status, introducedAt: r.introducedAt, expiresAt: r.expiresAt }, now)
    const introduced = r.introducedAt !== null
    const wf = wfByProposal.get(r.id)
    const stage = (wf?.stage as WorkflowStage | undefined) ?? null
    const stageEnteredAt = wf?.stageEnteredAt ?? null
    const stalled =
      stageEnteredAt !== null && !isTerminalStage(stage as WorkflowStage) && isStageTimedOut(stageEnteredAt, now)
    const blockers = blockerMap.get(r.id) ?? []

    return {
      proposalId: r.id,
      missionId: r.missionId,
      missionTitle: titleByMission.get(r.missionId) ?? null,
      state,
      bucket: bucketOf({ state, introduced }),
      introduced,
      introducedAt: r.introducedAt ? r.introducedAt.toISOString() : null,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      stage,
      stageEnteredAt: stageEnteredAt ? stageEnteredAt.toISOString() : null,
      stalled,
      canIntroduce: blockers.length === 0,
      introduceBlockers: blockers,
    }
  })

  // ── 3. 分桶计数用**窗口内全量**，这样 tab 数字不随当前过滤跳动 ──
  const summary = emptySummary()
  summary.ALL = all.length
  for (const r of all) summary[r.bucket] += 1

  // ── 4. 过滤 → 内存分页 ──
  const filtered = all.filter(
    (r) => (bucket === 'ALL' || r.bucket === bucket) && (!stalledOnly || r.stalled)
  )

  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    scanned: all.length,
    truncated: orgTotal > all.length,
    summary,
  }
}

/**
 * 从查询串解析分桶。**未知值返回 `null`**（由路由层转成 400），不是静默回退 `ALL`：
 * 静默回退会让调用方以为自己筛过了，实际看到的是全量 —— "筛选没生效"比"筛选报错"难发现得多
 * （与 `/api/v1/workflow/jobs` 的 `?status=` 同一取向）。
 */
export function parseConnectionBucket(value: string | null): ConnectionBucket | null {
  if (value === null || value.trim() === '') return 'ALL'
  const v = value.trim().toUpperCase()
  return (CONNECTION_BUCKETS as readonly string[]).includes(v) ? (v as ConnectionBucket) : null
}
