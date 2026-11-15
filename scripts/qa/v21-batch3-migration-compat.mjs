#!/usr/bin/env node
/**
 * V21 第三批 · C05 —— 迁移与数据完整性可重放验证
 * ═══════════════════════════════════════════════════════════════════════════════
 * 验证对象：
 *   prisma/migrations/20261115120000_v21_batch2_execution_loop/migration.sql
 *   （V21 第二批 execution loop：3 张新表 + 2 个可选列 + 6 条索引）
 *
 * 做四件事（全部在 /tmp 隔离库上，**绝不触碰 ci-e2e.db / 生产库**）：
 *   1. 可复现迁移来源：用「迁移前 schema 快照」→ 当前 schema 重新跑
 *      `prisma migrate diff`，断言 migration.sql 与 Prisma 生成的 SQL **逐句一致**
 *      （防止手写漂移），并断言全文无 DROP/DELETE/UPDATE、ALTER 只有两条 ADD COLUMN。
 *   2. 干净库：先应用「迁移前基线 SQL」（squashed baseline），再应用 migration.sql；
 *      断言 3 表 / 2 列 / 6 索引 / 唯一约束真实生效（PRAGMA + 插入冲突实测）。
 *   3. 旧版本库：只应用基线 → 插入旧版 Mission / IdempotencyRecord → 再应用新迁移；
 *      断言旧行仍在、可读、新列为 NULL、列顺序未变（纯新增）。
 *   4. Prisma 一致性：`prisma validate` + src/generated 是否包含三张新表。
 *
 * 为什么基线用「schema 快照」而不是重放 prisma/migrations 历史：
 *   本仓历史迁移是**变更记录**（见 20261010150000_t01_tenancy 抬头），前三个文件是
 *   PostgreSQL 方言（DO $$ … CREATE TYPE / TEXT[] / ADD COLUMN IF NOT EXISTS），
 *   在 SQLite 上无法重放（P3018 / near "DO": syntax error）。脚本仍会**实测**一次
 *   `prisma migrate deploy` 并把原始失败输出写进报告的 knownLimitations，
 *   不伪造通过；v21 迁移本身的验证用等价的基线快照完成。
 *
 * 运行：
 *   node scripts/qa/v21-batch3-migration-compat.mjs
 *
 * 退出码：0 = 全部 gate PASS；1 = 任一 gate FAIL / 未预期异常。
 * 产物：docs/v21/batch3/migration-report.json
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SCHEMA_DIR = path.join(ROOT, 'prisma/schema')
const MIGRATION_DIR = path.join(
  ROOT,
  'prisma/migrations/20261115120000_v21_batch2_execution_loop',
)
const MIGRATION_SQL = path.join(MIGRATION_DIR, 'migration.sql')
const DOWN_SQL = path.join(MIGRATION_DIR, 'down.sql')
const REPORT_DIR = path.join(ROOT, 'docs/v21/batch3')
const REPORT_PATH = path.join(REPORT_DIR, 'migration-report.json')

const TMP = '/tmp/v21-batch3-compat'
const DB_CLEAN = `${TMP}/v21-mig-clean.db`
const DB_LEGACY = `${TMP}/v21-mig-legacy.db`
const DB_PROBE = `${TMP}/v21-mig-deploy-probe.db`
const SNAPSHOT_DIR = `${TMP}/schema-before`
const BASELINE_SQL = `${TMP}/baseline-before-v21.sql`
const EXPECTED_SQL = `${TMP}/expected-v21-diff.sql`

const PRISMA_BIN = path.join(ROOT, 'node_modules/.bin/prisma')

const commands = []
const checks = []
const knownLimitations = []

const NEW_TABLES = ['MissionSpecRevision', 'ExecutionVerification', 'AgentRunStageEvent']
const NEW_COLUMNS = [
  { table: 'Mission', column: 'sourceRunId', type: 'TEXT' },
  { table: 'IdempotencyRecord', column: 'actorId', type: 'TEXT' },
]
const EXPECTED_INDEXES = [
  {
    table: 'MissionSpecRevision',
    name: 'MissionSpecRevision_missionId_version_key',
    unique: true,
    columns: ['missionId', 'version'],
  },
  {
    table: 'MissionSpecRevision',
    name: 'MissionSpecRevision_organizationId_missionId_version_idx',
    unique: false,
    columns: ['organizationId', 'missionId', 'version'],
  },
  {
    table: 'ExecutionVerification',
    name: 'ExecutionVerification_missionId_runId_key',
    unique: true,
    columns: ['missionId', 'runId'],
  },
  {
    table: 'ExecutionVerification',
    name: 'ExecutionVerification_organizationId_missionId_idx',
    unique: false,
    columns: ['organizationId', 'missionId'],
  },
  {
    table: 'AgentRunStageEvent',
    name: 'AgentRunStageEvent_runId_seq_key',
    unique: true,
    columns: ['runId', 'seq'],
  },
  {
    table: 'AgentRunStageEvent',
    name: 'AgentRunStageEvent_organizationId_runId_seq_idx',
    unique: false,
    columns: ['organizationId', 'runId', 'seq'],
  },
]

// ───────────────────────────── 基础设施 ─────────────────────────────

function childEnv(databaseUrl) {
  const env = { ...process.env, DATABASE_URL: databaseUrl }
  delete env.NODE_OPTIONS
  return env
}

function run(cmd, args, { databaseUrl, display } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    env: childEnv(databaseUrl ?? process.env.DATABASE_URL ?? ''),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const record = {
    command:
      display ??
      `${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
    exitCode: res.status,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  }
  commands.push(record)
  return { ...record, ok: res.status === 0 }
}

function prisma(args, opts) {
  return run(PRISMA_BIN, args, opts)
}

function addCheck(id, title, ok, detail, evidence = null) {
  checks.push({
    id,
    title,
    status: ok ? 'PASS' : 'FAIL',
    detail,
    evidence,
  })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${id} · ${title}${detail ? ` — ${detail}` : ''}`)
  return ok
}

function gate(id, title, fn) {
  try {
    return fn()
  } catch (err) {
    addCheck(id, title, false, `异常：${err?.message ?? String(err)}`)
    return false
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function openDb(file) {
  return new DatabaseSync(file)
}

function tableInfo(db, table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map((r) => ({
    cid: Number(r.cid),
    name: String(r.name),
    type: String(r.type),
    notnull: Number(r.notnull),
    dflt_value: r.dflt_value,
    pk: Number(r.pk),
  }))
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => String(r.name))
}

function indexInfo(db, index) {
  return db
    .prepare(`PRAGMA index_info('${index}')`)
    .all()
    .map((r) => ({ seqno: Number(r.seqno), name: String(r.name) }))
    .sort((a, b) => a.seqno - b.seqno)
}

function indexList(db, table) {
  return db
    .prepare(`PRAGMA index_list('${table}')`)
    .all()
    .map((r) => ({ name: String(r.name), unique: Number(r.unique) === 1 }))
}

function inventory(db) {
  const inv = {}
  for (const t of tableNames(db)) {
    inv[t] = tableInfo(db, t).map((c) => `${c.name}:${c.type}:${c.notnull}:${c.pk}`)
  }
  return inv
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function normalizeSql(sql) {
  return sql
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .join('\n')
}

// ───────────────────────── 0 · 环境与前置检查 ─────────────────────────

console.log('\nV21 C05 · 迁移与数据完整性验证')
console.log('══════════════════════════════════════════════════════════')
console.log(`root: ${ROOT}`)

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
fs.mkdirSync(REPORT_DIR, { recursive: true })

for (const f of [MIGRATION_SQL, DOWN_SQL, PRISMA_BIN]) {
  if (!fs.existsSync(f)) {
    console.error(`BLOCKED: 缺少必需文件 ${f}`)
    process.exit(1)
  }
}

const migrationSqlText = fs.readFileSync(MIGRATION_SQL, 'utf8')

gate('M01', 'migration.sql 为纯新增（静态检查）', () => {
  const forbidden = migrationSqlText
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .filter((l) => /\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i.test(l))
  const alters = migrationSqlText
    .split('\n')
    .filter((l) => /^ALTER TABLE/i.test(l.trim()))
  const badAlters = alters.filter((l) => !/ADD COLUMN/i.test(l))
  const evidence = { forbiddenStatements: forbidden, alterStatements: alters }
  return addCheck(
    'M01',
    'migration.sql 为纯新增（静态检查）',
    forbidden.length === 0 && alters.length === 2 && badAlters.length === 0,
    `forbidden=${forbidden.length}, ALTER=${alters.length}, 非 ADD COLUMN=${badAlters.length}`,
    evidence,
  )
})

// ───────── 1 · 复现迁移来源：迁移前快照 → 当前 schema ─────────

let snapshotReady = false

gate('M02', '构建迁移前 schema 快照（当前 schema 去掉 v21 增量）', () => {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const files = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))
  assert(files.includes('v21.prisma'), '找不到 v21.prisma')
  for (const f of files) {
    if (f === 'v21.prisma') continue
    fs.copyFileSync(path.join(SCHEMA_DIR, f), path.join(SNAPSHOT_DIR, f))
  }
  const connPath = path.join(SNAPSHOT_DIR, 'connection.prisma')
  let s = fs.readFileSync(connPath, 'utf8')
  const before = s
  s = s.replace(/\n  \/\/\/ V21 · Mission ↔ AgentRun[\s\S]*?sourceRunId    String\?\n/, '\n')
  s = s.replace(/\n  \/\/\/ V21\/R3：发起人身份[\s\S]*?actorId      String\?\n/, '\n')
  assert(s !== before, '快照裁剪未命中（schema 注释格式变了？）')
  assert(!/sourceRunId/.test(s), '快照仍含 sourceRunId')
  assert(!/actorId/.test(s), '快照仍含 actorId')
  fs.writeFileSync(connPath, s)
  snapshotReady = true
  return addCheck(
    'M02',
    '构建迁移前 schema 快照（当前 schema 去掉 v21 增量）',
    true,
    `${SNAPSHOT_DIR}（${files.length - 1} 个 .prisma，去掉 v21.prisma，裁剪 2 行）`,
    { snapshotDir: SNAPSHOT_DIR, removedColumns: ['Mission.sourceRunId', 'IdempotencyRecord.actorId'] },
  )
})

gate('M03', 'migration.sql 与 prisma migrate diff 生成结果逐句一致', () => {
  assert(snapshotReady, '快照未就绪')
  const generated = prisma([
    'migrate',
    'diff',
    '--from-schema',
    SNAPSHOT_DIR,
    '--to-schema',
    SCHEMA_DIR,
    '--script',
    '--output',
    EXPECTED_SQL,
  ])
  assert(generated.ok, `migrate diff 失败: ${generated.stderr || generated.stdout}`)
  const expected = normalizeSql(fs.readFileSync(EXPECTED_SQL, 'utf8'))
  const actual = normalizeSql(migrationSqlText)
  const same = expected === actual
  let diffHint = null
  if (!same) {
    const e = expected.split('\n')
    const a = actual.split('\n')
    const firstDiff = e.findIndex((line, i) => line !== a[i])
    diffHint = {
      firstDiffLine: firstDiff,
      expected: e.slice(Math.max(0, firstDiff - 2), firstDiff + 3),
      actual: a.slice(Math.max(0, firstDiff - 2), firstDiff + 3),
    }
  }
  return addCheck(
    'M03',
    'migration.sql 与 prisma migrate diff 生成结果逐句一致',
    same,
    same ? '与生成结果完全一致（含顺序）' : '存在漂移，见 evidence',
    {
      expectedSqlPath: EXPECTED_SQL,
      expectedSha256: crypto.createHash('sha256').update(expected).digest('hex'),
      actualSha256: crypto.createHash('sha256').update(actual).digest('hex'),
      firstDiff: diffHint,
    },
  )
})

// ───────── 2 · 干净库：基线 + 新迁移 ─────────

function generateBaseline() {
  const diff = prisma([
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema',
    SNAPSHOT_DIR,
    '--script',
    '--output',
    BASELINE_SQL,
  ])
  assert(diff.ok, `基线 diff 失败: ${diff.stderr || diff.stdout}`)
  const sql = fs.readFileSync(BASELINE_SQL, 'utf8')
  assert(/CREATE TABLE/i.test(sql), '基线 SQL 为空')
  return sql
}

function execSqlFile(file, dbFile) {
  const url = `file:${dbFile}`
  const res = prisma(['db', 'execute', '--file', file], {
    databaseUrl: url,
    display: `DATABASE_URL=${url} npx prisma db execute --file ${file}`,
  })
  assert(res.ok, `db execute 失败 (${file}): ${res.stderr || res.stdout}`)
  return res
}

let cleanInv = null

gate('M04', '干净库应用「迁移前基线」', () => {
  generateBaseline()
  const res = execSqlFile(BASELINE_SQL, DB_CLEAN)
  const db = openDb(DB_CLEAN)
  const tables = tableNames(db)
  const info = tableInfo(db, 'Mission')
  const hasNew = NEW_TABLES.filter((t) => tables.includes(t))
  const columns = info.map((c) => c.name)
  cleanInv = inventory(db)
  db.close()
  const ok =
    tables.length > 50 &&
    hasNew.length === 0 &&
    !columns.includes('sourceRunId')
  return addCheck(
    'M04',
    '干净库应用「迁移前基线」',
    ok,
    `表=${tables.length}, 新表=${hasNew.length}, Mission 列=${columns.length}（无 sourceRunId）`,
    {
      baselineSql: BASELINE_SQL,
      baselineSha256: sha256(BASELINE_SQL),
      execute: { exitCode: res.exitCode, stdout: res.stdout },
      tableCount: tables.length,
      missionColumns: columns,
    },
  )
})

gate('M05', '干净库应用新迁移 migration.sql', () => {
  const res = execSqlFile(MIGRATION_SQL, DB_CLEAN)
  return addCheck(
    'M05',
    '干净库应用新迁移 migration.sql',
    true,
    `prisma db execute 退出码 ${res.exitCode}`,
    { execute: { exitCode: res.exitCode, stdout: res.stdout } },
  )
})

gate('M06', '三张新表存在且列定义正确', () => {
  const db = openDb(DB_CLEAN)
  const tables = tableNames(db)
  const details = {}
  let ok = true
  for (const t of NEW_TABLES) {
    if (!tables.includes(t)) {
      details[t] = { missing: true }
      ok = false
      continue
    }
    const cols = tableInfo(db, t)
    details[t] = cols
    const pk = cols.filter((c) => c.pk === 1)
    if (pk.length !== 1 || pk[0].name !== 'id') ok = false
  }
  // 关键列语义
  const msv = details.MissionSpecRevision ?? []
  const ev = details.ExecutionVerification ?? []
  const ase = details.AgentRunStageEvent ?? []
  const must = (cols, name, notnull, type) => {
    const c = cols.find((x) => x.name === name)
    return !!c && c.notnull === notnull && (!type || c.type === type)
  }
  const semantics = {
    'MissionSpecRevision.version NOT NULL': must(msv, 'version', 1, 'INTEGER'),
    'MissionSpecRevision.specJson NOT NULL': must(msv, 'specJson', 1, 'TEXT'),
    'MissionSpecRevision.actorId NOT NULL': must(msv, 'actorId', 1, 'TEXT'),
    'MissionSpecRevision.changeNote NULL': must(msv, 'changeNote', 0, 'TEXT'),
    'ExecutionVerification.verdict NOT NULL': must(ev, 'verdict', 1, 'TEXT'),
    'ExecutionVerification.receiptRef NULL': must(ev, 'receiptRef', 0, 'TEXT'),
    'AgentRunStageEvent.seq NOT NULL': must(ase, 'seq', 1, 'INTEGER'),
    'AgentRunStageEvent.detail NULL': must(ase, 'detail', 0, 'TEXT'),
  }
  const badSemantics = Object.entries(semantics).filter(([, v]) => !v).map(([k]) => k)
  db.close()
  ok = ok && badSemantics.length === 0
  return addCheck(
    'M06',
    '三张新表存在且列定义正确',
    ok,
    `缺失表=${NEW_TABLES.filter((t) => !tables.includes(t)).join(',') || '无'}, 语义不符=${badSemantics.join(',') || '无'}`,
    { tables: NEW_TABLES, columns: details, semantics },
  )
})

gate('M07', '两个可选列存在且 NOT NULL=0（旧行默认 NULL）', () => {
  const db = openDb(DB_CLEAN)
  const rows = []
  let ok = true
  for (const { table, column, type } of NEW_COLUMNS) {
    const info = tableInfo(db, table)
    const col = info.find((c) => c.name === column)
    rows.push({ table, column, found: !!col, definition: col ?? null })
    if (!col || col.notnull !== 0 || col.type !== type || col.dflt_value !== null) ok = false
  }
  db.close()
  return addCheck(
    'M07',
    '两个可选列存在且 NOT NULL=0（旧行默认 NULL）',
    ok,
    rows.map((r) => `${r.table}.${r.column}=${r.found ? '存在' : '缺失'}`).join(', '),
    rows,
  )
})

gate('M08', '六条索引存在（唯一/非唯一与列序正确）', () => {
  const db = openDb(DB_CLEAN)
  const results = []
  let ok = true
  for (const spec of EXPECTED_INDEXES) {
    const list = indexList(db, spec.table)
    const found = list.find((i) => i.name === spec.name)
    const cols = found ? indexInfo(db, spec.name).map((c) => c.name) : []
    const pass =
      !!found &&
      found.unique === spec.unique &&
      cols.length === spec.columns.length &&
      cols.every((c, i) => c === spec.columns[i])
    if (!pass) ok = false
    results.push({
      table: spec.table,
      index: spec.name,
      expected: { unique: spec.unique, columns: spec.columns },
      actual: found ? { unique: found.unique, columns: cols } : null,
      pass,
    })
  }
  db.close()
  return addCheck(
    'M08',
    '六条索引存在（唯一/非唯一与列序正确）',
    ok,
    `${results.filter((r) => r.pass).length}/${results.length} 通过`,
    results,
  )
})

gate('M09', '唯一约束真实生效（重复插入被拒）', () => {
  const db = openDb(DB_CLEAN)
  const ts = new Date().toISOString()
  const results = []
  // MissionSpecRevision: (missionId, version)
  db.prepare(
    `INSERT INTO "MissionSpecRevision" ("id","organizationId","missionId","version","specJson","actorId","createdAt")
     VALUES (?,?,?,?,?,?,?)`,
  ).run('msr_1', 'org_1', 'mis_1', 1, '{}', 'user_1', ts)
  let msvDup = false
  try {
    db.prepare(
      `INSERT INTO "MissionSpecRevision" ("id","organizationId","missionId","version","specJson","actorId","createdAt")
       VALUES (?,?,?,?,?,?,?)`,
    ).run('msr_2', 'org_1', 'mis_1', 1, '{}', 'user_2', ts)
  } catch (e) {
    msvDup = true
    results.push({ table: 'MissionSpecRevision', duplicateRejected: true, error: String(e.message) })
  }
  if (!msvDup) results.push({ table: 'MissionSpecRevision', duplicateRejected: false })
  // ExecutionVerification: (missionId, runId)
  db.prepare(
    `INSERT INTO "ExecutionVerification" ("id","organizationId","missionId","runId","verdict","criteriaJson","verifierId","createdAt")
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run('ev_1', 'org_1', 'mis_1', 'run_1', 'CONFIRMED', '[]', 'user_2', ts)
  let evDup = false
  try {
    db.prepare(
      `INSERT INTO "ExecutionVerification" ("id","organizationId","missionId","runId","verdict","criteriaJson","verifierId","createdAt")
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run('ev_2', 'org_1', 'mis_1', 'run_1', 'CONFIRMED', '[]', 'user_3', ts)
  } catch (e) {
    evDup = true
    results.push({ table: 'ExecutionVerification', duplicateRejected: true, error: String(e.message) })
  }
  if (!evDup) results.push({ table: 'ExecutionVerification', duplicateRejected: false })
  // AgentRunStageEvent: (runId, seq)
  db.prepare(
    `INSERT INTO "AgentRunStageEvent" ("id","organizationId","runId","seq","stage","at")
     VALUES (?,?,?,?,?,?)`,
  ).run('ase_1', 'org_1', 'run_1', 1, 'QUOTA_CHECK', ts)
  let aseDup = false
  try {
    db.prepare(
      `INSERT INTO "AgentRunStageEvent" ("id","organizationId","runId","seq","stage","at")
       VALUES (?,?,?,?,?,?)`,
    ).run('ase_2', 'org_1', 'run_1', 1, 'MODEL_CALL', ts)
  } catch (e) {
    aseDup = true
    results.push({ table: 'AgentRunStageEvent', duplicateRejected: true, error: String(e.message) })
  }
  if (!aseDup) results.push({ table: 'AgentRunStageEvent', duplicateRejected: false })
  db.close()
  const ok = msvDup && evDup && aseDup
  return addCheck(
    'M09',
    '唯一约束真实生效（重复插入被拒）',
    ok,
    `${results.filter((r) => r.duplicateRejected).length}/3 唯一键拒绝了重复行`,
    results,
  )
})

gate('M10', '相对基线为纯新增（无表/列丢失）', () => {
  assert(cleanInv, '基线 inventory 未采集')
  const db = openDb(DB_CLEAN)
  const after = inventory(db)
  db.close()
  const beforeTables = Object.keys(cleanInv)
  const afterTables = Object.keys(after)
  const lostTables = beforeTables.filter((t) => !afterTables.includes(t))
  const addedTables = afterTables.filter((t) => !beforeTables.includes(t))
  const lostColumns = []
  const addedColumns = []
  for (const t of beforeTables) {
    if (!afterTables.includes(t)) continue
    const b = cleanInv[t]
    const a = after[t]
    const bNames = b.map((x) => x.split(':')[0])
    const aNames = a.map((x) => x.split(':')[0])
    for (const n of bNames) if (!aNames.includes(n)) lostColumns.push(`${t}.${n}`)
    for (const n of aNames) if (!bNames.includes(n)) addedColumns.push(`${t}.${n}`)
    // 列顺序：旧列必须保持原有相对顺序（ADD COLUMN 追加在末尾）
    const aFiltered = aNames.filter((n) => bNames.includes(n))
    if (aFiltered.join(',') !== bNames.join(',')) {
      lostColumns.push(`${t}:列顺序被打乱`)
    }
  }
  const ok =
    lostTables.length === 0 &&
    lostColumns.length === 0 &&
    addedTables.length === 3 &&
    addedTables.every((t) => NEW_TABLES.includes(t)) &&
    addedColumns.length === 2
  return addCheck(
    'M10',
    '相对基线为纯新增（无表/列丢失）',
    ok,
    `+表 ${addedTables.length}, +列 ${addedColumns.length}, 丢失表 ${lostTables.length}, 丢失列 ${lostColumns.length}`,
    {
      addedTables,
      addedColumns,
      lostTables,
      lostColumns,
      beforeTableCount: beforeTables.length,
      afterTableCount: afterTables.length,
    },
  )
})

// ───────── 3 · 旧版本库：旧数据 + 新迁移 ─────────

const LEGACY = {
  orgId: 'legacy_org_1',
  userId: 'legacy_user_1',
  missionId: 'legacy_mission_1',
  shareToken: 'legacy_share_token_1',
  idemId: 'legacy_idem_1',
  idemKey: 'legacy-key-1',
  title: '旧版 Mission（迁移前写入）',
  goal: '验证旧行在迁移后可读',
  offer: '旧报价',
  successCriteria: '旧判据',
  resourceId: 'legacy_res_1',
}

gate('M11', '旧版本库：应用基线并写入旧版数据', () => {
  execSqlFile(BASELINE_SQL, DB_LEGACY)
  const db = openDb(DB_LEGACY)
  const ts = new Date().toISOString()
  db.prepare(
    `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?)`,
  ).run(LEGACY.orgId, 'Legacy Org', 'legacy-org-1', 'ACTIVE', ts, ts)
  db.prepare(
    `INSERT INTO "User" ("id","email","role","tokenVersion","isBot","createdAt" ,"updatedAt")
     VALUES (?,?,?,?,?,?,?)`,
  ).run(LEGACY.userId, 'legacy@example.test', 'USER', 0, 0, ts, ts)
  db.prepare(
    `INSERT INTO "Mission"
       ("id","organizationId","ownerId","title","goal","offer","successCriteria","status","shareToken","publicPreview","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    LEGACY.missionId,
    LEGACY.orgId,
    LEGACY.userId,
    LEGACY.title,
    LEGACY.goal,
    LEGACY.offer,
    LEGACY.successCriteria,
    'ACTIVE',
    LEGACY.shareToken,
    1,
    ts,
    ts,
  )
  db.prepare(
    `INSERT INTO "IdempotencyRecord"
       ("id","organizationId","scope","key","requestHash","resourceType","resourceId","createdAt")
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    LEGACY.idemId,
    LEGACY.orgId,
    'mission.create',
    LEGACY.idemKey,
    'sha256:legacy-hash',
    'Mission',
    LEGACY.resourceId,
    ts,
  )
  const mission = db.prepare('SELECT * FROM "Mission" WHERE id = ?').get(LEGACY.missionId)
  const idem = db.prepare('SELECT * FROM "IdempotencyRecord" WHERE id = ?').get(LEGACY.idemId)
  const missionCols = tableInfo(db, 'Mission').map((c) => c.name)
  const idemCols = tableInfo(db, 'IdempotencyRecord').map((c) => c.name)
  db.close()
  const ok =
    !!mission &&
    !!idem &&
    !missionCols.includes('sourceRunId') &&
    !idemCols.includes('actorId')
  return addCheck(
    'M11',
    '旧版本库：应用基线并写入旧版数据',
    ok,
    `Mission=${!!mission}, IdempotencyRecord=${!!idem}, 旧表无新列=${!missionCols.includes('sourceRunId') && !idemCols.includes('actorId')}`,
    {
      missionColumns: missionCols,
      idempotencyColumns: idemCols,
      inserted: { mission, idempotencyRecord: idem },
    },
  )
})

gate('M12', '旧数据在应用新迁移后仍可读且值不变', () => {
  execSqlFile(MIGRATION_SQL, DB_LEGACY)
  const db = openDb(DB_LEGACY)
  const mission = db.prepare('SELECT * FROM "Mission" WHERE id = ?').get(LEGACY.missionId)
  const idem = db.prepare('SELECT * FROM "IdempotencyRecord" WHERE id = ?').get(LEGACY.idemId)
  db.close()
  const missionOk =
    !!mission &&
    mission.title === LEGACY.title &&
    mission.goal === LEGACY.goal &&
    mission.offer === LEGACY.offer &&
    mission.successCriteria === LEGACY.successCriteria &&
    mission.shareToken === LEGACY.shareToken &&
    mission.status === 'ACTIVE'
  const idemOk =
    !!idem &&
    idem.key === LEGACY.idemKey &&
    idem.scope === 'mission.create' &&
    idem.requestHash === 'sha256:legacy-hash' &&
    idem.resourceId === LEGACY.resourceId
  return addCheck(
    'M12',
    '旧数据在应用新迁移后仍可读且值不变',
    missionOk && idemOk,
    `Mission=${missionOk ? '字段全一致' : '不一致/丢失'}, IdempotencyRecord=${idemOk ? '字段全一致' : '不一致/丢失'}`,
    { mission: mission ?? null, idempotencyRecord: idem ?? null },
  )
})

gate('M13', '旧行新列默认 NULL（无回填、无默认值）', () => {
  const db = openDb(DB_LEGACY)
  const mission = db
    .prepare('SELECT "sourceRunId" FROM "Mission" WHERE id = ?')
    .get(LEGACY.missionId)
  const idem = db
    .prepare('SELECT "actorId" FROM "IdempotencyRecord" WHERE id = ?')
    .get(LEGACY.idemId)
  db.close()
  const m = mission ? mission.sourceRunId : undefined
  const i = idem ? idem.actorId : undefined
  const ok = m === null && i === null
  return addCheck(
    'M13',
    '旧行新列默认 NULL（无回填、无默认值）',
    ok,
    `Mission.sourceRunId=${JSON.stringify(m)}, IdempotencyRecord.actorId=${JSON.stringify(i)}`,
    { missionSourceRunId: m, idempotencyActorId: i },
  )
})

gate('M14', '旧库新列可写入（新代码按需赋值），旧行仍不受影响', () => {
  const db = openDb(DB_LEGACY)
  db.prepare('UPDATE "Mission" SET "sourceRunId" = ? WHERE id = ?').run('legacy_run_1', LEGACY.missionId)
  db.prepare('UPDATE "IdempotencyRecord" SET "actorId" = ? WHERE id = ?').run(LEGACY.userId, LEGACY.idemId)
  const mission = db.prepare('SELECT "sourceRunId" FROM "Mission" WHERE id = ?').get(LEGACY.missionId)
  const idem = db.prepare('SELECT "actorId" FROM "IdempotencyRecord" WHERE id = ?').get(LEGACY.idemId)
  const count = db.prepare('SELECT COUNT(*) AS c FROM "Mission"').get()
  db.close()
  const ok =
    mission?.sourceRunId === 'legacy_run_1' &&
    idem?.actorId === LEGACY.userId &&
    Number(count.c) === 1
  return addCheck(
    'M14',
    '旧库新列可写入（新代码按需赋值），旧行仍不受影响',
    ok,
    `sourceRunId=${mission?.sourceRunId}, actorId=${idem?.actorId}, Mission 行数=${count.c}`,
    { mission, idempotencyRecord: idem, missionCount: Number(count.c) },
  )
})

gate('M15', '旧库三张新表可用（新表在旧数据上增量建立）', () => {
  const db = openDb(DB_LEGACY)
  const ts = new Date().toISOString()
  db.prepare(
    `INSERT INTO "MissionSpecRevision" ("id","organizationId","missionId","version","specJson","actorId","createdAt")
     VALUES (?,?,?,?,?,?,?)`,
  ).run('legacy_msr_1', LEGACY.orgId, LEGACY.missionId, 1, '{"v":1}', LEGACY.userId, ts)
  db.prepare(
    `INSERT INTO "AgentRunStageEvent" ("id","organizationId","runId","seq","stage","at")
     VALUES (?,?,?,?,?,?)`,
  ).run('legacy_ase_1', LEGACY.orgId, 'legacy_run_1', 1, 'PERSISTED', ts)
  const msr = db.prepare('SELECT COUNT(*) AS c FROM "MissionSpecRevision"').get()
  const ase = db.prepare('SELECT COUNT(*) AS c FROM "AgentRunStageEvent"').get()
  const mission = db.prepare('SELECT "sourceRunId" FROM "Mission" WHERE id = ?').get(LEGACY.missionId)
  db.close()
  const ok = Number(msr.c) === 1 && Number(ase.c) === 1 && mission?.sourceRunId === 'legacy_run_1'
  return addCheck(
    'M15',
    '旧库三张新表可用（新表在旧数据上增量建立）',
    ok,
    `MissionSpecRevision=${msr.c}, AgentRunStageEvent=${ase.c}`,
    { missionSpecRevisionCount: Number(msr.c), agentRunStageEventCount: Number(ase.c) },
  )
})

// ───────── 4 · Prisma Client / schema 一致性 ─────────

gate('M16', 'prisma validate 通过', () => {
  const res = prisma(['validate'])
  const ok = res.ok && /valid/i.test(res.stdout)
  return addCheck(
    'M16',
    'prisma validate 通过',
    ok,
    ok ? res.stdout.split('\n').filter(Boolean).pop() : res.stderr || res.stdout,
    { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr },
  )
})

gate('M17', 'src/generated 已包含三张新表（Prisma Client 与 schema 一致）', () => {
  const genDir = path.join(ROOT, 'src/generated')
  assert(fs.existsSync(genDir), 'src/generated 不存在')
  const hits = {}
  for (const t of NEW_TABLES) {
    hits[t] = []
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) continue
      if (!/\.(ts|js|d\.ts|prisma|json)$/.test(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      const size = fs.statSync(p).size
      if (size > 20 * 1024 * 1024) continue
      const text = fs.readFileSync(p, 'utf8')
      for (const t of NEW_TABLES) {
        if (text.includes(t)) hits[t].push(path.relative(ROOT, p))
      }
    }
  }
  walk(genDir)
  const missing = NEW_TABLES.filter((t) => hits[t].length === 0)
  // 同时确认生成产物里两个新字段存在（抓 schema.prisma 副本）
  const schemaCopy = path.join(genDir, 'schema.prisma')
  const schemaCopyText = fs.existsSync(schemaCopy) ? fs.readFileSync(schemaCopy, 'utf8') : ''
  const fieldsOk =
    /sourceRunId\s+String\?/.test(schemaCopyText) && /actorId\s+String\?/.test(schemaCopyText)
  const ok = missing.length === 0 && fieldsOk
  return addCheck(
    'M17',
    'src/generated 已包含三张新表（Prisma Client 与 schema 一致）',
    ok,
    `缺失=${missing.join(',') || '无'}, 新字段=${fieldsOk ? '存在' : '缺失'}`,
    { generatedDir: 'src/generated', hits, schemaCopyHasNewFields: fieldsOk },
  )
})

gate('M18', 'down.sql 不含假回滚（无 DROP COLUMN / 无 DROP 既有表）', () => {
  const text = fs.readFileSync(DOWN_SQL, 'utf8')
  const active = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
  const drops = active.filter((l) => /^DROP TABLE/i.test(l))
  const dropTargets = drops.map((l) => (l.match(/"([^"]+)"/) ?? [])[1])
  const badTargets = dropTargets.filter((t) => !NEW_TABLES.includes(t))
  const dropColumn = active.filter((l) => /DROP COLUMN/i.test(l))
  const ok =
    drops.length === NEW_TABLES.length &&
    badTargets.length === 0 &&
    dropColumn.length === 0 &&
    NEW_TABLES.every((t) => dropTargets.includes(t))
  return addCheck(
    'M18',
    'down.sql 不含假回滚（无 DROP COLUMN / 无 DROP 既有表）',
    ok,
    `DROP TABLE=${drops.length}（目标=${dropTargets.join(',')}）, DROP COLUMN=${dropColumn.length}`,
    { activeStatements: active, dropTargets, dropColumn },
  )
})

// ───────── 5 · 已知环境限制（非本迁移引入，如实记录） ─────────

console.log('\n  · 探针：干净库上完整重放 prisma/migrations 历史（预期失败，记录原始输出）')
{
  const url = `file:${DB_PROBE}`
  const res = prisma(['migrate', 'deploy'], {
    databaseUrl: url,
    display: `DATABASE_URL=${url} npx prisma migrate deploy`,
  })
  knownLimitations.push({
    id: 'L01',
    title: 'prisma/migrations 历史无法在 SQLite 上重放（migrate deploy 失败）',
    status: res.ok ? 'UNEXPECTED_PASS' : 'CONFIRMED',
    classification: 'PRE_EXISTING_ENVIRONMENT_CONSTRAINT',
    introducedByThisChange: false,
    command: res.command,
    exitCode: res.exitCode,
    rawOutput: (res.stderr || res.stdout).slice(0, 6000),
    impact:
      '干净库不能用 `prisma migrate deploy` 从零构建；生产也不能靠它推进。历史文件 20250413/20250425/20260428 为 PostgreSQL 方言，且 20261010150000_t01_tenancy 明示历史文件是「变更记录，不是可重复执行的迁移脚本」。',
    mitigation:
      '本脚本用「迁移前 schema 快照 → 基线 SQL」在 /tmp 干净库上重建等价起点，再应用本次 migration.sql；生产执行走 scripts/connection/migrate.mjs 的幂等 DDL 通路并单独登记 _prisma_migrations 记录（见 C05_MIGRATION.md §5/§6）。',
  })
  console.log(`    → ${res.ok ? 'UNEXPECTED_PASS' : 'CONFIRMED 失败'}（exit=${res.exitCode}），已写入 knownLimitations`)
}

// ───────── 6 · 汇总与报告 ─────────

const failed = checks.filter((c) => c.status !== 'PASS')
const summary = {
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  knownLimitations: knownLimitations.length,
  failedIds: failed.map((c) => c.id),
}

const report = {
  task: 'V21 第三批 · C05（Prisma 迁移与数据完整性）',
  generatedAt: new Date().toISOString(),
  status: summary.status,
  migration: {
    version: '20261115120000_v21_batch2_execution_loop',
    dir: path.relative(ROOT, MIGRATION_DIR),
    files: {
      migrationSql: {
        path: path.relative(ROOT, MIGRATION_SQL),
        sha256: sha256(MIGRATION_SQL),
        bytes: fs.statSync(MIGRATION_SQL).size,
      },
      downSql: {
        path: path.relative(ROOT, DOWN_SQL),
        sha256: sha256(DOWN_SQL),
        bytes: fs.statSync(DOWN_SQL).size,
      },
    },
    additions: { tables: NEW_TABLES, columns: NEW_COLUMNS, indexes: EXPECTED_INDEXES },
  },
  environment: {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    prismaCli: PRISMA_BIN,
    datasourceProvider: 'sqlite',
    isolationDir: TMP,
    databases: {
      clean: DB_CLEAN,
      legacy: DB_LEGACY,
      deployProbe: DB_PROBE,
    },
    note: '全部使用 /tmp 下的独立库；未读写 ci-e2e.db 或任何生产库。',
  },
  checks,
  knownLimitations,
  commands,
  summary,
}

fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)

console.log('\n══════════════════════════════════════════════════════════')
console.log(`结果：${summary.status}  （PASS ${summary.passed}/${summary.total}，FAIL ${summary.failed}）`)
if (failed.length) {
  console.log(`失败项：${failed.map((c) => `${c.id} ${c.title}`).join(' | ')}`)
}
console.log(`已知限制：${summary.knownLimitations}（历史迁移不可重放，详见报告 knownLimitations）`)
console.log(`报告：${REPORT_PATH}`)
console.log(`隔离库：${TMP}`)
console.log('══════════════════════════════════════════════════════════\n')

process.exit(summary.status === 'PASS' ? 0 : 1)
