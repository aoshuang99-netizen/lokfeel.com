#!/usr/bin/env node
/**
 * S-01 · 生产支付账本**只读**审计（V20.7 总令「历史账本核查」）
 *
 * 目的
 * ----
 * 用真实生产库回答三个问题，而不是靠推理：
 *   ① 有没有「收了钱但没开通」的案例（SUCCEEDED 款项 + 无有效订阅）；
 *   ② 有没有 R-15 形态的痕迹 —— 同一 `chargeId` 出现 FAILED 后本该 SUCCEEDED，
 *      但成功事件被旧结算键去重吞掉（表现为：CREATED + FAILED，且键形如 `:settled`）；
 *   ③ 账本自身的合法性不变量有没有被破坏（重复入账、孤立结算、CREATED 缺失、
 *      金额不一致、SUCCEEDED 与 FAILED 共存）。
 *
 * 只读契约
 * --------
 * 本脚本**只允许 SELECT**。任何非 SELECT 语句在 `q()` 入口直接抛错，
 * 不是靠"我记得别写"。因此它不可能退款、改权益、补账。
 *
 * 为什么不用 `billing-reconcile.mjs`
 * ---------------------------------
 * 那个脚本是**单组织 + API 载荷**对账（它要拿服务端响应当输入）。
 * S-01 需要的是**全库普查**：没有任何单组织载荷可依赖，而且它必须能发现
 * "这个组织的账本身就是坏的"。
 *
 * 用法:
 *   node scripts/qa/s01-ledger-audit.mjs --out=evidence/s01-ledger-audit.json
 */

import { createClient } from '@libsql/client'
import { writeFileSync } from 'node:fs'

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

const SELECT_ONLY = /^\s*select\b/i

/**
 * R-15 之前的旧结算键形态：`dodo:charge-settled:<paymentId>`（**无终态后缀**）。
 *
 * ⚠️ 踩过的坑：第一版写成 `/:settled$/`（要求以字面 `:settled` 结尾），
 * 而旧键的结尾是 **paymentId**，于是永远匹配不到 ⇒ 审计静默漏报。
 * 正确判据是「前缀匹配 + 不带 `:succeeded`/`:failed` 后缀」。
 */
export const LEGACY_SETTLED_KEY = /^dodo:charge-settled:(?!.*:(?:succeeded|failed)$).+/

/** 判定层（纯函数，便于 TDD 注入负控）。 */
export function auditLedger(snapshot) {
  const findings = []
  const {
    typeCounts = [],
    chargeRows = [],
    subscriptionRows = [],
    b2cPaymentRows = [],
    orgPlanRows = [],
    b2cPaidWithoutSub = [],
    b2cPaymentWindow = null,
  } = snapshot

  // ── ① 账本合法性不变量 ──
  const byCharge = new Map()
  for (const r of chargeRows) {
    if (!r.chargeId) {
      findings.push({ severity: 'S1', code: 'charge_event_without_chargeId', detail: `${r.id}/${r.type}` })
      continue
    }
    if (!byCharge.has(r.chargeId)) byCharge.set(r.chargeId, [])
    byCharge.get(r.chargeId).push(r)
  }

  const invariantViolations = []
  for (const [chargeId, evs] of byCharge) {
    const types = evs.map((e) => e.type)
    const created = types.filter((t) => t === 'CHARGE_CREATED').length
    const dup = types.filter((t, i) => types.indexOf(t) !== i)
    if (created !== 1) invariantViolations.push({ chargeId, code: 'created_count_not_1', created })
    if (dup.length) invariantViolations.push({ chargeId, code: 'duplicate_event_type', duplicate: [...new Set(dup)] })
    if (types.includes('CHARGE_SUCCEEDED') && types.includes('CHARGE_FAILED')) {
      invariantViolations.push({ chargeId, code: 'succeeded_and_failed_coexist' })
    }
    if (types.includes('CHARGE_REFUNDED') && !types.includes('CHARGE_SUCCEEDED')) {
      invariantViolations.push({ chargeId, code: 'refunded_without_succeeded' })
    }
    const createdAmt = evs.find((e) => e.type === 'CHARGE_CREATED')?.amountCents
    const settled = evs.find((e) => e.type === 'CHARGE_SUCCEEDED' || e.type === 'CHARGE_REFUNDED')
    if (createdAmt != null && settled?.amountCents != null && createdAmt !== settled.amountCents) {
      invariantViolations.push({ chargeId, code: 'amount_mismatch', createdAmt, settledAmt: settled.amountCents })
    }
  }

  // ── ② R-15 痕迹：失败后成功被吞 ──
  const r15Suspects = []
  for (const [chargeId, evs] of byCharge) {
    const types = evs.map((e) => e.type)
    const hasSucceeded = types.includes('CHARGE_SUCCEEDED')
    const hasFailed = types.includes('CHARGE_FAILED')
    const legacyKeys = evs.filter((e) => LEGACY_SETTLED_KEY.test(String(e.dedupeKey || '')))
    if (hasFailed && !hasSucceeded) {
      r15Suspects.push({
        chargeId,
        code: legacyKeys.length ? 'failed_only_with_legacy_settled_key' : 'failed_only',
        legacySettledKeys: legacyKeys.map((e) => e.dedupeKey),
        occurredAt: evs.map((e) => e.occurredAt).sort().pop() ?? null,
      })
    }
  }

  // ── ③ 收钱未开通：SUCCEEDED 的款项，其组织当前无有效订阅 ──
  const planByOrg = new Map(orgPlanRows.map((r) => [r.organizationId, r.plan ?? null]))
  const succeededOrgs = new Set(
    chargeRows.filter((r) => r.type === 'CHARGE_SUCCEEDED').map((r) => r.organizationId),
  )
  const paidNotProvisioned = [...succeededOrgs]
    .filter((org) => !planByOrg.get(org))
    .map((org) => ({ organizationId: org, derivedPlan: null }))

  const totalCharges = byCharge.size
  const succeededCharges = [...byCharge.values()].filter((evs) =>
    evs.some((e) => e.type === 'CHARGE_SUCCEEDED'),
  ).length

  // 只要账本里出现过旧键，就说明**写入侧曾运行过含 R-15 的代码** ——
  // 这与"当时有没有真的收钱"是两件事，所以单独作为取证事实记录，不依赖有失败事件。
  const legacyKeyRows = chargeRows.filter((r) => LEGACY_SETTLED_KEY.test(String(r.dedupeKey || '')))

  const blockers = []
  if (invariantViolations.length) blockers.push('ledger_invariant_violated')
  if (paidNotProvisioned.length) blockers.push('paid_without_active_subscription')
  if (b2cPaidWithoutSub.length) blockers.push('b2c_paid_without_active_subscription')
  if (legacyKeyRows.length) blockers.push('legacy_settled_key_present')

  // 「2226 条 ACTIVE 订阅」本身不是结论 —— 必须按档位拆开看，
  // 否则免费档会把「付费用户数」放大 40 倍，让审计报告变成误导。
  const planBreakdown = groupCount(subscriptionRows, 'plan')
  const paidPlans = new Set(['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'])
  const paidSubscriptions = subscriptionRows.filter((r) => paidPlans.has(r.plan)).length
  const payableRows = b2cPaymentRows.filter((r) => r.status === 'SUCCEEDED' || r.status === 'REFUNDED')

  const zeroSample = totalCharges === 0
  return {
    // 零样本时**不允许**判 PASS —— 空集恒真，那是假绿。
    verdict: blockers.length ? 'FAIL' : zeroSample ? 'NO_SAMPLE' : 'PASS',
    zeroSample,
    counts: {
      billingEvents: typeCounts.reduce((a, r) => a + Number(r.n || 0), 0),
      charges: totalCharges,
      succeededCharges,
      b2cSubscriptions: subscriptionRows.length,
      b2cPaidSubscriptions: paidSubscriptions,
      b2cPayments: b2cPaymentRows.length,
      b2cSucceededPayments: b2cPaymentRows.filter((r) => r.status === 'SUCCEEDED').length,
      b2cPayableRows: payableRows.length,
    },
    typeCounts: typeCounts.map((r) => ({ type: r.type, n: Number(r.n || 0), amountCents: Number(r.amount || 0) })),
    findings,
    invariantViolations,
    r15Suspects,
    legacySettledKeys: legacyKeyRows.map((r) => ({ chargeId: r.chargeId, type: r.type, dedupeKey: r.dedupeKey })),
    paidNotProvisioned,
    b2cSubscriptionByPlan: planBreakdown,
    b2cSubscriptionStatus: groupCount(subscriptionRows, 'status'),
    b2cPaymentStatus: groupCount(b2cPaymentRows, 'status'),
    b2cPaidWithoutSub,
    b2cPaymentWindow,
    blockers,
  }
}

function groupCount(rows, key) {
  const m = new Map()
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1)
  return [...m.entries()].map(([k, v]) => ({ key: k, n: v }))
}

async function main() {
  const url = process.env.DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  const out = arg('out', '')
  if (!url) throw new Error('DATABASE_URL missing')

  const client = createClient({ url, authToken })
  const q = async (sql, args = []) => {
    if (!SELECT_ONLY.test(sql)) throw new Error(`READ-ONLY VIOLATION: ${sql.slice(0, 60)}`)
    const rs = await client.execute({ sql, args })
    return rs.rows.map((r) => ({ ...r }))
  }

  const snapshot = {}
  const result = { checkedAt: new Date().toISOString(), readOnly: true, target: url.replace(/\/\/[^@]*@/, '//***@') }

  try {
    // 表存在性（生产版本可能没有某些表）
    const tables = await q(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    const tableNames = new Set(tables.map((t) => t.name))
    result.tables = { billingEvent: tableNames.has('BillingEvent'), subscription: tableNames.has('Subscription'), payment: tableNames.has('Payment') }

    snapshot.typeCounts = tableNames.has('BillingEvent')
      ? await q(`SELECT "type" AS type, COUNT(*) AS n, COALESCE(SUM("amountCents"),0) AS amount FROM "BillingEvent" GROUP BY "type"`)
      : []

    snapshot.chargeRows = tableNames.has('BillingEvent')
      ? await q(
          `SELECT "id" AS id, "organizationId" AS organizationId, "type" AS type, "chargeId" AS chargeId,
                  "amountCents" AS amountCents, "currency" AS currency, "dedupeKey" AS dedupeKey,
                  "occurredAt" AS occurredAt
             FROM "BillingEvent"
            WHERE "type" LIKE 'CHARGE_%'
            ORDER BY "occurredAt" ASC`,
        )
      : []

    // 每组织派生当前方案：取最后一条 STARTED/PLAN_CHANGED，若其后有 CANCELED 则视为无订阅。
    snapshot.orgPlanRows = tableNames.has('BillingEvent')
      ? await q(
          `SELECT "organizationId" AS organizationId,
                  (SELECT e2."plan" FROM "BillingEvent" e2
                    WHERE e2."organizationId" = e1."organizationId"
                      AND e2."type" IN ('SUBSCRIPTION_STARTED','PLAN_CHANGED')
                      AND NOT EXISTS (
                        SELECT 1 FROM "BillingEvent" e3
                         WHERE e3."organizationId" = e2."organizationId"
                           AND e3."type" = 'SUBSCRIPTION_CANCELED'
                           AND e3."occurredAt" > e2."occurredAt")
                    ORDER BY e2."occurredAt" DESC LIMIT 1) AS "plan"
             FROM "BillingEvent" e1
            GROUP BY e1."organizationId"`,
        )
      : []

    snapshot.subscriptionRows = tableNames.has('Subscription')
      ? await q(`SELECT "id" AS id, "status" AS status, "plan" AS plan, "stripeSubscriptionId" AS stripeSubscriptionId FROM "Subscription"`)
      : []
    snapshot.b2cPaymentRows = tableNames.has('Payment')
      ? await q(`SELECT "id" AS id, "status" AS status, "userId" AS userId, "createdAt" AS createdAt FROM "Payment"`)
      : []

    // 「付款成功但该用户无 ACTIVE 订阅」= 收钱未开通（B2C 侧）。
    // 这条必须单独查，不能靠 Subscription 总数推断。
    snapshot.b2cPaidWithoutSub = tableNames.has('Payment') && tableNames.has('Subscription')
      ? await q(
          `SELECT p."id" AS id, p."userId" AS userId, p."amount" AS amount, p."createdAt" AS createdAt
             FROM "Payment" p
            WHERE p."status" = 'SUCCEEDED'
              AND NOT EXISTS (
                SELECT 1 FROM "Subscription" s
                 WHERE s."userId" = p."userId" AND s."status" = 'ACTIVE')`,
        )
      : []

    snapshot.b2cPaymentWindow = tableNames.has('Payment')
      ? (
          await q(
            `SELECT MIN("createdAt") AS minAt, MAX("createdAt") AS maxAt, COUNT(*) AS n FROM "Payment"`,
          )
        )[0] ?? null
      : null

    const audit = auditLedger(snapshot)
    Object.assign(result, audit)
    result.snapshot = {
      typeCounts: snapshot.typeCounts,
      orgPlanRows: snapshot.orgPlanRows,
      chargeRowCount: snapshot.chargeRows.length,
    }
  } catch (e) {
    result.verdict = 'ERROR'
    result.error = String(e?.message ?? e)
    result.blockers = ['audit_failed']
  } finally {
    client.close()
  }

  const printed = JSON.stringify(result, null, 2)
  process.stdout.write(`${printed}\n`)
  if (out) writeFileSync(out, `${printed}\n`, 'utf8')
  process.exitCode = result.verdict === 'PASS' || result.verdict === 'NO_SAMPLE' ? 0 : result.verdict === 'FAIL' ? 2 : 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
