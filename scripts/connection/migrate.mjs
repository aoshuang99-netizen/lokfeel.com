#!/usr/bin/env node
/**
 * T02/T03 · Connection OS 迁移（批次 C0 / C1）
 *
 * 用法：
 *   node scripts/connection/migrate.mjs probe                      # 只读：表/列/索引现状
 *   node scripts/connection/migrate.mjs plan                       # 只读：打印将执行的 SQL
 *   node scripts/connection/migrate.mjs apply --batch=ALL --yes    # 执行（需二次确认）
 *   node scripts/connection/migrate.mjs rollback --batch=C1 --yes  # 回滚（逆序删表）
 *   node scripts/connection/migrate.mjs verify                     # 对账断言
 *
 * 批次：
 *   C0 = Mission / MissionParticipation / IdempotencyRecord   （T02）
 *   C1 = SocialIntent                                          （T03，引用 C0 的 Mission）
 *
 * 设计约束（继承 T01 的 scripts/tenancy/migrate.mjs）：
 *   1. **纯新增** —— 各批次只 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`，
 *      不改动既有表的任何列。因此零停机、零回归。
 *   2. **幂等** —— 所有语句都带 IF NOT EXISTS；重复执行为空操作。
 *   3. **默认只读** —— 不带 `--yes` 不产生任何写操作。
 *   4. **禁止 `prisma db push`** —— 远程 Turso 会 P1013 失败（本项目既有约束）。
 *   5. **DDL 来源权威** —— 表结构由 `prisma migrate diff --from-empty --to-schema prisma/schema`
 *      生成后**原样抄录**，不做手写猜测；这样 Prisma client 与真实表结构不会漂移。
 *   6. **批次间有依赖方向** —— C1 的外键指向 C0 的表；`apply` 按 C0→C1 顺序，
 *      `rollback` 按 C1→C0 **逆序**，否则删 C0 会被外键挡住。
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

/** 批次定义。**apply 顺序**为数组顺序；**rollback 顺序**为其逆序。 */
export const BATCHES = {
  C0: {
    tables: ['Mission', 'MissionParticipation', 'IdempotencyRecord'],
    label: 'T02 · Connection OS 三表（Mission / MissionParticipation / IdempotencyRecord）',
  },
  C1: {
    tables: ['SocialIntent'],
    label: 'T03 · 成员意图与逐字段披露（SocialIntent）',
  },
  C2: {
    // C2 内部也有依赖方向：ProposalDecision 的外键指向 ConnectionProposal。
    // 数组顺序 = 创建顺序；rollback 取其逆序，故会先删 ProposalDecision。
    tables: ['ConnectionProposal', 'ProposalDecision'],
    label: 'T05 · 双边同意（ConnectionProposal / ProposalDecision）',
  },
}

export const ALL_BATCHES = ['C0', 'C1', 'C2']

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

/** 把 `--batch` 解析为按 apply 顺序排列的批次数组。 */
function resolveBatches(raw) {
  const value = String(raw || 'ALL').toUpperCase()
  if (value === 'ALL') return [...ALL_BATCHES]
  if (!BATCHES[value]) {
    console.error(`❌ 未知批次：${raw}（可用：${ALL_BATCHES.join(' | ')} | ALL）`)
    process.exit(2)
  }
  return [value]
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

function sqlC1() {
  return [
    `CREATE TABLE IF NOT EXISTS "SocialIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "need" TEXT NOT NULL,
  "offer" TEXT NOT NULL,
  "constraints" TEXT,
  "disclosure" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" DATETIME,
  "withdrawnAt" DATETIME,
  "importConsentAt" DATETIME,
  "importedFields" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SocialIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SocialIntent_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SocialIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "SocialIntent_missionId_userId_key" ON "SocialIntent"("missionId", "userId")`,
    `CREATE INDEX IF NOT EXISTS "SocialIntent_organizationId_status_idx" ON "SocialIntent"("organizationId", "status")`,
    `CREATE INDEX IF NOT EXISTS "SocialIntent_organizationId_missionId_idx" ON "SocialIntent"("organizationId", "missionId")`,
    `CREATE INDEX IF NOT EXISTS "SocialIntent_userId_status_idx" ON "SocialIntent"("userId", "status")`,
    `CREATE INDEX IF NOT EXISTS "SocialIntent_expiresAt_idx" ON "SocialIntent"("expiresAt")`,
  ]
}

function sqlC2() {
  return [
    `CREATE TABLE IF NOT EXISTS "ConnectionProposal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "proposerId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONSENT_PENDING',
  "rationale" TEXT NOT NULL,
  "expiresAt" DATETIME,
  "introducedAt" DATETIME,
  "closedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ConnectionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectionProposal_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectionProposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectionProposal_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ConnectionProposal_missionId_proposerId_candidateId_key" ON "ConnectionProposal"("missionId", "proposerId", "candidateId")`,
    `CREATE INDEX IF NOT EXISTS "ConnectionProposal_organizationId_status_idx" ON "ConnectionProposal"("organizationId", "status")`,
    `CREATE INDEX IF NOT EXISTS "ConnectionProposal_organizationId_missionId_idx" ON "ConnectionProposal"("organizationId", "missionId")`,
    `CREATE INDEX IF NOT EXISTS "ConnectionProposal_proposerId_status_idx" ON "ConnectionProposal"("proposerId", "status")`,
    `CREATE INDEX IF NOT EXISTS "ConnectionProposal_candidateId_status_idx" ON "ConnectionProposal"("candidateId", "status")`,
    `CREATE INDEX IF NOT EXISTS "ConnectionProposal_expiresAt_idx" ON "ConnectionProposal"("expiresAt")`,

    `CREATE TABLE IF NOT EXISTS "ProposalDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "note" TEXT,
  "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProposalDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProposalDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ConnectionProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProposalDecision_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ProposalDecision_proposalId_personId_key" ON "ProposalDecision"("proposalId", "personId")`,
    `CREATE INDEX IF NOT EXISTS "ProposalDecision_organizationId_idx" ON "ProposalDecision"("organizationId")`,
    `CREATE INDEX IF NOT EXISTS "ProposalDecision_personId_decidedAt_idx" ON "ProposalDecision"("personId", "decidedAt")`,
    `CREATE INDEX IF NOT EXISTS "ProposalDecision_decision_idx" ON "ProposalDecision"("decision")`,
  ]
}

const SQL_BY_BATCH = { C0: sqlC0, C1: sqlC1, C2: sqlC2 }

/** 期望存在的索引（verify 断言用）。 */
const EXPECTED_INDEXES = [
  // ── C0 ──
  { name: 'Mission_shareToken_key', table: 'Mission', unique: true },
  { name: 'Mission_organizationId_status_idx', table: 'Mission', unique: false },
  { name: 'Mission_organizationId_createdAt_idx', table: 'Mission', unique: false },
  { name: 'Mission_expiresAt_idx', table: 'Mission', unique: false },
  { name: 'MissionParticipation_missionId_userId_key', table: 'MissionParticipation', unique: true },
  { name: 'MissionParticipation_organizationId_status_idx', table: 'MissionParticipation', unique: false },
  { name: 'MissionParticipation_userId_status_idx', table: 'MissionParticipation', unique: false },
  { name: 'IdempotencyRecord_organizationId_scope_key_key', table: 'IdempotencyRecord', unique: true },
  { name: 'IdempotencyRecord_organizationId_createdAt_idx', table: 'IdempotencyRecord', unique: false },
  // ── C1 ──
  { name: 'SocialIntent_missionId_userId_key', table: 'SocialIntent', unique: true },
  { name: 'SocialIntent_organizationId_status_idx', table: 'SocialIntent', unique: false },
  { name: 'SocialIntent_organizationId_missionId_idx', table: 'SocialIntent', unique: false },
  { name: 'SocialIntent_userId_status_idx', table: 'SocialIntent', unique: false },
  { name: 'SocialIntent_expiresAt_idx', table: 'SocialIntent', unique: false },
  // ── C2 ──
  { name: 'ConnectionProposal_missionId_proposerId_candidateId_key', table: 'ConnectionProposal', unique: true },
  { name: 'ConnectionProposal_organizationId_status_idx', table: 'ConnectionProposal', unique: false },
  { name: 'ConnectionProposal_organizationId_missionId_idx', table: 'ConnectionProposal', unique: false },
  { name: 'ConnectionProposal_proposerId_status_idx', table: 'ConnectionProposal', unique: false },
  { name: 'ConnectionProposal_candidateId_status_idx', table: 'ConnectionProposal', unique: false },
  { name: 'ConnectionProposal_expiresAt_idx', table: 'ConnectionProposal', unique: false },
  { name: 'ProposalDecision_proposalId_personId_key', table: 'ProposalDecision', unique: true },
  { name: 'ProposalDecision_organizationId_idx', table: 'ProposalDecision', unique: false },
  { name: 'ProposalDecision_personId_decidedAt_idx', table: 'ProposalDecision', unique: false },
  { name: 'ProposalDecision_decision_idx', table: 'ProposalDecision', unique: false },
]

/** 期望存在的外键（表 → 引用目标），verify 断言用。 */
const EXPECTED_FKS = [
  // ── C0 ──
  { table: 'Mission', target: 'Organization' },
  { table: 'Mission', target: 'User' },
  { table: 'MissionParticipation', target: 'Organization' },
  { table: 'MissionParticipation', target: 'Mission' },
  { table: 'MissionParticipation', target: 'User' },
  { table: 'IdempotencyRecord', target: 'Organization' },
  // ── C1 ──
  { table: 'SocialIntent', target: 'Organization' },
  { table: 'SocialIntent', target: 'Mission' },
  { table: 'SocialIntent', target: 'User' },
  // ── C2 ──
  // ⚠️ `ConnectionProposal` 有 4 个外键，其中指向 `User` 的**有两个**（proposer / candidate）。
  // 本列表用「表 → 目标」的粗粒度断言，所以两条 User 外键只留一条 —— 方向由下面
  // `cmdVerify` 的列级断言（4c）单独守住：那里检查的是一条约束里**同时**出现
  // `"proposerId"` 与 `"candidateId"`，只建其中一个会失败。
  { table: 'ConnectionProposal', target: 'Organization' },
  { table: 'ConnectionProposal', target: 'Mission' },
  { table: 'ConnectionProposal', target: 'User' },
  { table: 'ProposalDecision', target: 'Organization' },
  { table: 'ProposalDecision', target: 'ConnectionProposal' },
  { table: 'ProposalDecision', target: 'User' },
]

/** 全部受管表（verify 用）。 */
const ALL_TABLES = ALL_BATCHES.flatMap((b) => BATCHES[b].tables)

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

  for (const batch of ALL_BATCHES) {
    console.log(`── 批次 ${batch} 目标表状态（${BATCHES[batch].label}）──`)
    for (const t of BATCHES[batch].tables) {
      const cols = await tableColumns(client, t)
      const rows = cols ? await countRows(client, t) : null
      console.log(
        cols
          ? `  ✅ ${t.padEnd(24)} 已存在 (列 ${cols.length}, 行 ${rows})`
          : `  ⬜ ${t.padEnd(24)} 不存在`
      )
    }
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

async function cmdPlan(client, args) {
  await probe(client)
  const batches = resolveBatches(args.batch)
  console.log(`\n════════ 将要执行的 SQL（batch=${batches.join('+')}，dry-run 未执行）════════`)
  for (const b of batches) {
    console.log(`\n-- [${b}] ${BATCHES[b].label}`)
    for (const s of SQL_BY_BATCH[b]()) console.log('  ' + s.replace(/\n/g, '\n  ') + ';')
  }
  console.log('\n（plan 模式不写入任何数据）')
}

async function cmdApply(client, args) {
  if (!args.yes) {
    console.error('❌ 写操作需要显式 --yes 确认。先跑 `plan` 查看将执行的 SQL。')
    process.exit(2)
  }
  const batches = resolveBatches(args.batch)

  console.log(`\n▶ 执行 batch=${batches.join('+')}（按 ${batches.join(' → ')} 顺序）`)
  for (const b of batches) {
    console.log(`\n[${b}] ${BATCHES[b].label} …`)
    for (const s of SQL_BY_BATCH[b]()) {
      await client.execute(s)
      console.log('  ok: ' + s.split('\n')[0].slice(0, 78))
    }
  }
  console.log('\n完成。运行 `verify` 校验。')
}

async function cmdRollback(client, args) {
  if (!args.yes) {
    console.error('❌ 回滚是写操作，需要显式 --yes 确认。')
    process.exit(2)
  }
  const batches = resolveBatches(args.batch)
  // **逆序**：C1 的外键指向 C0，先删 C0 会被外键挡住。
  const ordered = [...batches].reverse()

  console.log(`\n◀ 回滚 batch=${batches.join('+')}（逆序：${ordered.join(' → ')}）`)
  for (const b of ordered) {
    for (const t of [...BATCHES[b].tables].reverse()) {
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
  }
  console.log('\n回滚完成。运行 `verify` 应**失败**（即已回到迁移前状态）。')
}

async function cmdVerify(client) {
  const checks = []
  const ok = (label, pass, extra = '') => checks.push({ label, pass, extra })

  // 1) 全部受管表存在
  for (const t of ALL_TABLES) {
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

  // 4b) T03 · SocialIntent 的列约束与默认值
  const intentCols = await tableColumns(client, 'SocialIntent')
  if (intentCols) {
    const sql = await tableCreateSql(client, 'SocialIntent') || ''
    const intentNotNull = ['organizationId', 'missionId', 'userId', 'need', 'offer'].every((c) =>
      new RegExp(`"${c}"\\s+TEXT\\s+NOT\\s+NULL`).test(sql)
    )
    ok('SocialIntent 关键列均为 NOT NULL', intentNotNull)

    // 可空列：这些字段"没有值"是合法状态，若被建成 NOT NULL 会导致写入直接失败
    const intentNullable = [
      'constraints',
      'disclosure',
      'expiresAt',
      'withdrawnAt',
      'importConsentAt',
      'importedFields',
    ].every((c) => new RegExp(`"${c}"\\s+(TEXT|DATETIME)\\b(?!\\s+NOT)`).test(sql))
    ok('SocialIntent 可选列可为空（约束/披露/有效期/撤销/导入留痕）', intentNullable)

    ok("SocialIntent.status 默认 'ACTIVE'", /"status"\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'ACTIVE'/.test(sql))
  } else {
    ok('SocialIntent 关键列均为 NOT NULL', false, '表不存在')
  }

  // 4c) T05 · ConnectionProposal / ProposalDecision 的列约束与默认值
  const proposalCols = await tableColumns(client, 'ConnectionProposal')
  if (proposalCols) {
    const sql = (await tableCreateSql(client, 'ConnectionProposal')) || ''
    const required = ['organizationId', 'missionId', 'proposerId', 'candidateId', 'rationale'].every(
      (c) => new RegExp(`"${c}"\\s+TEXT\\s+NOT\\s+NULL`).test(sql)
    )
    ok('ConnectionProposal 关键列均为 NOT NULL', required)

    ok(
      "ConnectionProposal.status 默认 'CONSENT_PENDING'",
      /"status"\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'CONSENT_PENDING'/.test(sql)
    )

    // 可空列：这三个"没有值"都是合法状态。若被建成 NOT NULL，
    // 「不过期」「尚未介绍」「尚未关闭」都会变成写入失败。
    const proposalNullable = ['expiresAt', 'introducedAt', 'closedAt'].every((c) =>
      new RegExp(`"${c}"\\s+DATETIME\\b(?!\\s+NOT)`).test(sql)
    )
    ok('ConnectionProposal 可选列可为空（有效期/介绍时间/关闭时间）', proposalNullable)

    // 🔴 方向断言：proposer / candidate 必须是**两条各自独立**的 User 外键。
    // 若只建一条（例如把两个字段都接到同一个约束上），"被介绍方同意"会静默变成
    // "发起方自己同意" —— 双方同意退化为单方，且没有任何运行期信号。
    const hasProposerFk =
      /CONSTRAINT\s+"ConnectionProposal_proposerId_fkey"\s+FOREIGN KEY\s+\("proposerId"\)\s+REFERENCES\s+"User"/.test(
        sql
      )
    const hasCandidateFk =
      /CONSTRAINT\s+"ConnectionProposal_candidateId_fkey"\s+FOREIGN KEY\s+\("candidateId"\)\s+REFERENCES\s+"User"/.test(
        sql
      )
    ok('ConnectionProposal.proposerId → User 外键方向正确', hasProposerFk)
    ok('ConnectionProposal.candidateId → User 外键方向正确', hasCandidateFk)
  } else {
    ok('ConnectionProposal 关键列均为 NOT NULL', false, '表不存在')
  }

  const decisionCols = await tableColumns(client, 'ProposalDecision')
  if (decisionCols) {
    const sql = (await tableCreateSql(client, 'ProposalDecision')) || ''
    const required = ['organizationId', 'proposalId', 'personId', 'decision'].every((c) =>
      new RegExp(`"${c}"\\s+TEXT\\s+NOT\\s+NULL`).test(sql)
    )
    ok('ProposalDecision 关键列均为 NOT NULL', required)
    ok('ProposalDecision.note 可为空（拒绝理由不是必填项）', /"note"\s+TEXT\b(?!\s+NOT)/.test(sql))
    ok(
      'ProposalDecision.decidedAt 默认 CURRENT_TIMESTAMP',
      /"decidedAt"\s+DATETIME\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/.test(sql)
    )
  } else {
    ok('ProposalDecision 关键列均为 NOT NULL', false, '表不存在')
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

  // T03：三路孤儿（租户 / 任务 / 用户）
  const orphanIntentOrg = await countRows(
    client,
    'SocialIntent',
    ` WHERE "organizationId" NOT IN (SELECT "id" FROM "Organization")`
  )
  if (orphanIntentOrg !== null) {
    ok('SocialIntent 无孤儿 organizationId', orphanIntentOrg === 0, `孤儿 ${orphanIntentOrg}`)
  }

  const orphanIntentMission = await countRows(
    client,
    'SocialIntent',
    ` WHERE "missionId" NOT IN (SELECT "id" FROM "Mission")`
  )
  if (orphanIntentMission !== null) {
    ok('SocialIntent 无孤儿 missionId', orphanIntentMission === 0, `孤儿 ${orphanIntentMission}`)
  }

  const orphanIntentUser = await countRows(
    client,
    'SocialIntent',
    ` WHERE "userId" NOT IN (SELECT "id" FROM "User")`
  )
  if (orphanIntentUser !== null) {
    ok('SocialIntent 无孤儿 userId', orphanIntentUser === 0, `孤儿 ${orphanIntentUser}`)
  }

  // 5b) 业务唯一性：同一任务同一成员只能有一条意图
  const dupIntent = await countRows(
    client,
    'SocialIntent',
    ` GROUP BY "missionId", "userId" HAVING COUNT(*) > 1`
  )
  if (dupIntent !== null) {
    ok('SocialIntent 无重复 (missionId,userId)', dupIntent === 0, `重复组 ${dupIntent}`)
  }

  // 5c) T05 · 提案与表态的唯一性、以及引用完整性
  const dupProposal = await countRows(
    client,
    'ConnectionProposal',
    ` GROUP BY "missionId", "proposerId", "candidateId" HAVING COUNT(*) > 1`
  )
  if (dupProposal !== null) {
    ok(
      'ConnectionProposal 无重复 (missionId,proposerId,candidateId)',
      dupProposal === 0,
      `重复组 ${dupProposal}`
    )
  }

  const dupDecision = await countRows(
    client,
    'ProposalDecision',
    ` GROUP BY "proposalId", "personId" HAVING COUNT(*) > 1`
  )
  if (dupDecision !== null) {
    ok('ProposalDecision 无重复 (proposalId,personId)', dupDecision === 0, `重复组 ${dupDecision}`)
  }

  const orphanProposalMission = await countRows(
    client,
    'ConnectionProposal',
    ` WHERE "missionId" NOT IN (SELECT "id" FROM "Mission")`
  )
  if (orphanProposalMission !== null) {
    ok('ConnectionProposal 无孤儿 missionId', orphanProposalMission === 0, `孤儿 ${orphanProposalMission}`)
  }

  const orphanDecisionProposal = await countRows(
    client,
    'ProposalDecision',
    ` WHERE "proposalId" NOT IN (SELECT "id" FROM "ConnectionProposal")`
  )
  if (orphanDecisionProposal !== null) {
    ok(
      'ProposalDecision 无孤儿 proposalId',
      orphanDecisionProposal === 0,
      `孤儿 ${orphanDecisionProposal}`
    )
  }

  // 6) 计数（信息项，不断言 0 —— 生产可能有真实数据）
  for (const t of ALL_TABLES) {
    const n = await countRows(client, t)
    if (n !== null) ok(`${t} 行数可读`, true, String(n))
  }

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
        await cmdPlan(client, args)
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
