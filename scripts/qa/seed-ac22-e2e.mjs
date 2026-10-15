#!/usr/bin/env node
/**
 * AC-22 · Open SDK E2E —— **隔离库夹具**（播种）
 * ═══════════════════════════════════════════════════════════════
 * 取证对象是 `POST /api/mcp`、`/api/v1/a2a/tasks`、`/api/v1/bridges` **在真实
 * Next 运行时里的授权行为**。这要求夹具至少给出：
 *   · 一个真实可登录的会话（否则 401/403/200 三态无从区分）；
 *   · 三档角色（MEMBER / OPERATOR / OWNER）的**同一租户**成员；
 *   · 一条真实 Mission（让"授权路径"断言真实数据，而不是"空列表也绿"）；
 *   · 一个**我们都不是成员**的租户（`organizationId` 越权靶标）。
 *
 * ── 复用 AC-19 的两条成熟做法（不是随手的风格选择）────────────────
 *   ① `--reset` **DROP 全部表**而不是删库文件：inode 不变 ⇒ dev server 无需重启；
 *      删文件会让主库 fd 与 `-wal` 按路径对不上 ⇒ `SQLITE_READONLY`，
 *      症状是"读全对、写全挂"，极易误判成权限问题。
 *   ② DDL 由 `prisma migrate diff --from-empty --to-schema` 现场生成（`--regenerate`）。
 *
 * 用法：
 *   node scripts/qa/seed-ac22-e2e.mjs --reset --regenerate
 *   环境：E2E_DB_FILE / E2E_DDL_FILE / E2E_PASSWORD
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'
import { AC22_MISSION, AC22_ORGS, AC22_PASSWORD, AC22_PROFILES, AC22_USERS } from './ac22-fixture.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/ac22-open-sdk.db'
const DB_URL = `file:${DB_FILE}`
const DDL_FILE = process.env.E2E_DDL_FILE || '/tmp/ac22-open-sdk-ddl.sql'

function parseArgs(argv) {
  const args = { _: [] }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      args[k] = v === undefined ? true : v
    } else args._.push(a)
  }
  return args
}

function generateDdl() {
  const out = execFileSync(
    'npx',
    ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema', '--script'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  fs.writeFileSync(DDL_FILE, out)
  return out
}

function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--\s*$/.test(s))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })

  const ddl =
    fs.existsSync(DDL_FILE) && !args.regenerate ? fs.readFileSync(DDL_FILE, 'utf8') : generateDdl()
  const client = createClient({ url: DB_URL })

  // ── 0. --reset：DROP 全部表（保留库文件，见文件头）──
  if (args.reset) {
    const before = (
      await client.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      )
    ).rows
    if (before.length) {
      await client.execute('PRAGMA foreign_keys=OFF')
      for (const r of before) {
        await client.execute(`DROP TABLE IF EXISTS "${r.name}"`)
      }
      await client.execute('PRAGMA foreign_keys=ON')
    }
    console.log(`🧹 --reset：已清空 ${before.length} 张表（库文件保留，dev server 无需重启）`)
  }

  // ── 1. 建表（DDL 全是 CREATE TABLE/INDEX，无 IF NOT EXISTS ⇒ 只在空库上跑一次）──
  const existing = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='Organization'`,
  )
  if (existing.rows.length === 0) {
    for (const stmt of splitStatements(ddl)) {
      try {
        await client.execute(stmt)
      } catch (err) {
        console.error('DDL 执行失败：', stmt.slice(0, 80), '|', err?.message)
        throw err
      }
    }
    const n = (await client.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`))
      .rows[0].n
    console.log(`✅ schema 已建立（${n} 张表）`)
  } else {
    console.log('⏭  schema 已存在，跳过建表')
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const hash = bcrypt.hashSync(AC22_PASSWORD, 10)

  // ── 2. 两个租户 ──
  for (const org of Object.values(AC22_ORGS)) {
    await client.execute({
      sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?)
            ON CONFLICT("id") DO UPDATE SET "name"=excluded."name","status"='ACTIVE'`,
      args: [org.id, org.name, org.slug, 'ACTIVE', now, now],
    })
  }

  // ── 3. 三个账号（**全部**在 org a）+ 成员关系 ──
  //    🔴 `isBot` 必须显式为 false：true 会被登录链路挡掉（见记忆里的 QA 铁律）。
  for (const u of Object.values(AC22_USERS)) {
    await client.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
      args: [u.id, u.name, u.email, hash, now, now],
    })
    await client.execute({
      sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
            VALUES (?,?,?,?,'ACTIVE',?,?)
            ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
      args: [`ms_${u.id}`, AC22_ORGS.a.id, u.id, u.role, now, now],
    })
  }
  // org b **故意**没有任何成员关系 —— 它是 `organizationId` 越权靶标。

  // ── 4. 一条 Mission（授权路径的"真实数据"锚点）──
  const m = AC22_MISSION
  await client.execute({
    sql: `INSERT INTO "Mission" (
            "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
            "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
            "closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?,?,?,1,NULL,NULL,?,NULL,?,?)
          ON CONFLICT("id") DO UPDATE SET "status"='ACTIVE',"shareToken"=excluded."shareToken"`,
    args: [
      m.id,
      AC22_ORGS.a.id,
      AC22_USERS.aOwner.id,
      'AC22 授权示范任务',
      '为 MCP / A2A 的授权取证提供一个真实的任务锚点。',
      '本组织可对外开放的协作能力。',
      JSON.stringify(['开放 SDK 取证']),
      '第三方 Agent 能在授权范围内读到本任务。',
      'ACTIVE',
      m.token,
      now,
      now,
      now,
    ],
  })

  // ── 5. 三份档案 ──
  for (const [key, p] of Object.entries(AC22_PROFILES)) {
    const user = AC22_USERS[key]
    await client.execute({
      sql: `INSERT INTO "Profile" (
              "id","userId","displayName","age","gender","sexuality","bio","city",
              "occupation","company","profileStatus","onboardingStep","isApproved","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,?,?,?,?, 'APPROVED', 9, 1, ?, ?)
            ON CONFLICT("userId") DO UPDATE SET
              "displayName"=excluded."displayName","age"=excluded."age","bio"=excluded."bio",
              "city"=excluded."city","occupation"=excluded."occupation","company"=excluded."company",
              "profileStatus"='APPROVED',"onboardingStep"=9,"isApproved"=1`,
      args: [p.id, user.id, p.displayName, p.age, p.gender, p.sexuality, p.bio, p.city, p.occupation, p.company, now, now],
    })
  }

  const tables = await client.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`)
  const counts = await client.execute(
    `SELECT (SELECT COUNT(*) FROM "Organization") AS orgs,
            (SELECT COUNT(*) FROM "User") AS users,
            (SELECT COUNT(*) FROM "Membership") AS memberships,
            (SELECT COUNT(*) FROM "Mission") AS missions`,
  )
  const c = counts.rows[0]
  console.log(`\n✅ AC-22 夹具就绪：${DB_FILE}（${tables.rows[0].n} 张表）`)
  console.log(`   组织 ${c.orgs} · 账号 ${c.users} · 成员关系 ${c.memberships} · 任务 ${c.missions}`)
  console.log(`   ${AC22_ORGS.a.id}：OWNER / OPERATOR / MEMBER 三档齐备（鉴权阶梯）`)
  console.log(`   ${AC22_ORGS.b.id}：**零成员**（organizationId 越权靶标）`)
  console.log(`   E2E_PASSWORD=${AC22_PASSWORD}`)
  client.close()
}

main().catch((err) => {
  console.error('❌ AC-22 夹具准备失败：', err?.message || err)
  process.exit(1)
})
