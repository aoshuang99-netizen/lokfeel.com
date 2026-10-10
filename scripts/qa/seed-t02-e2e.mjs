#!/usr/bin/env node
/**
 * T02 · 分享页（Mission Link）E2E 夹具
 *
 * 目的：为 Playwright 移动端 E2E 准备一个**完全隔离**的本地库，
 * 使得 AC-11 的验证可以：
 *   - 反复重跑（不需要真实账号、不依赖生产数据）；
 *   - 完整走「真实登录 → 真实加入」，而不是只验证匿名预览；
 *   - **不触碰生产数据库**。
 *
 * 做法：
 *   1. 建一个 file: 库，把当前 schema 的完整 DDL 灌进去（DDL 由
 *      `prisma migrate diff --from-empty --to-schema prisma/schema --script` 生成）；
 *   2. 插入两个用户（owner / member）+ 一个租户 + 两条 Membership；
 *   3. 插入两条 Mission：一条 ACTIVE（可加入）、一条 PAUSED（用于断言"不可加入的原因"）。
 *
 * 用法：
 *   node scripts/qa/seed-t02-e2e.mjs --reset
 *   → 输出 E2E_MISSION_TOKEN / E2E_PAUSED_TOKEN / E2E_PASSWORD，供 Playwright 读取。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const DB_FILE = '/tmp/t02-e2e.db'
const DB_URL = `file:${DB_FILE}`
const DDL_FILE = '/tmp/t02-full-ddl.sql'

export const E2E = {
  orgId: 'org_e2e',
  ownerId: 'u_e2e_owner',
  memberId: 'u_e2e_member',
  ownerEmail: 'e2e.owner@example.test',
  memberEmail: 'e2e.member@example.test',
  activeToken: 'e2eActiveTokenAbcdefghijklmnop',
  pausedToken: 'e2ePausedTokenAbcdefghijklmnop',
}

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
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
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
  if (args.reset && fs.existsSync(DB_FILE)) {
    fs.unlinkSync(DB_FILE)
  }

  const ddl = fs.existsSync(DDL_FILE) && !args.regenerate ? fs.readFileSync(DDL_FILE, 'utf8') : generateDdl()
  const client = createClient({ url: DB_URL })

  // ── 1. 建表（DDL 全是 CREATE TABLE/INDEX，无 IF NOT EXISTS，因此只在空库上跑一次）──
  const existing = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='Mission'`
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
    console.log(`✅ schema 已建立（${(await client.execute(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`
    )).rows[0].n} 张表）`)
  } else {
    console.log('⏭  schema 已存在，跳过建表')
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const password = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'
  const hash = bcrypt.hashSync(password, 10)

  // ── 2. 租户 ──
  await client.execute({
    sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?)
          ON CONFLICT("id") DO UPDATE SET "name"=excluded."name"`,
    args: [E2E.orgId, 'E2E 跨境社群', 'e2e', 'ACTIVE', now, now],
  })

  // ── 3. 用户 + 成员关系 ──
  const users = [
    { id: E2E.ownerId, email: E2E.ownerEmail, name: 'E2E Owner' },
    { id: E2E.memberId, email: E2E.memberEmail, name: 'E2E Member' },
  ]
  for (const u of users) {
    await client.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
      args: [u.id, u.name, u.email, hash, now, now],
    })
  }

  const memberships = [
    { id: 'ms_e2e_owner', userId: E2E.ownerId, role: 'OWNER' },
    { id: 'ms_e2e_member', userId: E2E.memberId, role: 'MEMBER' },
  ]
  for (const m of memberships) {
    await client.execute({
      sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
            VALUES (?,?,?,?,'ACTIVE',?,?)
            ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
      args: [m.id, E2E.orgId, m.userId, m.role, now, now],
    })
  }

  // ── 4. Mission：ACTIVE（可加入） + PAUSED（不可加入）──
  const missions = [
    {
      id: 'mission_e2e_active',
      token: E2E.activeToken,
      title: '寻找东南亚渠道伙伴',
      status: 'ACTIVE',
      maxParticipants: 5,
    },
    {
      id: 'mission_e2e_paused',
      token: E2E.pausedToken,
      title: '已暂停的试点任务',
      status: 'PAUSED',
      maxParticipants: null,
    },
  ]
  for (const m of missions) {
    await client.execute({
      sql: `INSERT INTO "Mission" (
              "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
              "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
              "closedAt","createdAt","updatedAt")
            VALUES (?,?,?,?,?,?,?,?,?,?,1,?,NULL,?,NULL,?,?)
            ON CONFLICT("id") DO UPDATE SET "status"=excluded."status","shareToken"=excluded."shareToken"`,
      args: [
        m.id,
        E2E.orgId,
        E2E.ownerId,
        m.title,
        '在 3 个月内找到 2 家可长期合作的东南亚分销伙伴，覆盖印尼与越南。',
        '提供样品、渠道培训、联合投放预算，以及本社群内的引荐。',
        JSON.stringify(['东南亚市场经验', '至少 1 年渠道运营']),
        '双方签署试销协议，并完成首批出货与回款。',
        m.status,
        m.token,
        m.maxParticipants,
        now,
        now,
        now,
      ],
    })
  }

  // 清掉可能残留的加入记录，保证每次 E2E 从"未加入"开始
  await client.execute(
    `DELETE FROM "MissionParticipation" WHERE "missionId" IN ('mission_e2e_active','mission_e2e_paused')`
  )

  const tables = await client.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`)
  console.log(`\n✅ E2E 夹具就绪：${DB_FILE}（${tables.rows[0].n} 张表）`)
  console.log(`   E2E_MISSION_TOKEN=${E2E.activeToken}`)
  console.log(`   E2E_PAUSED_TOKEN=${E2E.pausedToken}`)
  console.log(`   E2E_MEMBER_EMAIL=${E2E.memberEmail}`)
  console.log(`   E2E_PASSWORD=${password}`)
  client.close()
}

main().catch((err) => {
  console.error('❌ 夹具准备失败：', err?.message || err)
  process.exit(1)
})
