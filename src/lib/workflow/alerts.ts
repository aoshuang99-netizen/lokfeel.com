/**
 * T06 · 运营告警（R9 的消解）
 *
 * R9 记录的事实：任务进 `DEAD` 之后**只有人主动打开** `/api/v1/workflow/overview`
 * 才看得见 `needsAttention`，没有任何主动推送。结果是"死信静静地躺着"。
 *
 * 本模块把这件事补上 —— 但**刻意不引入第二条通知管道**：
 *
 *   1. **不产生 `WorkflowJob`**。告警是**直接投递**（`deliverNotification()`），
 *      不经过 outbox。这样"告警投递失败"永远不会变成一条新的待处理任务 ——
 *      否则就是 R9 警告的"用通知管道通知自己"的回路。
 *   2. **失败只记审计、只计数**，向上抛不出去（调用方是 cron，抛了也没人接）。
 *   3. **按日去重**：幂等键含日期，同一个租户对同一个人一天最多一条告警。
 *      没有这层，"每次 tick 都告一次"会在小时级调度下变成噪音。
 *   4. **内容零业务文本**（`missionTitle: null`、无 `protectedTexts`）：
 *      告警只说"有待处置项"，不说是谁的任务 —— 多说一个字都是多余的披露面。
 *
 * 判据与运营视图**共用同一常量** `ATTENTION_JOB_STATUSES`（workflow.ts），
 * 避免"视图里有红点、告警却没触发"这类两处漂移。
 */

import { db } from '@/lib/db'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { deliverNotification } from './delivery'
import type { NotificationTemplate } from './notification-content'
import { ATTENTION_JOB_STATUSES } from './workflow'

/** 告警模板（收件人是运营/管理员，不是成员）。 */
export const OPERATOR_ALERT_TEMPLATE: NotificationTemplate = 'operator.attention'

/** 收件人角色：能**处置**死信的是 workflow.manage 持有者（ADMIN+）与所有者。 */
const OPERATOR_ALERT_ROLES: ('OWNER' | 'ADMIN' | 'OPERATOR')[] = ['OWNER', 'ADMIN', 'OPERATOR']

/**
 * 告警的落地页。
 *
 * ⚠️ 现阶段指向**已存在**的站内通知页，避免造出一个点进去 404 的"空按钮"
 * （AC-18 的取向）。T07 的运营控制台落地后，这里改指 `/console/workflow` 即可。
 */
export const OPERATOR_ALERT_ACTION_URL = '/dashboard/notifications'

export const DEFAULT_ALERT_ORG_LIMIT = 50

/**
 * 告警去重的"天"粒度（UTC）。纯函数，便于确定性断言。
 *
 * 为什么用天而不是小时：小时级调度 + 死信不会自愈 → 每小时一条是纯噪音；
 * 一天一条足以让运营注意到，且不会淹没站内信。
 */
export function alertDayKey(now: Date): string {
  return now.toISOString().slice(0, 10) // YYYY-MM-DD（UTC）
}

/**
 * 告警幂等键。
 *
 * 形状与 `deliveryDedupeKey()` 一致（`<kind>:...:<recipientId>`），
 * 因为 `NotificationDelivery` 的唯一约束是 `(organizationId, dedupeKey)` ——
 * **必须把收件人编进键里**，否则同一租户的第二个运营收不到告警。
 */
export function operatorAlertDedupeKey(recipientId: string, now: Date): string {
  return `alert:attention:${alertDayKey(now)}:${recipientId}`
}

export interface AttentionAlertReport {
  /** 扫描到的、有待处置任务的租户数。 */
  scannedOrgs: number
  /** 实际投出（或复用）告警的租户数。 */
  alertedOrgs: number
  /** 通知投递成功（含命中幂等的复用）。 */
  delivered: number
  /** 命中已有记录、本次未产生新投递。 */
  replayed: number
  /** 投递失败的条数（只计数，不抛错）。 */
  failed: number
  /** 有待处置任务但**找不到可通知的人**的租户数（静默 —— 需在日志里可见）。 */
  orphanedOrgs: number
}

/** 列出某租户里应当收到运营告警的人（活跃的 OWNER/ADMIN/OPERATOR）。 */
export async function listAlertRecipients(organizationId: string): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: { in: OPERATOR_ALERT_ROLES },
    },
    select: { userId: true },
    take: 50,
  })
  return rows.map((r) => r.userId)
}

/** 哪些租户当前有"需要人处置"的任务。 */
export async function findOrgsWithAttention(limit = DEFAULT_ALERT_ORG_LIMIT): Promise<string[]> {
  const grouped = await db.workflowJob.groupBy({
    by: ['organizationId'],
    where: { status: { in: ATTENTION_JOB_STATUSES } },
    _count: { _all: true },
    orderBy: { _count: { organizationId: 'desc' } },
    take: limit,
  })
  return grouped.map((g) => g.organizationId)
}

/**
 * 扫描全部租户，对"有待处置任务"的租户向运营投递一条站内告警。
 *
 * @returns 结构化报告（供 cron 端点回显 —— 这也是本功能可被 E2E 断言的形状）。
 */
export async function alertOperatorsOfAttention(
  opts: { now?: Date; limit?: number; organizationIds?: string[] } = {}
): Promise<AttentionAlertReport> {
  const now = opts.now ?? new Date()
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_ALERT_ORG_LIMIT, 1), 200)

  const orgIds = opts.organizationIds?.length
    ? opts.organizationIds.slice(0, limit)
    : await findOrgsWithAttention(limit)

  const report: AttentionAlertReport = {
    scannedOrgs: orgIds.length,
    alertedOrgs: 0,
    delivered: 0,
    replayed: 0,
    failed: 0,
    orphanedOrgs: 0,
  }
  if (orgIds.length === 0) return report

  const orgs = await db.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, name: true },
  })
  const nameById = new Map(orgs.map((o) => [o.id, o.name]))

  for (const organizationId of orgIds) {
    const organizationName = nameById.get(organizationId) ?? '你的社群'

    let recipients: string[]
    try {
      recipients = await listAlertRecipients(organizationId)
    } catch (err) {
      // 读收件人失败 → 计数、跳过。绝不向上抛（cron 抛了只会变成 500）。
      report.failed++
      logAlertFailure(organizationId, err, 'list-recipients')
      continue
    }

    if (recipients.length === 0) {
      // 有死信却没人可通知 —— 这是**运维信号**（租户没有管理员了），必须留痕。
      report.orphanedOrgs++
      console.warn('[workflow.alerts] 有待处置任务但无 OWNER/ADMIN/OPERATOR 可通知', {
        organizationId,
      })
      continue
    }

    let anyDelivered = false
    for (const recipientId of recipients) {
      try {
        const result = await deliverNotification(
          {
            organizationId,
            dedupeKey: operatorAlertDedupeKey(recipientId, now),
            channel: 'IN_APP',
            recipientId,
            template: OPERATOR_ALERT_TEMPLATE,
            organizationName,
            // 零业务文本：见文件头第 4 条。
            missionTitle: null,
            actionUrl: OPERATOR_ALERT_ACTION_URL,
          },
          { now }
        )
        if (result.replayed) report.replayed++
        else report.delivered++
        anyDelivered = true
      } catch (err) {
        report.failed++
        logAlertFailure(organizationId, err, 'deliver')
      }
    }

    if (anyDelivered) report.alertedOrgs++
  }

  // 审计：一次扫描一条汇总事件（不逐条写，避免审计面被告警刷屏）。
  for (const organizationId of orgIds) {
    await writeTenantAudit({
      organizationId,
      actorId: null, // 系统触发
      eventType: 'workflow.operator_alerted',
      resourceType: 'workflow_job',
      resourceId: null,
      safeMetadata: {
        day: alertDayKey(now),
        scanned: report.scannedOrgs,
        delivered: report.delivered,
        replayed: report.replayed,
        failed: report.failed,
      },
    })
  }

  return report
}

function logAlertFailure(organizationId: string, err: unknown, stage: string): void {
  console.error('[workflow.alerts] failed:', {
    stage,
    organizationId,
    message: err instanceof Error ? err.message : String(err),
  })
}
