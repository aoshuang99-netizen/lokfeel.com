/**
 * AC-10 · 数据生命周期 —— **保留政策**（纯函数，无 IO）
 *
 * ## 为什么有这个文件
 *
 * AC-10（BLOCKER）写的是「导出、删除、缓存/索引/任务清理按政策生效」。
 * T00–T12 的任务卡里**没人认领**它；T05 只认领了"满足阻断条件所需的那一小步"，
 * 并且在 `T05/risks.md` R7 记下了它与 AC-10 取向不一致的地方。T06 又新增了两张
 * 只增不减的表（`WorkflowJob` / `NotificationDelivery`）—— 于是它更没人管了。
 *
 * 本文件把**「按政策生效」这四个字变成可执行、可断言的东西**：
 *   政策在这里是**数据**（`RetentionPolicy`），判定是**纯函数**（`shouldPurge*`），
 *   因此"某天界限之前的终态任务该不该清"可以离线断言，不需要真库。
 *
 * ## 覆盖边界（诚实清单）
 *
 * ✅ 已覆盖：**任务清理**（终态 `WorkflowJob`）+ **通知保留期**
 *    （`NotificationDelivery` 的僵死 PENDING 与超长证据窗口；站内信 `Notification` 的已读清理）。
 * ❌ 仍未覆盖：**导出**（数据可携带）与**删除请求**（被遗忘权）的端到端流程。
 *    见 `docs/implementation/LIFECYCLE.md` §"仍开放"，不要因为这里打了勾就当作 AC-10 已闭合。
 *
 * ## ⚠️ 与 AC-09 的张力（必须显式记录）
 *
 * `NotificationDelivery` 同时是 **AC-09 的证据面**（"要发什么"的快照）。
 * 清它 = 削弱证据。因此默认策略把**证据窗口放得很长**（2 年），
 * 且**只清"僵死 PENDING"**（从未成功投出的半成品记录，不是证据）。
 * 若将来为了省空间把 `deliveryEvidenceDays` 调小，那是**一次合规决策**，
 * 必须在 `LIFECYCLE.md` 里留痕，不要悄悄改数字。
 */

import { TERMINAL_JOB_STATUSES, type WorkflowJobStatus } from '@/lib/workflow/job-core'

/** 政策版本。写进审计与清理报告，便于回答"当时按哪版政策清的"。 */
export const LIFECYCLE_POLICY_VERSION = '2026-10-12'

export interface RetentionPolicy {
  /** 终态任务（SUCCEEDED/FAILED/DEAD/TAKEN_OVER/CANCELLED）保留天数。 */
  terminalJobDays: number
  /** 僵死 PENDING 投递记录（从未成功投出）的保留天数 —— 这不是证据，是半成品。 */
  stalePendingDeliveryDays: number
  /** 投递**证据**（SENT/CAPTURED/FAILED）的保留天数。⚠️ 调小 = 削弱 AC-09 证据。 */
  deliveryEvidenceDays: number
  /** 已读站内信的保留天数（未读的永不清 —— 用户还没看见）。 */
  readNotificationDays: number
  /** 单次 sweep 每个实体的最大删除条数（防止一次清空把函数拖死）。 */
  batchSize: number
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  terminalJobDays: 90,
  stalePendingDeliveryDays: 7,
  deliveryEvidenceDays: 730, // 2 年
  readNotificationDays: 60,
  batchSize: 500,
}

/** 政策字段允许被环境变量覆盖（便于不同环境用不同窗口，而不改代码）。 */
export function policyFromEnv(env: Record<string, string | undefined> = process.env): RetentionPolicy {
  const num = (key: string, fallback: number): number => {
    const raw = env[key]?.trim()
    if (!raw) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    terminalJobDays: num('LIFECYCLE_TERMINAL_JOB_DAYS', DEFAULT_RETENTION.terminalJobDays),
    stalePendingDeliveryDays: num(
      'LIFECYCLE_STALE_PENDING_DAYS',
      DEFAULT_RETENTION.stalePendingDeliveryDays
    ),
    deliveryEvidenceDays: num(
      'LIFECYCLE_DELIVERY_EVIDENCE_DAYS',
      DEFAULT_RETENTION.deliveryEvidenceDays
    ),
    readNotificationDays: num(
      'LIFECYCLE_READ_NOTIFICATION_DAYS',
      DEFAULT_RETENTION.readNotificationDays
    ),
    batchSize: num('LIFECYCLE_BATCH_SIZE', DEFAULT_RETENTION.batchSize),
  }
}

/** 保留期 → 截止时刻。`now - days`。 */
export function cutoffFor(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

// ═══════════════════════════════════════════════════════════════
// 判定（纯函数）
// ═══════════════════════════════════════════════════════════════

/**
 * 终态任务是否可清。
 *
 * 🔴 **非终态任务永远不清** —— 这是本文件最重要的一条不变式：
 * PENDING / RUNNING 是"还没做完的事"，清掉它就是丢工作，不是清理。
 */
export function shouldPurgeJob(
  row: { status: WorkflowJobStatus; createdAt: Date },
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION
): boolean {
  if (!TERMINAL_JOB_STATUSES.includes(row.status)) return false
  return row.createdAt.getTime() < cutoffFor(policy.terminalJobDays, now).getTime()
}

/**
 * 投递记录是否可清。
 *
 * 分两档，因为两者的性质完全不同：
 *   - `PENDING` = 从未成功投出的半成品 → 短窗口（僵死则清）；
 *   - `SENT`/`CAPTURED`/`FAILED` = **证据** → 长窗口（默认 2 年）。
 */
export function shouldPurgeDelivery(
  row: { status: string; createdAt: Date },
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION
): boolean {
  if (row.status === 'PENDING') {
    return row.createdAt.getTime() < cutoffFor(policy.stalePendingDeliveryDays, now).getTime()
  }
  if (row.status === 'SENT' || row.status === 'CAPTURED' || row.status === 'FAILED') {
    return row.createdAt.getTime() < cutoffFor(policy.deliveryEvidenceDays, now).getTime()
  }
  // 未知状态：不清（宁可留下，也不要因为枚举漂移而误删）。
  return false
}

/**
 * 站内信是否可清。
 *
 * **只清已读的**：未读 = 用户还没看见 = 清了就是丢消息。
 */
export function shouldPurgeNotification(
  row: { isRead: boolean; createdAt: Date },
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION
): boolean {
  if (!row.isRead) return false
  return row.createdAt.getTime() < cutoffFor(policy.readNotificationDays, now).getTime()
}

/** 人类可读的政策摘要（写日志/报告用）。 */
export function describePolicy(policy: RetentionPolicy = DEFAULT_RETENTION): string {
  return [
    `v${LIFECYCLE_POLICY_VERSION}`,
    `终态任务 ${policy.terminalJobDays}d`,
    `僵死PENDING ${policy.stalePendingDeliveryDays}d`,
    `投递证据 ${policy.deliveryEvidenceDays}d`,
    `已读站内信 ${policy.readNotificationDays}d`,
    `批次 ${policy.batchSize}`,
  ].join(' · ')
}
