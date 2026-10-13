#!/usr/bin/env node
/**
 * T08 · 商业指标 **SQL 对账**（AC-16 的"复算一侧"）
 *
 * ═══════════════════════════════════════════════════════════════
 * 它证明什么
 * ═══════════════════════════════════════════════════════════════
 * AC-16 的判据：**API 下发的每个数字，都能被原始表 SQL 独立算出同一个值**。
 *
 * 本脚本就是那条判据的机械实现：
 *   ① 吃一份 API 响应（`--api=<file>`，由 `emit-outcome-metrics.mts` 产出，
 *      或在 http 模式下直接落盘的响应体）；
 *   ② 用**原始表 SQL** 把 8 个计数各重算一遍（不 import 任何业务代码，
 *      所以它不是"把服务的答案抄一遍"）；
 *   ③ 用响应**自己声明的假设**（`basis.assumptions`）与**自己声明的级别集合**
 *      （`basis.verifiedLevels`）复算工时与成本；
 *   ④ 逐字段比对，全等 → exit 0；任一不等 → exit 1 并指出**是哪个字段**。
 *
 * ⚠️ 为什么假设从响应里读、而不是在这里再写一份常量：
 *    如果脚本自带一份单价表，那么"改代码没改脚本"会让两边**同时**错，对账变成
 *    互相给对方盖章。让响应自描述，才能让"代码改了、数字变了、脚本立刻报错"。
 *
 * ⚠️ 为什么这个脚本用 `.mjs` 而不是 `.mts`：
 *    它**故意不依赖任何 TS 源码** —— 只用原始 SQL。`.mjs` 由
 *    `npm run check:script-decls` 守着（tsc 覆盖不到 `.mjs`，那正是它需要的守卫）。
 *
 * 用法:
 *   METRICS_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-metrics.db \
 *     node scripts/qa/outcome-reconcile.mjs --api=/tmp/t08-metrics-api.json
 *   … --api=… --mission-id=mission_t08_metrics     # 校验任务内收窄
 */

import fs from 'node:fs'
import { createClient } from '@libsql/client'

// ─────────────────────────────────────────────────────────────
// 参数
// ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq === -1) out[a.slice(2)] = true
      else out[a.slice(2, eq)] = a.slice(eq + 1)
    } else {
      out._.push(a)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const API_FILE = typeof args.api === 'string' ? args.api : process.env.METRICS_API_FILE || ''
const ORG = typeof args.org === 'string' ? args.org : process.env.METRICS_ORG_ID || ''
const MISSION = typeof args['mission-id'] === 'string' ? args['mission-id'] : process.env.METRICS_MISSION_ID || ''
const DB_URL = (process.env.DATABASE_URL || '').trim()
const AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim()

let pass = 0
let fail = 0
const mismatches = []

function ck(label, ok, extra = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  if (ok) pass += 1
  else {
    fail += 1
    mismatches.push(`${label}${extra ? '  ' + extra : ''}`)
  }
}

// ─────────────────────────────────────────────────────────────
// 数值口径 —— 必须与 src/lib/outcome/metrics.ts **逐字**一致
//   （round1 = 百分比；round2 = 小时 / 主币种金额）
// ─────────────────────────────────────────────────────────────

const round1 = (x) => Math.round(x * 10) / 10
const round2 = (x) => Math.round(x * 100) / 100

function percent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return round1((numerator / denominator) * 100)
}

const UNIT_ORDER = ['proposal', 'introduction', 'outcome', 'verification']

// ─────────────────────────────────────────────────────────────
// 载荷
// ─────────────────────────────────────────────────────────────

function readPayload() {
  if (!API_FILE) {
    throw new Error('缺少 --api=<file>（或 METRICS_API_FILE）—— 先跑 emit-outcome-metrics.mts 产出它')
  }
  const raw = JSON.parse(fs.readFileSync(API_FILE, 'utf8'))
  // 允许两种输入：`success()` 信封（{success,data}）或裸 data。
  const data = raw && typeof raw === 'object' && raw.data ? raw.data : raw
  if (!data || typeof data !== 'object' || !data.funnel || !data.cost || !data.basis) {
    throw new Error(`载荷形状不对（缺 funnel/cost/basis）：${API_FILE}`)
  }
  return data
}

// ─────────────────────────────────────────────────────────────
// 原始表 SQL 计数
// ─────────────────────────────────────────────────────────────

async function scalar(client, sql, argsList) {
  // ⚠️ libSQL 的 execute() 返回 `{rows}`（不是数组）—— 踩过一次，别写 `(await execute())[0]`。
  const res = await client.execute({ sql, args: argsList })
  return Number(res.rows[0].n)
}

async function collectCounts(client, missionId, verifiedLevels) {
  const missionClause = missionId ? ' AND "missionId" = ?' : ''
  const m = missionId ? [missionId] : []
  const inClause = verifiedLevels.map(() => '?').join(',')

  const proposals = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ?${missionClause}`,
    [ORG, ...m]
  )
  const consentPending = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ? AND "status" = 'CONSENT_PENDING'${missionClause}`,
    [ORG, ...m]
  )
  const mutuallyAccepted = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ? AND "status" = 'MUTUALLY_ACCEPTED'${missionClause}`,
    [ORG, ...m]
  )
  const introduced = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ? AND "introducedAt" IS NOT NULL${missionClause}`,
    [ORG, ...m]
  )
  const outcomesReported = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "Outcome" WHERE "organizationId" = ?${missionClause}`,
    [ORG, ...m]
  )
  const outcomesVerified = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "Outcome" WHERE "organizationId" = ? AND "verificationLevel" IN (${inClause})${missionClause}`,
    [ORG, ...verifiedLevels, ...m]
  )
  const takeovers = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "WorkflowJob" WHERE "organizationId" = ? AND "status" = 'TAKEN_OVER'${missionClause}`,
    [ORG, ...m]
  )
  const deadLettered = await scalar(
    client,
    `SELECT COUNT(*) AS n FROM "WorkflowJob" WHERE "organizationId" = ? AND "status" = 'DEAD'${missionClause}`,
    [ORG, ...m]
  )

  return {
    proposals,
    consentPending,
    mutuallyAccepted,
    introduced,
    outcomesReported,
    outcomesVerified,
    takeovers,
    deadLettered,
  }
}

// ─────────────────────────────────────────────────────────────
// 复算期望值
// ─────────────────────────────────────────────────────────────

function expectedFunnel(counts) {
  // ⚠️ 只取**漏斗自己的 6 个字段**（别把 takeovers/deadLettered 一起摊进来 ——
  //    那属于 workload；第一次写就犯过这个错，被本脚本自己的键集断言抓出来）。
  return {
    proposals: counts.proposals,
    consentPending: counts.consentPending,
    mutuallyAccepted: counts.mutuallyAccepted,
    introduced: counts.introduced,
    outcomesReported: counts.outcomesReported,
    outcomesVerified: counts.outcomesVerified,
    rates: {
      acceptedPerProposal: percent(counts.mutuallyAccepted, counts.proposals),
      introducedPerAccepted: percent(counts.introduced, counts.mutuallyAccepted),
      outcomePerIntroduced: percent(counts.outcomesReported, counts.introduced),
      verifiedPerOutcome: percent(counts.outcomesVerified, counts.outcomesReported),
    },
  }
}

function expectedWorkload(counts, assumptions) {
  const interventions = counts.takeovers + counts.deadLettered
  const minutes = interventions * assumptions.minutesPerIntervention
  return {
    takeovers: counts.takeovers,
    deadLettered: counts.deadLettered,
    interventions,
    minutesPerIntervention: assumptions.minutesPerIntervention,
    estimatedHumanMinutes: minutes,
    estimatedHumanHours: round2(minutes / 60),
  }
}

function expectedCost(counts, assumptions) {
  const units = {
    proposal: counts.proposals,
    introduction: counts.introduced,
    outcome: counts.outcomesReported,
    verification: counts.outcomesVerified,
  }
  const lineItems = UNIT_ORDER.map((unit) => {
    const unitCostCents = assumptions.unitCostsCents[unit] || 0
    return { unit, units: units[unit], unitCostCents, costCents: units[unit] * unitCostCents }
  })
  const totalCostCents = lineItems.reduce((s, i) => s + i.costCents, 0)
  return {
    currency: assumptions.currency,
    lineItems,
    totalCostCents,
    totalCost: round2(totalCostCents / 100),
  }
}

// ─────────────────────────────────────────────────────────────
// 逐字段比对
// ─────────────────────────────────────────────────────────────

function cmpNumbers(section, actualObj, expectedObj, fields) {
  for (const f of fields) {
    const a = actualObj[f]
    const e = expectedObj[f]
    ck(`${section}.${f}`, Object.is(a, e), a === e ? `${e}` : `API=${a} SQL=${e}`)
  }
}

function cmpJson(section, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  ck(section, a === e, a === e ? '' : `\n      API=${a}\n      SQL=${e}`)
}

/**
 * 字段集必须一致 —— 这条断言的价值在于**两个方向**都能抓：
 *   · API 多下发一个字段（本脚本不认识它 → 说明它是没人复算过的"野生数字"）；
 *   · API 少下发一个字段（本脚本算了但服务没给 → 说明有指标没进响应）。
 * 只比对共同字段会让上面两种漂移都静默通过。
 */
function cmpKeys(section, actualObj, expectedObj) {
  const a = Object.keys(actualObj).sort().join(',')
  const e = Object.keys(expectedObj).sort().join(',')
  ck(`${section} 字段集一致`, a === e, a === e ? '' : `API=[${a}] SQL=[${e}]`)
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

async function main() {
  if (!ORG) throw new Error('缺少组织 id —— 用 --org=<id> 或 METRICS_ORG_ID')
  if (!DB_URL) throw new Error('缺少 DATABASE_URL（对账要直连同一个库）')

  const api = readPayload()
  const basis = api.basis
  const assumptions = basis.assumptions
  const verifiedLevels = basis.verifiedLevels

  console.log(`\n📄 载荷：${API_FILE}`)
  console.log(`🏢 组织：${ORG}   任务：${MISSION || '(全租户)'}   库：${DB_URL.replace(/\/\/.*@/, '//***@')}`)

  // ── 0. 先验自身：口径自描述且自洽（错了就没必要往下算）──
  console.log('\n[0] 载荷自洽性')
  ck('basis.scope === all-time（本口径不做时间窗口）', basis.scope === 'all-time', `scope=${basis.scope}`)
  ck(
    'basis.missionId 与本次调用一致（防"用全量响应去对账任务内计数"）',
    (basis.missionId || '') === MISSION,
    `API=${basis.missionId} CLI=${MISSION || '(空)'}`
  )
  ck(
    '🔴 basis.verifiedLevels 不含 SELF_REPORTED（与 isVerified 同一判据）',
    Array.isArray(verifiedLevels) && verifiedLevels.length > 0 && !verifiedLevels.includes('SELF_REPORTED'),
    JSON.stringify(verifiedLevels)
  )
  ck(
    'basis.assumptions 齐备（单价 4 项 + 每次介入分钟数）',
    Boolean(assumptions) &&
      UNIT_ORDER.every((u) => Number.isFinite(assumptions.unitCostsCents?.[u])) &&
      Number.isFinite(assumptions.minutesPerIntervention),
    ''
  )
  if (fail > 0) {
    console.log('\n❌ 载荷本身不自洽，停止对账。')
    return
  }

  // ── 1. 原始表 SQL 复算 ──
  const client = createClient({ url: DB_URL, ...(AUTH_TOKEN ? { authToken: AUTH_TOKEN } : {}) })
  let counts
  try {
    counts = await collectCounts(client, MISSION || null, verifiedLevels)
  } finally {
    client.close()
  }

  console.log('\n[1] 计数（原始表 SQL 独立算出）')
  for (const [k, v] of Object.entries(counts)) console.log(`      ${k.padEnd(18)} = ${v}`)

  // ── 2. 漏斗 ──
  console.log('\n[2] 漏斗（计数 + 四段转化率）')
  cmpKeys('funnel', api.funnel, expectedFunnel(counts))
  cmpJson('funnel', api.funnel, expectedFunnel(counts))

  // ── 3. 人工工时 ──
  console.log('\n[3] 人工工时')
  cmpKeys('workload', api.workload, expectedWorkload(counts, assumptions))
  cmpJson('workload', api.workload, expectedWorkload(counts, assumptions))

  // ── 4. 任务成本 ──
  console.log('\n[4] 任务成本')
  cmpKeys('cost', api.cost, expectedCost(counts, assumptions))
  cmpJson('cost', api.cost, expectedCost(counts, assumptions))
  cmpNumbers('cost', api.cost, expectedCost(counts, assumptions), ['totalCostCents', 'totalCost'])

  // ── 5. 顶层币种 ──
  console.log('\n[5] 顶层字段')
  ck('currency === basis.assumptions.currency', api.currency === assumptions.currency, `${api.currency}`)
  ck(
    'cost.lineItems 顺序与单元顺序一致（对账按顺序比对）',
    Array.isArray(api.cost.lineItems) &&
      JSON.stringify(api.cost.lineItems.map((i) => i.unit)) === JSON.stringify(UNIT_ORDER),
    ''
  )
}

main()
  .then(() => {
    console.log(`\n${fail === 0 ? '✅ 对账通过' : '❌ 对账失败'}：${pass} 通过 / ${fail} 不一致`)
    if (fail > 0) {
      console.log('\n不一致明细：')
      for (const m of mismatches) console.log(`  · ${m}`)
    }
    process.exit(fail === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('\n❌ 对账脚本异常：', err?.message || err)
    process.exit(1)
  })
