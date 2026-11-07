#!/usr/bin/env node
/**
 * V20.5 · Batch 4 —— Outcome 核验的**正例阶梯**（自报 → 对手方确认 → 外部核验）
 *
 * 为什么另写一个脚本，而不是重跑 `v198-agent-consent-outcome.mjs`：
 *   v198 覆盖的是 A01–A12 / O-01 的**广**（Agent 执行、审批、降级、跨租户……），
 *   其中关于成果只有 A-10「未验证 → SELF_REPORTED」与 A-11「对手方确认」两条 ——
 *   也就是说：**从没有一条断言走过 `EXTERNALLY_VERIFIED`**。
 *   而主指令对 Batch 4 的要求恰恰是「**尤其是 Outcome Verify 真实正例路径**」。
 *   本脚本补的就是这条正例，并把"不得仅凭自述标为已验证"拆成可失败的四条负例。
 *
 * 另：v198 拒绝远程库（只吃本地 file: 库 + dev 服务 + stub provider）。
 * 本脚本面向**生产构建 + 真实 Turso** 跑，因此夹具必须自成一体、可完整回收。
 * 两者不是替代关系：v198 管广度与 Agent 侧，本脚本管成果核验的**深度**。
 *
 * 覆盖：
 *   P01 自报 → 201 / SELF_REPORTED / verified=false
 *   P02 列表 `?verified=1` 不含它；`unverifiedCount` 把它算进"未验证"
 *   P03 上报体里塞 `verificationLevel` / `level` → **被忽略**（级别不由客户端写入）
 *   P04 summary 自述"已验证 / verified / done" → 级别不变（文本不参与派生）
 *   P05 上报者确认自己的成果 → 400（不是"能确认"）
 *   P06 非当事方（ADMIN 但既非 reporter 也非 counterparty）确认 → 403
 *   P07 对手方确认 → COUNTERPARTY_CONFIRMED / verified=true / created=true
 *   P08 重复确认 → created=false 且记录数仍为 1（幂等，不是"多一条"）
 *   P09 ADMIN 外部核验 → EXTERNALLY_VERIFIED / verified=true
 *   P10 evidence **落库**但**不外发**（DTO 里没有这个字段）
 *   P11 重复核验 → created=false（幂等）
 *   P12 跨租户核验 → 404（不泄露存在性）
 *   P13 审计三类事件各 ≥1（reported / confirmed / verified）
 *   P14 `Outcome.verificationLevel` 快照 == 记录集派生值（无漂移）
 *   P15 级别只前进：核验后 `LEVEL_ORDER` 索引单调不减，且不会被"自报"覆盖
 *
 * 用法：
 *   node scripts/qa/v205-outcome-verify.mjs --base=http://localhost:3111
 *   node scripts/qa/v205-outcome-verify.mjs --base=https://app.lokfeel.com
 *
 * 夹具：`v205b4_*` 前缀，开跑前自清理 + 结束 finally 清理（--keep 可保留用于取证）。
 */

import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createClient } from '@libsql/client'

const ROOT = path.resolve(import.meta.dirname, '../..')
const parseEnv = (f) => {
  const out = {}
  if (!fs.existsSync(f)) return out
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}
const env = { ...parseEnv(path.join(ROOT, '.env')), ...parseEnv(path.join(ROOT, '.env.local')) }

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const BASE = argOf('base', 'https://app.lokfeel.com').replace(/\/$/, '')
const KEEP = argv.includes('--keep')

const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows
const one = async (sql, args = []) => (await q(sql, args))[0] ?? null

// ── 夹具 ────────────────────────────────────────────────────────────
const TAG = Date.now().toString(36)
const F = {
  org: 'v205b4_org',
  org2: 'v205b4_org2',
  uReporter: 'v205b4_reporter',
  uCounterparty: 'v205b4_counterparty',
  uAdmin: 'v205b4_admin',
  uForeign: 'v205b4_foreign',
  mission: 'v205b4_mission',
  proposal: 'v205b4_proposal',
  proposalForeign: 'v205b4_proposal2',
  missionForeign: 'v205b4_mission2',
  password: `${['v205', 'b4', TAG].join('-')}!A9`,
  email: (k) => `${k}@example.invalid`,
}

const results = []
const mark = { PASS: '✓', FAIL: '✗', SKIP: '–', NOT_TESTED: '?', BLOCKED: '!' }
const record = (id, verdict, detail) => {
  results.push({ id, verdict, detail })
  console.log(`  ${mark[verdict] ?? '·'} ${id.padEnd(6)} ${detail}`)
}
const ok = (id, cond, detail) => record(id, cond ? 'PASS' : 'FAIL', detail)

async function cleanup() {
  const steps = [
    [`DELETE FROM "OutcomeVerification" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "Outcome" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "IntroductionWorkflow" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "ProposalDecision" WHERE proposalId IN (?,?)`, [F.proposal, F.proposalForeign]],
    [`DELETE FROM "ConnectionProposal" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "MissionParticipation" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "Mission" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "Notification" WHERE userId IN (?,?,?,?)`, [F.uReporter, F.uCounterparty, F.uAdmin, F.uForeign]],
    [`DELETE FROM "TenantAuditEvent" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "Membership" WHERE organizationId IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "Organization" WHERE id IN (?,?)`, [F.org, F.org2]],
    [`DELETE FROM "User" WHERE id IN (?,?,?,?)`, [F.uReporter, F.uCounterparty, F.uAdmin, F.uForeign]],
  ]
  for (const [sql, args] of steps) {
    await db.execute({ sql, args }).catch(() => {})
  }
}

async function seed() {
  const hash = bcrypt.hashSync(F.password, 10)
  const users = [
    [F.uReporter, 'V205B4 Reporter', F.email('v205b4.reporter')],
    [F.uCounterparty, 'V205B4 Counterparty', F.email('v205b4.counterparty')],
    [F.uAdmin, 'V205B4 Verifier', F.email('v205b4.verifier')],
    [F.uForeign, 'V205B4 Foreign Admin', F.email('v205b4.foreign')],
  ]
  for (const [id, name, email] of users) {
    await db.execute({
      sql: `INSERT INTO "User" ("id","name","email","password","role","tokenVersion","isBot","createdAt","updatedAt")
            VALUES (?,?,?,?,'USER',0,0,datetime('now'),datetime('now'))
            ON CONFLICT("id") DO UPDATE SET "password"=excluded."password"`,
      args: [id, name, email, hash],
    })
  }
  for (const [id, name, slug] of [
    [F.org, 'V205B4 成果核验组织', 'v205b4-org'],
    [F.org2, 'V205B4 隔离组织', 'v205b4-org2'],
  ]) {
    await db.execute({
      sql: `INSERT INTO "Organization" ("id","name","slug","status","createdAt","updatedAt")
            VALUES (?,?,?,'ACTIVE',datetime('now'),datetime('now'))
            ON CONFLICT("id") DO UPDATE SET "name"=excluded."name"`,
      args: [id, name, slug],
    })
  }
  const members = [
    ['v205b4_mbr_rep', F.org, F.uReporter, 'MEMBER'],
    ['v205b4_mbr_cp', F.org, F.uCounterparty, 'MEMBER'],
    ['v205b4_mbr_adm', F.org, F.uAdmin, 'ADMIN'],
    ['v205b4_mbr_for', F.org2, F.uForeign, 'ADMIN'],
  ]
  for (const [id, org, user, role] of members) {
    await db.execute({
      sql: `INSERT INTO "Membership" ("id","organizationId","userId","role","status","createdAt","updatedAt")
            VALUES (?,?,?,?,'ACTIVE',datetime('now'),datetime('now'))
            ON CONFLICT("organizationId","userId") DO UPDATE SET "role"=excluded."role","status"='ACTIVE'`,
      args: [id, org, user, role],
    })
  }
  for (const [id, org, owner, title] of [
    [F.mission, F.org, F.uReporter, 'V205B4 成果核验任务'],
    [F.missionForeign, F.org2, F.uForeign, 'V205B4 隔离任务'],
  ]) {
    await db.execute({
      sql: `INSERT INTO "Mission" ("id","organizationId","ownerId","title","goal","offer","successCriteria","status","shareToken","publicPreview","createdAt","updatedAt")
            VALUES (?,?,?,?,'夹具目标','夹具供给','夹具判据','ACTIVE',?,0,datetime('now'),datetime('now'))
            ON CONFLICT("id") DO UPDATE SET "title"=excluded."title"`,
      args: [id, org, owner, title, `st_${id}_${TAG}`],
    })
  }
  // 提案已「介绍」——成果只能在连接建立之后上报（服务层硬前置）
  for (const [id, org, mid, proposer, candidate] of [
    [F.proposal, F.org, F.mission, F.uReporter, F.uCounterparty],
    [F.proposalForeign, F.org2, F.missionForeign, F.uForeign, F.uForeign],
  ]) {
    await db.execute({
      sql: `INSERT INTO "ConnectionProposal" ("id","organizationId","missionId","proposerId","candidateId","status","rationale","introducedAt","createdAt","updatedAt")
            VALUES (?,?,?,?,?,'MUTUALLY_ACCEPTED','夹具理由',datetime('now'),datetime('now'),datetime('now'))
            ON CONFLICT("id") DO UPDATE SET "introducedAt"=datetime('now'),"status"='MUTUALLY_ACCEPTED'`,
      args: [id, org, mid, proposer, candidate],
    })
  }
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password: F.password }),
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`登录失败 ${email} → ${res.status}`)
  const c = res.headers.getSetCookie?.().find((x) => /session-token/i.test(x))
  if (!c) throw new Error(`登录 ${email} 未返回 session cookie`)
  return c.split(';')[0]
}

async function api(p, { method = 'GET', body, jar } = {}) {
  const h = { Origin: BASE }
  if (jar) h.Cookie = jar
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON：由 status 断言 */
  }
  return { status: res.status, json, text }
}
const errCode = (r) => r.json?.error?.details?.code ?? r.json?.error?.code ?? null

async function main() {
  console.log(`\n目标：${BASE}\n夹具：${F.org} / ${F.proposal}\n`)
  if (!env.DATABASE_URL) {
    console.error('✗ 缺少 DATABASE_URL，无法播种夹具')
    process.exit(2)
  }

  await cleanup()
  await seed()

  const org = `?organizationId=${F.org}`
  const reporter = await login(F.email('v205b4.reporter'))
  const cp = await login(F.email('v205b4.counterparty'))
  const admin = await login(F.email('v205b4.verifier'))
  const foreign = await login(F.email('v205b4.foreign'))

  try {
    // ── P01 自报 ──
    const report = await api(`/api/v1/outcomes${org}`, {
      method: 'POST',
      jar: reporter,
      body: {
        proposalId: F.proposal,
        summary: '已完成初次引荐并对接，双方确认后续排期。',
        // 🔴 故意塞两个"客户端想直接定级"的字段（P03 验的就是它们必须被忽略）
        verificationLevel: 'EXTERNALLY_VERIFIED',
        level: 'EXTERNALLY_VERIFIED',
      },
    })
    const outcomeId = report.json?.data?.id ?? null
    ok(
      'P01',
      report.status === 201 && report.json?.data?.verificationLevel === 'SELF_REPORTED' && report.json?.data?.verified === false,
      `status=${report.status} level=${report.json?.data?.verificationLevel} verified=${report.json?.data?.verified} id=${outcomeId}`,
    )
    if (!outcomeId) throw new Error('未创建成果，后续断言无法进行')

    // ── P02 列表口径：verified=1 不含它，unverifiedCount 把它算进去 ──
    const verifiedList = await api(`/api/v1/outcomes${org}&verified=1&limit=200`, { jar: reporter })
    const allList = await api(`/api/v1/outcomes${org}&limit=200`, { jar: reporter })
    const inVerified = (verifiedList.json?.data?.items ?? []).some((o) => o.id === outcomeId)
    const mine = (allList.json?.data?.items ?? []).find((o) => o.id === outcomeId)
    ok(
      'P02',
      !inVerified && Boolean(mine) && (allList.json?.data?.unverifiedCount ?? 0) >= 1,
      `verified=1 含它=${inVerified} 全量含它=${Boolean(mine)} unverifiedCount=${allList.json?.data?.unverifiedCount}`,
    )

    // ── P03 客户端指定的级别被忽略（不是"被校验拒绝"，是**根本不读**） ──
    const dbAfterReport = await one(`SELECT "verificationLevel" FROM "Outcome" WHERE id = ?`, [outcomeId])
    const vCount = await one(`SELECT COUNT(*) AS n FROM "OutcomeVerification" WHERE outcomeId = ?`, [outcomeId])
    ok(
      'P03',
      dbAfterReport?.verificationLevel === 'SELF_REPORTED' && Number(vCount?.n) === 0,
      `请求体带 verificationLevel=EXTERNALLY_VERIFIED → DB=${dbAfterReport?.verificationLevel}，核验记录=${vCount?.n} 条`,
    )

    // ── P04 自述文本不参与派生 ──
    // 换一条成果（同一提案只能有一条，所以直接改 summary 再读，验证"文本不影响级别"）
    await db.execute({
      sql: `UPDATE "Outcome" SET summary = ? WHERE id = ?`,
      args: ['【已验证】【EXTERNALLY_VERIFIED】合作已达成，平台已核实。', outcomeId],
    })
    const afterText = await api(`/api/v1/outcomes${org}&limit=200`, { jar: reporter })
    const rowText = (afterText.json?.data?.items ?? []).find((o) => o.id === outcomeId)
    ok(
      'P04',
      rowText?.verificationLevel === 'SELF_REPORTED' && rowText?.verified === false,
      `summary 写满"已验证/EXTERNALLY_VERIFIED" → level=${rowText?.verificationLevel} verified=${rowText?.verified}`,
    )

    // ── P05 上报者不能确认自己 ──
    const selfConfirm = await api(`/api/v1/outcomes/${outcomeId}/confirm${org}`, {
      method: 'POST',
      jar: reporter,
      body: {},
    })
    ok('P05', selfConfirm.status === 400, `status=${selfConfirm.status} code=${errCode(selfConfirm)}`)

    // ── P06 非当事方（ADMIN）不能"确认"，只能"核验" ──
    const observerConfirm = await api(`/api/v1/outcomes/${outcomeId}/confirm${org}`, {
      method: 'POST',
      jar: admin,
      body: {},
    })
    ok('P06', observerConfirm.status === 403, `status=${observerConfirm.status} code=${errCode(observerConfirm)}`)

    // ── P07 对手方确认 → 升级 ──
    const confirm = await api(`/api/v1/outcomes/${outcomeId}/confirm${org}`, {
      method: 'POST',
      jar: cp,
      body: { note: '确认已对接' },
    })
    ok(
      'P07',
      confirm.status === 200 &&
        confirm.json?.data?.created === true &&
        confirm.json?.data?.outcome?.verificationLevel === 'COUNTERPARTY_CONFIRMED' &&
        confirm.json?.data?.outcome?.verified === true,
      `status=${confirm.status} created=${confirm.json?.data?.created} level=${confirm.json?.data?.outcome?.verificationLevel} verified=${confirm.json?.data?.outcome?.verified}`,
    )

    // ── P08 重复确认幂等 ──
    const confirm2 = await api(`/api/v1/outcomes/${outcomeId}/confirm${org}`, {
      method: 'POST',
      jar: cp,
      body: {},
    })
    const cpRows = await one(
      `SELECT COUNT(*) AS n FROM "OutcomeVerification" WHERE outcomeId = ? AND level = 'COUNTERPARTY_CONFIRMED'`,
      [outcomeId],
    )
    ok(
      'P08',
      confirm2.status === 200 && confirm2.json?.data?.created === false && Number(cpRows?.n) === 1,
      `第二次 created=${confirm2.json?.data?.created}，COUNTERPARTY_CONFIRMED 记录=${cpRows?.n} 条`,
    )

    // ── P09 外部核验（正例路径） ──
    const evidenceText = `合同扫描件 sha256=${'a'.repeat(64)}；对账流水 2026-11 已归档`
    const verify = await api(`/api/v1/outcomes/${outcomeId}/verify${org}`, {
      method: 'POST',
      jar: admin,
      body: { evidence: evidenceText, note: '已核对合同与流水' },
    })
    ok(
      'P09',
      verify.status === 200 &&
        verify.json?.data?.outcome?.verificationLevel === 'EXTERNALLY_VERIFIED' &&
        verify.json?.data?.outcome?.verified === true,
      `status=${verify.status} level=${verify.json?.data?.outcome?.verificationLevel} verified=${verify.json?.data?.outcome?.verified}`,
    )

    // ── P10 evidence 落库但不外发 ──
    const dbEvidence = await one(
      `SELECT evidence FROM "OutcomeVerification" WHERE outcomeId = ? AND level = 'EXTERNALLY_VERIFIED'`,
      [outcomeId],
    )
    const dtoText = JSON.stringify(verify.json?.data ?? {})
    ok(
      'P10',
      Boolean(dbEvidence?.evidence) && !dtoText.includes('sha256') && !/evidence/.test(dtoText),
      `DB 有 evidence（${String(dbEvidence?.evidence ?? '').length} 字符）；响应体出现 evidence 字段=${/evidence/.test(dtoText)}`,
    )

    // ── P11 重复核验幂等 ──
    const verify2 = await api(`/api/v1/outcomes/${outcomeId}/verify${org}`, {
      method: 'POST',
      jar: admin,
      body: { evidence: 'again' },
    })
    const extRows = await one(
      `SELECT COUNT(*) AS n FROM "OutcomeVerification" WHERE outcomeId = ? AND level = 'EXTERNALLY_VERIFIED'`,
      [outcomeId],
    )
    ok(
      'P11',
      verify2.status === 200 && verify2.json?.data?.created === false && Number(extRows?.n) === 1,
      `第二次 created=${verify2.json?.data?.created}，EXTERNALLY_VERIFIED 记录=${extRows?.n} 条`,
    )

    // ── P12 跨租户核验 → 404 ──
    const cross = await api(`/api/v1/outcomes/${outcomeId}/verify?organizationId=${F.org2}`, {
      method: 'POST',
      jar: foreign,
      body: { evidence: 'x' },
    })
    ok(
      'P12',
      cross.status === 404,
      `别的租户的 ADMIN 核验本租户成果 → status=${cross.status} code=${errCode(cross)}`,
    )

    // ── P13 审计三类事件 ──
    const audits = await q(
      `SELECT eventType, COUNT(*) AS n FROM "TenantAuditEvent"
       WHERE organizationId = ? AND resourceId = ? GROUP BY eventType`,
      [F.org, outcomeId],
    )
    const auditMap = Object.fromEntries(audits.map((r) => [r.eventType, Number(r.n)]))
    // ⚠️ 事件名是 `outcome.externally_verified`，不是 `outcome.verified` ——
    //    首跑 P13 判红就是因为我按"直觉"猜了名字。事件名属于**产品契约**，
    //    不能凭手感写；这里改成同时断三个真实事件（见 lib/outcome/outcomes.ts 的 eventType）。
    ok(
      'P13',
      auditMap['outcome.reported'] >= 1 &&
        auditMap['outcome.confirmed'] >= 1 &&
        auditMap['outcome.externally_verified'] >= 1,
      `审计=${JSON.stringify(auditMap)}`,
    )

    // ── P14 快照 == 派生值（无漂移） ──
    const records = await q(`SELECT level FROM "OutcomeVerification" WHERE outcomeId = ?`, [outcomeId])
    const ORDER = ['SELF_REPORTED', 'COUNTERPARTY_CONFIRMED', 'EXTERNALLY_VERIFIED']
    const derived = records.reduce(
      (best, r) => (ORDER.indexOf(r.level) > ORDER.indexOf(best) ? r.level : best),
      'SELF_REPORTED',
    )
    const snapshot = await one(`SELECT "verificationLevel" FROM "Outcome" WHERE id = ?`, [outcomeId])
    ok(
      'P14',
      snapshot?.verificationLevel === derived,
      `记录集=${records.map((r) => r.level).join(',')} → 派生=${derived}；快照=${snapshot?.verificationLevel}`,
    )

    // ── P15 级别只前进：再"自报"一次不能把级别打回去 ──
    const replayReport = await api(`/api/v1/outcomes${org}`, {
      method: 'POST',
      jar: reporter,
      body: { proposalId: F.proposal, summary: '重复上报一条（应冲突，不应重置级别）' },
    })
    const snapshot2 = await one(`SELECT "verificationLevel" FROM "Outcome" WHERE id = ?`, [outcomeId])
    ok(
      'P15',
      replayReport.status === 409 && snapshot2?.verificationLevel === 'EXTERNALLY_VERIFIED',
      `重复上报=${replayReport.status}（期望 409），级别仍=${snapshot2?.verificationLevel}`,
    )
  } finally {
    if (!KEEP) {
      await cleanup()
      console.log('\n✓ 夹具已清理（--keep 可保留）')
    } else {
      console.log('\n· 夹具保留（--keep）')
    }
  }

  const count = (v) => results.filter((r) => r.verdict === v).length
  console.log(
    `\n${count('PASS')} PASS / ${count('FAIL')} FAIL / ${count('SKIP')} SKIP / ${count('NOT_TESTED')} NOT_TESTED`,
  )
  const fails = results.filter((r) => r.verdict === 'FAIL')
  if (fails.length) {
    console.log('\n失败项：')
    for (const r of fails) console.log(`  - ${r.id}: ${r.detail}`)
  }
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('复验脚本异常：', e?.message ?? e)
  await cleanup().catch(() => {})
  process.exit(2)
})
