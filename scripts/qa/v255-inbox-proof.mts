/**
 * V25.5 P0.1 · Durable Inbox 真实 DB 集成证明（隔离库 / 不扣款 / 不部署）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 与 inbox-state.test.ts（22 个纯函数场景）互补：这里用**真实 Prisma 落隔离库**
 * 验证 store 层的四个关键后置条件：
 *   1. receiveEvent 幂等：同 deliveryId 重复收件不产生第二条行；
 *   2. ACK 与持久化绑定：事件先落库再处理（receiveEvent 成功 = 可安全回 2xx）；
 *   3. R-15 最终结算：failed→succeeded 在 Provider 确认 paid 时补偿结算到 SETTLED，
 *      账本真的多出一笔 recovery 款项，权益（paidTotalCents）恢复；
 *   4. 冲突可恢复：无凭据/unknown 进 NEEDS_PROVIDER_RECONCILIATION（可追踪队列），
 *      注入 Provider paid 后重新处理 → SETTLED；重复处理不重复入账（worker 恢复）。
 *
 * ── 诚实边界 ──────────────────────────────────────────────────────
 *   · Provider verifier 是**本地确定性注入**（模拟权威状态），不是真实 Dodo Test
 *     Mode 回执 —— 本脚本标 PROVIDER_NOT_TESTED，绝不声称外部结算已验证；
 *   · 隔离库 /tmp/v255-inbox.db，与生产无关；凭据为构造假值；零真实扣款；
 *   · 通过 store 函数进程内调用，非 TCP HTTP。
 *
 * 用法：
 *   E2E_DB_FILE=/tmp/v255-inbox.db E2E_DDL_FILE=/tmp/v255-inbox-ddl.sql \
 *     env -u NODE_OPTIONS node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
 *   env -u NODE_OPTIONS npx tsx scripts/qa/v255-inbox-proof.mts \
 *     --out=docs/v25.5/evidence/P0.1_INBOX_DB_PROOF.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const DB_FILE = process.env.V255_DB_FILE || '/tmp/v255-inbox.db'
process.env.DATABASE_URL = `file:${DB_FILE}`
;(process.env as Record<string, string>)['NODE_ENV'] = 'test'

const arg = (name: string, fallback: string) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

const store = await import('@/lib/billing/inbox-store')
const dbmod = await import('@/lib/db')
const db = dbmod.db

const ORG = 'org_e2e'
const ORG_B = 'org_t08_other'

// ── 本地确定性 Provider（模拟权威状态，非真实 Dodo）────────────────
let truthMode: 'paid' | 'unpaid' | 'unavailable' = 'unavailable'
const verifier = {
  async verifyPayment() {
    if (truthMode === 'unavailable') {
      return { status: 'unknown' as const, verified: false, amountCents: null, currency: null, reason: 'PROVIDER_NOT_TESTED (local deterministic inject)' }
    }
    if (truthMode === 'paid') {
      return { status: 'paid' as const, verified: true, amountCents: 14900, currency: 'USD' }
    }
    return { status: 'unpaid' as const, verified: true, amountCents: null, currency: null }
  },
}

const hash = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex').slice(0, 16)

interface Step {
  id: string
  scenario: string
  result: Record<string, unknown>
}
const steps: Step[] = []
const failures: string[] = []
function expect(cond: boolean, msg: string) {
  if (!cond) failures.push(msg)
}
function step(id: string, scenario: string, result: Record<string, unknown>) {
  steps.push({ id, scenario, result })
}

async function inboxSnapshot(deliveryId: string) {
  const r = await db.billingInboxEvent.findUnique({ where: { deliveryId } })
  return r ? {
    status: r.status, attempts: r.attempts, appliedToLedger: r.appliedToLedger,
    lastNote: r.lastNote, eventId: r.eventId,
  } : null
}

async function ledgerSnapshot() {
  return store.loadLedgerFacts(ORG)
}

try {
  // ── 0. 夹具组织 ────────────────────────────────────────────────
  for (const [id, slug, name] of [
    [ORG, 'org-e2e', 'V255 inbox 主租户'],
    [ORG_B, 'org-t08-other', 'V255 inbox 跨租户对照'],
  ]) {
    await db.organization.upsert({ where: { id }, create: { id, slug, name }, update: {} })
  }

  // ── 1. 构造"先失败"的账本状态：直接写一条 FAILED 款项 ──────────
  // 用真实账本内核：SUBSCRIPTION_STARTED + CHARGE_CREATED + CHARGE_FAILED
  const dodo = await import('@/lib/payments/dodo/store')
  await dodo.applyCommands(ORG, [
    { type: 'SUBSCRIPTION_STARTED', plan: 'GROWTH', dedupeKey: 'proof:sub-start', offsetMs: 0, providerRef: 'sub_v255' },
    { type: 'CHARGE_CREATED', chargeId: 'pay_v255_1', amountCents: 14900, currency: 'USD', plan: 'GROWTH', dedupeKey: 'proof:charge-created', offsetMs: 1, providerRef: 'sub_v255' },
    { type: 'CHARGE_FAILED', chargeId: 'pay_v255_1', amountCents: 14900, currency: 'USD', reason: 'card_declined', plan: 'GROWTH', dedupeKey: 'proof:charge-failed', offsetMs: 2, providerRef: 'sub_v255' },
  ], new Date('2026-11-20T00:00:00.000Z'))
  const beforeFailed = await ledgerSnapshot()
  expect(beforeFailed.charges.some((c) => c.chargeId === 'pay_v255_1' && c.status === 'FAILED'), 'setup: charge not FAILED')
  step('S0', '构造先失败的账本状态', { ledger: beforeFailed })

  // ── 2. 收件 payment.succeeded（同 payment_id）─────────────────
  const successEvent = {
    deliveryId: 'whd_v255_r15_1',
    eventId: 'evt_v255_r15_1',
    type: 'payment.succeeded',
    organizationId: ORG,
    paymentId: 'pay_v255_1',
    subscriptionId: 'sub_v255',
    amountCents: 14900,
    currency: 'USD',
    payloadHash: hash('payment.succeeded pay_v255_1'),
    receivedAt: '2026-11-20T00:01:00.000Z',
  }
  const recv1 = await store.receiveEvent(successEvent)
  expect(recv1.inserted === true, 'S2 first receive should insert')
  // 幂等：同 delivery 再收件
  const recv2 = await store.receiveEvent(successEvent)
  expect(recv2.inserted === false && recv2.id === recv1.id, 'S2 duplicate receive must be idempotent')
  step('S2', '收件幂等 + ACK 绑定持久化', { first: recv1, duplicate: recv2, inbox: await inboxSnapshot(successEvent.deliveryId) })

  // ── 3. 无凭据处理 → 进核验态，绝不结算 ─────────────────────────
  truthMode = 'unavailable'
  const p1 = await store.processInboxEvent(successEvent.deliveryId, { plan: 'GROWTH' }, { verifier })
  expect(p1.status === 'NEEDS_PROVIDER_RECONCILIATION', `S3 status=${p1.status}`)
  expect(p1.appliedCommands === 0, 'S3 must not grant entitlement without provider')
  const afterNoCred = await ledgerSnapshot()
  expect(afterNoCred.charges.length === beforeFailed.charges.length, 'S3 ledger must not change')
  step('S3', '无 Provider 凭据 → 核验态、零权益授予', { process: p1, ledger: afterNoCred, inbox: await inboxSnapshot(successEvent.deliveryId) })

  // ── 4. 注入 Provider=paid 重新处理（worker 恢复）→ SETTLED ──────
  truthMode = 'paid'
  const p2 = await store.processInboxEvent(successEvent.deliveryId, { plan: 'GROWTH' }, { verifier })
  expect(p2.status === 'SETTLED', `S4 status=${p2.status}`)
  expect(p2.appliedCommands === 2, `S4 applied=${p2.appliedCommands}`)
  const afterSettled = await ledgerSnapshot()
  expect(afterSettled.charges.some((c) => c.chargeId.includes('recovered') && c.status === 'SUCCEEDED'), 'S4 recovery charge missing')
  expect(afterSettled.charges.length === beforeFailed.charges.length + 1, 'S4 exactly one recovery charge')
  step('S4', 'Provider 确认 paid → 补偿结算 SETTLED', { process: p2, ledger: afterSettled, inbox: await inboxSnapshot(successEvent.deliveryId) })

  // ── 5. 再次处理同一 delivery（worker 重启重放）→ 不重复入账 ────
  const p3 = await store.processInboxEvent(successEvent.deliveryId, { plan: 'GROWTH' }, { verifier })
  const afterReplay = await ledgerSnapshot()
  expect(afterReplay.charges.length === afterSettled.charges.length, 'S5 replay duplicated ledger')
  expect(p3.appliedCommands === 0, 'S5 replay should apply 0 commands')
  step('S5', 'worker 重启重放同一 delivery → 零重复入账', { process: p3, ledger: afterReplay })

  // ── 6. 跨租户：orgB 的失败→成功事件独立结算 ───────────────────
  await dodo.applyCommands(ORG_B, [
    { type: 'SUBSCRIPTION_STARTED', plan: 'GROWTH', dedupeKey: 'proofB:sub-start', offsetMs: 0, providerRef: 'sub_v255_B' },
    { type: 'CHARGE_CREATED', chargeId: 'pay_v255_B', amountCents: 14900, currency: 'USD', plan: 'GROWTH', dedupeKey: 'proofB:created', offsetMs: 1, providerRef: 'sub_v255_B' },
    { type: 'CHARGE_FAILED', chargeId: 'pay_v255_B', amountCents: 14900, currency: 'USD', reason: 'declined', plan: 'GROWTH', dedupeKey: 'proofB:failed', offsetMs: 2, providerRef: 'sub_v255_B' },
  ], new Date('2026-11-20T00:00:00.000Z'))
  const crossEvent = { ...successEvent, deliveryId: 'whd_v255_cross', eventId: 'evt_v255_cross', organizationId: ORG_B, paymentId: 'pay_v255_B', subscriptionId: 'sub_v255_B' }
  await store.receiveEvent(crossEvent)
  truthMode = 'paid'
  const pCross = await store.processInboxEvent(crossEvent.deliveryId, { plan: 'GROWTH' }, { verifier })
  expect(pCross.status === 'SETTLED', `S6 cross status=${pCross.status}`)
  const orgAFinal = await ledgerSnapshot()
  expect(orgAFinal.charges.length === afterReplay.charges.length, 'S6 orgA ledger changed by orgB event')
  step('S6', '跨租户事件独立结算，orgA 账本零变化', { process: pCross, orgALedger: orgAFinal })

  // ── 7. Provider=unpaid → DEAD_LETTER（不授予权益）──────────────
  await dodo.applyCommands(ORG, [
    { type: 'CHARGE_CREATED', chargeId: 'pay_v255_2', amountCents: 14900, currency: 'USD', plan: 'GROWTH', dedupeKey: 'proof:charge2-created', offsetMs: 3, providerRef: 'sub_v255' },
    { type: 'CHARGE_FAILED', chargeId: 'pay_v255_2', amountCents: 14900, currency: 'USD', reason: 'declined', plan: 'GROWTH', dedupeKey: 'proof:charge2-failed', offsetMs: 4, providerRef: 'sub_v255' },
  ], new Date('2026-11-20T00:00:00.000Z'))
  const unpaidEvent = { ...successEvent, deliveryId: 'whd_v255_unpaid', eventId: 'evt_v255_unpaid', paymentId: 'pay_v255_2' }
  await store.receiveEvent(unpaidEvent)
  truthMode = 'unpaid'
  const pUnpaid = await store.processInboxEvent(unpaidEvent.deliveryId, { plan: 'GROWTH' }, { verifier })
  expect(pUnpaid.status === 'DEAD_LETTER', `S7 status=${pUnpaid.status}`)
  step('S7', 'Provider 确认未付 → DEAD_LETTER（不授予权益）', { process: pUnpaid, inbox: await inboxSnapshot(unpaidEvent.deliveryId) })

  // ── 8. 待处理队列可观测 ────────────────────────────────────────
  const pending = await store.listPendingInbox()
  step('S8', '待处理/复核队列可观测', { count: pending.length, statuses: pending.map((p) => p.status) })

} catch (err) {
  failures.push(`FATAL: ${err instanceof Error ? err.stack : String(err)}`)
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
const outPath = path.resolve(ROOT, arg('out', 'docs/v25.5/evidence/P0.1_INBOX_DB_PROOF.json'))
fs.mkdirSync(path.dirname(outPath), { recursive: true })
const evidence = {
  task: 'P0.1/V25-34',
  runAt: new Date().toISOString(),
  dbFile: DB_FILE,
  providerMode: 'LOCAL_DETERMINISTIC_INJECT (PROVIDER_NOT_TESTED)',
  verdict,
  failures,
  steps,
}
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n')
console.log(`VERDICT=${verdict} steps=${steps.length} failures=${failures.length}`)
if (failures.length) console.log('FAILURES:', JSON.stringify(failures, null, 2))
console.log('OUT=' + path.relative(ROOT, outPath))
process.exit(verdict === 'PASS' ? 0 : 1)
