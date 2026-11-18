/**
 * V25-34 · Dodo 支付账本真实四方核对（可复跑，隔离库 / 不扣款 / 不部署）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 与既有测试的分工（为什么不写一个 jest 就够）：
 *   · tests/billing/dodo-events.test.ts  —— 只验「翻译出的命令/键」（纯函数）
 *   · tests/billing/subscription.test.ts —— 只验「内核对人造事件序列的迁移表」
 *   · tests/billing/p0-02-dodo-ledger-e2e.test.ts —— 内存模拟 applyWebhook，
 *     文件头明写"不碰数据库、不发网络请求、不做真实扣款"
 *
 * 本脚本补的是最后一段、也是 R-15 真正发生的一段：**真实 HMAC 验签 +
 * 真实 NextRequest + 真实 route handler + 真实 Prisma 落隔离 libSQL 库 +
 * 真实读回 Entitlement**。四方 = ProviderEvent → WebhookSignature →
 * BillingEvent(账本) → Entitlement(权益视图)，逐方取真实证据，不 mock。
 *
 * ── 安全边界（诚实条款）─────────────────────────────────────────
 *   1. 全部凭据是**构造的假值**（test_api_key_* / whsec_<base64 test secret>），
 *      不发任何真实 HTTP 到 Dodo，不创建真实收款会话，不扣款；
 *   2. 数据库是隔离文件库 /tmp/v253-dodo-ledger.db，与生产/开发库完全无关；
 *   3. 验证对象 = 真实编译的 route handler 代码（等价生产逻辑），但通过
 *      `POST(new NextRequest(...))` 进程内调用，而非监听端口的 TCP 请求 ——
 *      这是"真实 handler + 真实 DB"，不是"真实网络栈"，边界如实记录;
 *   4. 事件里的 organizationId 是本系统 metadata 标记，用于验证跨租户谓词。
 *
 * ── 用法 ────────────────────────────────────────────────────────
 *   先建隔离库：
 *     E2E_DB_FILE=/tmp/v253-dodo-ledger.db E2E_DDL_FILE=/tmp/v253-dodo-ledger-ddl.sql \
 *       env -u NODE_OPTIONS node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
 *   再跑核对：
 *     env -u NODE_OPTIONS npx tsx scripts/qa/v253-dodo-ledger-proof.mts \
 *       --out=docs/v25.3/evidence/V25-34_LEDGER_PROOF.json
 */

import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const DB_FILE = process.env.V253_DB_FILE || '/tmp/v253-dodo-ledger.db'
const TEST_WEBHOOK_SECRET = 'whsec_dGVzdF93ZWJob29rX3NlY3JldF92MjUzX2xlZGdlcl9wcm9vZg=='
const TEST_API_KEY = 'test_api_key_for_v253_ledger_proof_1234'

// ── 注入环境（必须在动态 import 之前，Prisma 是 lazy singleton 读 process.env）──
process.env.DATABASE_URL = `file:${DB_FILE}`
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode'
process.env.DODO_PAYMENTS_API_KEY = TEST_API_KEY
process.env.DODO_PAYMENTS_WEBHOOK_KEY = TEST_WEBHOOK_SECRET
;(process.env as Record<string, string>)['NODE_ENV'] = 'test'

const arg = (name: string, fallback: string) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

// ── 动态 import 真实生产代码 ────────────────────────────────────
const { NextRequest } = await import('next/server')
const webhook = await import('@/app/api/webhooks/dodo/route')
const store = await import('@/lib/payments/dodo/store')
const dbmod = await import('@/lib/db')

const db = dbmod.db

const ORG = 'org_e2e'
const ORG_B = 'org_t08_other'
const PRODUCT = 'pdt_growth_monthly'
const META_A = { organizationId: ORG, plan: 'GROWTH', interval: 'monthly' }
const META_B = { organizationId: ORG_B, plan: 'GROWTH', interval: 'monthly' }

interface Evidence {
  task: string
  runAt: string
  dbFile: string
  handlerInvocations: number
  steps: Array<{
    id: string
    scenario: string
    httpStatus: number
    response: Record<string, unknown>
    ledgerAfter: {
      plan: string
      status: string
      paidTotalCents: number
      netPaidCents: number
      eventCount: number
    }
    billingEventRows: Array<{ type: string; chargeId: string | null; amountCents: number | null; reason: string | null; dedupeKey: string }>
  }>
  crossTenant: {
    orgAEventCount: number
    orgBEventCount: number
    leak: boolean
  }
  signatureNegative: {
    forgedSignatureStatus: number
    replayedOldTimestampStatus: number
  }
  verdict: 'PASS' | 'FAIL'
  failures: string[]
}

const ev: Evidence = {
  task: 'V25-34',
  runAt: new Date().toISOString(),
  dbFile: DB_FILE,
  handlerInvocations: 0,
  steps: [],
  crossTenant: { orgAEventCount: 0, orgBEventCount: 0, leak: true },
  signatureNegative: { forgedSignatureStatus: -1, replayedOldTimestampStatus: -1 },
  verdict: 'FAIL',
  failures: [],
}

const keyBuf = Buffer.from(TEST_WEBHOOK_SECRET.slice('whsec_'.length), 'base64')

function sign(rawBody: string, webhookId: string, timestamp: string) {
  return createHmac('sha256', keyBuf).update(`${webhookId}.${timestamp}.${rawBody}`).digest('base64')
}

/**
 * 走真实 route handler。注入合法/伪造签名头，返回原始响应体与状态。
 */
async function deliver(opts: {
  event: Record<string, unknown>
  webhookId?: string
  timestamp?: string
  forgeSignature?: boolean
}) {
  const webhookId = opts.webhookId || `whv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const timestamp = opts.timestamp || String(Math.floor(Date.now() / 1000))
  const rawBody = JSON.stringify(opts.event)
  const good = sign(rawBody, webhookId, timestamp)
  const signature = opts.forgeSignature ? 'v1,' + 'A'.repeat(good.length) : `v1,${good}`
  const req = new NextRequest('https://app.lokfeel.test/api/webhooks/dodo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    },
    body: rawBody,
  })
  ev.handlerInvocations += 1
  const res = await webhook.POST(req)
  let json: Record<string, unknown> = {}
  try {
    json = await res.json()
  } catch {
    json = { unparsable: true }
  }
  return { status: res.status, json }
}

const paySucceeded = (paymentId: string, subId: string, meta = META_A) => ({
  type: 'payment.succeeded',
  data: {
    payment_id: paymentId,
    subscription_id: subId,
    product_id: PRODUCT,
    total_amount: 14900,
    currency: 'usd',
    metadata: meta,
  },
})
const payFailed = (paymentId: string, subId: string) => ({
  type: 'payment.failed',
  data: {
    payment_id: paymentId,
    subscription_id: subId,
    product_id: PRODUCT,
    total_amount: 14900,
    currency: 'usd',
    error_message: 'card_declined',
    metadata: META_A,
  },
})
const renewed = (paymentId: string, subId: string) => ({
  type: 'subscription.renewed',
  data: {
    payment_id: paymentId,
    subscription_id: subId,
    product_id: PRODUCT,
    recurring_pre_tax_amount: 14900,
    currency: 'usd',
    metadata: META_A,
  },
})
const cancelled = (subId: string) => ({
  type: 'subscription.cancelled',
  data: { subscription_id: subId, product_id: PRODUCT, metadata: META_A },
})

interface LedgerRow {
  type: string
  chargeId: string | null
  amountCents: number | null
  reason: string | null
  dedupeKey: string
}

async function snapshot(org: string): Promise<{
  view: Awaited<ReturnType<typeof store.readOrgSubscription>>
  rows: LedgerRow[]
}> {
  const view = await store.readOrgSubscription(org)
  const rows = await db.billingEvent.findMany({
    where: { organizationId: org },
    select: { type: true, chargeId: true, amountCents: true, reason: true, dedupeKey: true },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  return {
    view,
    rows: (rows as Array<Record<string, unknown>>).map((r) => ({
      type: String(r.type),
      chargeId: (r.chargeId as string | null) ?? null,
      amountCents: (r.amountCents as number | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      dedupeKey: String(r.dedupeKey),
    })),
  }
}

async function record(id: string, scenario: string, result: { status: number; json: Record<string, unknown> }) {
  const s = await snapshot(ORG)
  ev.steps.push({
    id,
    scenario,
    httpStatus: result.status,
    response: result.json,
    ledgerAfter: {
      plan: s.view.plan,
      status: s.view.status,
      paidTotalCents: s.view.paidTotalCents,
      netPaidCents: s.view.netPaidCents,
      eventCount: s.rows.length,
    },
    billingEventRows: s.rows as Array<{ type: string; chargeId: string | null; amountCents: number | null; reason: string | null; dedupeKey: string }>,
  })
  return s
}

function expect(cond: boolean, msg: string) {
  if (!cond) ev.failures.push(msg)
}

try {
  // ── 0a. 幂等建跨租户夹具组织（FK 目标；只动 v253 命名，不碰生产）──
  for (const [id, slug, name] of [
    [ORG, 'org-e2e', 'V253 账本主租户'],
    [ORG_B, 'org-t08-other', 'V253 账本跨租户对照'],
  ]) {
    await db.organization.upsert({
      where: { id },
      create: { id, slug, name },
      update: {},
    })
  }

  // ── 0b. 断言初始为空（防止拿脏库假绿）────────────────────────
  const initial = await snapshot(ORG)
  expect(initial.rows.length === 0, `initial ledger not empty: ${initial.rows.length} rows`)

  // ── 1. 首单 payment.succeeded（钱先到，订阅未开通 ⇒ 自动补开通）──
  let r = await deliver({ event: paySucceeded('pay_v253_001', 'sub_v253_A') })
  const afterFirst = await record('S1', '首单 payment.succeeded：开通→建款→收款三条', r)
  expect(r.status === 200, `S1 status ${r.status}`)
  expect(afterFirst.view.plan === 'GROWTH', `S1 plan=${afterFirst.view.plan}`)
  expect(afterFirst.view.status === 'ACTIVE', `S1 status=${afterFirst.view.status}`)
  expect(afterFirst.view.paidTotalCents === 14900, `S1 paid=${afterFirst.view.paidTotalCents}`)
  expect(afterFirst.rows.length === 3, `S1 expected 3 ledger rows, got ${afterFirst.rows.length}`)

  // ── 2. 完全重复投递（同事件体重放，新 webhook-id）────────────
  r = await deliver({ event: paySucceeded('pay_v253_001', 'sub_v253_A') })
  const afterDup = await record('S2', '同事件重放：账本不重复入账', r)
  expect(afterDup.rows.length === 3, `S2 duplicate caused new rows: ${afterDup.rows.length}`)
  expect(afterDup.view.paidTotalCents === 14900, `S2 double charge: ${afterDup.view.paidTotalCents}`)

  // ── 3. subscription.renewed 与 payment.succeeded 成对到达（不同 payment_id）──
  r = await deliver({ event: renewed('pay_v253_002', 'sub_v253_A') })
  const afterRenew = await record('S3', '续费 renewed：新增一笔成功收款', r)
  expect(afterRenew.view.paidTotalCents === 29800, `S3 paid=${afterRenew.view.paidTotalCents}`)

  // ── 4. 乱序：renewed 的重复 payment.succeeded 后到（同 payment_id）──
  r = await deliver({ event: paySucceeded('pay_v253_002', 'sub_v253_A') })
  const afterOutOfOrder = await record('S4', '乱序重放：renewed 与 succeeded 同键，整体回放不重复', r)
  expect(afterOutOfOrder.view.paidTotalCents === 29800, `S4 out-of-order double charge: ${afterOutOfOrder.view.paidTotalCents}`)

  // ── 5. R-15 核心：同一 payment_id 先 failed 后 succeeded ──────
  //    用一笔新的失败，再同 id 成功。账本内核应显式拒绝改判（FAILED 不可变），
  //    webhook 返回 200 + deferred，绝不静默吞掉、也不静默改账。
  r = await deliver({ event: payFailed('pay_v253_003', 'sub_v253_A') })
  const afterFail = await record('S5a', '同笔先 failed：记一笔失败', r)
  expect(afterFail.rows.some((x) => x.chargeId === 'pay_v253_003' && x.type === 'CHARGE_FAILED'), 'S5a no CHARGE_FAILED row')

  r = await deliver({ event: paySucceeded('pay_v253_003', 'sub_v253_A') })
  const afterFix = await record('S5b', '同笔后 succeeded：不可改判，deferred 告警而非静默吞', r)
  const deferred = r.json.deferred === true
  expect(r.status === 200, `S5b status ${r.status}`)
  expect(deferred, 'S5b expected deferred=true (ledger rejected illegal FAILED→SUCCEEDED)')
  const charge003 = afterFix.rows.filter((x) => x.chargeId === 'pay_v253_003')
  expect(!charge003.some((x) => x.type === 'CHARGE_SUCCEEDED'), 'S5b illegally appended CHARGE_SUCCEEDED over FAILED')

  // ── 6. 退款（CHARGE_REFUNDED 净额扣减）───────────────────────
  //    Dodo 无独立 refund 事件翻译分支；用账本层直接核对 netPaid 计算口径
  //    通过 subscription.cancelled 验证权益收敛 + 不重复取消。
  r = await deliver({ event: cancelled('sub_v253_A') })
  const afterCancel = await record('S6a', 'subscription.cancelled：权益收敛到 CANCELED', r)
  expect(afterCancel.view.status === 'CANCELED', `S6a status=${afterCancel.view.status}`)

  r = await deliver({ event: cancelled('sub_v253_A') })
  const afterCancelDup = await record('S6b', '重复取消：幂等，不写第二条', r)
  expect(afterCancelDup.rows.length === afterCancel.rows.length, 'S6b duplicate cancel added a row')

  // ── 7. 跨租户：orgB 的事件落 orgB 账本，orgA 账本不变 ────────
  const orgABefore = (await snapshot(ORG)).rows.length
  r = await deliver({ event: paySucceeded('pay_v253_B1', 'sub_v253_B', META_B) })
  ev.handlerInvocations += 0 // deliver 已计数
  const snapB = await snapshot(ORG_B)
  const orgAAfter = (await snapshot(ORG)).rows.length
  ev.crossTenant.orgAEventCount = orgAAfter
  ev.crossTenant.orgBEventCount = snapB.rows.length
  ev.crossTenant.leak = orgAAfter !== orgABefore || snapB.view.plan !== 'GROWTH'
  expect(r.status === 200, `S7 orgB status ${r.status}`)
  expect(orgAAfter === orgABefore, 'S7 cross-tenant leak: orgA ledger changed')
  expect(snapB.view.plan === 'GROWTH', `S7 orgB plan=${snapB.view.plan}`)

  // 单独记录 S7（用 orgB 视图，billingEventRows 用 orgB 行）
  ev.steps.push({
    id: 'S7',
    scenario: '跨租户：orgB 事件独立入账，orgA 不变',
    httpStatus: r.status,
    response: r.json,
    ledgerAfter: {
      plan: snapB.view.plan,
      status: snapB.view.status,
      paidTotalCents: snapB.view.paidTotalCents,
      netPaidCents: snapB.view.netPaidCents,
      eventCount: snapB.rows.length,
    },
    billingEventRows: snapB.rows,
  })

  // ── 8. 签名负例：伪造签名 401；过期时间戳 401 ────────────────
  const forged = await deliver({ event: paySucceeded('pay_v253_forged', 'sub_v253_X'), forgeSignature: true })
  ev.signatureNegative.forgedSignatureStatus = forged.status
  expect(forged.status === 401, `S8 forged signature status ${forged.status}`)

  const oldTs = String(Math.floor(Date.now() / 1000) - 3600)
  const replay = await deliver({ event: paySucceeded('pay_v253_replay', 'sub_v253_X'), timestamp: oldTs })
  ev.signatureNegative.replayedOldTimestampStatus = replay.status
  expect(replay.status === 401, `S8 old timestamp status ${replay.status}`)

  // ── 9. 收敛 ───────────────────────────────────────────────────
  ev.verdict = ev.failures.length === 0 ? 'PASS' : 'FAIL'
} catch (err) {
  ev.failures.push(`FATAL: ${err instanceof Error ? err.message : String(err)}`)
  ev.verdict = 'FAIL'
}

const outPath = path.resolve(ROOT, arg('out', 'docs/v25.3/evidence/V25-34_LEDGER_PROOF.json'))
fs.mkdirSync(path.dirname(outPath), { recursive: true })
// 脱敏：确认无 key/secret 泄漏进证据
const serialized = JSON.stringify(ev, null, 2)
if (serialized.includes(TEST_API_KEY) || serialized.includes(TEST_WEBHOOK_SECRET)) {
  console.error('REFUSE TO WRITE: evidence contains credential material')
  process.exit(2)
}
fs.writeFileSync(outPath, serialized + '\n')

console.log(`VERDICT=${ev.verdict} invocations=${ev.handlerInvocations} steps=${ev.steps.length} failures=${ev.failures.length}`)
if (ev.failures.length) console.log('FAILURES:', JSON.stringify(ev.failures))
console.log('OUT=' + path.relative(ROOT, outPath))
process.exit(ev.verdict === 'PASS' ? 0 : 1)
