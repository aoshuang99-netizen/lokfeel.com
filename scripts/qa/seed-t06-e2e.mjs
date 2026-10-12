#!/usr/bin/env node
/**
 * T06 · Workflow Execution（outbox / 幂等 / 崩溃恢复）E2E 夹具
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么用**独立库** `/tmp/t06-e2e.db`（而不是复用 T05 的库）
 * ═══════════════════════════════════════════════════════════════
 * T06 的被测对象是**全局 cron 驱动器** `POST /api/cron/workflow-tick`：
 * 它的 `reconcileMissingJobs()` 会扫描**整个库**里"已双方同意但未介绍"的提案。
 * 若与 T05 夹具同库，T05 的 `cp_e2e_mutual`（MUTUALLY_ACCEPTED、未介绍）
 * 会被这一轮 tick 顺带介绍掉 —— 于是 T05 的 E2E 断言（"已建立连接"应只有 1 条）
 * 会在跑过 T06 之后失效。那等于把两条用例的成败绑在一起。
 *
 * 因此：T06 用自己的库 + 自己的 Mission（`mission_e2e_t06`）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 播种内容（全部落在 `mission_e2e_t06`）
 * ═══════════════════════════════════════════════════════════════
 * 用户：`u_e2e_t06_op`(OPERATOR)、`u_e2e_t06_member`(MEMBER)、
 *       `u_e2e_t06_member2`(MEMBER)、`u_e2e_t06_admin`(ADMIN)
 *
 * 三条提案，各证一件事：
 *   | id | 发起→被介绍 | 状态 | 关键特征 | 用于证 |
 *   |---|---|---|---|---|
 *   | `cp_e2e_wf_recover` | op→member  | MUTUALLY_ACCEPTED | **无 job / 无 workflow**（模拟"钩子没跑成"） | AC-17：tick 对账补入队 → 介绍落地；AC-14：端到端；AC-09：投递留痕 |
 *   | `cp_e2e_wf_revoked` | op→member2 | REVOKED | 预置一条 **PENDING** INTRODUCE job | AC-05：已撤销的待发任务被 tick 判 superseded → CANCELLED |
 *   | `cp_e2e_wf_dead`    | op→admin   | REJECTED | 预置一条 **DEAD** PROPOSAL_CREATED job | AC-17：死信要人接管（takeover → requeue） |
 *
 * 幂等：可重复执行。本脚本只动自己的命名空间（`cp_e2e_wf_%` / `wj_e2e_%` / `nd_e2e_%`）。
 *
 * 用法：
 *   E2E_DB_FILE=/tmp/t06-e2e.db node scripts/qa/seed-t02-e2e.mjs --reset   # 基线库（含 C3 表）
 *   node scripts/qa/seed-t06-e2e.mjs                                        # 本夹具
 *   DATABASE_URL=file:/tmp/t06-e2e.db CRON_SECRET=dev-cron-secret npx next dev -p 3106
 *   E2E_BASE_URL=http://localhost:3106 E2E_CRON_SECRET=dev-cron-secret \
 *   E2E_OP_EMAIL=... E2E_ADMIN_EMAIL=... E2E_MEMBER_EMAIL=... E2E_PASSWORD=... \
 *   npx playwright test -c playwright.t02.config.ts tests/e2e/workflow-execution.spec.ts
 */

import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/t06-e2e.db'
const DB_URL = `file:${DB_FILE}`

const E2E = {
  orgId: 'org_e2e',
  ownerId: 'u_e2e_owner',
  missionId: 'mission_e2e_t06',
  token: 'e2eT06TokenAbcdefghijklmnopq',
  opId: 'u_e2e_t06_op',
  opEmail: 'e2e.t06.op@example.test',
  memberId: 'u_e2e_t06_member',
  memberEmail: 'e2e.t06.member@example.test',
  member2Id: 'u_e2e_t06_member2',
  member2Email: 'e2e.t06.member2@example.test',
  adminId: 'u_e2e_t06_admin',
  adminEmail: 'e2e.t06.admin@example.test',
}

const RATIONALE = {
  recover: '你们互补：他在找东南亚清关，你有雅加达落地资源。',
  revoked: '你们互补：他需要品牌设计，你有品牌设计。',
  dead: '你们互补：他需要冷链，你有冷链。',
}

/** 负测 / 定位哨兵。 */
const SENTINELS = {
  opEmail: E2E.opEmail,
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

/**
 * ⚠️ **Prisma 的 DateTime 存储格式**（本夹具踩过的坑，务必保留此注释）
 *
 * Prisma 经 libSQL 写入的 DateTime 文本形如 `2026-10-12T06:31:11.687+00:00`，
 * 而 `CURRENT_TIMESTAMP` 风格是 `2026-10-12 06:31:11`（空格分隔、无毫秒、无偏移）。
 * 两者在 SQLite 里都是 TEXT，**不等式比较**（`nextAttemptAt <= now`）尚可命中，
 * 但引擎的**领取是 CAS**（`updateMany` 的 where 带 `nextAttemptAt: 读到的值`）——
 * 那是**等值**比较，格式不一致会**永远命中 0 行**，于是任务被安静跳过、停在 PENDING。
 *
 * 教训：凡是会被引擎用作 CAS 等值条件的列，夹具必须写成 Prisma 的格式。
 */
const prismaDate = (d = new Date()) => d.toISOString().replace('Z', '+00:00')

async function tableCounts(client) {
  const r = await client.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM "ConnectionProposal" WHERE "id" LIKE 'cp_e2e_wf_%') AS proposals,
            (SELECT COUNT(*) FROM "WorkflowJob" WHERE "id" LIKE 'wj_e2e_%')          AS jobs,
            (SELECT COUNT(*) FROM "IntroductionWorkflow" WHERE "proposalId" LIKE 'cp_e2e_wf_%') AS workflows`,
    args: [],
  })
  return r.rows[0]
}

async function upsertUser(client, { id, email, name, hash, now }) {
  await client.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES (?,?,?,?,'USER',0,false,?,?)
          ON CONFLICT("email") DO UPDATE SET "password"=excluded."password","updatedAt"=excluded."updatedAt"`,
    args: [id, name, email, hash, now, now],
  })
}

async function upsertMembership(client, { id, userId, role, now }) {
  await client.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES (?,?,?,?,'ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
    args: [id, E2E.orgId, userId, role, now, now],
  })
}

async function upsertProfile(client, { id, userId, displayName, age, bio, city, now }) {
  await client.execute({
    sql: `INSERT INTO "Profile" (
            "id","userId","displayName","age","gender","sexuality","bio","city",
            "occupation","company","profileStatus","onboardingStep","isApproved","createdAt","updatedAt")
          VALUES (?,?,?,?, 'MAN','Straight',?,?, '负责人','示例公司','APPROVED',9,1,?,?)
          ON CONFLICT("userId") DO UPDATE SET
            "displayName"=excluded."displayName","age"=excluded."age","bio"=excluded."bio",
            "city"=excluded."city","profileStatus"='APPROVED'`,
    args: [id, userId, displayName, age, bio, city, now, now],
  })
}

async function upsertMission(client, { now }) {
  await client.execute({
    sql: `INSERT INTO "Mission" (
            "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
            "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
            "closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?, 'ACTIVE', ?, 1, NULL, NULL, ?, NULL, ?, ?)
          ON CONFLICT("id") DO UPDATE SET
            "status"='ACTIVE',"shareToken"=excluded."shareToken","updatedAt"=excluded."updatedAt"`,
    args: [
      E2E.missionId,
      E2E.orgId,
      E2E.ownerId,
      'E2E · 工作流执行专项任务（T06）',
      '验证"钩子失败后由 tick 对账补入队、介绍落库、通知投递且不重复"这条可靠链路。',
      '提供本任务内的牵线运营动作。',
      JSON.stringify(['仅用于 E2E 夹具']),
      'outbox 在故障注入下无重复消息，死信可人工接管。',
      E2E.token,
      now,
      now,
      now,
    ],
  })
}

async function upsertParticipation(client, { id, userId, now }) {
  await client.execute({
    sql: `INSERT INTO "MissionParticipation" ("id","organizationId","missionId","userId","status","note","createdAt","updatedAt")
          VALUES (?,?,?,?,'INTERESTED',NULL,?,?)
          ON CONFLICT("missionId","userId") DO UPDATE SET "status"='INTERESTED',"updatedAt"=excluded."updatedAt"`,
    args: [id, E2E.orgId, E2E.missionId, userId, now, now],
  })
}

async function upsertIntent(client, { id, userId, need, offer, now }) {
  await client.execute({
    sql: `INSERT INTO "SocialIntent" (
            "id","organizationId","missionId","userId","need","offer","constraints","disclosure",
            "status","expiresAt","withdrawnAt","importConsentAt","importedFields","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,NULL,?,'ACTIVE',NULL,NULL,NULL,NULL,?,?)
          ON CONFLICT("missionId","userId") DO UPDATE SET
            "need"=excluded."need","offer"=excluded."offer","disclosure"=excluded."disclosure",
            "status"='ACTIVE',"withdrawnAt"=NULL,"updatedAt"=excluded."updatedAt"`,
    args: [id, E2E.orgId, E2E.missionId, userId, need, offer, JSON.stringify({ displayName: 'CANDIDATE' }), now, now],
  })
}

async function upsertProposal(client, { id, proposerId, candidateId, status, rationale, introducedAt, closedAt, now }) {
  await client.execute({
    sql: `INSERT INTO "ConnectionProposal" (
            "id","organizationId","missionId","proposerId","candidateId","status","rationale",
            "expiresAt","introducedAt","closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?)
          ON CONFLICT("missionId","proposerId","candidateId") DO UPDATE SET
            "status"=excluded."status","rationale"=excluded."rationale",
            "introducedAt"=excluded."introducedAt","closedAt"=excluded."closedAt","updatedAt"=excluded."updatedAt"`,
    args: [id, E2E.orgId, E2E.missionId, proposerId, candidateId, status, rationale, introducedAt, closedAt, now, now],
  })
}

async function upsertDecision(client, { id, proposalId, personId, decision, now }) {
  await client.execute({
    sql: `INSERT INTO "ProposalDecision" ("id","organizationId","proposalId","personId","decision","note","decidedAt")
          VALUES (?,?,?,?,?,NULL,?)
          ON CONFLICT("proposalId","personId") DO UPDATE SET "decision"=excluded."decision","decidedAt"=excluded."decidedAt"`,
    args: [id, E2E.orgId, proposalId, personId, decision, now],
  })
}

async function upsertJob(client, { id, dedupeKey, kind, status, proposalId, payload, attempts, deadLetteredAt, lastError }) {
  // 时间列一律用 Prisma 格式：`nextAttemptAt` 会被引擎用作 CAS 等值条件（见 prismaDate 注释）。
  const at = prismaDate()
  await client.execute({
    sql: `INSERT INTO "WorkflowJob" (
            "id","organizationId","dedupeKey","kind","status","proposalId","missionId","payload",
            "attempts","maxAttempts","nextAttemptAt","lockedBy","lockedUntil","lastError",
            "deadLetteredAt","takenOverBy","takenOverAt","cancelledAt","completedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?,?,5,?,NULL,NULL,?,?,NULL,NULL,NULL,NULL,?,?)
          ON CONFLICT("id") DO UPDATE SET
            "status"=excluded."status","attempts"=excluded."attempts","lastError"=excluded."lastError",
            "deadLetteredAt"=excluded."deadLetteredAt","takenOverBy"=NULL,"takenOverAt"=NULL,
            "cancelledAt"=NULL,"completedAt"=NULL,"lockedBy"=NULL,"lockedUntil"=NULL,
            "nextAttemptAt"=excluded."nextAttemptAt","updatedAt"=excluded."updatedAt"`,
    args: [
      id, E2E.orgId, dedupeKey, kind, status, proposalId, E2E.missionId,
      payload ? JSON.stringify(payload) : null,
      attempts, at, lastError ?? null, deadLetteredAt ? at : null, at, at,
    ],
  })
}

async function main() {
  const client = createClient({ url: DB_URL })
  const now = nowIso()
  const password = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'
  const hash = bcrypt.hashSync(password, 10)

  // 前置：基线库必须就位（org / owner）。C3 表由 seed-t02 的 schema-diff DDL 建出。
  const pre = await client.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM "Organization" WHERE "id"=?) AS org,
            (SELECT COUNT(*) FROM "Organization" WHERE "id"=?) AS _dup`,
    args: [E2E.orgId, E2E.orgId],
  })
  if (Number(pre.rows[0].org) === 0) {
    throw new Error(
      `缺少基线库（${DB_FILE} 里没有 ${E2E.orgId}）—— 请先：E2E_DB_FILE=${DB_FILE} node scripts/qa/seed-t02-e2e.mjs --reset`
    )
  }
  // C3 表存在性自检（不存在时给出可操作的提示，而不是后续的隐晦 SQL 错误）。
  const c3 = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('WorkflowJob','NotificationDelivery','IntroductionWorkflow')`,
    args: [],
  })
  if (Number(c3.rows[0].n) < 3) {
    throw new Error(`C3 表缺失（T06 需要 WorkflowJob/NotificationDelivery/IntroductionWorkflow）—— 请重跑 seed-t02 --reset（它按当前 schema 生成 DDL）`)
  }

  // ── 1. Mission ──
  await upsertMission(client, { now })

  // ── 2. 清理本脚本自己的历史产物（幂等；只动自己的命名空间）──
  // 顺序：先删无外键的软引用表，再删子表，最后删父表（父表删除会级联 IntroductionWorkflow）。
  // ⚠️ 必须按 `proposalId` 删，而**不只**按 id 前缀 —— 应用自建的任务 id 是 cuid，
  //    不匹配 `wj_e2e_%`；漏掉它们会让"无 job"的前置断言在重跑时失败。
  await client.execute({
    sql: `DELETE FROM "WorkflowJob" WHERE "id" LIKE 'wj_e2e_%' OR "proposalId" LIKE 'cp_e2e_wf_%'`,
  })
  await client.execute({ sql: `DELETE FROM "NotificationDelivery" WHERE "dedupeKey" LIKE '%cp_e2e_wf_%'` })
  await client.execute({ sql: `DELETE FROM "Notification" WHERE "data" LIKE '%cp_e2e_wf_%'` })
  await client.execute({ sql: `DELETE FROM "ProposalDecision" WHERE "proposalId" LIKE 'cp_e2e_wf_%'` })
  await client.execute({ sql: `DELETE FROM "ConnectionProposal" WHERE "id" LIKE 'cp_e2e_wf_%'` })

  // ── 3. 用户 + 成员关系 ──
  await upsertUser(client, { id: E2E.opId, email: E2E.opEmail, name: 'E2E T06 Operator', hash, now })
  await upsertUser(client, { id: E2E.memberId, email: E2E.memberEmail, name: 'E2E T06 Member', hash, now })
  await upsertUser(client, { id: E2E.member2Id, email: E2E.member2Email, name: 'E2E T06 Member2', hash, now })
  await upsertUser(client, { id: E2E.adminId, email: E2E.adminEmail, name: 'E2E T06 Admin', hash, now })

  await upsertMembership(client, { id: 'ms_e2e_t06_op', userId: E2E.opId, role: 'OPERATOR', now })
  await upsertMembership(client, { id: 'ms_e2e_t06_member', userId: E2E.memberId, role: 'MEMBER', now })
  await upsertMembership(client, { id: 'ms_e2e_t06_member2', userId: E2E.member2Id, role: 'MEMBER', now })
  await upsertMembership(client, { id: 'ms_e2e_t06_admin', userId: E2E.adminId, role: 'ADMIN', now })

  // ── 4. 档案 ──
  await upsertProfile(client, { id: 'pf_e2e_t06_op', userId: E2E.opId, displayName: '运营T06', age: 40, bio: '社群主理人', city: '上海', now })
  await upsertProfile(client, { id: 'pf_e2e_t06_member', userId: E2E.memberId, displayName: '成员T06', age: 33, bio: '待介绍的自述', city: '北京', now })
  await upsertProfile(client, { id: 'pf_e2e_t06_member2', userId: E2E.member2Id, displayName: '成员T06b', age: 35, bio: '另一名成员', city: '广州', now })
  await upsertProfile(client, { id: 'pf_e2e_t06_admin', userId: E2E.adminId, displayName: '管理员T06', age: 45, bio: '社群管理员', city: '深圳', now })

  // ── 5. 参与关系 + 意图（介绍要求双方意图 ACTIVE）──
  for (const [key, userId] of [
    ['op', E2E.opId],
    ['member', E2E.memberId],
    ['member2', E2E.member2Id],
    ['admin', E2E.adminId],
  ]) {
    await upsertParticipation(client, { id: `mp_t06_${key}`, userId, now })
  }
  await upsertIntent(client, { id: 'si_t06_op', userId: E2E.opId, need: '我想找合规顾问', offer: '我能提供社群资源', now })
  await upsertIntent(client, { id: 'si_t06_member', userId: E2E.memberId, need: '我需要东南亚渠道', offer: '我能提供清关资源', now })
  await upsertIntent(client, { id: 'si_t06_member2', userId: E2E.member2Id, need: '我需要品牌设计', offer: '我能提供设计资源', now })
  await upsertIntent(client, { id: 'si_t06_admin', userId: E2E.adminId, need: '我需要冷链', offer: '我能提供冷链资源', now })

  // ── 6. 提案 ──
  await upsertProposal(client, {
    id: 'cp_e2e_wf_recover', proposerId: E2E.opId, candidateId: E2E.memberId,
    status: 'MUTUALLY_ACCEPTED', rationale: RATIONALE.recover, introducedAt: null, closedAt: null, now,
  })
  await upsertProposal(client, {
    id: 'cp_e2e_wf_revoked', proposerId: E2E.opId, candidateId: E2E.member2Id,
    status: 'REVOKED', rationale: RATIONALE.revoked, introducedAt: null, closedAt: now, now,
  })
  await upsertProposal(client, {
    id: 'cp_e2e_wf_dead', proposerId: E2E.opId, candidateId: E2E.adminId,
    status: 'REJECTED', rationale: RATIONALE.dead, introducedAt: null, closedAt: now, now,
  })

  // ── 7. 表态记录 ──
  await upsertDecision(client, { id: 'pd_t06_rc_op', proposalId: 'cp_e2e_wf_recover', personId: E2E.opId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t06_rc_me', proposalId: 'cp_e2e_wf_recover', personId: E2E.memberId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t06_rv_op', proposalId: 'cp_e2e_wf_revoked', personId: E2E.opId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t06_rv_m2', proposalId: 'cp_e2e_wf_revoked', personId: E2E.member2Id, decision: 'REVOKE', now })
  await upsertDecision(client, { id: 'pd_t06_dd_op', proposalId: 'cp_e2e_wf_dead', personId: E2E.opId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t06_dd_ad', proposalId: 'cp_e2e_wf_dead', personId: E2E.adminId, decision: 'REJECT', now })

  // ── 8. 预置任务（故障注入的关键）──
  //  (a) 已撤销提案的**待发**介绍任务 —— tick 应判 superseded → CANCELLED（AC-05）
  await upsertJob(client, {
    id: 'wj_e2e_revoked', dedupeKey: 'introduce:cp_e2e_wf_revoked', kind: 'INTRODUCE_CONNECTION',
    status: 'PENDING', proposalId: 'cp_e2e_wf_revoked', payload: null, attempts: 0, now,
  })
  //  (b) 一条**死信** —— 自动流程不得复活它，须人接管（AC-17）
  await upsertJob(client, {
    id: 'wj_e2e_dead', dedupeKey: `proposal-created:cp_e2e_wf_dead:${E2E.adminId}`,
    kind: 'PROPOSAL_CREATED', status: 'DEAD', proposalId: 'cp_e2e_wf_dead',
    payload: { recipientId: E2E.adminId }, attempts: 5,
    deadLetteredAt: now, lastError: 'forced dead for E2E', now,
  })

  const counts = await tableCounts(client)
  console.log(`\n✅ T06 工作流夹具已播种：${DB_FILE}`)
  console.log(`   提案=${counts.proposals}（期望 3）/ 预置任务=${counts.jobs}（期望 2 —— 一条 PENDING、一条 DEAD）`)
  console.log('\n   —— Playwright 环境变量 ——')
  console.log(`   E2E_T06_MISSION_TOKEN=${E2E.token}`)
  console.log(`   E2E_OP_EMAIL=${E2E.opEmail}`)
  console.log(`   E2E_ADMIN_EMAIL=${E2E.adminEmail}`)
  console.log(`   E2E_MEMBER_EMAIL=${E2E.memberEmail}`)
  console.log(`   E2E_PASSWORD=${password}`)
  console.log('\n   —— 跑用例**前**的期望（member 视角）——')
  console.log('   cp_e2e_wf_recover：MUTUALLY_ACCEPTED、introducedAt=NULL、**无 job**（对账补入队的输入）')
  console.log('   cp_e2e_wf_revoked：REVOKED，有一条 PENDING 介绍任务（tick 后应变 CANCELLED）')
  console.log('   cp_e2e_wf_dead：DEAD 任务需人接管（workflow.manage = ADMIN+）')
  console.log(`   🔒 负测哨兵（不得出现在投递正文里）：${SENTINELS.opEmail}`)
  client.close()
}

main().catch((err) => {
  console.error('❌ T06 夹具准备失败：', err?.message || err)
  process.exit(1)
})
