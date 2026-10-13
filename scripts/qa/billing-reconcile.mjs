#!/usr/bin/env node
/**
 * T08 · 用量计费 **SQL 对账**（AC-21 的"复算一侧"）
 *
 * ═══════════════════════════════════════════════════════════════
 * 它证明什么
 * ═══════════════════════════════════════════════════════════════
 * AC-21 的判据有两半，本脚本各有一条机械实现：
 *
 *   ── ① 使用量**可复算** ─────────────────────────────────────
 *      API 下发的每个用量数字，都能被**原始表 SQL** 独立算出同一个值。
 *      并且账本行自身必须自洽（期次 = occurredAt 的 UTC 月、幂等键 = `<unit>:<sourceId>`）。
 *      对账**不 import 任何业务代码** —— 所以它不是"把服务的答案抄一遍"。
 *
 *   ── ② 退款/失败/升级/降级**状态一致** ──────────────────────
 *      API 下发的订阅状态，必须与原始事件集一致。分三层取证（由强到弱）：
 *      (a) **SQL 聚合**：`paidTotal` / `refundedTotal` / `eventCount` / 款项数
 *          —— 纯 SQL 求和，与服务的命令式折叠**不可能共享同一个 bug**；
 *      (b) **账本合法性不变量**：没有任何款项同时出现 SUCCEEDED 与 FAILED、
 *          没有 REFUNDED 而不曾 SUCCEEDED、每笔款项都有且只有一条 CREATED、
 *          结算金额与创建金额一致。这些是"一个可审计账本"的定义，与实现无关；
 *      (c) **派生复算**：按事件序列重走一遍状态投影（status/plan/方向/时间戳）。
 *          这一层是"重新推导"，与内核规则同形，故它抓的是**状态漂移**
 *          （响应与事件集不符），抓不到"内核规则本身错" —— 那由单元测试穷举覆盖。
 *      三层都通过，才说明响应里的状态不是凭空写上去的。
 *
 * ⚠️ 为什么这个脚本用 `.mjs` 而不是 `.mts`：
 *    它**故意不依赖任何 TS 源码** —— 只用原始 SQL。`.mjs` 由
 *    `npm run check:script-decls` 守着（tsc 覆盖不到 `.mjs`，那正是它需要的守卫）。
 *
 * ⚠️ 哪些值从响应里读、而不是在这里再写一份常量：
 *    · `basis.periodKey` / `periodStart` / `periodEnd`（期次与边界）
 *    · `basis.plan` / `basis.planLimits`（限额判定的**依据**）
 *    · `basis.unitMapping`（单元口径 ↔ 数据库枚举）
 *    自描述的响应才能让"改代码没改脚本"立刻报错；脚本自带常量则会让两边同时错。
 *
 * 🔴 为什么最后还要跑「变异自证」：
 *    一个"永远通过"的对账脚本与一个正确的对账脚本，在**只有一次干净跑**时长得一样。
 *    故本脚本在干净通过后，会把载荷**故意改坏**若干处并断言"必须被抓到"。
 *    没有这一步，`fail === 0` 无法排除"断言根本没生效"。
 *
 * 用法:
 *   BILLING_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t08-billing.db \
 *     node scripts/qa/billing-reconcile.mjs --api=/tmp/t08-billing-api.json
 *   … --period=2026-09     # 覆盖期次（默认取载荷声明的 periodKey）
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
const API_FILE = typeof args.api === 'string' ? args.api : process.env.BILLING_API_FILE || ''
const ORG = typeof args.org === 'string' ? args.org : process.env.BILLING_ORG_ID || ''
const PERIOD_OVERRIDE = typeof args.period === 'string' ? args.period : process.env.BILLING_PERIOD || ''
const DB_URL = (process.env.DATABASE_URL || '').trim()
const AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim()

const USAGE_UNITS = ['proposal', 'introduction', 'outcome', 'verification']
const EFFECTIVE_PLANS = ['FREE', 'STARTER', 'GROWTH', 'SCALE']
const LEDGER_CHARGE_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']
const SUBSCRIPTION_STATUSES = ['NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'REFUNDED']
const GATEWAY_STATUSES = ['CAPTURED', 'SUCCEEDED', 'FAILED']
const PLAN_ORDER = { FREE: 0, STARTER: 1, GROWTH: 2, SCALE: 3 }

// ─────────────────────────────────────────────────────────────
// 断言框架（可重复运行：供"干净跑"与"变异跑"复用）
// ─────────────────────────────────────────────────────────────

function makeChecker() {
  const lines = []
  let pass = 0
  let fail = 0
  const ck = (section, label, ok, detail = '') => {
    lines.push(`  ${ok ? '✅' : '❌'} [${section}] ${label}${detail ? '  ' + detail : ''}`)
    if (ok) pass += 1
    else fail += 1
  }
  const info = (section, label, detail = '') => {
    lines.push(`  ·  [${section}] ${label}${detail ? '  ' + detail : ''}`)
  }
  return { ck, info, lines, get pass() { return pass }, get fail() { return fail } }
}

// ─────────────────────────────────────────────────────────────
// 数值/结构工具
// ─────────────────────────────────────────────────────────────

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const asCount = (x) => Math.max(0, Math.floor(num(x)))

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameKeySet(obj, keys) {
  if (!obj || typeof obj !== 'object') return false
  const a = Object.keys(obj).sort().join(',')
  const e = [...keys].sort().join(',')
  return a === e
}

/**
 * 时间戳相等 = **同一时刻**，不是同一字符串。
 *
 * ⚠️ 库里存 `2026-01-15T12:01:00.000+00:00`（Prisma/夹具统一写 `+00:00`），
 *    而服务层 DTO 经 `toISOString()` 归一为 `2026-01-15T12:01:00.000Z`。
 *    两者是同一时刻的两种合法 ISO 表示 —— 字符串比较会**误报**不一致
 *    （这正是 `T08/risks.md` R10 说的那类陷阱：把时间语义押在字符串上）。
 *    故此处按**解析后的时刻**比较。
 */
function sameTs(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === ''
  if (b === null || b === undefined || b === '') return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return String(a) === String(b)
  return ta === tb
}

/** 期次口径（与 `periodKeyOf` 同为 UTC 自然月，但对 `Z` / `+00:00` / 空格三种写法都成立）。 */
const PK = (col) => `substr(replace(replace(${col},'Z',''),'+00:00',''),1,7)`

// ─────────────────────────────────────────────────────────────
// 原始读数（唯一做 IO 的地方 —— 之后全部走纯比较）
// ─────────────────────────────────────────────────────────────

async function fetchRaw(client, org, periodKey) {
  const q = async (sql, params = []) => (await client.execute({ sql, args: params })).rows
  const scalar = async (sql, params = []) => Number(((await q(sql, params))[0] || { n: 0 }).n)

  // ── 账本行 ──
  const ledgerRows = await q(
    `SELECT "id","unit","quantity","occurredAt","periodKey","sourceType","sourceId","dedupeKey"
       FROM "UsageRecord" WHERE "organizationId" = ?`,
    [org]
  )

  // ── 原始表事实（按期次 + 租户谓词；与账本无关的一条独立路径）──
  const rawInPeriod = {
    proposal: await scalar(
      `SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ? AND ${PK('"createdAt"')} = ?`,
      [org, periodKey]
    ),
    introduction: await scalar(
      `SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ? AND "introducedAt" IS NOT NULL AND ${PK('"introducedAt"')} = ?`,
      [org, periodKey]
    ),
    outcome: await scalar(
      `SELECT COUNT(*) AS n FROM "Outcome" WHERE "organizationId" = ? AND ${PK('"occurredAt"')} = ?`,
      [org, periodKey]
    ),
    // 核验按"**已被核验的成果数**"计（与 `listUsageFacts` 同口径：不是验证记录条数）。
    verification: await scalar(
      `SELECT COUNT(*) AS n FROM "Outcome" WHERE "organizationId" = ? AND "verificationLevel" <> 'SELF_REPORTED' AND ${PK('"occurredAt"')} = ?`,
      [org, periodKey]
    ),
  }

  // ── 全部期次的事实数（用于证明"期次过滤承重"）──
  const rawAllPeriods = {
    proposal: await scalar(`SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ?`, [org]),
    introduction: await scalar(
      `SELECT COUNT(*) AS n FROM "ConnectionProposal" WHERE "organizationId" = ? AND "introducedAt" IS NOT NULL`,
      [org]
    ),
    outcome: await scalar(`SELECT COUNT(*) AS n FROM "Outcome" WHERE "organizationId" = ?`, [org]),
    verification: await scalar(
      `SELECT COUNT(*) AS n FROM "Outcome" WHERE "organizationId" = ? AND "verificationLevel" <> 'SELF_REPORTED'`,
      [org]
    ),
  }

  // ── 账本行的来源是否存在（软引用完整性：账不能凭空记一笔）──
  const orphanRows = await q(
    `SELECT u."id" AS "id", u."unit" AS "unit", u."sourceId" AS "sourceId"
       FROM "UsageRecord" u
      WHERE u."organizationId" = ?
        AND (
          (u."unit" IN ('PROPOSAL','INTRODUCTION') AND NOT EXISTS (
             SELECT 1 FROM "ConnectionProposal" p WHERE p."id" = u."sourceId" AND p."organizationId" = u."organizationId"))
          OR
          (u."unit" IN ('OUTCOME','VERIFICATION') AND NOT EXISTS (
             SELECT 1 FROM "Outcome" o WHERE o."id" = u."sourceId" AND o."organizationId" = u."organizationId"))
        )`,
    [org]
  )

  // ── 事件集 ──
  const events = await q(
    `SELECT "id","type","plan","chargeId","amountCents","currency","gatewayStatus","reason","occurredAt","createdAt"
       FROM "BillingEvent" WHERE "organizationId" = ?
      ORDER BY "occurredAt" ASC, "createdAt" ASC, "id" ASC`,
    [org]
  )

  const eventAgg = {
    eventCount: events.length,
    paidTotalCents: await scalar(
      `SELECT COALESCE(SUM("amountCents"),0) AS n FROM "BillingEvent" WHERE "organizationId" = ? AND "type" = 'CHARGE_SUCCEEDED'`,
      [org]
    ),
    refundedTotalCents: await scalar(
      `SELECT COALESCE(SUM("amountCents"),0) AS n FROM "BillingEvent" WHERE "organizationId" = ? AND "type" = 'CHARGE_REFUNDED'`,
      [org]
    ),
    succeededGatewayEvents: await scalar(
      `SELECT COUNT(*) AS n FROM "BillingEvent" WHERE "organizationId" = ? AND "gatewayStatus" = 'SUCCEEDED'`,
      [org]
    ),
    unknownGatewayEvents: await scalar(
      // 合法取值集合从 GATEWAY_STATUSES 单源拼出（不手写第二份字面量）。
      `SELECT COUNT(*) AS n FROM "BillingEvent"
        WHERE "organizationId" = ? AND "gatewayStatus" IS NOT NULL
          AND "gatewayStatus" NOT IN (${GATEWAY_STATUSES.map(() => '?').join(',')})`,
      [org, ...GATEWAY_STATUSES]
    ),
  }

  return { ledgerRows, rawInPeriod, rawAllPeriods, orphanRows, events, eventAgg }
}

// ─────────────────────────────────────────────────────────────
// 纯比较：把 (响应, 原始读数) 变成一组断言
//    —— 与 IO 分离，故可对"变异载荷"重复调用（变异自证）。
// ─────────────────────────────────────────────────────────────

function classifyChange(from, to) {
  const d = (PLAN_ORDER[to] ?? 0) - (PLAN_ORDER[from] ?? 0)
  return d > 0 ? 'UPGRADE' : d < 0 ? 'DOWNGRADE' : 'SAME'
}

/** 由分组后的事件集派生一笔款项的快照（(b)/(c) 层）。 */
function deriveCharge(chargeId, evs) {
  const types = evs.map((e) => e.type)
  const created = evs.find((e) => e.type === 'CHARGE_CREATED')
  const settled = [...evs].reverse().find((e) =>
    ['CHARGE_SUCCEEDED', 'CHARGE_FAILED', 'CHARGE_REFUNDED'].includes(e.type)
  )
  const lastWithGateway = [...evs].reverse().find((e) => e.gatewayStatus !== null && e.gatewayStatus !== undefined)
  // 优先级 REFUNDED > SUCCEEDED > FAILED > PENDING 是**终态规则的结果**，不是独立猜测：
  // `CHARGE_TRANSITIONS` 只允许 PENDING→{SUCCEEDED,FAILED}、SUCCEEDED→REFUNDED，故
  // "出现 REFUNDED 必已 SUCCEEDED"、"FAILED 与 SUCCEEDED 不可共存"。
  const status = types.includes('CHARGE_REFUNDED')
    ? 'REFUNDED'
    : types.includes('CHARGE_SUCCEEDED')
      ? 'SUCCEEDED'
      : types.includes('CHARGE_FAILED')
        ? 'FAILED'
        : 'PENDING'
  return {
    chargeId,
    status,
    amountCents: num(created?.amountCents),
    currency: created?.currency ?? 'USD',
    gatewayStatus: lastWithGateway?.gatewayStatus ?? null,
    createdAt: created?.occurredAt ?? null,
    settledAt: settled?.occurredAt ?? null,
  }
}

/** 按事件序列重走状态投影（(c) 层）。 */
function deriveSubscription(events) {
  let plan = 'FREE'
  let status = 'NONE'
  let direction = null
  let startedAt = null
  let canceledAt = null
  let refundedAt = null
  let lastEventAt = null
  let paidTotalCents = 0
  let refundedTotalCents = 0

  for (const e of events) {
    const at = e.occurredAt
    switch (e.type) {
      case 'SUBSCRIPTION_STARTED':
        plan = e.plan ?? plan
        status = 'ACTIVE'
        startedAt = at
        canceledAt = null
        refundedAt = null
        break
      case 'PLAN_CHANGED':
        direction = classifyChange(plan, e.plan)
        plan = e.plan ?? plan
        break
      case 'SUBSCRIPTION_CANCELED':
        status = 'CANCELED'
        canceledAt = at
        break
      case 'CHARGE_SUCCEEDED':
        paidTotalCents += num(e.amountCents)
        status = 'ACTIVE'
        break
      case 'CHARGE_FAILED':
        status = 'PAST_DUE'
        break
      case 'CHARGE_REFUNDED':
        refundedTotalCents += num(e.amountCents)
        status = 'REFUNDED'
        refundedAt = at
        break
      default:
        break
    }
    lastEventAt = at
  }

  return {
    plan,
    status,
    paidTotalCents,
    refundedTotalCents,
    netPaidCents: paidTotalCents - refundedTotalCents,
    startedAt,
    canceledAt,
    refundedAt,
    lastEventAt,
    eventCount: events.length,
    lastPlanChangeDirection: direction,
  }
}

function compareAll(payload, raw) {
  const C = makeChecker()
  const usage = payload?.usage ?? null
  const subscription = payload?.subscription ?? null

  if (!usage || !subscription) {
    C.ck('载荷', '载荷含 usage 与 subscription 两段', false, `keys=${Object.keys(payload || {}).join(',')}`)
    return C
  }

  const basis = usage.basis ?? {}
  const periodKey = PERIOD_OVERRIDE || basis.periodKey
  const limits = basis.planLimits ?? {}
  const mapping = basis.unitMapping ?? {}

  // ═════════════════════════════════════════════════════════
  // [0] 载荷自洽性（错了就没必要往下算）
  // ═════════════════════════════════════════════════════════
  C.ck('0', 'usage.basis.scope === period', basis.scope === 'period', `scope=${basis.scope}`)
  C.ck('0', 'basis.periodKey 形如 YYYY-MM', /^\d{4}-\d{2}$/.test(String(periodKey)), `periodKey=${periodKey}`)
  C.ck(
    '0',
    '界线是 ISO 8601 UTC（上界开，便于对账按同一口径切期）',
    typeof basis.periodStart === 'string' &&
      basis.periodStart.endsWith('Z') &&
      typeof basis.periodEnd === 'string' &&
      basis.periodEnd.endsWith('Z') &&
      basis.periodStart < basis.periodEnd,
    `${basis.periodStart} .. ${basis.periodEnd}`
  )
  C.ck('0', 'basis.plan 是合法有效方案', EFFECTIVE_PLANS.includes(basis.plan), `plan=${basis.plan}`)
  C.ck(
    '0',
    'basis.planLimits 字段集齐备（4 单元 + seats）',
    sameKeySet(limits, ['proposalPerMonth', 'introductionPerMonth', 'outcomePerMonth', 'verificationPerMonth', 'seats']),
    Object.keys(limits).join(',')
  )
  C.ck(
    '0',
    '🔴 basis.unitMapping 与 usage.totals 字段集一致（单元词表同源）',
    sameKeySet(mapping, USAGE_UNITS) && sameKeySet(usage.totals, USAGE_UNITS),
    `mapping=[${Object.keys(mapping)}] totals=[${Object.keys(usage.totals || {})}]`
  )
  C.ck(
    '0',
    'unitMapping 的枚举值与单元一一对应',
    USAGE_UNITS.every((u) => String(mapping[u] || '').toUpperCase() === u.toUpperCase()),
    JSON.stringify(mapping)
  )
  C.ck(
    '0',
    'limits 条目集合与单元集合一致（不多不少）',
    Array.isArray(usage.limits) &&
      usage.limits.length === USAGE_UNITS.length &&
      USAGE_UNITS.every((u) => usage.limits.some((l) => l.unit === u)),
    (usage.limits || []).map((l) => l.unit).join(',')
  )
  if (C.fail > 0) {
    C.info('0', '载荷本身不自洽 → 跳过后续对账')
    return C
  }

  // ═════════════════════════════════════════════════════════
  // [1] 用量：账本行 → 汇总（服务侧路径的复算）
  // ═════════════════════════════════════════════════════════
  const inPeriod = raw.ledgerRows.filter((r) => r.periodKey === periodKey)
  const ledgerTotals = Object.fromEntries(USAGE_UNITS.map((u) => [u, 0]))
  for (const r of inPeriod) {
    const unit = String(r.unit || '').toLowerCase()
    if (unit in ledgerTotals) ledgerTotals[unit] += asCount(r.quantity)
  }
  for (const u of USAGE_UNITS) {
    C.ck('1', `totals.${u} = 账本行合计`, num(usage.totals[u]) === ledgerTotals[u], `API=${usage.totals[u]} 账本=${ledgerTotals[u]}`)
  }
  C.ck(
    '1',
    'totalUnits = 四单元之和',
    num(usage.totalUnits) === USAGE_UNITS.reduce((s, u) => s + num(usage.totals[u]), 0),
    `API=${usage.totalUnits}`
  )
  C.ck(
    '1',
    '本期账本行数 = totalUnits（quantity 恒为 1 时两者相等）',
    inPeriod.length === num(usage.totalUnits),
    `本期行数=${inPeriod.length} totalUnits=${usage.totalUnits}`
  )

  // ── 账本行自洽（期次 / 幂等键 / 来源类型 / 数量）──
  const badPeriod = raw.ledgerRows.filter((r) => r.periodKey !== String(r.occurredAt || '').replace('Z', '').replace('+00:00', '').slice(0, 7))
  const badDedupe = raw.ledgerRows.filter(
    (r) => r.dedupeKey !== `${String(r.unit).toLowerCase()}:${r.sourceId}`
  )
  const badSourceType = raw.ledgerRows.filter((r) => r.sourceType !== String(r.unit).toLowerCase())
  const badQuantity = raw.ledgerRows.filter((r) => asCount(r.quantity) !== 1)
  C.ck('1', '每行 periodKey = occurredAt 的 UTC 月', badPeriod.length === 0, badPeriod.map((r) => r.id).join(',') || '')
  C.ck('1', '每行 dedupeKey = `<unit-lower>:<sourceId>`', badDedupe.length === 0, badDedupe.map((r) => r.id).join(',') || '')
  C.ck('1', '每行 sourceType = unit 小写', badSourceType.length === 0, badSourceType.map((r) => r.id).join(',') || '')
  C.ck('1', '每行 quantity = 1（一事实一账）', badQuantity.length === 0, badQuantity.map((r) => r.id).join(',') || '')
  C.ck('1', '账本无重复 dedupeKey', new Set(raw.ledgerRows.map((r) => r.dedupeKey)).size === raw.ledgerRows.length)

  // ═════════════════════════════════════════════════════════
  // [2] 用量：**原始表 SQL** 独立复算（不经账本的一条路径）
  // ═════════════════════════════════════════════════════════
  for (const u of USAGE_UNITS) {
    C.ck(
      '2',
      `totals.${u} = 原始表独立复算`,
      num(usage.totals[u]) === num(raw.rawInPeriod[u]),
      `API=${usage.totals[u]} 原始表=${raw.rawInPeriod[u]}`
    )
  }
  C.ck('2', '账本行无悬空来源（每笔账都能追回原始行）', raw.orphanRows.length === 0, raw.orphanRows.map((r) => `${r.unit}:${r.sourceId}`).join(',') || '')

  // ── 期次过滤必须**承重**：全期事实数 ≥ 本期数，且若多于则说明过滤真的在起作用 ──
  const filteredAny = USAGE_UNITS.some((u) => num(raw.rawAllPeriods[u]) > num(raw.rawInPeriod[u]))
  C.info(
    '2',
    '期次过滤承重（全期 vs 本期）',
    USAGE_UNITS.map((u) => `${u}: ${raw.rawInPeriod[u]}/${raw.rawAllPeriods[u]}`).join('  ') +
      (filteredAny ? '  ⇒ 过滤生效' : '  ⚠️ 无跨期数据，过滤未被承重')
  )
  C.ck('2', '全期事实数不少于本期（过滤是包含关系）', USAGE_UNITS.every((u) => num(raw.rawAllPeriods[u]) >= num(raw.rawInPeriod[u])))

  // ═════════════════════════════════════════════════════════
  // [3] 限额：用响应自己声明的 planLimits 复算
  //     （限额是**假设**，必须随响应下发；这里就用它，而不是脚本自带一份）
  // ═════════════════════════════════════════════════════════
  const limitOf = (u) => {
    const raw0 = limits[`${u}PerMonth`]
    return typeof raw0 === 'number' && Number.isFinite(raw0) ? raw0 : null
  }
  for (const u of USAGE_UNITS) {
    const entry = (usage.limits || []).find((l) => l.unit === u)
    const limit = limitOf(u)
    const used = asCount(usage.totals[u])
    const exp = {
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      exhausted: limit !== null && used >= limit,
      exceeded: limit !== null && used > limit,
    }
    C.ck(
      '3',
      `limits[${u}] 复算一致（含 exhausted/exceeded 分离）`,
      entry && sameJson({ limit: entry.limit, used: entry.used, remaining: entry.remaining, exhausted: entry.exhausted, exceeded: entry.exceeded }, exp),
      entry ? `API=${JSON.stringify(entry)} 复算=${JSON.stringify(exp)}` : 'missing'
    )
  }

  // ═════════════════════════════════════════════════════════
  // [4] 订阅：SQL 聚合层（与命令式折叠不可能共享同一 bug）
  // ═════════════════════════════════════════════════════════
  C.ck('4', 'eventCount = 事件表行数', num(subscription.eventCount) === raw.eventAgg.eventCount, `API=${subscription.eventCount} SQL=${raw.eventAgg.eventCount}`)
  C.ck(
    '4',
    'paidTotalCents = SUM(CHARGE_SUCCEEDED.amountCents)',
    num(subscription.paidTotalCents) === raw.eventAgg.paidTotalCents,
    `API=${subscription.paidTotalCents} SQL=${raw.eventAgg.paidTotalCents}`
  )
  C.ck(
    '4',
    'refundedTotalCents = SUM(CHARGE_REFUNDED.amountCents)',
    num(subscription.refundedTotalCents) === raw.eventAgg.refundedTotalCents,
    `API=${subscription.refundedTotalCents} SQL=${raw.eventAgg.refundedTotalCents}`
  )
  C.ck(
    '4',
    'netPaidCents = paid − refunded',
    num(subscription.netPaidCents) === num(subscription.paidTotalCents) - num(subscription.refundedTotalCents),
    `API=${subscription.netPaidCents}`
  )

  // ═════════════════════════════════════════════════════════
  // [5] 订阅：账本合法性不变量（与实现无关的"可审计账本"定义）
  // ═════════════════════════════════════════════════════════
  const byCharge = new Map()
  for (const e of raw.events) {
    if (!e.chargeId) continue
    if (!byCharge.has(e.chargeId)) byCharge.set(e.chargeId, [])
    byCharge.get(e.chargeId).push(e)
  }
  const createdCounts = new Map()
  for (const e of raw.events) {
    if (e.type === 'CHARGE_CREATED') createdCounts.set(e.chargeId, (createdCounts.get(e.chargeId) || 0) + 1)
  }
  const illegal = []
  for (const [cid, evs] of byCharge) {
    const t = evs.map((x) => x.type)
    if ((createdCounts.get(cid) || 0) !== 1) illegal.push(`${cid}: CREATED×${createdCounts.get(cid) || 0}`)
    if (t.includes('CHARGE_SUCCEEDED') && t.includes('CHARGE_FAILED')) illegal.push(`${cid}: SUCCEEDED+FAILED`)
    if (t.includes('CHARGE_REFUNDED') && !t.includes('CHARGE_SUCCEEDED')) illegal.push(`${cid}: REFUNDED 而无 SUCCEEDED`)
    if (t.includes('CHARGE_REFUNDED') && t.includes('CHARGE_FAILED')) illegal.push(`${cid}: REFUNDED+FAILED`)
    const created = evs.find((x) => x.type === 'CHARGE_CREATED')
    for (const x of evs) {
      if (['CHARGE_SUCCEEDED', 'CHARGE_REFUNDED'].includes(x.type) && num(x.amountCents) !== num(created?.amountCents)) {
        illegal.push(`${cid}: ${x.type} 金额 ${x.amountCents} ≠ CREATED ${created?.amountCents}`)
      }
    }
    // 结算事件必须晚于创建事件（时间单调）
    if (created && evs.some((x) => x.type !== 'CHARGE_CREATED' && String(x.occurredAt) <= String(created.occurredAt))) {
      illegal.push(`${cid}: 结算时间不晚于创建时间`)
    }
  }
  C.ck('5', '🔴 账本合法（无 成功+失败 并存 / 无退款而无成功 / 金额一致 / 时间单调）', illegal.length === 0, illegal.join(' | ') || '')

  // ═════════════════════════════════════════════════════════
  // [6] 订阅：派生复算（status / plan / 方向 / 时间戳 / 款项快照）
  // ═════════════════════════════════════════════════════════
  const derived = deriveSubscription(raw.events)
  const expCharges = [...byCharge.entries()]
    .map(([cid, evs]) => deriveCharge(cid, evs))
    .sort((a, b) => String(a.createdAt) < String(b.createdAt) ? -1 : String(a.createdAt) > String(b.createdAt) ? 1 : (a.chargeId < b.chargeId ? -1 : 1))

  const fieldPairs = [
    ['plan', subscription.plan, derived.plan, sameJson],
    ['status', subscription.status, derived.status, sameJson],
    ['paidTotalCents', num(subscription.paidTotalCents), derived.paidTotalCents, sameJson],
    ['refundedTotalCents', num(subscription.refundedTotalCents), derived.refundedTotalCents, sameJson],
    ['netPaidCents', num(subscription.netPaidCents), derived.netPaidCents, sameJson],
    ['startedAt', subscription.startedAt ?? null, derived.startedAt, sameTs],
    ['canceledAt', subscription.canceledAt ?? null, derived.canceledAt, sameTs],
    ['refundedAt', subscription.refundedAt ?? null, derived.refundedAt, sameTs],
    ['lastEventAt', subscription.lastEventAt ?? null, derived.lastEventAt, sameTs],
    ['eventCount', num(subscription.eventCount), derived.eventCount, sameJson],
    ['lastPlanChangeDirection', subscription.lastPlanChangeDirection ?? null, derived.lastPlanChangeDirection, sameJson],
  ]
  for (const [name, api, exp, cmp] of fieldPairs) {
    C.ck('6', `subscription.${name} 与事件集复算一致`, cmp(api, exp), cmp(api, exp) ? `${String(exp)}` : `API=${String(api)} 复算=${String(exp)}`)
  }
  C.ck('6', 'status 属于已知集合', SUBSCRIPTION_STATUSES.includes(subscription.status), `status=${subscription.status}`)
  C.ck(
    '6',
    'live 与 status 口径一致（ACTIVE/PAST_DUE 才算订阅中）',
    subscription.live === (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE'),
    `live=${subscription.live} status=${subscription.status}`
  )
  C.ck(
    '6',
    'charges 条目集合与事件集一致（不多不少）',
    Array.isArray(subscription.charges) &&
      sameJson(subscription.charges.map((c) => c.chargeId).sort(), expCharges.map((c) => c.chargeId).sort()),
    `API=[${(subscription.charges || []).map((c) => c.chargeId)}] 复算=[${expCharges.map((c) => c.chargeId)}]`
  )
  for (const exp of expCharges) {
    const api = (subscription.charges || []).find((c) => c.chargeId === exp.chargeId)
    if (!api) {
      C.ck('6', `charges[${exp.chargeId}] 存在`, false, 'missing')
      continue
    }
    const fields = ['status', 'amountCents', 'currency', 'gatewayStatus', 'createdAt', 'settledAt']
    const snapshotOk =
      api.status === exp.status &&
      num(api.amountCents) === exp.amountCents &&
      api.currency === exp.currency &&
      (api.gatewayStatus ?? null) === exp.gatewayStatus &&
      sameTs(api.createdAt ?? null, exp.createdAt) &&
      sameTs(api.settledAt ?? null, exp.settledAt)
    C.ck(
      '6',
      `charges[${exp.chargeId}] 快照复算一致（字段：${fields.join('/')}）`,
      snapshotOk,
      snapshotOk ? '' : `API=${JSON.stringify(api)} 复算=${JSON.stringify(exp)}`
    )
    C.ck('6', `charges[${exp.chargeId}].status 属于已知集合`, LEDGER_CHARGE_STATUSES.includes(api.status), `status=${api.status}`)
  }

  // ═════════════════════════════════════════════════════════
  // [7] 诚实条款（AC-21：沙箱不得冒充真实收款）
  // ═════════════════════════════════════════════════════════
  for (const [label, gw] of [['usage.gateway', usage.gateway], ['subscription.gateway', subscription.gateway]]) {
    C.ck('7', `${label}.provider === creem`, gw?.provider === 'creem', `provider=${gw?.provider}`)
    C.ck('7', `🔴 ${label}.realChargesEnabled === false（真实扣款当前不可用）`, gw?.realChargesEnabled === false, `${gw?.realChargesEnabled}`)
    const missing = Array.isArray(gw?.credentialsMissing) ? gw.credentialsMissing : null
    C.ck('7', `${label}.credentialsMissing 是数组`, missing !== null, JSON.stringify(gw?.credentialsMissing))
    C.ck(
      '7',
      `${label}.mode 与凭据缺失一致（sandbox ⟺ 缺凭据）`,
      missing !== null && gw.mode === (missing.length > 0 ? 'sandbox' : 'not_implemented'),
      `mode=${gw?.mode} missing=${missing ? missing.length : 'n/a'}`
    )
  }
  C.ck(
    '7',
    '🔴 无任何事件 gatewayStatus=SUCCEEDED（沙箱未冒充"真实网关已受理"）',
    raw.eventAgg.succeededGatewayEvents === 0,
    `count=${raw.eventAgg.succeededGatewayEvents}`
  )
  C.ck('7', '事件的 gatewayStatus 取值合法', raw.eventAgg.unknownGatewayEvents === 0)
  C.ck('7', 'usage.basis.currency 与 subscription.currency 一致', basis.currency === subscription.currency, `${basis.currency} vs ${subscription.currency}`)

  return C
}

// ─────────────────────────────────────────────────────────────
// 变异自证 —— 证明断言**不是"永远通过"**
// ─────────────────────────────────────────────────────────────

function mutationProof(cleanPayload, raw) {
  const cases = [
    ['usage.totals.proposal + 1', (p) => { p.usage.totals.proposal += 1 }],
    ['usage.totalUnits + 1', (p) => { p.usage.totalUnits += 1 }],
    ['usage.limits[0].used + 1', (p) => { p.usage.limits[0].used += 1 }],
    ['usage.limits[0].exhausted 取反', (p) => { p.usage.limits[0].exhausted = !p.usage.limits[0].exhausted }],
    ['basis.unitMapping 改值', (p) => { p.usage.basis.unitMapping.proposal = 'OUTCOME' }],
    ['subscription.paidTotalCents + 1', (p) => { p.subscription.paidTotalCents += 1 }],
    ['subscription.eventCount + 1', (p) => { p.subscription.eventCount += 1 }],
    ['subscription.status 改为 ACTIVE', (p) => { p.subscription.status = p.subscription.status === 'ACTIVE' ? 'CANCELED' : 'ACTIVE' }],
    ['subscription.lastPlanChangeDirection 置 null', (p) => { p.subscription.lastPlanChangeDirection = null }],
    ['charges[0].status 篡改', (p) => { p.subscription.charges[0].status = p.subscription.charges[0].status === 'SUCCEEDED' ? 'FAILED' : 'SUCCEEDED' }],
  ]
  const out = []
  for (const [name, mutate] of cases) {
    const clone = JSON.parse(JSON.stringify(cleanPayload))
    mutate(clone)
    const r = compareAll(clone, raw)
    out.push({ name, caught: r.fail > 0, failures: r.fail })
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

async function main() {
  if (!ORG) throw new Error('缺少组织 id —— 用 --org=<id> 或 BILLING_ORG_ID')
  if (!DB_URL) throw new Error('缺少 DATABASE_URL（对账要直连同一个库）')
  if (!API_FILE) throw new Error('缺少 --api=<file>（或 BILLING_API_FILE）—— 先跑 emit-billing.mts 产出它')

  const rawPayload = JSON.parse(fs.readFileSync(API_FILE, 'utf8'))
  const data = rawPayload && typeof rawPayload === 'object' && rawPayload.data ? rawPayload.data : rawPayload

  const client = createClient({ url: DB_URL, ...(AUTH_TOKEN ? { authToken: AUTH_TOKEN } : {}) })
  let raw
  try {
    const declaredPeriod = PERIOD_OVERRIDE || data?.usage?.basis?.periodKey
    if (!declaredPeriod) throw new Error('载荷里没有 usage.basis.periodKey，且未传 --period')
    raw = await fetchRaw(client, ORG, declaredPeriod)
  } finally {
    client.close()
  }

  console.log(`\n📄 载荷：${API_FILE}`)
  console.log(`🏢 组织：${ORG}   期次：${PERIOD_OVERRIDE || data?.usage?.basis?.periodKey}   库：${DB_URL.replace(/\/\/.*@/, '//***@')}`)

  // ── 干净跑 ──
  const clean = compareAll(data, raw, ORG)
  for (const line of clean.lines) console.log(line)

  // ── 变异自证 ──
  console.log('\n[8] 变异自证（把载荷故意改坏，断言必须被抓到）')
  const proofs = mutationProof(data, raw)
  let proofFail = 0
  for (const p of proofs) {
    const ok = p.caught
    if (!ok) proofFail += 1
    console.log(`  ${ok ? '✅' : '❌'} 变异「${p.name}」→ ${ok ? `已抓到（${p.failures} 项不一致）` : '未被抓到 —— 断言形同虚设'}`)
  }

  const totalFail = clean.fail + proofFail
  console.log(`\n${totalFail === 0 ? '✅ 对账通过' : '❌ 对账失败'}：对账 ${clean.pass} 通过 / ${clean.fail} 不一致；变异自证 ${proofs.length - proofFail}/${proofs.length}`)
  if (clean.fail > 0) {
    console.log('\n不一致明细：')
    for (const line of clean.lines) if (line.includes('❌')) console.log(line)
  }
  process.exit(totalFail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌ 对账脚本异常：', err?.message || err)
  process.exit(1)
})
