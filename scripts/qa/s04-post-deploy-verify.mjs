#!/usr/bin/env node
/**
 * S-04 · 热修复上生产后的只读复验（V20.7 总令）
 *
 * 背景：`rc/hotfix-checkout-safety`（RC `c97c893`）的修复内容，已随 main 头
 * 提交 `0e16959` 的 Netlify 构建进入生产（`/api/health` → `commit: 0e16959`）。
 * 因此本脚本的任务不是"再部署一次"，而是证明**产线上跑的就是 RC 的支付代码**，
 * 并证明门禁在真实 HTTP 上真的关着。
 *
 * 契约：
 *   - 取数只发 GET，外加**一条匿名 POST** 打结账入口（401 在鉴权后才读 body，
 *     未登录不可能创建会话；路由注释见 checkout/route.ts 状态码约定）。
 *   - 不改生产、不写账本、不产生任何结账会话或扣款。
 *   - 判定与取数分离：`evaluateS04()` 是纯函数，`--selftest` 用 5 个夹具
 *     证明它**能变红**（防止"永远 PASS"的空断言）。
 *
 * 用法：
 *   env -u NODE_OPTIONS node scripts/qa/s04-post-deploy-verify.mjs \
 *     --base=https://app.lokfeel.com \
 *     --rc=c97c893 --deployed=0e16959 \
 *     --write=docs/release/lokfeel-final-20261110/evidence/s04-post-deploy-verify.json
 *   env -u NODE_OPTIONS node scripts/qa/s04-post-deploy-verify.mjs --selftest
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export const B4_PUBLIC_ROUTES = ['/product', '/solutions', '/stories', '/how-it-works', '/help']

/** 支付面：RC 与产线必须逐 blob 相等。少一个都说明"部署的不是 RC"。 */
export const PAYMENT_BLOBS = [
  'src/app/api/payments/dodo/checkout/route.ts',
  'src/app/api/payments/dodo/plans/route.ts',
  'src/lib/payments/commercial-gate.ts',
  'src/lib/payments/dodo/events.ts',
  'src/config/products.ts',
]

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

/**
 * 判定层（纯函数）。
 * 顺序即优先级：证据不全 → ERROR；代码不是 RC → CODE_PARITY_MISMATCH；
 * 任一门禁判据不符 → RISK_OPEN；全过才是 PRODUCTION_RISK_CLOSED。
 *
 * 注意 scopeDrift 只作**报告项**，不参与风险关闭判定 ——
 * 页面是否该上线是范围决策，不是支付安全判据，二者不得混算。
 */
export function evaluateS04(ev) {
  const fail = (verdict, reasons) => ({ verdict, reasons })
  const h = ev.health
  const p = ev.plans
  if (!h || typeof h.httpStatus !== 'number') return fail('ERROR', ['health_fetch_failed'])
  if (h.httpStatus !== 200) return fail('ERROR', [`health_not_200:${h.httpStatus}`])
  if (!h.commit) return fail('ERROR', ['health_commit_missing'])
  if (!ev.deployed?.resolvedSha) return fail('ERROR', ['deployed_sha_unresolved'])
  if (!h.commit.startsWith(ev.deployed.resolvedSha.slice(0, 7))) {
    return fail('TRACEABILITY_MISMATCH', [`health_commit_${h.commit}_not_${ev.deployed.resolvedSha.slice(0, 7)}`])
  }
  if (!p || typeof p.httpStatus !== 'number') return fail('ERROR', ['plans_fetch_failed'])
  if (p.httpStatus !== 200) return fail('ERROR', [`plans_not_200:${p.httpStatus}`])
  if (typeof p.checkoutReady !== 'boolean') return fail('ERROR', ['plans_checkoutReady_missing'])

  const parity = ev.codeParity || {}
  const mismatched = PAYMENT_BLOBS.filter((f) => parity[f] !== true)
  if (mismatched.length) {
    return fail('CODE_PARITY_MISMATCH', mismatched.map((f) => `blob_differs_from_rc:${f}`))
  }

  const reasons = []
  if (p.checkoutReady !== false) reasons.push('checkout_ready_is_true_on_production')
  if (p.commercialApproval?.status !== 'PENDING_APPROVAL') {
    reasons.push(`commercial_status_${p.commercialApproval?.status ?? 'missing'}_not_PENDING_APPROVAL`)
  }
  if (p.commercialApproval?.ref !== null) reasons.push('commercial_approval_ref_not_null')
  if (ev.anonymousCheckout?.httpStatus !== 401) {
    reasons.push(`anonymous_checkout_${ev.anonymousCheckout?.httpStatus ?? 'missing'}_not_401`)
  }
  if (reasons.length) return fail('RISK_OPEN', reasons)

  return fail('PRODUCTION_RISK_CLOSED', [])
}

/** 范围漂移：文档口径是"五个公开页在生产 404"，实测 200 即为漂移。 */
export function detectScopeDrift(routes = {}) {
  const live = B4_PUBLIC_ROUTES.filter((r) => routes[r]?.httpStatus === 200)
  return { drifted: live.length > 0, liveRoutes: live }
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

async function get(base, pathname) {
  const url = new URL(pathname, base).toString()
  const startedAt = Date.now()
  try {
    const res = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25_000) })
    const body = await res.text()
    return { url, httpStatus: res.status, bytes: Buffer.byteLength(body), ms: Date.now() - startedAt, body }
  } catch (err) {
    return { url, httpStatus: 0, bytes: 0, ms: Date.now() - startedAt, error: String(err?.message || err) }
  }
}

async function postAnonymous(base, pathname) {
  const url = new URL(pathname, base).toString()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'STARTER', interval: 'monthly' }),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    })
    const body = await res.text()
    let json = null
    try { json = JSON.parse(body) } catch { /* 非 JSON 也算证据 */ }
    return { url, httpStatus: res.status, bytes: Buffer.byteLength(body), code: json?.code ?? null, error: json?.error ?? null }
  } catch (err) {
    return { url, httpStatus: 0, bytes: 0, error: String(err?.message || err) }
  }
}

async function collect({ base, rc, deployed }) {
  const deployedSha = git(['rev-parse', deployed])
  const rcSha = git(['rev-parse', rc])
  const healthRes = await get(base, '/api/health')
  let health = { httpStatus: healthRes.httpStatus, bytes: healthRes.bytes }
  if (healthRes.httpStatus === 200) {
    try {
      const j = JSON.parse(healthRes.body)
      health = { ...health, commit: j.commit, builtAt: j.builtAt, version: j.version, payments: j.payments, botModule: j.botModule }
    } catch { health.error = 'health_not_json' }
  } else { health.error = healthRes.error }

  const plansRes = await get(base, '/api/payments/dodo/plans')
  let plans = { httpStatus: plansRes.httpStatus, bytes: plansRes.bytes }
  if (plansRes.httpStatus === 200) {
    try {
      const j = JSON.parse(plansRes.body)
      plans = { ...plans, ok: j.ok, currency: j.currency, catalogVersion: j.catalogVersion, checkoutReady: j.checkoutReady, commercialApproval: j.commercialApproval, missing: j.missing, environment: j.environment, planCount: Array.isArray(j.plans) ? j.plans.length : null }
    } catch { plans.error = 'plans_not_json' }
  } else { plans.error = plansRes.error }

  const anonymousCheckout = await postAnonymous(base, '/api/payments/dodo/checkout')

  const routes = {}
  for (const r of ['/pricing', ...B4_PUBLIC_ROUTES]) {
    const row = await get(base, r)
    routes[r] = { httpStatus: row.httpStatus, bytes: row.bytes, ms: row.ms, pricingShows49: r === '/pricing' ? /\$49/.test(row.body || '') : undefined }
  }

  const codeParity = {}
  for (const f of PAYMENT_BLOBS) {
    try {
      const a = git(['rev-parse', `${rcSha}:${f}`])
      const b = git(['rev-parse', `${deployedSha}:${f}`])
      codeParity[f] = a === b
    } catch { codeParity[f] = false }
  }

  const eventsAtDeployed = git(['show', `${deployedSha}:src/lib/payments/dodo/events.ts`])
  const settledKeySplit = /succeeded/.test(eventsAtDeployed) && /failed/.test(eventsAtDeployed)

  return {
    checkedAt: new Date().toISOString(),
    base,
    readOnly: true,
    rc: { ref: rc, sha: rcSha },
    deployed: { ref: deployed, resolvedSha: deployedSha },
    health,
    plans,
    anonymousCheckout,
    routes,
    codeParity,
    r15: { settledKeySplit, source: `${deployedSha}:src/lib/payments/dodo/events.ts` },
    git: { remoteMainSha: git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] },
  }
}

function selftest() {
  const good = {
    health: { httpStatus: 200, commit: '0e16959' },
    deployed: { resolvedSha: '0e16959abcdef0123456789abcdef0123456789ab' },
    plans: { httpStatus: 200, checkoutReady: false, commercialApproval: { status: 'PENDING_APPROVAL', ref: null } },
    anonymousCheckout: { httpStatus: 401 },
    codeParity: Object.fromEntries(PAYMENT_BLOBS.map((f) => [f, true])),
  }
  const clone = (patch) => ({
    ...good,
    ...patch,
    plans: { ...good.plans, ...(patch.plans || {}) },
    codeParity: { ...good.codeParity, ...(patch.codeParity || {}) },
  })
  const fixtures = [
    ['门禁关闭 + 代码等值 → CLOSED', good, 'PRODUCTION_RISK_CLOSED'],
    ['checkoutReady=true（旧版本）→ OPEN', clone({ plans: { checkoutReady: true } }), 'RISK_OPEN'],
    ['商业批准被自填 → OPEN', clone({ plans: { commercialApproval: { status: 'APPROVED', ref: 'SELF-1' } } }), 'RISK_OPEN'],
    ['匿名 POST 未拦住 → OPEN', clone({ anonymousCheckout: { httpStatus: 200 } }), 'RISK_OPEN'],
    ['支付源码与 RC 不等值 → PARITY', clone({ codeParity: { [PAYMENT_BLOBS[0]]: false } }), 'CODE_PARITY_MISMATCH'],
    ['health.commit 与部署 SHA 不符 → TRACE', clone({ health: { httpStatus: 200, commit: 'dead-beef' } }), 'TRACEABILITY_MISMATCH'],
  ]
  let pass = 0
  for (const [name, ev, want] of fixtures) {
    const got = evaluateS04(ev).verdict
    const ok = got === want
    console.log(`${ok ? 'PASS' : 'FAIL'} · ${name} → ${got}${ok ? '' : ` (want ${want})`}`)
    if (ok) pass++
  }
  const drift = detectScopeDrift({ '/product': { httpStatus: 200 }, '/help': { httpStatus: 404 } })
  const driftOk = drift.drifted === true && drift.liveRoutes.length === 1
  console.log(`${driftOk ? 'PASS' : 'FAIL'} · 范围漂移识别 → ${drift.liveRoutes.join(',')}`)
  if (driftOk) pass++
  const total = fixtures.length + 1
  console.log(`\n判定层 ${pass}/${total}`)
  if (pass !== total) process.exitCode = 1
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest()

  const base = arg('base', 'https://app.lokfeel.com')
  const rc = arg('rc', 'c97c893')
  const deployed = arg('deployed', '0e16959')
  const writeTo = arg('write', '')

  const ev = await collect({ base, rc, deployed })
  const verdict = evaluateS04(ev)
  const scope = detectScopeDrift(ev.routes)
  const report = {
    ...ev,
    verdict,
    scopeDrift: { ...scope, documentedExpectation: 'B4 五页在生产应为 404（GA 未发布）', finding: scope.drifted ? 'SCOPE_DRIFT_B4_PUBLIC_PAGES_LIVE' : 'NONE' },
    criteria: {
      checkoutReadyFalse: ev.plans.checkoutReady === false,
      commercialPending: ev.plans.commercialApproval?.status === 'PENDING_APPROVAL' && ev.plans.commercialApproval?.ref === null,
      anonymousCheckout401: ev.anonymousCheckout?.httpStatus === 401,
      paymentBlobParity: Object.values(ev.codeParity).every(Boolean),
      r15SettledKeySplit: ev.r15?.settledKeySplit === true,
      healthCommitTraceable: ev.health.commit === ev.deployed.resolvedSha.slice(0, 7),
    },
    knownDefects: {
      pricingShowsAmountBeforeApproval: ev.routes['/pricing']?.pricingShows49 === true,
      note: '线上既有缺陷，RC 与 main 同源，非本次引入',
    },
  }

  if (writeTo) writeFileSync(writeTo, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`\nS-04 生产复验 @ ${base}`)
  console.log(`  部署提交   ${ev.deployed.resolvedSha.slice(0, 7)} (${ev.deployed.ref}) · builtAt=${ev.health.builtAt ?? 'n/a'}`)
  console.log(`  RC         ${ev.rc.sha.slice(0, 7)} (${ev.rc.ref})`)
  console.log(`  checkoutReady=${ev.plans.checkoutReady} · commercial=${ev.plans.commercialApproval?.status} · env=${ev.plans.environment} · missing=${JSON.stringify(ev.plans.missing)}`)
  console.log(`  匿名 POST checkout → ${ev.anonymousCheckout.httpStatus} ${ev.anonymousCheckout.code ?? ''}`)
  console.log(`  支付源码等值: ${Object.entries(ev.codeParity).map(([f, ok]) => `${ok ? '=' : '≠'}${f.split('/').pop()}`).join(' ')}`)
  console.log(`  R-15 分态结算键: ${ev.r15.settledKeySplit ? 'present' : 'MISSING'}`)
  console.log(`  路由: ${Object.entries(ev.routes).map(([r, v]) => `${r}=${v.httpStatus}`).join(' ')}`)
  if (scope.drifted) console.log(`  ⚠ 范围漂移: ${scope.liveRoutes.join(',')} 已在线（GA 文档口径为 404）`)
  console.log(`\n判定: ${verdict.verdict}${verdict.reasons.length ? ` · ${verdict.reasons.join(', ')}` : ''}`)
  if (writeTo) console.log(`证据: ${writeTo}`)
  if (verdict.verdict !== 'PRODUCTION_RISK_CLOSED') process.exitCode = 2
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exitCode = 1 })
}
