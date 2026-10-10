#!/usr/bin/env node
/**
 * T02 · Connection OS Mission 迁移（批次 C0）
 *
 * 用法：
 *   node scripts/connection/migrate.mjs probe                     # 只读：表/列/索引现状
 *   node scripts/connection/migrate.mjs plan                      # 只读：打印将执行的 SQL
 *   node scripts/connection/migrate.mjs apply --batch=C0 --yes    # 执行（需二次确认）
 *   node scripts/connection/migrate.mjs rollback --batch=C0 --yes # 回滚（逆序删表）
 *   node scripts/connection/migrate.mjs verify                    # 对账断言
 *
 * 设计约束（继承 T01 的 scripts/tenancy/migrate.mjs）：
 *   1. **纯新增** —— 本批次只 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`，
 *      不改动既有 42 张表的任何列。因此零停机、零回归。
 *   2. **幂等** —— 所有语句都带 IF NOT EXISTS；重复执行为空操作。
 *   3. **默认只读** —— 不带 `--apply` 不产生任何写操作。
 *   4. **禁止 `prisma db push`** —— 远程 Turso 会 P1013 失败（本项目既有约束）。
 *   5. **DDL 来源权威** —— 表结构由 `prisma migrate diff --from-empty --to-schema prisma/schema`
 *      生成后**原样抄录**，不做手写猜测；这样 Prisma client 与真实表结构不会漂移。
 *
 * 环境：从 .env.local（优先）/ .env 读取 DATABASE_URL 与 TURSO_AUTH_TOKEN。
 *      可在命令行覆盖：--url=<libsql url> --token=<auth token>
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

/** 本批次的表（顺序 = 建表顺序；回滚时逆序删除）。 */
export const C0_TABLES = ['Mission', 'MissionParticipation', 'IdempotencyRecord']

// ══════════════════════════════════════════════════════════════════════
// 环境加载
// ══════════════════════════════════════════════════════════════════════

function loadEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  const text = fs.readFileSync(file, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function resolveConnection(args) {
  const env = {
    ...loadEnvFile(path.join(ROOT, '.env')),
    ...loadEnvFile(path.join(ROOT, '.env.local')),
  }
  const url = args.url || env.DATABASE_URL || process.env.DATABASE_URL
  const authToken =
    args.token || env.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined
  if (!url) {
    console.error('❌ 未找到 DATABASE_URL（可显式传 --url=...）')
    process.exit(2)
  }
  return { url, authToken }
}

function parseArgs(argv) {
  const args = { _: [] }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      args[k] = v === undefined ? true : v
    } else {
      args._.push(a)
    }
  }
  return args
}

const maskHost = (url) => {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return url.slice(0, 24) + '…'
  }
}

// ══════════════════════════════════════════════════════════════════════
// SQL 定义（权威来源：prisma migrate diff 输出，原样抄录）
// ══════════════════════════════════════════════════════════════════════

function sqlC0() {
  return [
    `CREATE TABLE IF NOT EXISTS "Mission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "offer" TEXT NOT NULL,
  "constraints" TEXT,
  "successCriteria" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "shareToken" TEXT NOT NULL,
  "publicPreview" BOOLEAN NOT NULL DEFAULT true,
  "maxParticipants" INTEGER,
  "expiresAt" DATETIME,
  "publishedAt" DATETIME,
  "closedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Mission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Mission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Mission_shareToken_key" ON "Mission"("shareToken")`,
    `CREATE INDEX IF NOT EXISTS "Mission_organizationId_status_idx" ON "Mission"("organizationId", "status")`,
    `CREATE INDEX IF NOT EXISTS "Mission_organizationId_createdAt_idx" ON "Mission"("organizationId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "Mission_expiresAt_idx" ON "Mission"("expiresAt")`,

    `CREATE TABLE IF NOT EXISTS "MissionParticipation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INTERESTED',
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MissionParticipation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MissionParticipation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MissionParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "MissionParticipation_missionId_userId_key" ON "MissionParticipation"("missionId", "userId")`,
    `CREATE INDEX IF NOT EXISTS "MissionParticipation_organizationId_status_idx" ON "MissionParticipation"("organizationId", "status")`,
    `CREATE INDEX IF NOT EXISTS "MissionParticipation_userId_status_idx" ON "MissionParticipation"("userId", "status")`,

    `CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_scope_key_key" ON "IdempotencyRecord"("organizationId", "scope", "key")`,
    `CREATE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_createdAt_idx" ON "IdempotencyRecord"("organizationId", "createdAt")`,
  ]
}

/** 期望存在的索引（verify 断言用）。 */
const EXPECTED_INDEXES = [
  { name: 'Mission_shareToken_key', table: 'Mission', unique: true },
  { name: 'Mission_organizationId_status_idx', table: 'Mission', unique: false },
  { name: 'Mission_organizationId_createdAt_idx', table: 'Mission', unique: false },
  { name: 'Mission_expiresAt_idx', table: 'Mission', unique: false },
  { name: 'MissionParticipation_missionId_userId_key', table: 'MissionParticipation', unique: true },
  { name: 'MissionParticipation_organizationId_status_idx', table: 'MissionParticipation', unique: false },
  { name: 'MissionParticipation_userId_status_idx', table: 'MissionParticipation', unique: false },
  { name: 'IdempotencyRecord_organizationId_scope_key_key', table: 'IdempotencyRecord', unique: true },
  { name: 'IdempotencyRecord_organizationId_createdAt_idx', table: 'IdempotencyRecord', unique: false },
]

/** 期望存在的外键（表 → 引用目标），verify 断言用。 */
const EXPECTED_FKS = [
  { table: 'Mission', target: 'Organization' },
  { table: 'Mission', target: 'User' },
  { table: 'MissionParticipation', target: 'Organization' },
  { table: 'MissionParticipation', target: 'Mission' },
  { table: 'MissionParticipation', target: 'User' },
  { table: 'IdempotencyRecord', target: 'Organization' },
]

// ══════════════════════════════════════════════════════════════════════
// 只读探测
// ══════════════════════════════════════════════════════════════════════

async function listTables(client) {
  const r = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )
  return r.rows.map((row) => String(row.name))
}

/**
 * ⚠️ 表不存在时 `PRAGMA table_info` 返回**空结果集**而非报错。
 * 必须显式判长度 → 返回 null；直接返回 `[]` 会被后续 `if (!cols)` 误判为"存在"
 * （T01 的真实踩坑，见 docs/implementation/T01/changes.md §5）。
 */
async function tableColumns(client, table) {
  try {
    const r = await client.execute(`PRAGMA table_info("${table}")`)
    if (r.rows.length === 0) return null
    return r.rows.map((row) => String(row.name))
  } catch {
    return null
  }
}

/**
 * 行数统计。`where` 可选（含前导空格，如 ` WHERE "x" NOT IN (…)`）。
 *
 * ⚠️ 该参数**必须存在**：verify 的孤儿断言依赖它。若签名漏掉此参数，
 * `COUNT(*) FROM "表"` 会把**全表行数**当作「孤儿数」上报 —— 空库碰巧为 0
 * （假绿），非空库则稳定误报（假红），而引用完整性其实从未被校验。
 */
async function countRows(client, table, where = '') {
  try {
    const r = await client.execute(`SELECT COUNT(*) AS n FROM "${table}"${where}`)
    return Number(r.rows[0]?.n ?? 0)
  } catch {
    return null
  }
}

async function tableCreateSql(client, table) {
  try {
    const r = await client.execute(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
      [table]
    )
    return r.rows[0]?.sql ? String(r.rows[0].sql) : null
  } catch {
    return null
  }
}

async function indexRows(client, table) {
  try {
    const r = await client.execute(`PRAGMA index_list("${table}")`)
    return r.rows.map((row) => ({
      name: String(row.name),
      unique: Number(row.unique) === 1,
    }))
  } catch {
    return []
  }
}

async function probe(client) {
  const tables = await listTables(client)
  console.log(`\n发现 ${tables.length} 张表\n`)

  console.log('── C0 目标表状态 ──')
  for (const t of C0_TABLES) {
    const cols = await tableColumns(client, t)
    const rows = cols ? await countRows(client, t) : null
    console.log(
      cols
        ? `  ✅ ${t.padEnd(22)} 已存在 (列 ${cols.length}, 行 ${rows})`
        : `  ⬜ ${t.padEnd(22)} 不存在`
    )
  }

  console.log('\n── 索引状态 ──')
  const missing = []
  for (const idx of EXPECTED_INDEXES) {
    const found = (await indexRows(client, idx.table)).some((i) => i.name === idx.name)
    if (!found) missing.push(idx.name)
    console.log(`  ${found ? '✅' : '⬜'} ${idx.name}`)
  }
  return { missing }
}

// ══════════════════════════════════════════════════════════════════════
// 命令
// ══════════════════════════════════════════════════════════════════════

async function cmdPlan(client) {
  await probe(client)
  console.log('\n════════ 将要执行的 SQL（dry-run，未执行）════════')
  for (const s of sqlC0()) console.log('  ' + s.replace(/\n/g, '\n  ') + ';')
  console.log('\n（plan 模式不写入任何数据）')
}

async function cmdApply(client, args) {
  if (!args.yes) {
    console.error('❌ 写操作需要显式 --yes 确认。先跑 `plan` 查看将执行的 SQL。')
    process.exit(2)
  }
  const batch = String(args.batch || 'C0').toUpperCase()
  if (batch !== 'C0' && batch !== 'ALL') {
    console.error('❌ 必须指定 --batch=C0（或 ALL）')
    process.exit(2)
  }

  console.log(`\n▶ 执行 batch=${batch}`)
  console.log('\n[C0] 建 Connection OS 三表 + 索引 …')
  for (const s of sqlC0()) {
    await client.execute(s)
    console.log('  ok: ' + s.split('\n')[0].slice(0, 78))
  }
  console.log('\n完成。运行 `verify` 校验。')
}

async function cmdRollback(client, args) {
  if (!args.yes) {
    console.error('❌ 回滚是写操作，需要显式 --yes 确认。')
    process.exit(2)
  }
  const batch = String(args.batch || 'C0').toUpperCase()
  if (batch !== 'C0' && batch !== 'ALL') {
    console.error('❌ 必须指定 --batch=C0（或 ALL）')
    process.exit(2)
  }

  console.log(`\n◀ 回滚 batch=${batch}（逆序删表，先子后父）`)
  // 逆序：IdempotencyRecord → MissionParticipation → Mission
  for (const t of [...C0_TABLES].reverse()) {
    const cols = await tableColumns(client, t)
    if (!cols) {
      console.log(`  ⏭  ${t} 不存在，跳过`)
      continue
    }
    const rows = await countRows(client, t)
    if (rows > 0) {
      // 有数据时**不静默删**：先备份到 JSON，再删除。避免"回滚"变成"丢数据"。
      const dump = await client.execute(`SELECT * FROM "${t}"`)
      const backup = path.join(ROOT, `.rollback-backup-${t}-${Date.now()}.json`)
      fs.writeFileSync(backup, JSON.stringify(dump.rows, null, 2))
      console.log(`  💾 ${t} 有 ${rows} 行，已备份 → ${path.basename(backup)}`)
    }
    await client.execute(`DROP TABLE IF EXISTS "${t}"`)
    console.log(`  ✅ ${t} 已删除`)
  }
  console.log('\n回滚完成。运行 `verify` 应**失败**（即已回到迁移前状态）。')
}

async function cmdVerify(client) {
  const checks = []
  const ok = (label, pass, extra = '') => checks.push({ label, pass, extra })

  // 1) 三表存在
  for (const t of C0_TABLES) {
    const cols = await tableColumns(client, t)
    ok(`表 ${t} 存在`, Boolean(cols), cols ? `${cols.length} 列` : '')
  }

  // 2) 索引齐全（含唯一性）
  for (const idx of EXPECTED_INDEXES) {
    const found = (await indexRows(client, idx.table)).find((i) => i.name === idx.name)
    ok(
      `索引 ${idx.name}${idx.unique ? '（唯一）' : ''}`,
      Boolean(found),
      found ? (found.unique === idx.unique ? '唯一性一致' : `唯一性不符(期望 ${idx.unique})`) : '缺失'
    )
  }

  // 3) 外键存在
  for (const fk of EXPECTED_FKS) {
    const sql = await tableCreateSql(client, fk.table)
    const has = Boolean(sql && sql.includes(`REFERENCES "${fk.target}"`))
    ok(`外键 ${fk.table} → ${fk.target}`, has)
  }

  // 4) 关键列的非空约束（防止有人用"简版建表"把 NOT NULL 漏掉）
  const missionCols = await tableColumns(client, 'Mission')
  if (missionCols) {
    const sql = await tableCreateSql(client, 'Mission')
    const allNotNull = [
      'organizationId',
      'ownerId',
      'title',
      'goal',
      'offer',
      'successCriteria',
      'shareToken',
    ].every((c) => new RegExp(`"${c}"\\s+TEXT\\s+NOT\\s+NULL`).test(sql || ''))
    ok('Mission 关键列均为 NOT NULL', allNotNull)
    const constraintsNullable = /"constraints"\s+TEXT\b(?!\s+NOT)/.test(sql || '')
    ok('Mission.constraints 可为空（JSON 文本，非必填）', constraintsNullable)
  } else {
    ok('Mission 关键列均为 NOT NULL', false, '表不存在')
  }

  // 5) 孤儿行（跨表完整性）
  const orphanMission = await countRows(
    client,
    'Mission',
    ` WHERE "organizationId" NOT IN (SELECT "id" FROM "Organization")`
  )
  if (orphanMission !== null) ok('Mission 无孤儿 organizationId', orphanMission === 0, `孤儿 ${orphanMission}`)

  const orphanPart = await countRows(
    client,
    'MissionParticipation',
    ` WHERE "missionId" NOT IN (SELECT "id" FROM "Mission")`
  )
  if (orphanPart !== null) ok('MissionParticipation 无孤儿 missionId', orphanPart === 0, `孤儿 ${orphanPart}`)

  // 6) 计数（信息项，不断言 0 —— 生产可能有真实数据）
  const missionCount = await countRows(client, 'Mission')
  const partCount = await countRows(client, 'MissionParticipation')
  const idemCount = await countRows(client, 'IdempotencyRecord')
  if (missionCount !== null) ok('Mission 行数可读', true, String(missionCount))
  if (partCount !== null) ok('MissionParticipation 行数可读', true, String(partCount))
  if (idemCount !== null) ok('IdempotencyRecord 行数可读', true, String(idemCount))

  console.log('\n── 对账结果 ──')
  let failed = 0
  for (const c of checks) {
    if (!c.pass) failed++
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.label}${c.extra ? ' — ' + c.extra : ''}`)
  }
  console.log(`\n━━ 结果：${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}（${checks.length - failed}/${checks.length}）`)
  process.exit(failed === 0 ? 0 : 1)
}

// ══════════════════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0] || 'probe'
  const { url, authToken } = resolveConnection(args)

  console.log(`\n目标库：${maskHost(url)}`)
  console.log(`命令：${cmd}`)

  const client = createClient({ url, authToken })

  try {
    switch (cmd) {
      case 'probe':
        await probe(client)
        break
      case 'plan':
        await cmdPlan(client)
        break
      case 'apply':
        await cmdApply(client, args)
        break
      case 'rollback':
        await cmdRollback(client, args)
        break
      case 'verify':
        await cmdVerify(client)
        break
      default:
        console.error(`❌ 未知命令：${cmd}（可用：probe|plan|apply|rollback|verify）`)
        process.exit(2)
    }
  } finally {
    client.close()
  }
}

main().catch((err) => {
  console.error('\n❌ 执行失败：', err?.message || err)
  process.exit(1)
})
