#!/usr/bin/env node
/**
 * AC-19 · Community Bridge E2E —— **隔离库夹具**
 * ═══════════════════════════════════════════════════════════════
 * 与 `seed-t02-e2e.mjs` 的分工：
 *   t02 造**一个**租户（跨群天然造不出来）；本脚本造**三个**租户 + 两份协议，
 *   并把「三环收窄」的全部对照组成员一次性备齐（见 `ac19-fixture.mjs` 的注释）。
 *
 * 为什么必须自建整个库（而不是扩展 t02 夹具）：
 *   AC-19 的判据是「**跨**租户 + **三方**交集」。把一个租户塞进 t02 的夹具里，
 *   会让"跨群"退化成"同群不同成员"，而那样**恰好**是 T03 已有受众档位覆盖的场景 ——
 *   断言会在一个与 AC-19 无关的路径上变绿（最危险的一类假证据）。
 *
 * ── 复用 t02 的两条成熟做法 ────────────────────────────────────
 *   ① `--reset` **DROP 全部表**而不是删库文件（inode 不变 ⇒ dev server 无需重启；
 *      删文件会让主库 fd 与 `-wal` 按路径对不上 ⇒ `SQLITE_READONLY`，症状是"读全对、
 *      写全挂"，极易误判成权限问题）。
 *   ② DDL 由 `prisma migrate diff --from-empty --to-schema` 现场生成（`--regenerate`）。
 *
 * 用法：
 *   node scripts/qa/seed-ac19-bridge-e2e.mjs --reset --regenerate
 *   环境：E2E_DB_FILE / E2E_DDL_FILE / E2E_PASSWORD
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'
import {
  AC19_BRIDGES,
  AC19_BRIDGE_FIELD_KEYS,
  AC19_INTENT_DISCLOSURE,
  AC19_MISSIONS,
  AC19_ORGS,
  AC19_PASSWORD,
  AC19_PROFILES,
  AC19_USERS,
} from './ac19-fixture.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/ac19-bridge.db'
const DB_URL = `file:${DB_FILE}`
const DDL_FILE = process.env.E2E_DDL_FILE || '/tmp/ac19-bridge-ddl.sql'

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

  // ── 0. --reset：DROP 全部表（保留库文件，见文件头） ──
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
    `SELECT name FROM sqlite_master WHERE type='table' AND name='CommunityBridge'`,
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
    console.log(`✅ schema 已建立（${n} 张表，含 CommunityBridge / BridgeMemberOptIn）`)
  } else {
    console.log('⏭  schema 已存在，跳过建表')
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const hash = bcrypt.hashSync(AC19_PASSWORD, 10)

  // ── 2. 三个租户 ──
  for (const org of Object.values(AC19_ORGS)) {
    await client.execute({
      sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?)
            ON CONFLICT("id") DO UPDATE SET "name"=excluded."name","status"='ACTIVE'`,
      args: [org.id, org.name, org.slug, 'ACTIVE', now, now],
    })
  }

  // ── 3. 七个账号 + 成员关系 ──
  //    🔴 `isBot` 必须显式为 false：true 会被登录链路挡掉（见记忆里的 QA 铁律）。
  for (const u of Object.values(AC19_USERS)) {
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
      args: [`ms_${u.id}`, AC19_ORGS[u.org].id, u.id, u.role, now, now],
    })
  }

  // ── 4. 每个组织一条 Mission（意图的必填锚点）──
  for (const key of ['a', 'b', 'c']) {
    const m = AC19_MISSIONS[key]
    const org = AC19_ORGS[key]
    const ownerKey = key === 'a' ? 'aOwner' : key === 'b' ? 'bOwner' : 'cOwner'
    await client.execute({
      sql: `INSERT INTO "Mission" (
              "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
              "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
              "closedAt","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,?,?,?,?,1,NULL,NULL,?,NULL,?,?)
            ON CONFLICT("id") DO UPDATE SET "status"='ACTIVE',"shareToken"=excluded."shareToken"`,
      args: [
        m.id,
        org.id,
        AC19_USERS[ownerKey].id,
        `${org.name} · 跨群合作锚点任务`,
        '为跨社群合作提供一个可被审计的意图锚点。',
        '本组织可对外提供的渠道与供给能力。',
        JSON.stringify(['跨群合作']),
        '双方签署合作备忘。',
        'ACTIVE',
        m.token,
        now,
        now,
        now,
      ],
    })
  }

  // ── 5. 四份档案（披露投影的**值**全在这里）──
  for (const [key, p] of Object.entries(AC19_PROFILES)) {
    const user = AC19_USERS[key]
    await client.execute({
      sql: `INSERT INTO "Profile" (
              "id","userId","displayName","age","gender","sexuality","bio","city",
              "occupation","company","profileStatus","onboardingStep","isApproved","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,?,?,?,?, 'APPROVED', 9, 1, ?, ?)
            ON CONFLICT("userId") DO UPDATE SET
              "displayName"=excluded."displayName","age"=excluded."age","bio"=excluded."bio",
              "city"=excluded."city","occupation"=excluded."occupation","company"=excluded."company",
              "profileStatus"='APPROVED',"onboardingStep"=9,"isApproved"=1`,
      args: [
        p.id,
        user.id,
        p.displayName,
        p.age,
        p.gender,
        p.sexuality,
        p.bio,
        p.city,
        p.occupation,
        p.company,
        now,
        now,
      ],
    })
  }

  // ── 6. 意图（**第三环**：披露档位）──
  //    bMember3 **刻意不造** —— 「已 opt-in 但没有意图」是 reverse 组之一。
  const intentOwner = { aMember: 'a', bMember: 'b', bMember2: 'b' }
  for (const [key, disclosure] of Object.entries(AC19_INTENT_DISCLOSURE)) {
    const user = AC19_USERS[key]
    const orgKey = intentOwner[key]
    await client.execute({
      sql: `INSERT INTO "SocialIntent" (
              "id","organizationId","missionId","userId","need","offer","constraints","disclosure",
              "status","expiresAt","withdrawnAt","importConsentAt","importedFields","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,NULL,?,?,NULL,NULL,NULL,NULL,?,?)
            ON CONFLICT("missionId","userId") DO UPDATE SET
              "disclosure"=excluded."disclosure","status"='ACTIVE',"withdrawnAt"=NULL,"updatedAt"=excluded."updatedAt"`,
      args: [
        `si_ac19_${key}`,
        AC19_ORGS[orgKey].id,
        AC19_MISSIONS[orgKey].id,
        user.id,
        '寻找可长期合作的跨群伙伴。',
        '可提供渠道、供给与本地化落地能力。',
        JSON.stringify(disclosure),
        'ACTIVE',
        now,
        now,
      ],
    })
  }

  // ── 7. 两份协议（均为 PENDING；A↔C 那份由 verify 走真实 POST 现场创建）──
  const fieldKeysJson = JSON.stringify(AC19_BRIDGE_FIELD_KEYS)
  const bridges = [
    {
      id: AC19_BRIDGES.ab,
      initiator: AC19_ORGS.a.id,
      recipient: AC19_ORGS.b.id,
      createdBy: AC19_USERS.aOwner.id,
      purpose: '打通甲乙两群之间的渠道与供给对接，仅用于本次合作评估。',
    },
    {
      id: AC19_BRIDGES.bc,
      initiator: AC19_ORGS.b.id,
      recipient: AC19_ORGS.c.id,
      createdBy: AC19_USERS.bOwner.id,
      // 🔴 这份协议只是「甲不是当事方」的靶标：甲的任何成员读它都必须 404。
      purpose: '乙丙两群的内部合作试点（与甲群无关，专用于越权取证）。',
    },
  ]
  for (const b of bridges) {
    await client.execute({
      sql: `INSERT INTO "CommunityBridge" (
              "id","initiatorOrgId","recipientOrgId","status",
              "initiatorFieldKeys","recipientFieldKeys","shareableMissionKinds",
              "purpose","initiatorApprovedAt","recipientApprovedAt",
              "expiresAt","revokedAt","revokedBy","createdBy","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?,?)
            ON CONFLICT("id") DO UPDATE SET
              "status"='PENDING',"recipientApprovedAt"=NULL,"revokedAt"=NULL,
              "initiatorFieldKeys"=excluded."initiatorFieldKeys",
              "recipientFieldKeys"=excluded."recipientFieldKeys"`,
      args: [
        b.id,
        b.initiator,
        b.recipient,
        'PENDING',
        fieldKeysJson,
        fieldKeysJson,
        JSON.stringify(['跨群合作']),
        b.purpose,
        // 创建 = 发起方同意（与 createBridge 落库结果一致）。
        now,
        b.createdBy,
        now,
        now,
      ],
    })
  }

  // ── 8. 清掉可能残留的 opt-in / 幂等记录，保证每次从"未加入"开始 ──
  await client.execute(
    `DELETE FROM "BridgeMemberOptIn" WHERE "bridgeId" IN ('${AC19_BRIDGES.ab}','${AC19_BRIDGES.bc}')`,
  )
  try {
    // 幂等记录若残留，A↔C 的"首次创建"会变成重放 ⇒ 201 断言假失败。清掉。
    await client.execute(`DELETE FROM "IdempotencyRecord" WHERE "scope"='bridge.create'`)
  } catch (err) {
    console.warn('⚠️  清理 IdempotencyRecord 跳过（表不存在？）:', err?.message)
  }

  const tables = await client.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`)
  const counts = await client.execute(
    `SELECT (SELECT COUNT(*) FROM "Organization") AS orgs,
            (SELECT COUNT(*) FROM "User") AS users,
            (SELECT COUNT(*) FROM "CommunityBridge") AS bridges,
            (SELECT COUNT(*) FROM "SocialIntent") AS intents,
            (SELECT COUNT(*) FROM "BridgeMemberOptIn") AS optins`,
  )
  const c = counts.rows[0]
  console.log(`\n✅ AC-19 夹具就绪：${DB_FILE}（${tables.rows[0].n} 张表）`)
  console.log(
    `   组织 ${c.orgs} · 账号 ${c.users} · 协议 ${c.bridges} · 意图 ${c.intents} · opt-in ${c.optins}`,
  )
  console.log(`   主协议 ${AC19_BRIDGES.ab}（甲→乙，PENDING）· 越权靶标 ${AC19_BRIDGES.bc}（乙→丙，PENDING）`)
  console.log(`   E2E_PASSWORD=${AC19_PASSWORD}`)
  client.close()
}

main().catch((err) => {
  console.error('❌ AC-19 夹具准备失败：', err?.message || err)
  process.exit(1)
})
