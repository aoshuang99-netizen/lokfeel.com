#!/usr/bin/env node
/**
 * 生产库只读快照：全表清单 + 关键业务表行数。
 *
 * 用途：迁移/发版前后对照，证明「纯新增」迁移对既有数据零影响。
 * 只读 —— 仅 SELECT，不产生任何写操作。
 *
 * 用法：
 *   node scripts/qa/db-snapshot.mjs before
 *   node scripts/qa/db-snapshot.mjs after
 *   # 输出 /tmp/lokfeel-db-snapshot-<label>.json
 *   # 对照：node scripts/qa/db-snapshot.mjs diff before after
 *
 * 环境：从仓库根的 .env.local（优先）/ .env 读取 DATABASE_URL 与 TURSO_AUTH_TOKEN。
 *
 * ⚠️ libSQL 的 execute() 返回 `{ rows }` 而**不是数组** —— 不能写 `(await execute())[0]`，
 *    否则恒为 undefined（本项目已踩过的假绿坑）。
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
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

/** 既有量级基线：迁移前应非零（用于证明迁移未动它们）。 */
const KEY_TABLES = [
  'User',
  'Profile',
  'Organization',
  'Membership',
  'Mission',
  'MissionParticipation',
  'IdempotencyRecord',
  'SocialIntent',
  'AuditLog',
  'TenantAuditEvent',
  'ConnectionProposal',
  'ProposalDecision',
  'WorkflowJob',
  'NotificationDelivery',
  'IntroductionWorkflow',
]

const snapFile = (label) => `/tmp/lokfeel-db-snapshot-${label}.json`

async function snapshot(label) {
  const env = {
    ...loadEnvFile(path.join(ROOT, '.env')),
    ...loadEnvFile(path.join(ROOT, '.env.local')),
  }
  const url = env.DATABASE_URL || process.env.DATABASE_URL
  const authToken = env.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN
  if (!url) {
    console.error('❌ 未找到 DATABASE_URL')
    process.exit(2)
  }

  const db = createClient({ url, authToken })
  const tablesRes = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    args: [],
  })
  const tables = tablesRes.rows.map((r) => String(r.name))

  const keyCounts = {}
  for (const t of KEY_TABLES) {
    if (!tables.includes(t)) {
      keyCounts[t] = null
      continue
    }
    const r = await db.execute({ sql: `SELECT COUNT(*) AS n FROM "${t}"`, args: [] })
    keyCounts[t] = Number(r.rows[0]?.n ?? -1)
  }

  const out = {
    label,
    at: new Date().toISOString(),
    host: (() => {
      try {
        return new URL(url).host
      } catch {
        return 'unknown'
      }
    })(),
    tableCount: tables.length,
    tables,
    keyCounts,
  }
  fs.writeFileSync(snapFile(label), JSON.stringify(out, null, 2))

  console.log(`✅ 快照 ${label} → ${snapFile(label)}`)
  console.log(`   表数量：${out.tableCount}`)
  for (const [k, v] of Object.entries(keyCounts)) {
    console.log(`   ${k.padEnd(22)} ${v === null ? '（不存在）' : v}`)
  }
  return out
}

function diff(a, b) {
  const A = JSON.parse(fs.readFileSync(snapFile(a), 'utf8'))
  const B = JSON.parse(fs.readFileSync(snapFile(b), 'utf8'))
  const added = B.tables.filter((t) => !A.tables.includes(t))
  const removed = A.tables.filter((t) => !B.tables.includes(t))

  console.log(`对照 ${a} → ${b}`)
  console.log(`  表数量：${A.tableCount} → ${B.tableCount}`)
  console.log(`  新增表（${added.length}）：${added.join(', ') || '（无）'}`)
  console.log(`  消失表（${removed.length}）：${removed.join(', ') || '（无）'}`)

  let changed = 0
  console.log('  既有表行数变化：')
  for (const k of Object.keys(A.keyCounts)) {
    const x = A.keyCounts[k]
    const y = B.keyCounts[k]
    if (x === null && y === null) continue
    if (x === null && y !== null) {
      console.log(`    ${k.padEnd(22)} 新建（${y} 行）`)
      continue
    }
    if (x !== y) {
      changed += 1
      console.log(`    ⚠️ ${k.padEnd(20)} ${x} → ${y}`)
    }
  }
  if (changed === 0) console.log('    （既有表行数全部未变 ✅）')

  // 已知的、按批次注册的"预期新增表"白名单 —— 迁移只做纯新增，以下均为预期内。
  // 每新增一个迁移批次，把它的表加到这里（否则 diff 会误报"预期之外的变更"）。
  const EXPECTED_NEW_TABLES = [
    // C2 · T05 双边同意
    'ConnectionProposal',
    'ProposalDecision',
    // C3 · T06 可靠投递与跟进状态机
    'WorkflowJob',
    'NotificationDelivery',
    'IntroductionWorkflow',
    // C4 · T08 成果验证
    'Outcome',
    'OutcomeVerification',
    // C5 · T08 组织级用量计费
    'UsageRecord',
    'BillingEvent',
  ]
  const unexpected = added.filter((t) => !EXPECTED_NEW_TABLES.includes(t))
  if (removed.length > 0 || unexpected.length > 0) {
    console.error('🔴 出现预期之外的变更，请人工复核')
    process.exit(1)
  }
  console.log('✅ 变更范围与「纯新增 C2–C5」预期一致')
}

const mode = process.argv[2]
if (mode === 'diff') {
  const a = process.argv[3]
  const b = process.argv[4]
  if (!a || !b) {
    console.error('用法：node scripts/qa/db-snapshot.mjs diff <before> <after>')
    process.exit(2)
  }
  diff(a, b)
} else {
  await snapshot(mode || 'snapshot')
}
