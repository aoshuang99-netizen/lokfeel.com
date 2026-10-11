#!/usr/bin/env node
/**
 * T05 · Consent & Trust（双边同意 / 撤回 / 介绍）E2E 夹具
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么本脚本**另开一条 Mission**（而不是往 `mission_e2e_active` 里塞）
 * ═══════════════════════════════════════════════════════════════
 *
 * 第一版曾把提案挂在 `mission_e2e_active` 上，随即发现它会**改变 T04 的断言输入**：
 * 召回是按"该 Mission 下的 SocialIntent"遍历的，多三条意图就会让
 * `considered` 从 2 变成 5；若让它们不参与任务，`gatedOut.not_participant` 又会变。
 * 也就是说：**只要往那条 Mission 里加人，T04 的 E2E 数字就必须跟着改** ——
 * 那等于把两条用例的成败绑在一起，一处失败无法判断是谁弄坏的。
 *
 * 因此本脚本建一条**独立 Mission** `mission_e2e_t05`（同 org、同 token 命名风格），
 * 自己带一套意图/参与关系/提案。`mission_e2e_active` 一个字节都不动，
 * T04 的 E2E 断言保持原样。
 *
 * 播种内容（全部落在 `mission_e2e_t05`）：
 *   - 复用 T02/T04 已建用户：`u_e2e_member`（被介绍方 / 登录者）、`u_e2e_peer`、`u_e2e_noise`；
 *   - 新建 `u_e2e_op`（**OPERATOR** —— 介绍是运营动作，需要真实角色）、
 *     `u_e2e_t05a`（普通成员，用于"我是发起方"的提案）、
 *     `u_e2e_t05b`（普通成员，披露表含 `age:COUNTERPARTY`，用于**档位升级**判据）。
 *
 * 六条提案，每条只证一件事（互不重叠，失败即可定位）：
 *   | id | 发起方 → 被介绍方 | 状态 | 决策 | 用于断言 |
 *   |---|---|---|---|---|
 *   | `cp_e2e_decline`  | t05a → member  | CONSENT_PENDING   | 无                 | **拒绝**：member 点拒绝 → 立刻终态「已拒绝」（AC-05） |
 *   | `cp_e2e_pending`  | op → member    | CONSENT_PENDING   | op=ACCEPT          | member 点同意 → **双方已同意**（仍非已连接） |
 *   | `cp_e2e_mine`     | member → t05a  | CONSENT_PENDING   | 无                 | **单方同意仍是待决**（AC-04 核心） |
 *   | `cp_e2e_mutual`   | peer → member  | MUTUALLY_ACCEPTED | peer+member=ACCEPT | 「双方同意但未介绍」≠ 已连接；档位仍是 CANDIDATE；**撤回**（AC-05） |
 *   | `cp_e2e_intro`    | t05b → member  | MUTUALLY_ACCEPTED | t05b+member=ACCEPT | 已建立连接；档位升级为 **COUNTERPARTY**（age 可见） |
 *   | `cp_e2e_rejected` | noise → member | REJECTED          | noise=REJECT       | 终态进入「已结束」，不再有任何动作 |
 *
 * ⚠️ `cp_e2e_decline`（t05a → member）与 `cp_e2e_mine`（member → t05a）是**方向相反的两条
 *    独立提案**。为什么不让 t05a 省掉这条：AC-05 的「拒绝」需要一个**我尚未表态、且他人
 *    未替我表态**的待决提案 —— 而 member 与其余每个人的配对都已被上表占用（唯一键
 *    `(missionId, proposerId, candidateId)`），复用任何一条都会把两条用例的成败绑在一起。
 *    两人互提在现实里也真实存在，因此这里刻意保留这一对反向提案。
 *
 * 披露设计（本夹具的负测核心）：
 *   - `t05b`：`{displayName: CANDIDATE, age: COUNTERPARTY, bio: ORGANIZER}`
 *     → 介绍**落地后** member 应以 COUNTERPARTY 档看它：昵称 + 年龄可见，简介不可见。
 *       若档位升级没生效（错写成 CANDIDATE），年龄就**看不到** —— 可证伪。
 *   - `peer`：`{displayName: CANDIDATE, city: CANDIDATE, age: COUNTERPARTY, bio: ORGANIZER}`
 *     → `cp_e2e_mutual` 尚未介绍，member 仍以 CANDIDATE 档看它：**年龄 47 与简介都不得出现**。
 *       与上一条互为对照：若把判据写成"同意即升级"，47 就会漏出来。
 *
 * 用法：
 *   node scripts/qa/seed-t02-e2e.mjs --regenerate   # 先建库与基线夹具
 *   node scripts/qa/seed-t04-e2e.mjs                # 再追加 T04 样本（本脚本复用其 peer/noise 档案）
 *   node scripts/qa/seed-t05-e2e.mjs                # 追加 T05 的独立 Mission 与提案
 */

import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

const DB_FILE = process.env.E2E_DB_FILE || '/tmp/t02-e2e.db'
const DB_URL = `file:${DB_FILE}`

const E2E = {
  orgId: 'org_e2e',
  ownerId: 'u_e2e_owner',
  // ⚠️ 独立 Mission：绝不写进 mission_e2e_active（见文件头说明）。
  missionId: 'mission_e2e_t05',
  token: 'e2eT05TokenAbcdefghijklmnopq',
  memberId: 'u_e2e_member',
  memberEmail: 'e2e.member@example.test',
  peerId: 'u_e2e_peer',
  peerEmail: 'e2e.peer@example.test',
  noiseId: 'u_e2e_noise',
  opId: 'u_e2e_op',
  opEmail: 'e2e.op@example.test',
  t05aId: 'u_e2e_t05a',
  t05aEmail: 'e2e.t05a@example.test',
  t05bId: 'u_e2e_t05b',
  t05bEmail: 'e2e.t05b@example.test',
}

/** 负测哨兵：这些值**一次都不该**出现在不该出现的卡片上。 */
const SENTINELS = {
  opEmail: E2E.opEmail,
  peerBio: '十年印尼落地经验', // peer 只授权给 ORGANIZER 的自述（继承 T04 档案值）
  peerAge: 47, // peer 授权给 COUNTERPARTY
  t05bName: '霍岩',
  t05bAge: 53, // t05b 授权给 COUNTERPARTY
  t05bBio: '这段自述只给组织者看', // t05b 只授权给 ORGANIZER
  t05aBio: '发起方不宜外泄的自述', // t05a 未授权任何档
}

const RATIONALE = {
  pending: '你们互补：他在找东南亚清关，你有雅加达落地资源。',
  mine: '你们互补：你需要分销，他能给分销。',
  mutual: '你们互补：他需要印尼渠道，你有印尼渠道。',
  intro: '你们互补：他需要合规材料，你有现成模板。',
  rejected: '你们互补：他需要冷链，你有冷链。',
  decline: '你们互补：他需要品牌设计，你有品牌设计。',
}

/** 本 Mission 的诉求正文。刻意与 `mission_e2e_active` 的文案不同主题，避免任何隐性耦合。 */
const TEXT = {
  memberNeed: '我需要能源行业的合规顾问',
  memberOffer: '我能提供能源项目的尽调资源',
  opNeed: '我想找一位懂财税的合伙人',
  opOffer: '我能提供社群运营与活动策划',
  t05aNeed: '我在找财税方向的合伙人',
  t05aOffer: '我能提供法务与合同审核',
  t05bNeed: '我需要医疗器械的注册通路',
  t05bOffer: '我能提供医疗器械的注册通路',
  peerNeed: '我需要印尼本地的渠道伙伴',
  peerOffer: '我能提供东南亚的清关资源',
  noiseNeed: '我需要摄影器材租赁',
  noiseOffer: '我能提供法语翻译',
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

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

async function upsertProfile(client, { id, userId, displayName, age, gender = 'MAN', bio, city, now }) {
  await client.execute({
    sql: `INSERT INTO "Profile" (
            "id","userId","displayName","age","gender","sexuality","bio","city",
            "occupation","company","profileStatus","onboardingStep","isApproved","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,?,?,?,?, 'APPROVED', 9, 1, ?, ?)
          ON CONFLICT("userId") DO UPDATE SET
            "displayName"=excluded."displayName","age"=excluded."age","bio"=excluded."bio",
            "city"=excluded."city","profileStatus"='APPROVED'`,
    args: [id, userId, displayName, age, gender, 'Straight', bio, city, '负责人', '示例公司', now, now],
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
      'E2E · 双边同意专项任务（T05）',
      '验证"单方同意不产生介绍、双方同意后由运营介绍、任一方可撤销"这条闭环。',
      '提供本任务内的牵线运营动作。',
      JSON.stringify(['仅用于 E2E 夹具']),
      '提案状态与披露档位在每一步都符合预期。',
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

async function upsertIntent(client, { id, userId, need, offer, disclosure, now }) {
  await client.execute({
    sql: `INSERT INTO "SocialIntent" (
            "id","organizationId","missionId","userId","need","offer","constraints","disclosure",
            "status","expiresAt","withdrawnAt","importConsentAt","importedFields","createdAt","updatedAt")
          VALUES (?,?,?,?,?,?,NULL,?,'ACTIVE',NULL,NULL,NULL,NULL,?,?)
          ON CONFLICT("missionId","userId") DO UPDATE SET
            "need"=excluded."need","offer"=excluded."offer","disclosure"=excluded."disclosure",
            "status"='ACTIVE',"withdrawnAt"=NULL,"updatedAt"=excluded."updatedAt"`,
    args: [id, E2E.orgId, E2E.missionId, userId, need, offer, disclosure, now, now],
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

async function main() {
  const client = createClient({ url: DB_URL })
  const now = nowIso()
  const password = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'
  const hash = bcrypt.hashSync(password, 10)

  // 前置：T02 夹具必须已就位（org / owner / member）；peer 与 noise 由 T04 建。
  const pre = await client.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM "Organization" WHERE "id"=?) AS org,
            (SELECT COUNT(*) FROM "User" WHERE "id"=?)         AS owner,
            (SELECT COUNT(*) FROM "User" WHERE "id"=?)         AS peer,
            (SELECT COUNT(*) FROM "User" WHERE "id"=?)         AS noise`,
    args: [E2E.orgId, E2E.ownerId, E2E.peerId, E2E.noiseId],
  })
  const p = pre.rows[0]
  if (Number(p.org) === 0 || Number(p.owner) === 0) {
    throw new Error('缺少 T02 夹具（Organization / owner）—— 请先跑：node scripts/qa/seed-t02-e2e.mjs --regenerate')
  }
  if (Number(p.peer) === 0 || Number(p.noise) === 0) {
    throw new Error('缺少 T04 夹具的 u_e2e_peer / u_e2e_noise —— 请先跑：node scripts/qa/seed-t04-e2e.mjs')
  }

  // ── 1. 独立 Mission ──
  await upsertMission(client, { now })

  // ── 1b. 清理**本脚本自己**的历史产物（幂等，且只动自己的命名空间）──
  // 为什么需要它：`seed-t02-e2e.mjs --regenerate` 只按 DDL 重建**缺失的表结构**，
  // 不会清空已有数据行。早期版本的 T05 夹具把提案挂在 `mission_e2e_active` 上，
  // 那些行会一直留着 —— 既让本脚本的 `id` 主键冲突，又让 T04 的 Mission 多出 5 条提案。
  // 先删子表（ProposalDecision）再删父表（ConnectionProposal），避免外键悬念。
  await client.execute({ sql: `DELETE FROM "ProposalDecision" WHERE "proposalId" LIKE 'cp_e2e_%'` })
  await client.execute({ sql: `DELETE FROM "ConnectionProposal" WHERE "id" LIKE 'cp_e2e_%'` })

  // ── 2. 用户（member/peer/noise 复用，若不存在则建）──
  await upsertUser(client, { id: E2E.memberId, email: E2E.memberEmail, name: 'E2E Member', hash, now })
  await upsertUser(client, { id: E2E.opId, email: E2E.opEmail, name: 'E2E Operator', hash, now })
  await upsertUser(client, { id: E2E.t05aId, email: E2E.t05aEmail, name: 'E2E T05A', hash, now })
  await upsertUser(client, { id: E2E.t05bId, email: E2E.t05bEmail, name: 'E2E T05B', hash, now })

  await upsertMembership(client, { id: 'ms_e2e_member', userId: E2E.memberId, role: 'MEMBER', now })
  // ⚠️ 运营角色是**真实**的：介绍端点要求 proposal.create（OPERATOR+）。
  await upsertMembership(client, { id: 'ms_e2e_op', userId: E2E.opId, role: 'OPERATOR', now })
  await upsertMembership(client, { id: 'ms_e2e_t05a', userId: E2E.t05aId, role: 'MEMBER', now })
  await upsertMembership(client, { id: 'ms_e2e_t05b', userId: E2E.t05bId, role: 'MEMBER', now })

  // ── 3. 档案（仅新建的三个；peer/noise 的档案由 T04 夹具负责）──
  await upsertProfile(client, {
    id: 'pf_e2e_op',
    userId: E2E.opId,
    displayName: '运营欧',
    age: 38,
    gender: 'WOMAN',
    bio: '社群主理人',
    city: '广州',
    now,
  })
  await upsertProfile(client, {
    id: 'pf_e2e_t05a',
    userId: E2E.t05aId,
    displayName: '甲乙',
    age: 31,
    bio: SENTINELS.t05aBio,
    city: '杭州',
    now,
  })
  await upsertProfile(client, {
    id: 'pf_e2e_t05b',
    userId: E2E.t05bId,
    displayName: SENTINELS.t05bName,
    age: SENTINELS.t05bAge, // 授权给 COUNTERPARTY → 只有介绍落地后才可见
    bio: SENTINELS.t05bBio, // 只授权给 ORGANIZER → 连介绍后也不可见
    city: '深圳',
    now,
  })

  // ── 4. 参与关系（本 Mission）──
  const people = [
    ['member', E2E.memberId],
    ['op', E2E.opId],
    ['t05a', E2E.t05aId],
    ['t05b', E2E.t05bId],
    ['peer', E2E.peerId],
    ['noise', E2E.noiseId],
  ]
  for (const [key, userId] of people) {
    await upsertParticipation(client, { id: `mp_t05_${key}`, userId, now })
  }

  // ── 5. 意图（本 Mission；每个提案双方都要有生效中的意图）──
  await upsertIntent(client, {
    id: 'si_t05_member',
    userId: E2E.memberId,
    need: TEXT.memberNeed,
    offer: TEXT.memberOffer,
    disclosure: JSON.stringify({ displayName: 'CANDIDATE', city: 'CANDIDATE' }),
    now,
  })
  await upsertIntent(client, {
    id: 'si_t05_op',
    userId: E2E.opId,
    need: TEXT.opNeed,
    offer: TEXT.opOffer,
    disclosure: JSON.stringify({ displayName: 'CANDIDATE' }),
    now,
  })
  await upsertIntent(client, {
    id: 'si_t05_t05a',
    userId: E2E.t05aId,
    need: TEXT.t05aNeed,
    offer: TEXT.t05aOffer,
    disclosure: JSON.stringify({ displayName: 'CANDIDATE' }),
    now,
  })
  await upsertIntent(client, {
    id: 'si_t05_t05b',
    userId: E2E.t05bId,
    need: TEXT.t05bNeed,
    offer: TEXT.t05bOffer,
    // ⚠️ 档位升级判据：age 授权给 COUNTERPARTY（介绍落地后才可见），
    //    bio 只授权给 ORGANIZER（任何成员视角都不可见）。
    disclosure: JSON.stringify({ displayName: 'CANDIDATE', age: 'COUNTERPARTY', bio: 'ORGANIZER' }),
    now,
  })
  await upsertIntent(client, {
    id: 'si_t05_peer',
    userId: E2E.peerId,
    need: TEXT.peerNeed,
    offer: TEXT.peerOffer,
    // 与 T04 同构：displayName/city 最宽，age 中档，bio 最窄。
    disclosure: JSON.stringify({
      displayName: 'CANDIDATE',
      city: 'CANDIDATE',
      age: 'COUNTERPARTY',
      bio: 'ORGANIZER',
    }),
    now,
  })
  await upsertIntent(client, {
    id: 'si_t05_noise',
    userId: E2E.noiseId,
    need: TEXT.noiseNeed,
    offer: TEXT.noiseOffer,
    disclosure: JSON.stringify({ displayName: 'CANDIDATE' }),
    now,
  })

  // ── 6. 六条提案 ──
  await upsertProposal(client, {
    id: 'cp_e2e_decline', proposerId: E2E.t05aId, candidateId: E2E.memberId,
    status: 'CONSENT_PENDING', rationale: RATIONALE.decline,
    introducedAt: null, closedAt: null, now,
  })
  await upsertProposal(client, {
    id: 'cp_e2e_pending', proposerId: E2E.opId, candidateId: E2E.memberId,
    status: 'CONSENT_PENDING', rationale: RATIONALE.pending,
    introducedAt: null, closedAt: null, now,
  })
  await upsertProposal(client, {
    id: 'cp_e2e_mine', proposerId: E2E.memberId, candidateId: E2E.t05aId,
    status: 'CONSENT_PENDING', rationale: RATIONALE.mine,
    introducedAt: null, closedAt: null, now,
  })
  await upsertProposal(client, {
    id: 'cp_e2e_mutual', proposerId: E2E.peerId, candidateId: E2E.memberId,
    status: 'MUTUALLY_ACCEPTED', rationale: RATIONALE.mutual,
    introducedAt: null, closedAt: null, now,
  })
  await upsertProposal(client, {
    id: 'cp_e2e_intro', proposerId: E2E.t05bId, candidateId: E2E.memberId,
    status: 'MUTUALLY_ACCEPTED', rationale: RATIONALE.intro,
    introducedAt: now, closedAt: null, now,
  })
  await upsertProposal(client, {
    id: 'cp_e2e_rejected', proposerId: E2E.noiseId, candidateId: E2E.memberId,
    status: 'REJECTED', rationale: RATIONALE.rejected,
    introducedAt: null, closedAt: now, now,
  })

  // ── 7. 表态记录 ──
  await upsertDecision(client, { id: 'pd_t05_p1_op', proposalId: 'cp_e2e_pending', personId: E2E.opId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t05_mu_peer', proposalId: 'cp_e2e_mutual', personId: E2E.peerId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t05_mu_me', proposalId: 'cp_e2e_mutual', personId: E2E.memberId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t05_in_t05b', proposalId: 'cp_e2e_intro', personId: E2E.t05bId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t05_in_me', proposalId: 'cp_e2e_intro', personId: E2E.memberId, decision: 'ACCEPT', now })
  await upsertDecision(client, { id: 'pd_t05_rj_noise', proposalId: 'cp_e2e_rejected', personId: E2E.noiseId, decision: 'REJECT', now })

  // ── 8. 自检：夹具本身也是可观测输出 ──
  const check = await client.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM "ConnectionProposal" WHERE "missionId"=?)          AS proposals,
            (SELECT COUNT(*) FROM "ConnectionProposal" WHERE "missionId"=? AND "introducedAt" IS NOT NULL) AS introduced,
            (SELECT COUNT(*) FROM "ProposalDecision" WHERE "proposalId" LIKE 'cp_e2e_%')  AS decisions,
            (SELECT "role" FROM "Membership" WHERE "organizationId"=? AND "userId"=?)    AS op_role,
            (SELECT COUNT(*) FROM "ConnectionProposal" WHERE "missionId"='mission_e2e_active') AS untouched`,
    args: [E2E.missionId, E2E.missionId, E2E.orgId, E2E.opId],
  })
  const row = check.rows[0]

  console.log(`\n✅ T05 提案夹具已播种：${DB_FILE}`)
  console.log(`   自检：本 Mission 提案=${row.proposals} 条（期望 6）/ 已介绍=${row.introduced} 条（期望 1）/ 表态=${row.decisions} 条（期望 6）`)
  console.log(`         运营角色=${row.op_role}（期望 OPERATOR）`)
  console.log(`   🔒 T04 的 mission_e2e_active 上提案数=${row.untouched}（期望 0 —— 证明零扰动）`)
  console.log('\n   —— Playwright 环境变量 ——')
  console.log(`   E2E_T05_MISSION_TOKEN=${E2E.token}`)
  console.log(`   E2E_MEMBER_EMAIL=${E2E.memberEmail}`)
  console.log(`   E2E_OP_EMAIL=${E2E.opEmail}`)
  console.log(`   E2E_PASSWORD=${password}`)
  console.log('\n   —— 页面分区期望（member 视角，跑用例**前**）——')
  console.log('   待处理 4：cp_e2e_decline（待我回应）、cp_e2e_pending（op 已同意）、cp_e2e_mine（你是发起方）、cp_e2e_mutual（双方已同意，等待介绍）')
  console.log('   已建立连接 1：cp_e2e_intro（t05b，COUNTERPARTY 档 → 昵称 + 年龄可见）')
  console.log('   已结束 1：cp_e2e_rejected（噪音甲）')
  console.log(`\n   —— 负测哨兵（不得出现在页面上）——`)
  console.log(`   ${SENTINELS.opEmail} / ${SENTINELS.peerBio} / ${SENTINELS.peerAge}`)
  console.log(`   ${SENTINELS.t05bBio} / ${SENTINELS.t05aBio}`)
  client.close()
}

main().catch((err) => {
  console.error('❌ T05 夹具准备失败：', err?.message || err)
  process.exit(1)
})
