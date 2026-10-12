#!/usr/bin/env node
/**
 * AC-10 · 生命周期清理 CLI（**默认 dry-run**）
 *
 * 与 `src/lib/lifecycle/sweep.ts` 同一套政策 —— 用直连 libSQL 复刻，
 * 目的是**在没有 Next 运行时的情况下**也能先看一眼"会删什么"（生产排障常用）。
 *
 * ## 为什么按 id 删、而不是把保留期写进 SQL
 *
 * 生产库里**日期格式不统一**（已实测）：
 *   · `Notification.createdAt` = `2026-04-14T22:37:44.324Z`（Z 结尾）
 *   · Prisma 写的 = `2026-10-12T06:31:11.687+00:00`（+00:00 结尾）
 * 字符串比较只在**跨日**时安全。对一个删除作业来说这不够，所以这里
 * **取候选 → 用 Date 解析后判定 → 按 id 删**（与 sweep.ts 同构）。
 *
 * ⚠️ 复刻 = 有漂移风险。保留期常量与 `policy.ts` 默认值逐字对齐；
 *    真正的判定由 `tests/lifecycle/policy.test.ts` 守。
 *
 * 用法：
 *   node scripts/qa/lifecycle-sweep.mjs            # dry-run（默认）
 *   node scripts/qa/lifecycle-sweep.mjs --apply    # 真删
 *
 * 环境：仓库根 .env.local（优先）/ .env 的 DATABASE_URL + TURSO_AUTH_TOKEN。
 * 覆盖：LIFECYCLE_TERMINAL_JOB_DAYS / LIFECYCLE_STALE_PENDING_DAYS /
 *       LIFECYCLE_DELIVERY_EVIDENCE_DAYS / LIFECYCLE_READ_NOTIFICATION_DAYS / LIFECYCLE_BATCH_SIZE
 *
 * ⚠️ libSQL 的 execute() 返回 `{ rows }` 而**不是数组**（本项目踩过的假绿坑）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

function loadEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[line.slice(0, eq).trim()] = v
  }
  return out
}

const env = {
  ...loadEnvFile(path.join(ROOT, '.env')),
  ...loadEnvFile(path.join(ROOT, '.env.local')),
  ...process.env,
}

function num(key, fallback) {
  const raw = (env[key] || '').trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const POLICY = {
  terminalJobDays: num('LIFECYCLE_TERMINAL_JOB_DAYS', 90),
  stalePendingDays: num('LIFECYCLE_STALE_PENDING_DAYS', 7),
  evidenceDays: num('LIFECYCLE_DELIVERY_EVIDENCE_DAYS', 730),
  readNotificationDays: num('LIFECYCLE_READ_NOTIFICATION_DAYS', 60),
  batchSize: num('LIFECYCLE_BATCH_SIZE', 500),
}

const TERMINAL_JOB_STATUSES = ['SUCCEEDED', 'FAILED', 'DEAD', 'TAKEN_OVER', 'CANCELLED']
const DELIVERY_CANDIDATE_STATUSES = ['PENDING', 'SENT', 'CAPTURED', 'FAILED']

const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const cutoff = (days) => now.getTime() - days * DAY

// ── 与 policy.ts 一一对应的判定（日期解析成 Date 再比，格式无关）──
const isPurgeJob = (row) =>
  TERMINAL_JOB_STATUSES.includes(row.status) &&
  new Date(row.createdAt).getTime() < cutoff(POLICY.terminalJobDays)

const isPurgeDelivery = (row) => {
  const t = new Date(row.createdAt).getTime()
  if (!Number.isFinite(t)) return false
  if (row.status === 'PENDING') return t < cutoff(POLICY.stalePendingDays)
  if (['SENT', 'CAPTURED', 'FAILED'].includes(row.status)) return t < cutoff(POLICY.evidenceDays)
  return false
}

const isPurgeNotification = (row) =>
  row.isRead === 1 || row.isRead === true
    ? new Date(row.createdAt).getTime() < cutoff(POLICY.readNotificationDays)
    : false

const apply = process.argv.includes('--apply')
const batch = Math.min(Math.max(Math.trunc(POLICY.batchSize), 1), 5000)
const scan = Math.min(batch * 4, 20000)

const url = env.DATABASE_URL
const authToken = env.TURSO_AUTH_TOKEN
if (!url) {
  console.error('❌ 未找到 DATABASE_URL')
  process.exit(2)
}

const db = createClient({ url, authToken })
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows

const phases = [
  {
    name: '终态任务 WorkflowJob',
    table: 'WorkflowJob',
    whereStatuses: TERMINAL_JOB_STATUSES,
    excludeStatuses: null,
    predicate: isPurgeJob,
    extraWhere: '',
    days: POLICY.terminalJobDays,
  },
  {
    name: '投递记录 NotificationDelivery',
    table: 'NotificationDelivery',
    whereStatuses: DELIVERY_CANDIDATE_STATUSES,
    excludeStatuses: null,
    predicate: isPurgeDelivery,
    extraWhere: '',
    days: `${POLICY.stalePendingDays}d(PENDING) / ${POLICY.evidenceDays}d(证据)`,
  },
  {
    name: '已读站内信 Notification',
    table: 'Notification',
    whereStatuses: null,
    excludeStatuses: null,
    predicate: isPurgeNotification,
    extraWhere: ' AND "isRead" = 1',
    days: POLICY.readNotificationDays,
  },
]

console.log(`\n━━━ AC-10 生命周期清理 ${apply ? '（APPLY 真删）' : '（DRY-RUN 只统计）'} ━━━`)
console.log(
  `保留期：终态任务 ${POLICY.terminalJobDays}d · 僵死PENDING ${POLICY.stalePendingDays}d · 证据 ${POLICY.evidenceDays}d · 已读站内信 ${POLICY.readNotificationDays}d · 批次 ${batch}`
)
console.log(
  `目标库：${(() => {
    try {
      return new URL(url).host
    } catch {
      return 'unknown'
    }
  })()}\n`
)

let totalScanned = 0
let totalMatched = 0
let totalPurged = 0

for (const phase of phases) {
  const statusClause = phase.whereStatuses
    ? ` AND "status" IN (${phase.whereStatuses.map(() => '?').join(',')})`
    : ''
  const args = phase.whereStatuses ? [...phase.whereStatuses] : []
  const rows = await q(
    `SELECT "id", "createdAt"${phase.table === 'WorkflowJob' ? ', "status"' : ''}${
      phase.table === 'NotificationDelivery' ? ', "status"' : ''
    }${phase.table === 'Notification' ? ', "isRead"' : ''}
       FROM "${phase.table}" WHERE 1=1${statusClause}${phase.extraWhere}
      ORDER BY "createdAt" ASC LIMIT ?`,
    [...args, scan]
  )
  totalScanned += rows.length
  const victims = rows.filter(phase.predicate).slice(0, batch)
  totalMatched += victims.length

  let purged = 0
  if (apply && victims.length > 0) {
    const ids = victims.map((r) => String(r.id))
    const res = await db.execute({
      sql: `DELETE FROM "${phase.table}" WHERE "id" IN (${ids.map(() => '?').join(',')})`,
      args: ids,
    })
    purged = Number(res.rowsAffected ?? 0)
    totalPurged += purged
  }

  console.log(
    `  ${phase.name.padEnd(28)} 扫描 ${String(rows.length).padStart(4)} · 命中 ${String(victims.length).padStart(4)}${
      apply ? ` → 删除 ${purged}` : ''
    }   [保留 ${phase.days}]`
  )
}

console.log(
  `\n合计：扫描 ${totalScanned} · 命中 ${totalMatched}${apply ? ` · 实际删除 ${totalPurged}` : '（dry-run 未写库）'}`
)
console.log(apply ? '✅ 清理完成\n' : '提示：加 --apply 才会真删。\n')
