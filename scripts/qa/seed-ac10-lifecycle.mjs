#!/usr/bin/env node
/**
 * AC-10 · 数据生命周期 —— **隔离库夹具**（播种）
 * ═══════════════════════════════════════════════════════════════
 * 取证对象是 `GET /api/v1/me/export` 与 `POST /api/v1/me/erasure?apply=1`
 * **在真实 Next 运行时里的行为**。所以夹具必须给出：
 *
 *   · 一个**真实可登录**的账号（否则 401 无从与"功能坏了"区分）；
 *   · 该账号在**每一张被覆盖的表上都有真实数据**（否则"导出为空"与"导出坏了"
 *     无法区分 —— 这正是 AC-10 最容易被假绿的地方）；
 *   · 一个**对照组账号**（`u_ac10_other`）：删除他**不该**被波及。
 *     没有对照，"删干净了"与"删过头了"看起来一样。
 *
 * ── 复用 AC-19 / AC-22 的两条成熟做法（不是风格选择）────────────────
 *   ① `--reset` **DROP 全部表**而不是删库文件：inode 不变 ⇒ dev server 无需重启；
 *      删文件会让主库 fd 与 `-wal` 按路径对不上 ⇒ `SQLITE_READONLY`（读全对、写全挂）。
 *   ② DDL 由 `prisma migrate diff --from-empty --to-schema` 现场生成（`--regenerate`）。
 *
 * 用法：
 *   node scripts/qa/seed-ac10-lifecycle.mjs --reset --regenerate
 *   环境：E2E_DB_FILE / E2E_DDL_FILE / E2E_PASSWORD
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/ac10-lifecycle.db'
const DB_URL = `file:${DB_FILE}`
const DDL_FILE = process.env.E2E_DDL_FILE || '/tmp/ac10-lifecycle-ddl.sql'
const PASSWORD = AC10_PASSWORD

/**
 * 夹具常量（id / PII / 口令）全部来自 `./ac10-fixture.mjs` —— **单一来源**。
 * 本文件在顶层调用 `main()`（有副作用），所以 verify 脚本**不能** import 本文件；
 * 两个脚本都 import fixture，漂移才会立刻变红而不是静默假绿。
 */
import { AC10_IDS as IDS, AC10_PII as PII, AC10_PASSWORD } from './ac10-fixture.mjs'

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
    for (const { name } of before) {
      await client.execute(`DROP TABLE IF EXISTS "${name}"`)
    }
    console.log(`🧹 已 DROP ${before.length} 张表`)
  }

  // ── 1. 建表 ──
  const hasUser = (
    await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='User'`)
  ).rows.length
  if (!hasUser) {
    for (const stmt of ddl.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
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
  const hash = bcrypt.hashSync(PASSWORD, 10)

  // ── 2. 两个租户（peer 只作跨群协议的对方）──
  for (const [id, name, slug] of [
    [IDS.org, 'AC10 生命周期示范群', 'ac10'],
    [IDS.orgPeer, 'AC10 邻群', 'ac10-peer'],
  ]) {
    await client.execute({
      sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
            VALUES (?,?,?,'ACTIVE',?,?)
            ON CONFLICT("id") DO UPDATE SET "name"=excluded."name","status"='ACTIVE'`,
      args: [id, name, slug, now, now],
    })
  }

  // ── 3. 账号：待销号 + 对照 ──
  //    🔴 `isBot` 必须显式为 false：true 会被登录链路挡掉。
  for (const [id, name, email] of [
    [IDS.user, PII.name, PII.email],
    [IDS.other, 'AC10 对照用户', 'ac10.other@example.test'],
  ]) {
    await client.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
      args: [id, name, email, hash, now, now],
    })
  }
  await client.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES (?,?,?,'OWNER','ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"='OWNER',"status"='ACTIVE'`,
    args: [IDS.membership, IDS.org, IDS.user, now, now],
  })

  // ── 4. 档案（含**内部备注** —— 导出必须剔除它）──
  for (const [pid, uid, display, gender] of [
    [IDS.profile, IDS.user, PII.displayName, 'MAN'],
    [IDS.profileOther, IDS.other, '对照用户', 'WOMAN'],
  ]) {
    await client.execute({
      sql: `INSERT INTO "Profile" (
              "id","userId","displayName","age","gender","sexuality","bio","city",
              "occupation","company","adminNotes","profileStatus","onboardingStep","isApproved","createdAt","updatedAt")
            VALUES (?,?,?,30,?,?,?,?,?,?,?, 'APPROVED', 9, 1, ?, ?)
            ON CONFLICT("userId") DO UPDATE SET "profileStatus"='APPROVED',"isApproved"=1`,
      args: [pid, uid, display, gender, 'Straight', PII.bio, PII.city, PII.occupation, PII.company, PII.adminNotes, now, now],
    })
  }

  // ── 5. Mission + 意图 + 参与 ──
  await client.execute({
    sql: `INSERT INTO "Mission" (
            "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
            "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
            "closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?, 'ACTIVE',?,1,NULL,NULL,?,NULL,?,?)
          ON CONFLICT("id") DO UPDATE SET "status"='ACTIVE'`,
    args: [
      IDS.mission, IDS.org, IDS.user, 'AC10 生命周期示范任务',
      '为数据生命周期取证提供一个真实锚点。', '本组织可对外协作的能力。',
      JSON.stringify(['生命周期取证']), '导出与销号都能被真实断言。',
      'ac10ShareTokenAaaaaaaaaaaaaaaaaa', now, now, now,
    ],
  })
  await client.execute({
    sql: `INSERT INTO "SocialIntent" (
            "id","organizationId","missionId","userId","need","offer","constraints","disclosure","status","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?, 'ACTIVE', ?, ?)
          ON CONFLICT("missionId","userId") DO UPDATE SET "need"=excluded."need","status"='ACTIVE'`,
    args: [
      IDS.intent, IDS.org, IDS.mission, IDS.user,
      PII.intentNeed, PII.intentOffer,
      JSON.stringify(['只接受长期合作']),
      JSON.stringify({ displayName: 'CANDIDATE', bio: 'CANDIDATE' }),
      now, now,
    ],
  })
  await client.execute({
    sql: `INSERT INTO "MissionParticipation" ("id","organizationId","missionId","userId","status","note","createdAt","updatedAt")
          VALUES (?,?,?,?, 'INTERESTED', NULL, ?, ?)
          ON CONFLICT("missionId","userId") DO UPDATE SET "status"='INTERESTED'`,
    args: [IDS.participation, IDS.org, IDS.mission, IDS.user, now, now],
  })

  // ── 6. 跨群协议 + 该成员的 opt-in（ACTIVE，带披露字段）──
  await client.execute({
    sql: `INSERT INTO "CommunityBridge" (
            "id","initiatorOrgId","recipientOrgId","status","initiatorFieldKeys","recipientFieldKeys",
            "shareableMissionKinds","purpose","initiatorApprovedAt","recipientApprovedAt","expiresAt","revokedAt","revokedBy","createdBy","createdAt","updatedAt")
          VALUES (?,?,?, 'ACTIVE',?,?,?,?,?,?,NULL,NULL,NULL,?,?,?)
          ON CONFLICT("initiatorOrgId","recipientOrgId") DO UPDATE SET "status"='ACTIVE'`,
    args: [
      IDS.bridge, IDS.org, IDS.orgPeer,
      JSON.stringify(['displayName', 'bio']), JSON.stringify(['displayName', 'bio']),
      JSON.stringify(['COLLABORATION']), 'AC10 生命周期取证',
      now, now, IDS.user, now, now,
    ],
  })
  await client.execute({
    sql: `INSERT INTO "BridgeMemberOptIn" ("id","bridgeId","organizationId","userId","status","disclosedFieldKeys","optedInAt","withdrawnAt","createdAt","updatedAt")
          VALUES (?,?,?,?, 'ACTIVE', ?, ?, NULL, ?, ?)
          ON CONFLICT("bridgeId","userId") DO UPDATE SET "status"='ACTIVE'`,
    args: [IDS.optIn, IDS.bridge, IDS.org, IDS.user, JSON.stringify(['bio']), now, now, now],
  })

  // ── 7. Agent 运行（含 goal / rawText —— 销号后必须清空）──
  await client.execute({
    sql: `INSERT INTO "AgentRun" (
            "id","organizationId","skill","status","risk","requiresApproval","requestedBy","subjectLabel",
            "goal","proposalJson","rawText","reason","degradeCode","providerKind","injectionSignals",
            "costMicroCents","dedupeKey","requestHash","createdAt","updatedAt")
          VALUES (?,?,'INTRO_DRAFT','PROPOSED','LOW',1,?,?,?,NULL,?,NULL,NULL,'RULES',NULL,0,?,NULL,?,?)
          ON CONFLICT("organizationId","dedupeKey") DO UPDATE SET "goal"=excluded."goal"`,
    args: [IDS.agentRun, IDS.org, IDS.user, 'AC10 目标对象', PII.agentGoal, PII.agentRawText, 'ac10-dedupe-1', now, now],
  })

  // ── 8. 站内信（销号后应被删除）──
  await client.execute({
    sql: `INSERT INTO "Notification" ("id","userId","type","title","body","data","actionUrl","isRead","readAt","createdAt")
          VALUES (?,?,'SYSTEM_ANNOUNCEMENT','AC10 通知',?,NULL,NULL,0,NULL,?)
          ON CONFLICT("id") DO UPDATE SET "body"=excluded."body"`,
    args: [IDS.notification, IDS.user, PII.notificationBody, now],
  })

  const counts = await client.execute(
    `SELECT (SELECT COUNT(*) FROM "User") AS users,
            (SELECT COUNT(*) FROM "Profile") AS profiles,
            (SELECT COUNT(*) FROM "SocialIntent") AS intents,
            (SELECT COUNT(*) FROM "BridgeMemberOptIn") AS optins,
            (SELECT COUNT(*) FROM "AgentRun") AS runs,
            (SELECT COUNT(*) FROM "Notification") AS notifications`,
  )
  const c = counts.rows[0]
  console.log(`\n✅ AC-10 夹具就绪：${DB_FILE}`)
  console.log(`   账号 ${c.users} · 档案 ${c.profiles} · 意图 ${c.intents} · opt-in ${c.optins} · AgentRun ${c.runs} · 通知 ${c.notifications}`)
  console.log(`   待销号：${PII.email}（${IDS.user}）｜对照：ac10.other@example.test（${IDS.other}）`)
  console.log(`   E2E_PASSWORD=${PASSWORD}`)
  client.close()
}

main().catch((err) => {
  console.error('❌ AC-10 夹具准备失败：', err?.message || err)
  process.exit(1)
})
