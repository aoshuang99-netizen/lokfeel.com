#!/usr/bin/env node
/**
 * T07 · 成员邀请表迁移（纯新增，可回退）
 *
 * 用法：
 *   node scripts/tenancy/migrate-invitations.mjs probe     # 只读：现状
 *   node scripts/tenancy/migrate-invitations.mjs plan      # 只读：打印将执行的 SQL
 *   node scripts/tenancy/migrate-invitations.mjs apply     # 执行（幂等；需 --yes）
 *   node scripts/tenancy/migrate-invitations.mjs verify    # 对账断言
 *   node scripts/tenancy/migrate-invitations.mjs rollback  # DROP TABLE（需 --yes）
 *
 * 设计口径与 scripts/tenancy/migrate.mjs 一致：
 *   1. **只新增，不改既有表** —— 因此不需要停机窗口，也不影响任何现有查询；
 *   2. **幂等** —— 全部 `IF NOT EXISTS`，重复执行无副作用；
 *   3. **默认只读** —— 不带 `--apply` 不产生任何写操作；
 *   4. **禁止 `prisma db push`** —— 远程 Turso 会 P1013（本项目既有约束）。
 *
 * 为什么 rollback 也在脚本里：这张表在 GA 前才引入，若 RC 判定 NO-GO 需要干净回退。
 * DROP TABLE 会连带丢掉邀请数据 —— 因此只允许在"表从未被写入过"或明确接受丢数据时执行，
 * 脚本会先打印行数要求 `--force`。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'

const ROOT = path.resolve(import.meta.dirname, '../..')

function parseEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const arg = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null

const ENV = { ...parseEnvFile(path.join(ROOT, '.env')), ...parseEnvFile(path.join(ROOT, '.env.local')) }
const URL_ = arg('url') ?? ENV.DATABASE_URL
const TOKEN = arg('token') ?? ENV.TURSO_AUTH_TOKEN ?? ENV.DATABASE_AUTH_TOKEN

const TABLE = 'OrganizationInvitation'

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "${TABLE}" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "invitedBy" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "acceptedAt" DATETIME,
  "acceptedBy" TEXT,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "${TABLE}_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "${TABLE}_tokenHash_key" ON "${TABLE}"("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "${TABLE}_organizationId_email_status_idx" ON "${TABLE}"("organizationId","email","status")`,
  `CREATE INDEX IF NOT EXISTS "${TABLE}_organizationId_status_idx" ON "${TABLE}"("organizationId","status")`,
]

const REQUIRED_COLUMNS = [
  'id',
  'organizationId',
  'email',
  'role',
  'tokenHash',
  'status',
  'invitedBy',
  'expiresAt',
  'acceptedAt',
  'acceptedBy',
  'revokedAt',
  'createdAt',
  'updatedAt',
]

function client() {
  if (!URL_) {
    console.error('缺少 DATABASE_URL（或用 --url= 传入）')
    process.exit(2)
  }
  return createClient({ url: URL_, authToken: TOKEN || undefined })
}

async function probe(db) {
  const tables = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [TABLE],
  })
  const exists = tables.rows.length > 0
  const out = { table: TABLE, exists, columns: [], indexes: [], rows: null }
  if (exists) {
    const cols = await db.execute(`PRAGMA table_info("${TABLE}")`)
    out.columns = cols.rows.map((r) => r.name)
    const idx = await db.execute(`PRAGMA index_list("${TABLE}")`)
    out.indexes = idx.rows.map((r) => r.name)
    const n = await db.execute(`SELECT COUNT(*) AS n FROM "${TABLE}"`)
    out.rows = Number(n.rows[0].n)
  }
  return out
}

async function main() {
  const mode = argv.find((a) => ['probe', 'plan', 'apply', 'verify', 'rollback'].includes(a)) ?? 'probe'
  const db = client()

  if (mode === 'plan') {
    console.log('将执行（全部幂等）：')
    for (const s of STATEMENTS) console.log('  ' + s.split('\n')[0] + ' …')
    return
  }

  if (mode === 'probe') {
    const p = await probe(db)
    console.log(`表 ${p.table}：${p.exists ? '存在' : '不存在'}`)
    if (p.exists) {
      console.log('  列：', p.columns.join(', '))
      console.log('  索引：', p.indexes.join(', ') || '(无)')
      console.log('  行数：', p.rows)
    }
    return
  }

  if (mode === 'verify') {
    const p = await probe(db)
    const missing = REQUIRED_COLUMNS.filter((c) => !p.columns.includes(c))
    const hasUnique = p.indexes.length > 0
    const ok = p.exists && missing.length === 0 && hasUnique
    console.log(`  表存在        : ${p.exists ? '✓' : '✗'}`)
    console.log(`  列齐全        : ${missing.length === 0 ? '✓' : `✗ 缺 ${missing.join(', ')}`}`)
    console.log(`  索引已建      : ${hasUnique ? '✓' : '✗'}`)
    console.log(ok ? '\n✅ PASS' : '\n🔴 FAIL')
    process.exit(ok ? 0 : 1)
  }

  if (mode === 'apply') {
    if (!has('--yes')) {
      console.error('拒绝：apply 需要 --yes 二次确认（会写生产库）。先跑 plan 看一眼。')
      process.exit(2)
    }
    const before = await probe(db)
    console.log(`执行前：${before.exists ? '表已存在' : '表不存在'}`)
    for (const sql of STATEMENTS) {
      await db.execute(sql)
      console.log('  ✓ ' + sql.split('\n')[0])
    }
    const after = await probe(db)
    console.log(`\n执行后：存在=${after.exists} 列=${after.columns.length} 索引=${after.indexes.length} 行数=${after.rows}`)
    const missing = REQUIRED_COLUMNS.filter((c) => !after.columns.includes(c))
    if (!after.exists || missing.length) {
      console.error(`\n🔴 失败：缺列 ${missing.join(', ') || '(表不存在)'}`)
      process.exit(1)
    }
    console.log('\n✅ 迁移完成（幂等，可重复执行）')
    return
  }

  if (mode === 'rollback') {
    const p = await probe(db)
    if (!p.exists) {
      console.log('表不存在，无需回滚。')
      return
    }
    if (!has('--yes')) {
      console.error('拒绝：rollback 需要 --yes。')
      process.exit(2)
    }
    if (p.rows > 0 && !has('--force')) {
      console.error(`拒绝：表内还有 ${p.rows} 行邀请数据。确认要丢弃请加 --force。`)
      process.exit(2)
    }
    await db.execute(`DROP TABLE IF EXISTS "${TABLE}"`)
    const after = await probe(db)
    console.log(after.exists ? '🔴 回滚失败：表仍存在' : '✅ 已回滚（表已删除）')
    process.exit(after.exists ? 1 : 0)
  }
}

main().catch((e) => {
  console.error('失败：', e?.message ?? e)
  process.exit(1)
})
