/**
 * AC-10 · 数据生命周期 —— **清理扫描**（有 IO，但完全由 `policy.ts` 的纯判定驱动）
 *
 * ## 为什么是"先扫候选、再用纯函数判、最后按 id 删"
 *
 * 最直觉的写法是把保留期直接写进 SQL 条件（`createdAt < cutoff`）。但那样有两个坑：
 *
 *   1. **判据会被复制两份**（SQL 一份、`policy.ts` 一份）→ 迟早漂移，
 *      而这里漂移的代价是"该清的没清 / 不该清的被删"。
 *   2. 🔴 **日期格式并不统一**。同一张库里同时存在两种写法：
 *      · Prisma 经 libSQL 写：`2026-10-12T06:31:11.687+00:00`
 *      · 早期脚本 / `toISOString()` 写：`2026-04-14T22:37:44.324Z`
 *      （已在本机生产库实测确认，`Notification.createdAt` 就是 `Z` 结尾。）
 *      字符串比较在这两种格式下**只在跨日时安全** —— 一旦落在同一天就是错的。
 *      对一个**删除**作业来说，这种"偶发误判"是不可接受的。
 *
 * 所以这里改成：查出最老的 N 条候选 → 用 `shouldPurge*`（把日期解析成 `Date` 再比）→
 * 只删判定为真的前 `batchSize` 条。于是：
 *   - 判定只剩**一个来源**；
 *   - 日期比较走 `Date` 对象，与存储格式无关；
 *   - 查询条件退化为纯粹的"候选范围"（状态过滤 + 排序 + 上限），不再承载政策。
 *
 * ## 其余纪律
 *
 *   - **两次调用**：libSQL/Prisma 的 `deleteMany` 没有 `take`，
 *     所以先 `findMany({ take })` 拿 id，再 `deleteMany({ id: { in } })` —— 破坏面有上界。
 *   - **`apply=false` 是真 dry-run**：只统计，不写。
 *   - **不写租户审计**：sweep 是全局的，逐租户写审计会把审计面刷爆，且清理不是业务动作；
 *     报告经日志与 HTTP 响应输出（见 `docs/implementation/LIFECYCLE.md`）。
 */

import { db } from '@/lib/db'
import { TERMINAL_JOB_STATUSES, type WorkflowJobStatus } from '@/lib/workflow/job-core'
import {
  DEFAULT_RETENTION,
  LIFECYCLE_POLICY_VERSION,
  describePolicy,
  shouldPurgeDelivery,
  shouldPurgeJob,
  shouldPurgeNotification,
  type RetentionPolicy,
} from './policy'

/** 投递记录里会被纳入候选的状态（未知状态不进候选 → 永不被删）。 */
const DELIVERY_CANDIDATE_STATUSES = ['PENDING', 'SENT', 'CAPTURED', 'FAILED'] as const

/** 候选扫描倍数：扫 `batchSize × 4` 条，最多删 `batchSize` 条。 */
const SCAN_MULTIPLIER = 4

export interface SweepReport {
  policyVersion: string
  /** true = 真删；false = dry-run（只统计）。 */
  apply: boolean
  /** 本次判定所用的"现在"。 */
  now: string
  /** 各实体扫描到的候选条数（有上界）。 */
  scanned: { jobs: number; deliveries: number; notifications: number }
  /** 判定为"该清"的条数（已被 `batchSize` 截断）。 */
  matched: { jobs: number; deliveries: number; notifications: number }
  /** 实际删除的条数（apply=false 时恒为 0）。 */
  purged: { jobs: number; deliveries: number; notifications: number }
}

export interface SweepOptions {
  now?: Date
  /** 默认 false —— dry-run 是默认动作。 */
  apply?: boolean
  policy?: RetentionPolicy
}

function cap(policy: RetentionPolicy): { batch: number; scan: number } {
  const batch = Math.min(Math.max(Math.trunc(policy.batchSize), 1), 5_000)
  return { batch, scan: Math.min(batch * SCAN_MULTIPLIER, 20_000) }
}

export async function runLifecycleSweep(opts: SweepOptions = {}): Promise<SweepReport> {
  const now = opts.now ?? new Date()
  const policy = opts.policy ?? DEFAULT_RETENTION
  const apply = opts.apply === true
  const { batch, scan } = cap(policy)

  // ── 1) 终态任务 ──
  // 候选范围 = 终态任务（按 createdAt 升序 → 最老的在最前）。
  // 🔴 非终态（PENDING/RUNNING）**根本不进候选**，与 `shouldPurgeJob` 的不变式双重保险。
  const jobCandidates = await db.workflowJob.findMany({
    // 展开成可变数组：`TERMINAL_JOB_STATUSES` 是 `readonly`（防止被就地改动），
    // 而 Prisma 的 `in` 需要可变数组。
    where: { status: { in: [...TERMINAL_JOB_STATUSES] } },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: scan,
  })
  const jobVictims = jobCandidates
    .filter((r) =>
      shouldPurgeJob({ status: r.status as WorkflowJobStatus, createdAt: r.createdAt }, now, policy)
    )
    .slice(0, batch)
    .map((r) => r.id)
  const purgedJobs = apply ? await deleteByIds('workflowJob', jobVictims) : 0

  // ── 2) 投递记录（两档：僵死 PENDING 短窗口，证据长窗口）──
  const deliveryCandidates = await db.notificationDelivery.findMany({
    where: { status: { in: [...DELIVERY_CANDIDATE_STATUSES] } },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: scan,
  })
  const deliveryVictims = deliveryCandidates
    .filter((r) =>
      shouldPurgeDelivery({ status: r.status as string, createdAt: r.createdAt }, now, policy)
    )
    .slice(0, batch)
    .map((r) => r.id)
  const purgedDeliveries = apply ? await deleteByIds('notificationDelivery', deliveryVictims) : 0

  // ── 3) 已读站内信（候选只含已读 → 未读永不进候选，也就永不删）──
  const notifCandidates = await db.notification.findMany({
    where: { isRead: true },
    select: { id: true, isRead: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: scan,
  })
  const notifVictims = notifCandidates
    .filter((r) => shouldPurgeNotification({ isRead: r.isRead, createdAt: r.createdAt }, now, policy))
    .slice(0, batch)
    .map((r) => r.id)
  const purgedNotifications = apply ? await deleteByIds('notification', notifVictims) : 0

  const report: SweepReport = {
    policyVersion: LIFECYCLE_POLICY_VERSION,
    apply,
    now: now.toISOString(),
    scanned: {
      jobs: jobCandidates.length,
      deliveries: deliveryCandidates.length,
      notifications: notifCandidates.length,
    },
    matched: {
      jobs: jobVictims.length,
      deliveries: deliveryVictims.length,
      notifications: notifVictims.length,
    },
    purged: {
      jobs: purgedJobs,
      deliveries: purgedDeliveries,
      notifications: purgedNotifications,
    },
  }

  console.log(
    `[lifecycle.sweep] ${apply ? 'APPLY' : 'DRY-RUN'} · ${describePolicy(policy)} · ` +
      `matched(j=${report.matched.jobs}, d=${report.matched.deliveries}, n=${report.matched.notifications}) · ` +
      `purged(j=${report.purged.jobs}, d=${report.purged.deliveries}, n=${report.purged.notifications})`
  )

  return report
}

/**
 * 按 id 批量删除。三条不同的 Prisma 委托无法用同一个泛型表达（模型类型不同），
 * 因此这里显式分支 —— 比 `any` 转换安全，也让"哪些表可以被删"一目了然。
 */
async function deleteByIds(
  model: 'workflowJob' | 'notificationDelivery' | 'notification',
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0
  const where = { id: { in: ids } }
  if (model === 'workflowJob') return (await db.workflowJob.deleteMany({ where })).count
  if (model === 'notificationDelivery')
    return (await db.notificationDelivery.deleteMany({ where })).count
  return (await db.notification.deleteMany({ where })).count
}
