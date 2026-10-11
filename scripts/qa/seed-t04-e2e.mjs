#!/usr/bin/env node
/**
 * T04 · 候选（Reciprocal Match）E2E 夹具 —— 与 T02/T03 共用同一个隔离库
 *
 * 为什么**不**扩写 `seed-t02-e2e.mjs`：
 *   那个脚本的"每次从零开始"语义（清空 Participation / SocialIntent）是 T02/T03
 *   两条 E2E 的前提。往里面塞 T04 的样本会同时改动三条用例的初始态 ——
 *   一处失败将无法判断是谁弄坏的。因此本脚本**只做追加式播种**（upsert），
 *   并且**不删除任何东西**，与 T02 脚本正交。
 *
 * 播种内容（全部落在 `mission_e2e_active` 上）：
 *   - `u_e2e_member`（T02 已建）：**互补的发起方**，自带一条 ACTIVE 意图；
 *   - `u_e2e_peer`   ：**双向互补** —— 与 member 互为 need/offer 镜像 → 必须出现在候选里；
 *   - `u_e2e_noise`  ：**单向/无交集** —— 是任务参与人但无互补关系 → 必须被排除；
 *   - `u_e2e_dormant`：意图 **WITHDRAWN** → 必须被硬门控挡掉（进 gatedOut）；
 *   - `u_e2e_outsider`：意图 ACTIVE 但**不是任务参与人** → 必须被挡掉（not_participant）。
 *
 * 披露设计（本夹具的负测核心）：
 *   peer 的披露表 = `{displayName: CANDIDATE, city: CANDIDATE,
 *                     age: COUNTERPARTY, bio: ORGANIZER}`
 *   → 候选页**只能**看到 昵称 + 城市；`age`（授权给已同意的对手方）与 `bio`
 *     （只给组织者）**必须不可见**。这正是"档位方向有没有写反"的端到端判据：
 *     若把候选投影错写成 `COUNTERPARTY`，`age` 就会漏出来。
 *
 * 用法：
 *   node scripts/qa/seed-t02-e2e.mjs --regenerate   # 先建库与基线夹具
 *   node scripts/qa/seed-t04-e2e.mjs                # 再追加 T04 样本
 *   → 输出 E2E_MISSION_ID / E2E_PEER_* 等，供 Playwright 读取。
 */

import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/t02-e2e.db'
const DB_URL = `file:${DB_FILE}`

const E2E = {
  orgId: 'org_e2e',
  missionId: 'mission_e2e_active',
  memberId: 'u_e2e_member',
  memberEmail: 'e2e.member@example.test',
  peerId: 'u_e2e_peer',
  peerEmail: 'e2e.peer@example.test',
  noiseId: 'u_e2e_noise',
  dormantId: 'u_e2e_dormant',
  outsiderId: 'u_e2e_outsider',
}

// ── 正文样本：**必须成镜像**，否则"双向"断言会假绿 ──
// 词元化规则见 src/lib/connection/recall.ts：拉丁词 ≥3 字符、CJK 走 2-gram。
// 因此中文句子靠**共享 2-gram**（如"分销渠道""清关与仓储"）达成命中，
// 而不是靠整句相等 —— 这是真实用户文案的形态。
const TEXT = {
  memberNeed: '我需要东南亚的清关与仓储伙伴', // 与 peerOffer 共享 "东南/南亚/清关/仓储/伙伴"…
  memberOffer: '我能提供印尼本地的分销渠道', // 与 peerNeed 共享 "印尼/本地/分销/渠道"
  peerNeed: '我需要印尼本地的分销渠道',
  peerOffer: '我能提供东南亚的清关与仓储伙伴',
  noiseNeed: '我需要摄影器材租赁', // 与 memberOffer 无交集
  noiseOffer: '我能提供法语翻译', // 与 memberNeed 无交集
  dormantNeed: '我需要冷链仓储', // 内容不重要：它连门控都过不了
  dormantOffer: '我能提供报关代理',
  outsiderNeed: '我需要东南亚的清关与仓储伙伴', // 内容互补，但**不是参与人** → 仍须被挡
  outsiderOffer: '我能提供印尼本地的分销渠道',
}

const DISCLOSURE = {
  // member 自己：昵称/城市可给同任务伙伴，年龄只给已同意的对手方
  member: JSON.stringify({ displayName: 'CANDIDATE', city: 'CANDIDATE', age: 'COUNTERPARTY' }),
  // peer 是负测主角：四个档位各用一次，覆盖"包含式"语义的全部四个格子
  peer: JSON.stringify({
    displayName: 'CANDIDATE', // 最宽 → 候选可见
    city: 'CANDIDATE', // 最宽 → 候选可见
    age: 'COUNTERPARTY', // 中档 → 候选**不可见**（关键断言）
    bio: 'ORGANIZER', // 窄档 → 候选**不可见**
  }),
  noise: JSON.stringify({ displayName: 'CANDIDATE' }),
  dormant: JSON.stringify({ displayName: 'CANDIDATE' }),
  outsider: JSON.stringify({ displayName: 'CANDIDATE' }),
}

/** 负测专用的哨兵值：这些字符串**一次都不该**出现在候选页 / 候选 API 响应里。 */
const SENTINELS = {
  peerEmail: E2E.peerEmail,
  peerAge: 47,
  peerBio: '十年印尼落地经验',
  noiseName: '噪音甲',
  dormantName: '已撤销乙',
  outsiderName: '外部丙',
}

async function upsertUser(client, { id, email, name, hash, now }) {
  await client.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES (?,?,?,?,'USER',0,false,?,?)
          ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
    args: [id, name, email, hash, now, now],
  })
}

async function upsertMembership(client, { id, userId, role = 'MEMBER', now }) {
  await client.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES (?,?,?,?,'ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
    args: [id, E2E.orgId, userId, role, now, now],
  })
}

async function upsertProfile(client, { id, userId, profile, now }) {
  await client.execute({
    sql: `INSERT INTO "Profile" (
            "id","userId","displayName","age","gender","sexuality","bio","city",
            "occupation","company","profileStatus","onboardingStep","isApproved","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?,?,?, 'APPROVED', 9, 1, ?, ?)
          ON CONFLICT("userId") DO UPDATE SET
            "displayName"=excluded."displayName","age"=excluded."age","bio"=excluded."bio",
            "city"=excluded."city","occupation"=excluded."occupation","company"=excluded."company",
            "profileStatus"='APPROVED'`,
    args: [
      id,
      userId,
      profile.displayName,
      profile.age,
      profile.gender,
      profile.sexuality,
      profile.bio,
      profile.city,
      profile.occupation,
      profile.company,
      now,
      now,
    ],
  })
}

async function upsertParticipation(client, { id, userId, status = 'INTERESTED', now }) {
  await client.execute({
    sql: `INSERT INTO "MissionParticipation" ("id","organizationId","missionId","userId","status","note","createdAt","updatedAt")
          VALUES (?,?,?,?,?,NULL,?,?)
          ON CONFLICT("missionId","userId") DO UPDATE SET "status"=excluded."status","updatedAt"=excluded."updatedAt"`,
    args: [id, E2E.orgId, E2E.missionId, userId, status, now, now],
  })
}

async function upsertIntent(client, { id, userId, need, offer, disclosure, status = 'ACTIVE', now }) {
  await client.execute({
    sql: `INSERT INTO "SocialIntent" (
            "id","organizationId","missionId","userId","need","offer","constraints","disclosure",
            "status","expiresAt","withdrawnAt","importConsentAt","importedFields","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,NULL,?,?,NULL,?,NULL,NULL,?,?)
          ON CONFLICT("missionId","userId") DO UPDATE SET
            "need"=excluded."need","offer"=excluded."offer","disclosure"=excluded."disclosure",
            "status"=excluded."status","withdrawnAt"=excluded."withdrawnAt","updatedAt"=excluded."updatedAt"`,
    args: [
      id,
      E2E.orgId,
      E2E.missionId,
      userId,
      need,
      offer,
      disclosure,
      status,
      status === 'WITHDRAWN' ? now : null,
      now,
      now,
    ],
  })
}

async function main() {
  const client = createClient({ url: DB_URL })
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const password = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'
  const hash = bcrypt.hashSync(password, 10)

  // 前置：T02 夹具必须已就位（否则这里造的样本挂在一条不存在的 Mission 上，
  // 表现为 FK 报错 —— 但更常见的是"库是空的、脚本却报成功"，故显式先查一次）。
  const mission = await client.execute({
    sql: `SELECT "id" FROM "Mission" WHERE "id" = ?`,
    args: [E2E.missionId],
  })
  if (mission.rows.length === 0) {
    throw new Error(
      `Mission ${E2E.missionId} 不存在 —— 请先跑：node scripts/qa/seed-t02-e2e.mjs --regenerate`
    )
  }

  // ── 1. 追加式建人（member 若已存在则复用，不改其 email）──
  await upsertUser(client, { id: E2E.memberId, email: E2E.memberEmail, name: 'E2E Member', hash, now })
  await upsertUser(client, { id: E2E.peerId, email: E2E.peerEmail, name: 'E2E Peer', hash, now })
  await upsertUser(client, { id: E2E.noiseId, email: 'e2e.noise@example.test', name: 'E2E Noise', hash, now })
  await upsertUser(client, { id: E2E.dormantId, email: 'e2e.dormant@example.test', name: 'E2E Dormant', hash, now })
  await upsertUser(client, { id: E2E.outsiderId, email: 'e2e.outsider@example.test', name: 'E2E Outsider', hash, now })

  await upsertMembership(client, { id: 'ms_e2e_peer', userId: E2E.peerId, now })
  await upsertMembership(client, { id: 'ms_e2e_noise', userId: E2E.noiseId, now })
  await upsertMembership(client, { id: 'ms_e2e_dormant', userId: E2E.dormantId, now })
  await upsertMembership(client, { id: 'ms_e2e_outsider', userId: E2E.outsiderId, now })
  await upsertMembership(client, { id: 'ms_e2e_member', userId: E2E.memberId, now })

  // ── 2. 档案（披露投影的"值"全部来自这里）──
  await upsertProfile(client, {
    id: 'pf_e2e_peer',
    userId: E2E.peerId,
    profile: {
      displayName: '陈岸',
      age: SENTINELS.peerAge,
      gender: 'MAN',
      sexuality: 'Straight',
      bio: SENTINELS.peerBio,
      city: '雅加达',
      occupation: '渠道负责人',
      company: '南洋通路',
    },
    now,
  })
  await upsertProfile(client, {
    id: 'pf_e2e_noise',
    userId: E2E.noiseId,
    profile: {
      displayName: SENTINELS.noiseName,
      age: 29,
      gender: 'WOMAN',
      sexuality: 'Straight',
      bio: '摄影师',
      city: '成都',
      occupation: '摄影师',
      company: '独立工作室',
    },
    now,
  })

  // ── 3. 加入关系（门控的 not_participant 判据）──
  // ⚠️ outsider **刻意不加入** —— 它正是 not_participant 这条门控的样本。
  await upsertParticipation(client, { id: 'mp_e2e_member', userId: E2E.memberId, now })
  await upsertParticipation(client, { id: 'mp_e2e_peer', userId: E2E.peerId, now })
  await upsertParticipation(client, { id: 'mp_e2e_noise', userId: E2E.noiseId, now })
  await upsertParticipation(client, { id: 'mp_e2e_dormant', userId: E2E.dormantId, now })

  // ── 4. 意图 ──
  await upsertIntent(client, {
    id: 'si_e2e_member',
    userId: E2E.memberId,
    need: TEXT.memberNeed,
    offer: TEXT.memberOffer,
    disclosure: DISCLOSURE.member,
    now,
  })
  await upsertIntent(client, {
    id: 'si_e2e_peer',
    userId: E2E.peerId,
    need: TEXT.peerNeed,
    offer: TEXT.peerOffer,
    disclosure: DISCLOSURE.peer,
    now,
  })
  await upsertIntent(client, {
    id: 'si_e2e_noise',
    userId: E2E.noiseId,
    need: TEXT.noiseNeed,
    offer: TEXT.noiseOffer,
    disclosure: DISCLOSURE.noise,
    now,
  })
  await upsertIntent(client, {
    id: 'si_e2e_dormant',
    userId: E2E.dormantId,
    need: TEXT.dormantNeed,
    offer: TEXT.dormantOffer,
    disclosure: DISCLOSURE.dormant,
    status: 'WITHDRAWN',
    now,
  })
  await upsertIntent(client, {
    id: 'si_e2e_outsider',
    userId: E2E.outsiderId,
    need: TEXT.outsiderNeed,
    offer: TEXT.outsiderOffer,
    disclosure: DISCLOSURE.outsider,
    now,
  })

  // ── 5. 自检：把"夹具本身是否正确"也变成可观测输出 ──
  // 若 member 的意图没落 ACTIVE、或 peer 不是参与人，E2E 会以"没有候选"失败，
  // 而那种失败看起来像功能缺陷。所以这里直接读回来核对。
  const check = await client.execute({
    sql: `SELECT
            (SELECT "status" FROM "SocialIntent" WHERE "id"='si_e2e_member') AS member_intent,
            (SELECT "status" FROM "SocialIntent" WHERE "id"='si_e2e_peer')   AS peer_intent,
            (SELECT COUNT(*) FROM "MissionParticipation"
              WHERE "missionId"=? AND "status"='INTERESTED')                 AS participants,
            (SELECT COUNT(*) FROM "SocialIntent" WHERE "missionId"=?)        AS intents`,
    args: [E2E.missionId, E2E.missionId],
  })
  const row = check.rows[0]

  console.log(`\n✅ T04 候选夹具已播种：${DB_FILE}`)
  console.log(`   自检：member 意图=${row.member_intent} / peer 意图=${row.peer_intent}`)
  console.log(`         参与人=${row.participants} 条 / 意图=${row.intents} 条`)
  console.log('   （期望：两名 ACTIVE、参与人 4、意图 5；被门控 2 条 = 1 WITHDRAWN + 1 非参与人）')
  console.log('\n   —— Playwright 环境变量 ——')
  console.log(`   E2E_MISSION_ID=${E2E.missionId}`)
  console.log(`   E2E_MISSION_TOKEN=e2eActiveTokenAbcdefghijklmnop`)
  console.log(`   E2E_MEMBER_EMAIL=${E2E.memberEmail}`)
  console.log(`   E2E_PASSWORD=${password}`)
  console.log(`   E2E_PEER_NAME=陈岸`)
  console.log(`   E2E_PEER_CITY=雅加达`)
  client.close()
}

main().catch((err) => {
  console.error('❌ T04 夹具准备失败：', err?.message || err)
  process.exit(1)
})
