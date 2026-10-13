#!/usr/bin/env node
/**
 * T08 · 商业指标对账夹具（AC-16）
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么需要它
 * ═══════════════════════════════════════════════════════════════
 * AC-16 的判据是「API 下发的每个数字，都能被原始表 SQL 独立算出同一个值」。
 * 要证这件事，需要一个**计数完全已知**的库：否则"两边算出同一个数"可能只是
 * 因为两边都算错了同一个方向（例如都漏掉 REVOKED 分支）。
 *
 * 因此本夹具刻意构造：
 *   · **每个计数字段取值互不相同**（提案 7 / 待表态 2 / 双方同意 4 / 已介绍 3 /
 *     成果 3 / 已验证 1 / 接管 1 / 死信 2）—— 谁被漏算都会立刻显形；
 *   · **非整数比率**（4/7 = 57.1%、1/3 = 33.3%）—— 舍入口径错了也会显形；
 *   · **噪声行**：`REVOKED` 提案、`SUCCEEDED`/`PENDING` 任务、第二条 Mission 的数据
 *     —— 用来证明过滤真的生效，而不是"把表里所有行都数了一遍"。
 *
 * ═══════════════════════════════════════════════════════════════
 * 期望值（mission_t08_metrics 内）
 * ═══════════════════════════════════════════════════════════════
 *   提案 7（含 1 条 REVOKED —— **不计入** mutuallyAccepted）
 *   待表态 2 / 双方同意 4 / 已介绍 3
 *   成果 3（其中 **已验证 1**，另 2 条仅自报）
 *   接管 1 / 死信 2 → 介入 3 → 45 分钟 = 0.75 小时
 *   成本 = 7×20 + 3×500 + 3×300 + 1×100 = 2640 分 = 26.40
 *
 * 用法：
 *   E2E_DB_FILE=/tmp/t08-metrics.db node scripts/qa/seed-t02-e2e.mjs --reset
 *   E2E_DB_FILE=/tmp/t08-metrics.db node scripts/qa/seed-t08-metrics.mjs
 *   METRICS_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-metrics.db \
 *     npx tsx scripts/qa/emit-outcome-metrics.mts > /tmp/t08-metrics-api.json
 *   METRICS_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-metrics.db \
 *     node scripts/qa/outcome-reconcile.mjs --api=/tmp/t08-metrics-api.json
 *
 * 幂等：只动自己的命名空间（`mission_t08_%` / `cp_t08_%` / `oc_t08_%` / `ov_t08_%` / `wj_t08_%`）。
 */

import { createClient } from '@libsql/client'

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/t08-metrics.db'
const DB_URL = `file:${DB_FILE}`

const ORG = 'org_e2e' // 由 seed-t02-e2e.mjs 建出

const MISSION_MAIN = 'mission_t08_metrics'
const MISSION_OTHER = 'mission_t08_other'

const U = {
  reporter: 'u_t08_reporter',
  counterparty: 'u_t08_counterparty',
  admin: 'u_t08_admin',
}

/** 每条提案需要一个**不同的被介绍方** —— `@@unique([missionId, proposerId, candidateId])`。 */
const candOf = (n) => `u_t08_cand_${n}`

/** Prisma 写 DateTime 的格式（与 seed-t06 同一条约定，避免同库两种时间格式混排）。 */
const prismaDate = (d = new Date()) => d.toISOString().replace('Z', '+00:00')

async function tableExists(client, name) {
  const r = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  })
  return Number(r.rows[0].n) > 0
}

async function upsertUser(client, { id, email, name, now }) {
  await client.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES (?,?,?,'x','USER',0,false,?,?)
          ON CONFLICT("email") DO UPDATE SET "name"=excluded."name","updatedAt"=excluded."updatedAt"`,
    args: [id, name, email, now, now],
  })
}

async function upsertMembership(client, { id, userId, role, now }) {
  await client.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES (?,?,?,?,'ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
    args: [id, ORG, userId, role, now, now],
  })
}

async function upsertMission(client, { id, title, now }) {
  await client.execute({
    sql: `INSERT INTO "Mission" (
            "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
            "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
            "closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?, 'ACTIVE', ?, 1, NULL, NULL, ?, NULL, ?, ?)
          ON CONFLICT("id") DO UPDATE SET "title"=excluded."title","updatedAt"=excluded."updatedAt"`,
    args: [id, ORG, U.reporter, title, '度量夹具', '度量夹具', JSON.stringify([]), '计数与对账一致', `${id}-token`, now, now, now],
  })
}

async function upsertProposal(client, { id, missionId, proposerId, candidateId, status, introducedAt, closedAt, now }) {
  await client.execute({
    sql: `INSERT INTO "ConnectionProposal" (
            "id","organizationId","missionId","proposerId","candidateId","status","rationale",
            "expiresAt","introducedAt","closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?)
          ON CONFLICT("id") DO UPDATE SET
            "status"=excluded."status","introducedAt"=excluded."introducedAt",
            "closedAt"=excluded."closedAt","updatedAt"=excluded."updatedAt"`,
    args: [
      id, ORG, missionId, proposerId, candidateId, status,
      '对账夹具：双方互补。',
      introducedAt, closedAt, now, now,
    ],
  })
}

async function upsertOutcome(client, { id, proposalId, missionId, level, reporterId, counterpartyId, occurredAt, now }) {
  await client.execute({
    sql: `INSERT INTO "Outcome" (
            "id","organizationId","proposalId","missionId","reporterId","counterpartyId",
            "summary","verificationLevel","occurredAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT("id") DO UPDATE SET
            "verificationLevel"=excluded."verificationLevel","updatedAt"=excluded."updatedAt"`,
    args: [
      id, ORG, proposalId, missionId, reporterId, counterpartyId,
      '对账夹具成果：已达成合作。', level, occurredAt, now, now,
    ],
  })
}

async function upsertVerification(client, { id, outcomeId, level, actorId, now }) {
  await client.execute({
    sql: `INSERT INTO "OutcomeVerification" ("id","organizationId","outcomeId","level","actorId","evidence","note","createdAt")
          VALUES (?,?,?,?,?,NULL,NULL,?)
          ON CONFLICT("id") DO UPDATE SET "level"=excluded."level"`,
    args: [id, ORG, outcomeId, level, actorId, now],
  })
}

async function upsertJob(client, { id, dedupeKey, kind, status, missionId, proposalId, now }) {
  const at = prismaDate()
  await client.execute({
    sql: `INSERT INTO "WorkflowJob" (
            "id","organizationId","dedupeKey","kind","status","proposalId","missionId","payload",
            "attempts","maxAttempts","nextAttemptAt","lockedBy","lockedUntil","lastError",
            "deadLetteredAt","takenOverBy","takenOverAt","cancelledAt","completedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,NULL,0,5,?,NULL,NULL,NULL,?,NULL,NULL,NULL,NULL,?,?)
          ON CONFLICT("id") DO UPDATE SET "status"=excluded."status","updatedAt"=excluded."updatedAt"`,
    args: [
      id, ORG, dedupeKey, kind, status, proposalId ?? null, missionId,
      at,
      status === 'DEAD' ? at : null,
      now, now,
    ],
  })
}

async function main() {
  const client = createClient({ url: DB_URL })
  const now = prismaDate()

  // ── 前置：基线库就位（org / owner 由 seed-t02 建）──
  const pre = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM "Organization" WHERE "id"=?`,
    args: [ORG],
  })
  if (Number(pre.rows[0].n) === 0) {
    throw new Error(
      `缺少基线库（${DB_FILE} 里没有 ${ORG}）—— 请先：E2E_DB_FILE=${DB_FILE} node scripts/qa/seed-t02-e2e.mjs --reset`
    )
  }
  // ── 前置：C4 表必须存在（seed-t02 按当前 schema 生成 DDL，故通常已含）──
  for (const t of ['Outcome', 'OutcomeVerification']) {
    if (!(await tableExists(client, t))) {
      throw new Error(
        `C4 表缺失：${t}。请用**最新** schema 重跑：E2E_DB_FILE=${DB_FILE} E2E_DDL_FILE=/tmp/t08-metrics-ddl.sql node scripts/qa/seed-t02-e2e.mjs --reset --regenerate`
      )
    }
  }

  // ── 用户 + 成员 ──
  await upsertUser(client, { id: U.reporter, email: 't08.reporter@example.test', name: 'T08 上报方', now })
  await upsertUser(client, { id: U.counterparty, email: 't08.counterparty@example.test', name: 'T08 对手方', now })
  await upsertUser(client, { id: U.admin, email: 't08.admin@example.test', name: 'T08 管理员', now })
  await upsertMembership(client, { id: 'ms_t08_reporter', userId: U.reporter, role: 'MEMBER', now })
  await upsertMembership(client, { id: 'ms_t08_counterparty', userId: U.counterparty, role: 'MEMBER', now })
  await upsertMembership(client, { id: 'ms_t08_admin', userId: U.admin, role: 'ADMIN', now })
  // 被介绍方们（9 条提案各一个 —— 避免撞 (missionId, proposerId, candidateId) 唯一键）
  for (let i = 1; i <= 9; i += 1) {
    await upsertUser(client, { id: candOf(i), email: `t08.cand${i}@example.test`, name: `T08 被介绍方${i}`, now })
    await upsertMembership(client, { id: `ms_t08_cand_${i}`, userId: candOf(i), role: 'MEMBER', now })
  }

  // ── Mission ──
  await upsertMission(client, { id: MISSION_MAIN, title: 'T08 指标对账（主）', now })
  await upsertMission(client, { id: MISSION_OTHER, title: 'T08 指标对账（干扰项）', now })

  // ── 清掉本脚本自己的历史产物（幂等）──
  await client.execute({ sql: `DELETE FROM "OutcomeVerification" WHERE "id" LIKE 'ov_t08_%'` })
  await client.execute({ sql: `DELETE FROM "Outcome" WHERE "id" LIKE 'oc_t08_%'` })
  await client.execute({ sql: `DELETE FROM "WorkflowJob" WHERE "id" LIKE 'wj_t08_%'` })
  await client.execute({ sql: `DELETE FROM "ProposalDecision" WHERE "proposalId" LIKE 'cp_t08_%'` })
  await client.execute({ sql: `DELETE FROM "ConnectionProposal" WHERE "id" LIKE 'cp_t08_%'` })

  // ══════════════════════════════════════════════════════════
  // 主任务：7 条提案（1 条 REVOKED 作为"不该被计入同意"的噪声）
  // ══════════════════════════════════════════════════════════
  await upsertProposal(client, { id: 'cp_t08_p1', missionId: MISSION_MAIN, proposerId: U.reporter, candidateId: candOf(1), status: 'CONSENT_PENDING', introducedAt: null, closedAt: null, now })
  await upsertProposal(client, { id: 'cp_t08_p2', missionId: MISSION_MAIN, proposerId: U.reporter, candidateId: candOf(2), status: 'CONSENT_PENDING', introducedAt: null, closedAt: null, now })
  await upsertProposal(client, { id: 'cp_t08_p3', missionId: MISSION_MAIN, proposerId: U.reporter, candidateId: candOf(3), status: 'MUTUALLY_ACCEPTED', introducedAt: null, closedAt: null, now })
  await upsertProposal(client, { id: 'cp_t08_p4', missionId: MISSION_MAIN, proposerId: U.reporter, candidateId: candOf(4), status: 'MUTUALLY_ACCEPTED', introducedAt: now, closedAt: null, now })
  await upsertProposal(client, { id: 'cp_t08_p5', missionId: MISSION_MAIN, proposerId: U.reporter, candidateId: candOf(5), status: 'MUTUALLY_ACCEPTED', introducedAt: now, closedAt: null, now })
  await upsertProposal(client, { id: 'cp_t08_p6', missionId: MISSION_MAIN, proposerId: U.reporter, candidateId: candOf(6), status: 'MUTUALLY_ACCEPTED', introducedAt: now, closedAt: null, now })
  await upsertProposal(client, { id: 'cp_t08_p7', missionId: MISSION_MAIN, proposerId: U.reporter, candidateId: candOf(7), status: 'REVOKED', introducedAt: null, closedAt: now, now })

  // 成果：3 条（p4/p5/p6 各一），其中 p5 **已验证**
  await upsertOutcome(client, { id: 'oc_t08_p4', proposalId: 'cp_t08_p4', missionId: MISSION_MAIN, level: 'SELF_REPORTED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: now, now })
  await upsertOutcome(client, { id: 'oc_t08_p5', proposalId: 'cp_t08_p5', missionId: MISSION_MAIN, level: 'COUNTERPARTY_CONFIRMED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: now, now })
  await upsertOutcome(client, { id: 'oc_t08_p6', proposalId: 'cp_t08_p6', missionId: MISSION_MAIN, level: 'SELF_REPORTED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: now, now })
  await upsertVerification(client, { id: 'ov_t08_p5', outcomeId: 'oc_t08_p5', level: 'COUNTERPARTY_CONFIRMED', actorId: U.counterparty, now })

  // 任务：1 接管 + 2 死信（计数），另加 2 成功 + 1 待执行（**不该**被计入）
  await upsertJob(client, { id: 'wj_t08_takeover', dedupeKey: 't08:takeover', kind: 'INTRODUCE_CONNECTION', status: 'TAKEN_OVER', missionId: MISSION_MAIN, proposalId: 'cp_t08_p4', now })
  await upsertJob(client, { id: 'wj_t08_dead1', dedupeKey: 't08:dead1', kind: 'PROPOSAL_CREATED', status: 'DEAD', missionId: MISSION_MAIN, proposalId: 'cp_t08_p1', now })
  await upsertJob(client, { id: 'wj_t08_dead2', dedupeKey: 't08:dead2', kind: 'CONSENT_ACCEPTED', status: 'DEAD', missionId: MISSION_MAIN, proposalId: 'cp_t08_p2', now })
  await upsertJob(client, { id: 'wj_t08_noise_ok', dedupeKey: 't08:noise-ok', kind: 'INTRODUCE_CONNECTION', status: 'SUCCEEDED', missionId: MISSION_MAIN, proposalId: 'cp_t08_p5', now })
  await upsertJob(client, { id: 'wj_t08_noise_ok2', dedupeKey: 't08:noise-ok2', kind: 'INTRODUCE_CONNECTION', status: 'SUCCEEDED', missionId: MISSION_MAIN, proposalId: 'cp_t08_p6', now })
  await upsertJob(client, { id: 'wj_t08_noise_pending', dedupeKey: 't08:noise-pending', kind: 'COORDINATION_FOLLOWUP', status: 'PENDING', missionId: MISSION_MAIN, proposalId: 'cp_t08_p3', now })

  // ══════════════════════════════════════════════════════════
  // 干扰任务：数据形状完全不同（2 提案 / 1 同意 / 1 介绍 / 1 成果 / 0 验证 / 0 介入）
  //   ⇒ 用来证明 missionId 过滤真的生效（全量 = 主 + 干扰）
  // ══════════════════════════════════════════════════════════
  await upsertProposal(client, { id: 'cp_t08_o1', missionId: MISSION_OTHER, proposerId: U.reporter, candidateId: candOf(8), status: 'CONSENT_PENDING', introducedAt: null, closedAt: null, now })
  await upsertProposal(client, { id: 'cp_t08_o2', missionId: MISSION_OTHER, proposerId: U.reporter, candidateId: candOf(9), status: 'MUTUALLY_ACCEPTED', introducedAt: now, closedAt: null, now })
  await upsertOutcome(client, { id: 'oc_t08_o2', proposalId: 'cp_t08_o2', missionId: MISSION_OTHER, level: 'EXTERNALLY_VERIFIED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: now, now })

  const after = await client.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM "ConnectionProposal" WHERE "id" LIKE 'cp_t08_%') AS proposals,
            (SELECT COUNT(*) FROM "Outcome" WHERE "id" LIKE 'oc_t08_%') AS outcomes,
            (SELECT COUNT(*) FROM "WorkflowJob" WHERE "id" LIKE 'wj_t08_%') AS jobs`,
    args: [],
  })
  const row = after.rows[0]

  console.log(`\n✅ T08 指标夹具已播种：${DB_FILE}`)
  console.log(`   提案 ${row.proposals}（期望 9 = 主 7 + 干扰 2）· 成果 ${row.outcomes}（期望 4）· 任务 ${row.jobs}（期望 6 = 主 6）`)
  console.log('\n   —— 主任务 ' + MISSION_MAIN + ' 的期望计数 ——')
  console.log('   proposals=7  consentPending=2  mutuallyAccepted=4  introduced=3')
  console.log('   outcomesReported=3  outcomesVerified=1  takeovers=1  deadLettered=2')
  console.log('   rates: 57.1 / 75 / 100 / 33.3   cost: 2640 分（26.40）  工时: 45 分（0.75h）')
  console.log('\n   —— 全租户（不加 missionId）的期望计数 ——')
  console.log('   proposals=9  consentPending=3  mutuallyAccepted=5  introduced=4')
  console.log('   outcomesReported=4  outcomesVerified=2  takeovers=1  deadLettered=2')
  client.close()
}

main().catch((err) => {
  console.error('❌ T08 指标夹具准备失败：', err?.message || err)
  process.exit(1)
})
