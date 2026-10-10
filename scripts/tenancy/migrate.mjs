#!/usr/bin/env node
/**
 * T01 · 多租户底座迁移（M0 / M1 / M2）
 *
 * 用法：
 *   node scripts/tenancy/migrate.mjs probe              # 只读：列出相关表/列现状
 *   node scripts/tenancy/migrate.mjs plan               # 只读：打印将要执行的 SQL
 *   node scripts/tenancy/migrate.mjs apply --batch=M0   # 执行（需 --yes 二次确认）
 *   node scripts/tenancy/migrate.mjs verify             # 对账断言
 *
 * 设计约束（见 docs/implementation/MIGRATION_PLAN.md §2.1 / §3.2）：
 *   1. **加列优先**：M1 一律 `ADD COLUMN` 可空列，绝不先加 NOT NULL。
 *   2. **幂等**：M0 用 `IF NOT EXISTS`；M1 先查 `PRAGMA table_info` 再决定是否 ADD；
 *      M2 用 `WHERE ... IS NULL`，天然可重跑。
 *   3. **默认只读**：不带 `--apply` 的调用不产生任何写操作。
 *   4. **禁止 `prisma db push`**：远程 Turso 会 P1013 失败（本项目既有约束）。
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

// ── 默认租户（幂等锚点） ─────────────────────────────────────────────
export const DEFAULT_ORG = {
  id: 'org_default',
  name: 'Default Organization',
  slug: 'default',
}

/**
 * M1 加列清单：需要纳入租户作用域的**业务资源表**。
 *
 * 不含的（有意的）：
 *   - User / Account / Session / VerificationToken —— 身份是全局的，租户归属靠 Membership 表达
 *   - Profile —— 挂在 User 下的「人」的属性，随 User 跨租户
 *   - ConversationParticipant / MessageReceipt / MessageReaction / UserPresence —— 从属表，随父表
 *   - Admin* / Analytics* / SystemConfig / CustomRole —— 平台级，非租户资源
 *   - AuditLog —— 保留原样；租户安全事件走新表 TenantAuditEvent
 *
 * 后续任务（T02–T08）新增表时，直接在新表 schema 里带 organizationId，无需进本清单。
 */
export const TENANT_SCOPED_TABLES = [
  'Match',
  'Conversation',
  'IMMessage',
  'ConsentRequest',
  'ConsentGrant',
  'PowerBoardRule',
  'Subscription',
  'Payment',
  'Notification',
  'UserReport',
  'Block',
]

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
// SQL 定义
// ══════════════════════════════════════════════════════════════════════

/** M0：新建租户三表（幂等）。表名遵循 Prisma 默认（model 名原样，无 @@map）。 */
function sqlM0() {
  return [
    `CREATE TABLE IF NOT EXISTS "Organization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug")`,
    `CREATE INDEX IF NOT EXISTS "Organization_status_idx" ON "Organization"("status")`,

    `CREATE TABLE IF NOT EXISTS "Membership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId")`,
    `CREATE INDEX IF NOT EXISTS "Membership_userId_status_idx" ON "Membership"("userId", "status")`,
    `CREATE INDEX IF NOT EXISTS "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role")`,

    `CREATE TABLE IF NOT EXISTS "TenantAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "safeMetadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE INDEX IF NOT EXISTS "TenantAuditEvent_organizationId_createdAt_idx" ON "TenantAuditEvent"("organizationId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "TenantAuditEvent_organizationId_eventType_idx" ON "TenantAuditEvent"("organizationId", "eventType")`,
    `CREATE INDEX IF NOT EXISTS "TenantAuditEvent_resourceType_resourceId_idx" ON "TenantAuditEvent"("resourceType", "resourceId")`,
  ]
}

/** M0 附带：播种默认租户（幂等，slug 为锚点）。 */
function sqlM0Seed() {
  return [
    `INSERT INTO "Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
SELECT '${DEFAULT_ORG.id}', '${DEFAULT_ORG.name}', '${DEFAULT_ORG.slug}', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Organization" WHERE "slug" = '${DEFAULT_ORG.slug}')`,
  ]
}

/** M1：给业务资源表加可空 organizationId（列存在性由调用方预先检查）。 */
function sqlM1(tables) {
  return tables.flatMap((t) => [
    `ALTER TABLE "${t}" ADD COLUMN "organizationId" TEXT`,
    `CREATE INDEX IF NOT EXISTS "${t}_organizationId_idx" ON "${t}"("organizationId")`,
  ])
}

/** M2：把存量行回填到默认租户。 */
function sqlM2(tables) {
  return tables.map(
    (t) =>
      `UPDATE "${t}" SET "organizationId" = '${DEFAULT_ORG.id}' WHERE "organizationId" IS NULL`
  )
}

async function cmdRollback(client, args) {
  if (!args.yes) {
    console.error('❌ 回滚是写操作，需要显式 --yes 确认。')
    process.exit(2)
  }
  const batch = String(args.batch || '').toUpperCase()
  if (!['M0', 'M1', 'M2', 'ALL'].includes(batch)) {
    console.error('❌ 必须指定 --batch=M0|M1|M2|ALL（ALL = 从 M2 反序回退到 M0）')
    process.exit(2)
  }

  console.log(`\n◀ 回滚 batch=${batch}（按 M2 → M1 → M0 的逆序）`)

  // ── M2 逆向：把回填值置空 ──
  if (batch === 'M2' || batch === 'ALL') {
    console.log('\n[M2⁻] 置空 organizationId …')
    for (const t of TENANT_SCOPED_TABLES) {
      const cols = await tableColumns(client, t)
      if (!cols || !cols.includes('organizationId')) {
        console.log(`  ⏭  ${t} 无 organizationId，跳过`)
        continue
      }
      const r = await client.execute(
        `UPDATE "${t}" SET "organizationId" = NULL WHERE "organizationId" = '${DEFAULT_ORG.id}'`
      )
      console.log(`  ✅ ${t} 置空 ${r.rowsAffected ?? 0} 行`)
    }
  }

  // ── M1 逆向：删索引 + 删列（SQLite 3.35+ / libSQL 支持 DROP COLUMN） ──
  if (batch === 'M1' || batch === 'ALL') {
    console.log('\n[M1⁻] 移除 organizationId 列 …')
    for (const t of TENANT_SCOPED_TABLES) {
      const cols = await tableColumns(client, t)
      if (!cols || !cols.includes('organizationId')) {
        console.log(`  ⏭  ${t} 无 organizationId，跳过`)
        continue
      }
      try {
        await client.execute(`DROP INDEX IF EXISTS "${t}_organizationId_idx"`)
        await client.execute(`ALTER TABLE "${t}" DROP COLUMN "organizationId"`)
        console.log(`  ✅ ${t} 已移除`)
      } catch (err) {
        console.log(`  ❌ ${t} 移除失败：${err?.message || err}`)
      }
    }
  }

  // ── M0 逆向：删表（必须先子后父，否则 FK 强制的实例会拒绝） ──
  if (batch === 'M0' || batch === 'ALL') {
    console.log('\n[M0⁻] 删除租户三表 …')
    for (const t of ['TenantAuditEvent', 'Membership', 'Organization']) {
      const cols = await tableColumns(client, t)
      if (!cols) {
        console.log(`  ⏭  ${t} 不存在，跳过`)
        continue
      }
      await client.execute(`DROP TABLE IF EXISTS "${t}"`)
      console.log(`  ✅ ${t} 已删除`)
    }
  }

  console.log('\n回滚完成。运行 `verify` 应**失败**（即已回到迁移前状态）。')
}

// ══════════════════════════════════════════════════════════════════════
// 只读探测
// ══════════════════════════════════════════════════════════════════════

async function listTables(client) {
  const r = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )
  return r.rows.map((row) => String(row.name))
}

async function tableColumns(client, table) {
  try {
    const r = await client.execute(`PRAGMA table_info("${table}")`)
    // ⚠️ 表不存在时 PRAGMA 返回**空结果集**而非报错。若直接返回 []
    // 会在 `if (!cols)` 处被当成 truthy，从而把「不存在」误判为「已存在」。
    // 因此这里统一：表不存在 → null。
    if (r.rows.length === 0) return null
    return r.rows.map((row) => String(row.name))
  } catch {
    return null
  }
}

async function countRows(client, table, where = '') {
  try {
    const r = await client.execute(`SELECT COUNT(*) AS n FROM "${table}"${where}`)
    return Number(r.rows[0]?.n ?? 0)
  } catch {
    return null
  }
}

async function probe(client) {
  const tables = await listTables(client)
  console.log(`\n发现 ${tables.length} 张表\n`)

  console.log('── M0 目标表状态 ──')
  for (const t of ['Organization', 'Membership', 'TenantAuditEvent']) {
    const cols = await tableColumns(client, t)
    const rows = cols ? await countRows(client, t) : null
    console.log(
      cols
        ? `  ✅ ${t.padEnd(20)} 已存在  (列 ${cols.length}, 行 ${rows})`
        : `  ⬜ ${t.padEnd(20)} 不存在`
    )
  }

  console.log('\n── M1 目标表 organizationId 列状态 ──')
  const missingTables = []
  const missingCols = []
  for (const t of TENANT_SCOPED_TABLES) {
    const cols = await tableColumns(client, t)
    if (!cols) {
      missingTables.push(t)
      console.log(`  ⚠️  ${t.padEnd(20)} 表不存在`)
      continue
    }
    const has = cols.includes('organizationId')
    if (!has) missingCols.push(t)
    console.log(`  ${has ? '✅' : '⬜'} ${t.padEnd(20)} ${has ? '已有 organizationId' : '缺 organizationId'}`)
  }

  return { tables, missingTables, missingCols }
}

// ══════════════════════════════════════════════════════════════════════
// 命令
// ══════════════════════════════════════════════════════════════════════

async function cmdPlan(client, args) {
  const batch = `M${(args.batch || 'all').replace(/^M/i, '')}`.toUpperCase()
  const runAll = batch === 'MALL' || batch === 'ALL'
  const info = await probe(client)

  const m1Tables = TENANT_SCOPED_TABLES.filter(
    (t) => !info.missingTables.includes(t) && info.missingCols.includes(t)
  )

  console.log('\n════════ 将要执行的 SQL（dry-run，未执行）════════')
  if (runAll || batch === 'M0') {
    console.log('\n-- M0: 建租户三表 + 播种默认租户')
    for (const s of sqlM0()) console.log('  ' + s.replace(/\n/g, '\n  ') + ';')
    for (const s of sqlM0Seed()) console.log('  ' + s.replace(/\n/g, '\n  ') + ';')
  }
  if (runAll || batch === 'M1') {
    console.log(
      `\n-- M1: 加可空 organizationId（${m1Tables.length} 张表需处理：${m1Tables.join(', ') || '无'}）`
    )
    for (const s of sqlM1(m1Tables)) console.log('  ' + s + ';')
  }
  if (runAll || batch === 'M2') {
    const m2Tables = TENANT_SCOPED_TABLES.filter(
      (t) => !info.missingTables.includes(t) && info.missingCols.includes(t)
    )
    console.log(`\n-- M2: 回填默认租户（${m2Tables.length} 张表：${m2Tables.join(', ') || '无'}）`)
    for (const s of sqlM2(m2Tables)) console.log('  ' + s + ';')
  }
  console.log('\n（plan 模式不写入任何数据）')
}

async function cmdApply(client, args) {
  if (!args.yes) {
    console.error('❌ 写操作需要显式 --yes 确认。先跑 `plan` 查看将执行的 SQL。')
    process.exit(2)
  }
  const batch = String(args.batch || '').toUpperCase().replace(/^M(\d)$/, 'M$1')
  if (!['M0', 'M1', 'M2', 'ALL'].includes(batch)) {
    console.error('❌ 必须指定 --batch=M0|M1|M2|ALL')
    process.exit(2)
  }

  console.log(`\n▶ 执行 batch=${batch}`)

  if (batch === 'M0' || batch === 'ALL') {
    console.log('\n[M0] 建表 …')
    for (const s of [...sqlM0(), ...sqlM0Seed()]) {
      await client.execute(s)
      console.log('  ok: ' + s.split('\n')[0].slice(0, 70))
    }
  }

  if (batch === 'M1' || batch === 'ALL') {
    console.log('\n[M1] 加列 …')
    for (const t of TENANT_SCOPED_TABLES) {
      const cols = await tableColumns(client, t)
      if (!cols) {
        console.log(`  ⏭  ${t} 表不存在，跳过`)
        continue
      }
      if (cols.includes('organizationId')) {
        console.log(`  ⏭  ${t} 已有 organizationId，跳过（幂等）`)
        continue
      }
      for (const s of sqlM1([t])) {
        await client.execute(s)
      }
      console.log(`  ✅ ${t} 已加 organizationId`)
    }
  }

  if (batch === 'M2' || batch === 'ALL') {
    console.log('\n[M2] 回填默认租户 …')
    for (const t of TENANT_SCOPED_TABLES) {
      const cols = await tableColumns(client, t)
      if (!cols || !cols.includes('organizationId')) {
        console.log(`  ⏭  ${t} 无 organizationId，跳过`)
        continue
      }
      const r = await client.execute(sqlM2([t])[0])
      console.log(`  ✅ ${t} 回填 ${r.rowsAffected ?? 0} 行`)
    }
  }

  console.log('\n完成。运行 `verify` 做对账断言。')
}

async function cmdVerify(client) {
  console.log('\n════════ T01 对账验证 ════════')
  let failures = 0
  const assert = (label, ok, detail = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
    if (!ok) failures++
  }

  // 1. 三表存在
  const tables = await listTables(client)
  for (const t of ['Organization', 'Membership', 'TenantAuditEvent']) {
    assert(`表 ${t} 存在`, tables.includes(t))
  }

  // 2. 默认租户存在且唯一
  const orgCount = await countRows(client, 'Organization')
  const defaultOrg = await countRows(client, 'Organization', ` WHERE "slug" = '${DEFAULT_ORG.slug}'`)
  assert('Organization 行数 ≥ 1', (orgCount ?? 0) >= 1, `实际 ${orgCount}`)
  assert('默认租户(slug=default) 恰有 1 条', defaultOrg === 1, `实际 ${defaultOrg}`)

  // 3. M1 列状态
  const notYetMigrated = []
  for (const t of TENANT_SCOPED_TABLES) {
    const cols = await tableColumns(client, t)
    if (!cols) continue
    if (!cols.includes('organizationId')) notYetMigrated.push(t)
  }
  assert(
    'M1 列已就位（或表不存在）',
    notYetMigrated.length === 0,
    notYetMigrated.length ? `缺列：${notYetMigrated.join(', ')}` : '全部就位'
  )

  // 4. 回填完整性：有 organizationId 列的表不得有空值
  for (const t of TENANT_SCOPED_TABLES) {
    const cols = await tableColumns(client, t)
    if (!cols || !cols.includes('organizationId')) continue
    const nulls = await countRows(client, t, ` WHERE "organizationId" IS NULL`)
    assert(`${t} 无空 organizationId`, nulls === 0, `NULL=${nulls}`)
  }

  // 5. 孤儿成员关系（表不存在时不抛错，直接判失败）
  if (tables.includes('Membership') && tables.includes('Organization') && tables.includes('User')) {
    const orphan = await client.execute(
      `SELECT COUNT(*) AS n FROM "Membership" m
       WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = m."organizationId")
          OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = m."userId")`
    )
    const n = Number(orphan.rows[0]?.n ?? 0)
    assert('Membership 无孤儿行', n === 0, `孤儿=${n}`)
  } else {
    assert('Membership 无孤儿行', false, '前置表缺失，无法校验')
  }

  console.log(
    `\n结果：${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项未通过`}`
  )
  process.exit(failures === 0 ? 0 : 1)
}

// ══════════════════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0] || 'probe'
  const { url, authToken } = resolveConnection(args)

  console.log(`[tenancy] 目标库: ${maskHost(url)}`)
  console.log(`[tenancy] 命令: ${cmd}`)

  const client = createClient({ url, authToken })

  try {
    switch (cmd) {
      case 'probe':
        await probe(client)
        break
      case 'plan':
        await cmdPlan(client, args)
        break
      case 'apply':
        await cmdApply(client, args)
        break
      case 'verify':
        await cmdVerify(client)
        break
      case 'rollback':
        await cmdRollback(client, args)
        break
      default:
        console.error(`未知命令: ${cmd}`)
        console.error('可用: probe | plan | apply --batch=M0|M1|M2|ALL [--yes] | rollback --batch=ALL [--yes] | verify')
        process.exit(2)
    }
  } finally {
    if (cmd !== 'verify') client.close()
  }
}

main().catch((err) => {
  console.error('❌ 迁移失败:', err?.message || err)
  process.exit(1)
})
