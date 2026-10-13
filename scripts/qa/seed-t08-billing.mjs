#!/usr/bin/env node
/**
 * T08 · 用量计费对账夹具（AC-21）
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么需要它
 * ═══════════════════════════════════════════════════════════════
 * AC-21 的判据有两半，各自需要一种「计数/状态**完全已知**」的库：
 *
 *   ① **使用量可复算** —— 要求「归集出的用量」与「原始表 SQL 独立算出的用量」
 *      逐字相同。要证这件事，计数必须**互不相同**，否则"两边算出同一个数"可能只是
 *      两边都漏掉同一个分支（例如都漏掉 REVOKED、都漏掉跨期行）。
 *   ② **退款/失败/升级/降级状态一致** —— 要求「派生的账本状态」与「原始事件集」
 *      一致。要证这件事，事件序列必须**走遍全部四类迁移**（升级、降级、失败、退款），
 *      且终态可被独立算出（而不是"随便造几条、状态碰巧对"）。
 *
 * 因此本夹具刻意构造：
 *
 * ── A. 用量事实（当期，`org_e2e` / `mission_t08_billing`）──────────────────
 *      提案 6 · 介绍 4 · 成果 5 · 核验 2      （四单元**各不相等**）
 *   ⇒ 「介绍数被误当成提案数」「核验按记录条数而非成果数计」都会立刻显形。
 *
 * ── B. 两类噪声（证明过滤是**承重**的，而不是"恰好没数据"）───────────────
 *   · **跨期噪声**（上一期）：+1 提案 / +1 介绍 / +1 成果 / +1 核验
 *     ⇒ 若对账脚本忘了按期次过滤，当期数字会**多**出 4 个。
 *   · **跨租户噪声**（`org_t08_other`）：+1 提案 / +1 成果（已验证）
 *     ⇒ 若忘了租户谓词，当期数字会再多 2 个（且会污染全库对账）。
 *   ⚠️ 跨期行**会照常入账**（`collectUsage` 不过滤期次，是账本就该有的行为）——
 *      它们落进**上一期**的 `periodKey`，这正是"按期归集"被真正跑到的地方。
 *
 * ── C. 账本事件（`org_e2e`，10 条，覆盖四类迁移）────────────────────────
 *   t1  SUBSCRIPTION_STARTED  STARTER                      → ACTIVE / STARTER
 *   t2  CHARGE_CREATED        ch1 1000                     → ch1 PENDING
 *   t3  CHARGE_SUCCEEDED      ch1 1000 gateway=CAPTURED     → ch1 SUCCEEDED, paid=1000
 *   t4  PLAN_CHANGED          GROWTH                       → **UPGRADE**
 *   t5  CHARGE_CREATED        ch2 2000                     → ch2 PENDING
 *   t6  CHARGE_FAILED         ch2 reason=card_declined      → ch2 FAILED, status=PAST_DUE
 *   t7  CHARGE_CREATED        ch3 2000                     → ch3 PENDING
 *   t8  CHARGE_SUCCEEDED      ch3 2000 gateway=CAPTURED     → ch3 SUCCEEDED, paid=3000, ACTIVE
 *   t9  PLAN_CHANGED          STARTER                      → **DOWNGRADE**
 *   t10 CHARGE_REFUNDED       ch3 2000                     → ch3 REFUNDED, refunded=2000, REFUNDED
 *   ⇒ 终态：plan=STARTER / status=REFUNDED / paid=3000 / refunded=2000 / net=1000
 *           charges=[ch1 SUCCEEDED, ch2 FAILED, ch3 REFUNDED] / eventCount=10
 *           lastPlanChangeDirection=DOWNGRADE
 *   ⚠️ 每条 `CHARGE_*` 的 `gatewayStatus` **一律 CAPTURED 或 FAILED，绝不 SUCCEEDED**
 *      —— 沙箱下若写成 SUCCEEDED 就是虚报"真实网关已受理"（AC-21 诚实条款）。
 *      对账脚本会把这条当成硬断言（`gatewayStatus='SUCCEEDED'` 计数必须为 0）。
 *   ⚠️ `occurredAt` 与 `createdAt` **逐条严格递增**：折叠按 `(occurredAt, createdAt, id)`
 *      定序，同刻会让顺序退到 `id` 上（cuid 不保证与插入顺序一致）→ 折叠结抖动。
 *
 *   ＋ 跨租户噪声事件：`org_t08_other` 上 1 条 `SUBSCRIPTION_STARTED`
 *     ⇒ 忘了租户谓词时 eventCount 会变成 11。
 *
 * 用法：
 *   E2E_DB_FILE=/tmp/t08-billing.db E2E_DDL_FILE=/tmp/t08-billing-ddl.sql \
 *     node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
 *   E2E_DB_FILE=/tmp/t08-billing.db node scripts/qa/seed-t08-billing.mjs
 *   BILLING_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-billing.db \
 *     npx tsx scripts/qa/emit-billing.mts > /tmp/t08-billing-api.json
 *   BILLING_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-billing.db \
 *     node scripts/qa/billing-reconcile.mjs --api=/tmp/t08-billing-api.json
 *
 * 幂等：只动自己的命名空间（`mission_t08_billing` / `cp_t8b_%` / `oc_t8b_%` /
 * `ov_t8b_%` / `be_t8b_%` / `org_t08_other` 及其 `cp_t8x_%` / `oc_t8x_%`）。
 * 注意**不写** `UsageRecord` —— 用量账只能由 `collectUsage` 归集产生，
 * 夹具若自己塞账，"归集"这条路径就没被验证过（那是 S3-G 的核心判据）。
 */

import { createClient } from '@libsql/client'

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/t08-billing.db'
const DB_URL = `file:${DB_FILE}`

const ORG = 'org_e2e' // 由 seed-t02-e2e.mjs 建出
const ORG_OTHER = 'org_t08_other' // 跨租户噪声（本脚本自建）

const MISSION = 'mission_t08_billing'

const U = {
  reporter: 'u_t8b_reporter',
  counterparty: 'u_t8b_counterparty',
  admin: 'u_t8b_admin',
}

/** 每条提案需要一个**不同的被介绍方** —— `@@unique([missionId, proposerId, candidateId])`。 */
const candOf = (n) => `u_t8b_cand_${n}`

/** Prisma 写 DateTime 的格式（与 seed-t08-metrics 同一约定，避免同库多格式混排 → R10）。 */
const prismaDate = (d = new Date()) => d.toISOString().replace('Z', '+00:00')

// ─────────────────────────────────────────────────────────────
// 期次（UTC 自然月）—— 与 `src/lib/billing/usage.ts` 的 `periodKeyOf` 同口径。
//   夹具自己算一遍是**刻意的**：若这里算错，对账会在"当期 vs 上期"上直接暴露。
// ─────────────────────────────────────────────────────────────

const PERIOD_RE = /^\d{4}-\d{2}$/

function periodKeyOf(d) {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

function shiftPeriodKey(periodKey, months) {
  if (!PERIOD_RE.test(periodKey)) throw new Error(`非法期次：${periodKey}`)
  const [yStr, mStr] = periodKey.split('-')
  const base = Number(yStr) * 12 + (Number(mStr) - 1) + months
  const y = Math.floor(base / 12)
  const m = (base % 12) + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

/** 某期次内一个确定的时刻（第 15 天 12:00Z），确保落在该月中间、不踩边界。 */
function instantIn(periodKey) {
  const [y, m] = periodKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15, 12, 0, 0, 0))
}

async function tableExists(client, name) {
  const r = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  })
  return Number(r.rows[0].n) > 0
}

// ── 基础实体 ──

async function upsertOrg(client, { id, name, slug, now }) {
  await client.execute({
    sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
          VALUES (?,?,?,'ACTIVE',?,?)
          ON CONFLICT("id") DO UPDATE SET "name"=excluded."name"`,
    args: [id, name, slug, now, now],
  })
}

async function upsertUser(client, { id, email, name, now }) {
  await client.execute({
    sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
          VALUES (?,?,?,'x','USER',0,false,?,?)
          ON CONFLICT("email") DO UPDATE SET "name"=excluded."name","updatedAt"=excluded."updatedAt"`,
    args: [id, name, email, now, now],
  })
}

async function upsertMembership(client, { id, org, userId, role, now }) {
  await client.execute({
    sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
          VALUES (?,?,?,?,'ACTIVE',?,?)
          ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
    args: [id, org, userId, role, now, now],
  })
}

async function upsertMission(client, { id, org, ownerId, title, now }) {
  await client.execute({
    sql: `INSERT INTO "Mission" (
            "id","organizationId","ownerId","title","goal","offer","constraints","successCriteria",
            "status","shareToken","publicPreview","maxParticipants","expiresAt","publishedAt",
            "closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?, 'ACTIVE', ?, 1, NULL, NULL, ?, NULL, ?, ?)
          ON CONFLICT("id") DO UPDATE SET "title"=excluded."title","updatedAt"=excluded."updatedAt"`,
    args: [id, org, ownerId, title, '计费夹具', '计费夹具', JSON.stringify([]), '计数与对账一致', `${id}-token`, now, now, now],
  })
}

async function upsertProposal(client, { id, org, missionId, proposerId, candidateId, status, introducedAt, closedAt, createdAt, now }) {
  await client.execute({
    sql: `INSERT INTO "ConnectionProposal" (
            "id","organizationId","missionId","proposerId","candidateId","status","rationale",
            "expiresAt","introducedAt","closedAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?)
          ON CONFLICT("id") DO UPDATE SET
            "status"=excluded."status","introducedAt"=excluded."introducedAt",
            "closedAt"=excluded."closedAt","createdAt"=excluded."createdAt","updatedAt"=excluded."updatedAt"`,
    args: [id, org, missionId, proposerId, candidateId, status, '计费夹具：双方互补。', introducedAt, closedAt, createdAt, now],
  })
}

async function upsertOutcome(client, { id, org, proposalId, missionId, level, reporterId, counterpartyId, occurredAt, now }) {
  await client.execute({
    sql: `INSERT INTO "Outcome" (
            "id","organizationId","proposalId","missionId","reporterId","counterpartyId",
            "summary","verificationLevel","occurredAt","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT("id") DO UPDATE SET
            "verificationLevel"=excluded."verificationLevel","occurredAt"=excluded."occurredAt","updatedAt"=excluded."updatedAt"`,
    args: [id, org, proposalId, missionId, reporterId, counterpartyId, '计费夹具成果：已达成合作。', level, occurredAt, now, now],
  })
}

async function upsertVerification(client, { id, org, outcomeId, level, actorId, createdAt }) {
  await client.execute({
    sql: `INSERT INTO "OutcomeVerification" ("id","organizationId","outcomeId","level","actorId","evidence","note","createdAt")
          VALUES (?,?,?,?,?,NULL,NULL,?)
          ON CONFLICT("id") DO UPDATE SET "level"=excluded."level","createdAt"=excluded."createdAt"`,
    args: [id, org, outcomeId, level, actorId, createdAt],
  })
}

async function upsertBillingEvent(client, e) {
  await client.execute({
    sql: `INSERT INTO "BillingEvent" (
            "id","organizationId","type","plan","chargeId","amountCents","currency",
            "providerRef","gatewayStatus","reason","actorId","dedupeKey","requestHash",
            "occurredAt","createdAt")
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT("id") DO UPDATE SET
            "type"=excluded."type","plan"=excluded."plan","chargeId"=excluded."chargeId",
            "amountCents"=excluded."amountCents","gatewayStatus"=excluded."gatewayStatus",
            "reason"=excluded."reason","occurredAt"=excluded."occurredAt","createdAt"=excluded."createdAt"`,
    args: [
      e.id, e.org, e.type, e.plan ?? null, e.chargeId ?? null, e.amountCents ?? null,
      e.currency ?? 'USD', e.providerRef ?? null, e.gatewayStatus ?? null, e.reason ?? null,
      e.actorId ?? null, e.dedupeKey, e.requestHash ?? null, e.occurredAt, e.createdAt,
    ],
  })
}

async function main() {
  const client = createClient({ url: DB_URL })
  const now = prismaDate()

  // ── 前置：基线库就位 ──
  const pre = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM "Organization" WHERE "id"=?`,
    args: [ORG],
  })
  if (Number(pre.rows[0].n) === 0) {
    throw new Error(
      `缺少基线库（${DB_FILE} 里没有 ${ORG}）—— 请先：E2E_DB_FILE=${DB_FILE} node scripts/qa/seed-t02-e2e.mjs --reset`
    )
  }
  // ── 前置：C5 表必须存在（`--regenerate` 才能保证是最新 schema 生成的 DDL）──
  for (const t of ['UsageRecord', 'BillingEvent']) {
    if (!(await tableExists(client, t))) {
      throw new Error(
        `C5 表缺失：${t}。请用**最新** schema 重跑基线：` +
          `E2E_DB_FILE=${DB_FILE} E2E_DDL_FILE=/tmp/t08-billing-ddl.sql node scripts/qa/seed-t02-e2e.mjs --reset --regenerate`
      )
    }
  }

  const periodNow = periodKeyOf(new Date())
  const periodPrev = shiftPeriodKey(periodNow, -1)
  const atNow = prismaDate(instantIn(periodNow))
  const atPrev = prismaDate(instantIn(periodPrev))

  // ══════════════════════════════════════════════════════════
  // 用户 + 成员（主租户）
  // ══════════════════════════════════════════════════════════
  await upsertUser(client, { id: U.reporter, email: 't8b.reporter@example.test', name: 'T08B 上报方', now })
  await upsertUser(client, { id: U.counterparty, email: 't8b.counterparty@example.test', name: 'T08B 对手方', now })
  await upsertUser(client, { id: U.admin, email: 't8b.admin@example.test', name: 'T08B 管理员', now })
  await upsertMembership(client, { id: 'ms_t8b_reporter', org: ORG, userId: U.reporter, role: 'MEMBER', now })
  await upsertMembership(client, { id: 'ms_t8b_counterparty', org: ORG, userId: U.counterparty, role: 'MEMBER', now })
  await upsertMembership(client, { id: 'ms_t8b_admin', org: ORG, userId: U.admin, role: 'ADMIN', now })
  for (let i = 1; i <= 8; i += 1) {
    await upsertUser(client, { id: candOf(i), email: `t8b.cand${i}@example.test`, name: `T08B 被介绍方${i}`, now })
    await upsertMembership(client, { id: `ms_t8b_cand_${i}`, org: ORG, userId: candOf(i), role: 'MEMBER', now })
  }

  await upsertOrg(client, { id: ORG_OTHER, name: 'T08B 跨租户噪声', slug: 't08b-other', now })

  // ══════════════════════════════════════════════════════════
  // 清掉本脚本自己的历史产物（幂等）
  // ══════════════════════════════════════════════════════════
  await client.execute({ sql: `DELETE FROM "UsageRecord"  WHERE "id" LIKE 'ur_t8b_%'` })
  await client.execute({ sql: `DELETE FROM "BillingEvent" WHERE "id" LIKE 'be_t8b_%' OR "id" LIKE 'be_t8x_%'` })
  await client.execute({ sql: `DELETE FROM "OutcomeVerification" WHERE "id" LIKE 'ov_t8b_%' OR "id" LIKE 'ov_t8x_%'` })
  await client.execute({ sql: `DELETE FROM "Outcome" WHERE "id" LIKE 'oc_t8b_%' OR "id" LIKE 'oc_t8x_%'` })
  await client.execute({ sql: `DELETE FROM "ProposalDecision" WHERE "proposalId" LIKE 'cp_t8b_%' OR "proposalId" LIKE 'cp_t8x_%'` })
  await client.execute({ sql: `DELETE FROM "ConnectionProposal" WHERE "id" LIKE 'cp_t8b_%' OR "id" LIKE 'cp_t8x_%'` })

  await upsertMission(client, { id: MISSION, org: ORG, ownerId: U.reporter, title: 'T08 计费对账', now })

  // ══════════════════════════════════════════════════════════
  // A. 当期用量事实：提案 6 / 介绍 4 / 成果 5 / 核验 2
  //    介绍来自 p3..p6（introducedAt 非空）→ 4
  //    成果挂在 p2..p6 上 → 5；其中 oc_t8b_p2 / oc_t8b_p4 **已验证** → 核验 2
  // ══════════════════════════════════════════════════════════
  await upsertProposal(client, { id: 'cp_t8b_p1', org: ORG, missionId: MISSION, proposerId: U.reporter, candidateId: candOf(1), status: 'CONSENT_PENDING', introducedAt: null, closedAt: null, createdAt: atNow, now })
  await upsertProposal(client, { id: 'cp_t8b_p2', org: ORG, missionId: MISSION, proposerId: U.reporter, candidateId: candOf(2), status: 'MUTUALLY_ACCEPTED', introducedAt: null, closedAt: null, createdAt: atNow, now })
  await upsertProposal(client, { id: 'cp_t8b_p3', org: ORG, missionId: MISSION, proposerId: U.reporter, candidateId: candOf(3), status: 'MUTUALLY_ACCEPTED', introducedAt: atNow, closedAt: null, createdAt: atNow, now })
  await upsertProposal(client, { id: 'cp_t8b_p4', org: ORG, missionId: MISSION, proposerId: U.reporter, candidateId: candOf(4), status: 'MUTUALLY_ACCEPTED', introducedAt: atNow, closedAt: null, createdAt: atNow, now })
  await upsertProposal(client, { id: 'cp_t8b_p5', org: ORG, missionId: MISSION, proposerId: U.reporter, candidateId: candOf(5), status: 'MUTUALLY_ACCEPTED', introducedAt: atNow, closedAt: null, createdAt: atNow, now })
  await upsertProposal(client, { id: 'cp_t8b_p6', org: ORG, missionId: MISSION, proposerId: U.reporter, candidateId: candOf(6), status: 'MUTUALLY_ACCEPTED', introducedAt: atNow, closedAt: null, createdAt: atNow, now })

  await upsertOutcome(client, { id: 'oc_t8b_p2', org: ORG, proposalId: 'cp_t8b_p2', missionId: MISSION, level: 'COUNTERPARTY_CONFIRMED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: atNow, now })
  await upsertOutcome(client, { id: 'oc_t8b_p3', org: ORG, proposalId: 'cp_t8b_p3', missionId: MISSION, level: 'SELF_REPORTED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: atNow, now })
  await upsertOutcome(client, { id: 'oc_t8b_p4', org: ORG, proposalId: 'cp_t8b_p4', missionId: MISSION, level: 'EXTERNALLY_VERIFIED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: atNow, now })
  await upsertOutcome(client, { id: 'oc_t8b_p5', org: ORG, proposalId: 'cp_t8b_p5', missionId: MISSION, level: 'SELF_REPORTED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: atNow, now })
  await upsertOutcome(client, { id: 'oc_t8b_p6', org: ORG, proposalId: 'cp_t8b_p6', missionId: MISSION, level: 'SELF_REPORTED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: atNow, now })

  await upsertVerification(client, { id: 'ov_t8b_p2', org: ORG, outcomeId: 'oc_t8b_p2', level: 'COUNTERPARTY_CONFIRMED', actorId: U.counterparty, createdAt: atNow })
  await upsertVerification(client, { id: 'ov_t8b_p4', org: ORG, outcomeId: 'oc_t8b_p4', level: 'EXTERNALLY_VERIFIED', actorId: U.admin, createdAt: atNow })

  // ══════════════════════════════════════════════════════════
  // B1. 跨期噪声（上一期）：+1 提案 / +1 介绍 / +1 成果 / +1 核验
  //     它会被照常归集，但落在**上一期** periodKey ⇒ 当期 totals 不该包含它。
  // ══════════════════════════════════════════════════════════
  await upsertProposal(client, { id: 'cp_t8b_prev1', org: ORG, missionId: MISSION, proposerId: U.reporter, candidateId: candOf(7), status: 'MUTUALLY_ACCEPTED', introducedAt: atPrev, closedAt: null, createdAt: atPrev, now })
  await upsertOutcome(client, { id: 'oc_t8b_prev1', org: ORG, proposalId: 'cp_t8b_prev1', missionId: MISSION, level: 'COUNTERPARTY_CONFIRMED', reporterId: U.reporter, counterpartyId: U.counterparty, occurredAt: atPrev, now })
  await upsertVerification(client, { id: 'ov_t8b_prev1', org: ORG, outcomeId: 'oc_t8b_prev1', level: 'COUNTERPARTY_CONFIRMED', actorId: U.counterparty, createdAt: atPrev })

  // ══════════════════════════════════════════════════════════
  // B2. 跨租户噪声（org_t08_other）：+1 提案 / +1 成果（已验证）
  // ══════════════════════════════════════════════════════════
  await upsertUser(client, { id: 'u_t8x_owner', email: 't8x.owner@example.test', name: 'T08X Owner', now })
  await upsertMembership(client, { id: 'ms_t8x_owner', org: ORG_OTHER, userId: 'u_t8x_owner', role: 'OWNER', now })
  await upsertMission(client, { id: 'mission_t08x_other', org: ORG_OTHER, ownerId: 'u_t8x_owner', title: 'T08X 跨租户噪声', now })
  await upsertProposal(client, { id: 'cp_t8x_1', org: ORG_OTHER, missionId: 'mission_t08x_other', proposerId: 'u_t8x_owner', candidateId: candOf(8), status: 'MUTUALLY_ACCEPTED', introducedAt: atNow, closedAt: null, createdAt: atNow, now })
  await upsertOutcome(client, { id: 'oc_t8x_1', org: ORG_OTHER, proposalId: 'cp_t8x_1', missionId: 'mission_t08x_other', level: 'EXTERNALLY_VERIFIED', reporterId: 'u_t8x_owner', counterpartyId: U.counterparty, occurredAt: atNow, now })
  await upsertVerification(client, { id: 'ov_t8x_1', org: ORG_OTHER, outcomeId: 'oc_t8x_1', level: 'EXTERNALLY_VERIFIED', actorId: 'u_t8x_owner', createdAt: atNow })

  // ══════════════════════════════════════════════════════════
  // C. 账本事件（主租户，10 条，覆盖 升级/降级/失败/退款）
  // ══════════════════════════════════════════════════════════
  const base = Date.UTC(2026, 0, 15, 12, 0, 0, 0) // 固定时刻，与用量事实无关
  const tk = (i) => prismaDate(new Date(base + i * 60_000)) // 每条 +1 分钟，严格递增

  const events = [
    { id: 'be_t8b_01', type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', dedupeKey: 't8b:start' },
    { id: 'be_t8b_02', type: 'CHARGE_CREATED', chargeId: 'ch_t8b_1', amountCents: 1000, dedupeKey: 't8b:ch1:created' },
    { id: 'be_t8b_03', type: 'CHARGE_SUCCEEDED', chargeId: 'ch_t8b_1', amountCents: 1000, gatewayStatus: 'CAPTURED', providerRef: 'sandbox:t8b-1', dedupeKey: 't8b:ch1:succeeded' },
    { id: 'be_t8b_04', type: 'PLAN_CHANGED', plan: 'GROWTH', dedupeKey: 't8b:plan:growth' },
    { id: 'be_t8b_05', type: 'CHARGE_CREATED', chargeId: 'ch_t8b_2', amountCents: 2000, dedupeKey: 't8b:ch2:created' },
    { id: 'be_t8b_06', type: 'CHARGE_FAILED', chargeId: 'ch_t8b_2', reason: 'card_declined', gatewayStatus: 'FAILED', dedupeKey: 't8b:ch2:failed' },
    { id: 'be_t8b_07', type: 'CHARGE_CREATED', chargeId: 'ch_t8b_3', amountCents: 2000, dedupeKey: 't8b:ch3:created' },
    { id: 'be_t8b_08', type: 'CHARGE_SUCCEEDED', chargeId: 'ch_t8b_3', amountCents: 2000, gatewayStatus: 'CAPTURED', providerRef: 'sandbox:t8b-3', dedupeKey: 't8b:ch3:succeeded' },
    { id: 'be_t8b_09', type: 'PLAN_CHANGED', plan: 'STARTER', dedupeKey: 't8b:plan:starter' },
    { id: 'be_t8b_10', type: 'CHARGE_REFUNDED', chargeId: 'ch_t8b_3', amountCents: 2000, gatewayStatus: 'CAPTURED', dedupeKey: 't8b:ch3:refunded' },
  ]
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i]
    await upsertBillingEvent(client, {
      ...e,
      org: ORG,
      actorId: U.admin,
      requestHash: `t8b-fixture-${i + 1}`,
      occurredAt: tk(i + 1),
      createdAt: tk(i + 1),
    })
  }
  // 跨租户噪声事件：唯一一条 SUBSCRIPTION_STARTED
  await upsertBillingEvent(client, {
    id: 'be_t8x_01',
    org: ORG_OTHER,
    type: 'SUBSCRIPTION_STARTED',
    plan: 'SCALE',
    dedupeKey: 't8x:start',
    requestHash: 't8x-fixture-1',
    occurredAt: tk(1),
    createdAt: tk(1),
  })

  // ══════════════════════════════════════════════════════════
  // 自检：把"期望"打出来（对账脚本会**独立**复算同一组数字）
  //
  // ⚠️ 期次过滤必须按**每个单元各自的 occurredAt 列**（与 `listUsageFacts` 同口径）：
  //      proposal/introduction ⟵ ConnectionProposal.createdAt / introducedAt
  //      outcome/verification ⟵ Outcome.occurredAt（verification 另取最早验证记录时间）
  //    日期文本经「去 Z / 去 +00:00 / 空格→T」归一后取前 7 位 = `YYYY-MM`，
  //    与 `periodKeyOf` 同为 UTC 自然月，且对 `Z` 与 `+00:00` 两种写法都成立。
  // ══════════════════════════════════════════════════════════
  const PK = (col) => `substr(replace(replace(${col},'Z',''),'+00:00',''),1,7)`

  const countIn = async (periodKey) => {
    const res = await client.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM "ConnectionProposal"
                 WHERE "organizationId"='${ORG}' AND "id" LIKE 'cp_t8b_%'
                   AND ${PK('"createdAt"')} = '${periodKey}') AS proposals,
              (SELECT COUNT(*) FROM "ConnectionProposal"
                 WHERE "organizationId"='${ORG}' AND "id" LIKE 'cp_t8b_%' AND "introducedAt" IS NOT NULL
                   AND ${PK('"introducedAt"')} = '${periodKey}') AS introductions,
              (SELECT COUNT(*) FROM "Outcome"
                 WHERE "organizationId"='${ORG}' AND "id" LIKE 'oc_t8b_%'
                   AND ${PK('"occurredAt"')} = '${periodKey}') AS outcomes,
              (SELECT COUNT(*) FROM "Outcome"
                 WHERE "organizationId"='${ORG}' AND "id" LIKE 'oc_t8b_%' AND "verificationLevel" <> 'SELF_REPORTED'
                   AND ${PK('"occurredAt"')} = '${periodKey}') AS verifications`,
      args: [],
    })
    return res.rows[0]
  }

  const cur = await countIn(periodNow)
  const prev = await countIn(periodPrev)
  const evRow = (await client.execute({
    sql: `SELECT COUNT(*) AS n FROM "BillingEvent" WHERE "organizationId"='${ORG}'`,
    args: [],
  })).rows[0]

  console.log(`\n✅ T08 计费夹具已播种：${DB_FILE}`)
  console.log(`   当期 ${periodNow} · 上一期 ${periodPrev}`)
  console.log(`\n   —— A. 当期（${periodNow}）用量事实（org_e2e，对账脚本会独立复算同一组数字）——`)
  console.log(`   proposal=${cur.proposals}  introduction=${cur.introductions}  outcome=${cur.outcomes}  verification=${cur.verifications}`)
  console.log(`   全期合计（含跨期噪声，账本里会有两期行）：`)
  console.log(`   proposal=${Number(cur.proposals) + Number(prev.proposals)}  introduction=${Number(cur.introductions) + Number(prev.introductions)}  outcome=${Number(cur.outcomes) + Number(prev.outcomes)}  verification=${Number(cur.verifications) + Number(prev.verifications)}`)
  console.log('\n   —— B. 噪声（证明过滤承重）——')
  console.log(`   跨期（${periodPrev}）各单元应各为 1 ⇒ 上面的"当期"必须**不含**它们`)
  console.log(`   跨租户 ${ORG_OTHER} 另有 +1 提案 / +1 成果（已验证）⇒ 当期必须**不含**它们`)
  console.log('\n   —— C. 账本终态（org_e2e）——')
  console.log(`   eventCount=${evRow.n}  plan=STARTER  status=REFUNDED`)
  console.log('   paid=3000  refunded=2000  net=1000  lastPlanChangeDirection=DOWNGRADE')
  console.log('   charges=[ch_t8b_1 SUCCEEDED, ch_t8b_2 FAILED, ch_t8b_3 REFUNDED]')
  console.log('   🔴 gatewayStatus=SUCCEEDED 的事件数必须为 0（沙箱不得冒充真实受理）')
  console.log('\n   下一步：BILLING_ORG_ID=org_e2e DATABASE_URL=file:' + DB_FILE)
  console.log('           npx tsx scripts/qa/emit-billing.mts > /tmp/t08-billing-api.json')
  client.close()
}

main().catch((err) => {
  console.error('❌ T08 计费夹具准备失败：', err?.message || err)
  process.exit(1)
})
