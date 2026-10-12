#!/usr/bin/env node
/**
 * AC-10 · 生命周期清理的**自证夹具**（独立库 `/tmp/lifecycle-e2e.db`）
 *
 * ## 为什么需要它
 *
 * 生产库里当前"命中 0"是**真零**（`WorkflowJob` 0 行、`Notification` 60 行但全未读），
 * 因此跑一次 dry-run 得到 0 **不能**证明清理逻辑是对的 —— 它同样可能是
 * "查询写错、什么都没扫到"的假绿。这个夹具造出**必然该清 / 必然不该清**的样本，
 * 让"命中数"变成一个可以对着期望值核对的数字（负向验证要自证变异确实发生）。
 *
 * ## 样本矩阵（期望值写死在表里，见下）
 *
 * | 表 | id | 特征 | 期望 |
 * |---|---|---|---|
 * | WorkflowJob | `wj_lc_terminal_old` | SUCCEEDED，200 天前 | ✅ 清 |
 * | WorkflowJob | `wj_lc_terminal_new` | SUCCEEDED，3 天前 | ❌ 留 |
 * | WorkflowJob | `wj_lc_pending_old` | **PENDING**，4000 天前 | ❌ 留（不变式！） |
 * | NotificationDelivery | `nd_lc_pending_stale` | PENDING，30 天前 | ✅ 清 |
 * | NotificationDelivery | `nd_lc_sent_100d` | SENT，100 天前 | ❌ 留（证据 730d 窗口） |
 * | NotificationDelivery | `nd_lc_sent_old` | SENT，800 天前 | ✅ 清 |
 * | Notification | `nt_lc_read_old` | 已读，100 天前 | ✅ 清 |
 * | Notification | `nt_lc_unread_old` | **未读**，4000 天前 | ❌ 留（用户还没看见） |
 *
 * 用法：
 *   node scripts/qa/seed-lifecycle-e2e.mjs
 *   DATABASE_URL=file:/tmp/lifecycle-e2e.db node scripts/qa/lifecycle-sweep.mjs
 *   DATABASE_URL=file:/tmp/lifecycle-e2e.db node scripts/qa/lifecycle-sweep.mjs --apply
 */

import fs from 'node:fs'
import { createClient } from '@libsql/client'

const DB_FILE = process.env.LIFECYCLE_E2E_DB || '/tmp/lifecycle-e2e.db'

/** 与 `src/lib/lifecycle/policy.ts` 的默认窗口对齐（改动需同步）。 */
const POLICY = { terminalJobDays: 90, stalePendingDays: 7, evidenceDays: 730, readNotificationDays: 60 }

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString().replace('Z', '+00:00')

// 期望值（供断言 / 人工核对）
export const EXPECTED = { jobs: 1, deliveries: 2, notifications: 1 }

const DDL = [
  `CREATE TABLE IF NOT EXISTS "WorkflowJob" (
     "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
     "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "proposalId" TEXT,
     "missionId" TEXT, "payload" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
     "maxAttempts" INTEGER NOT NULL DEFAULT 5, "nextAttemptAt" TEXT NOT NULL,
     "lockedBy" TEXT, "lockedUntil" TEXT, "lastError" TEXT, "deadLetteredAt" TEXT,
     "takenOverBy" TEXT, "takenOverAt" TEXT, "cancelledAt" TEXT, "completedAt" TEXT,
     "createdAt" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
  `CREATE TABLE IF NOT EXISTS "NotificationDelivery" (
     "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
     "channel" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "recipientId" TEXT NOT NULL,
     "template" TEXT NOT NULL, "subject" TEXT, "body" TEXT NOT NULL, "actionUrl" TEXT,
     "capturedAt" TEXT, "provider" TEXT, "providerMessageId" TEXT, "failureReason" TEXT,
     "sentAt" TEXT, "createdAt" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     "updatedAt" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
  `CREATE TABLE IF NOT EXISTS "Notification" (
     "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
     "title" TEXT NOT NULL, "body" TEXT NOT NULL, "data" TEXT, "actionUrl" TEXT,
     "isRead" INTEGER NOT NULL DEFAULT 0, "readAt" TEXT,
     "createdAt" TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
]

const job = (id, status, days, extra = {}) => ({
  id,
  status,
  createdAt: daysAgo(days),
  nextAttemptAt: daysAgo(days),
  ...extra,
})

const JOB_ROWS = [
  job('wj_lc_terminal_old', 'SUCCEEDED', 200),
  job('wj_lc_terminal_new', 'SUCCEEDED', 3),
  job('wj_lc_pending_old', 'PENDING', 4000), // 🔴 不变式：永不清
]

const DELIVERY_ROWS = [
  { id: 'nd_lc_pending_stale', status: 'PENDING', createdAt: daysAgo(30) }, // ✅ 清
  { id: 'nd_lc_sent_100d', status: 'SENT', createdAt: daysAgo(100) }, // ❌ 留（证据窗口）
  { id: 'nd_lc_sent_old', status: 'SENT', createdAt: daysAgo(800) }, // ✅ 清
]

const NOTIF_ROWS = [
  { id: 'nt_lc_read_old', isRead: 1, createdAt: daysAgo(100) }, // ✅ 清
  { id: 'nt_lc_unread_old', isRead: 0, createdAt: daysAgo(4000) }, // ❌ 留
]

async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE)
  const db = createClient({ url: `file:${DB_FILE}` })

  for (const sql of DDL) await db.execute(sql)

  // 幂等：先清自己命名空间的残留（这里是全新库，保险起见）
  await db.execute(`DELETE FROM "WorkflowJob" WHERE "id" LIKE 'wj_lc_%'`)
  await db.execute(`DELETE FROM "NotificationDelivery" WHERE "id" LIKE 'nd_lc_%'`)
  await db.execute(`DELETE FROM "Notification" WHERE "id" LIKE 'nt_lc_%'`)

  for (const r of JOB_ROWS) {
    await db.execute({
      sql: `INSERT INTO "WorkflowJob" ("id","organizationId","dedupeKey","kind","status","nextAttemptAt","createdAt")
            VALUES (?, 'org_lc', ?, 'INTRODUCE_CONNECTION', ?, ?, ?)`,
      args: [r.id, `lc:${r.id}`, r.status, r.nextAttemptAt, r.createdAt],
    })
  }
  for (const r of DELIVERY_ROWS) {
    await db.execute({
      sql: `INSERT INTO "NotificationDelivery" ("id","organizationId","dedupeKey","channel","status","recipientId","template","body","createdAt","updatedAt")
            VALUES (?, 'org_lc', ?, 'IN_APP', ?, 'u_lc', 'operator.attention', 'body', ?, ?)`,
      args: [r.id, `lc:${r.id}`, r.status, r.createdAt, r.createdAt],
    })
  }
  for (const r of NOTIF_ROWS) {
    await db.execute({
      sql: `INSERT INTO "Notification" ("id","userId","type","title","body","isRead","createdAt")
            VALUES (?, 'u_lc', 'SYSTEM_ANNOUNCEMENT', 't', 'b', ?, ?)`,
      args: [r.id, r.isRead, r.createdAt],
    })
  }

  console.log(`✅ 夹具就绪 → ${DB_FILE}`)
  console.log(`   保留期：终态任务 ${POLICY.terminalJobDays}d · 僵死PENDING ${POLICY.stalePendingDays}d · 证据 ${POLICY.evidenceDays}d · 已读站内信 ${POLICY.readNotificationDays}d`)
  console.log(
    `   期望命中：WorkflowJob ${EXPECTED.jobs}（只有 wj_lc_terminal_old）· ` +
      `NotificationDelivery ${EXPECTED.deliveries}（pending_stale + sent_old）· ` +
      `Notification ${EXPECTED.notifications}（read_old）`
  )
  console.log(`\n   DATABASE_URL=file:${DB_FILE} node scripts/qa/lifecycle-sweep.mjs`)
}

await main()
