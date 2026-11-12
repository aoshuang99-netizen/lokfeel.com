#!/usr/bin/env node
/**
 * S-02 · Hotfix 收银台**HTTP 级**证据（可复跑）
 *
 * 与 jest 的分工：
 *   · jest 证明"代码逻辑对"（路由级 mock，快、可穷举）；
 *   · 本脚本证明"真实进程 + 真实环境变量下行为对"（真 next start、真 HTTP）。
 * 两者都要有，因为 mock 掉的 `readDodoConfig` 永远不会告诉你
 * "凭据塞进去之后 commercialApproval 到底有没有出现"。
 *
 * 用法（对本地生产构建，或对 Preview 域名）:
 *   node scripts/qa/s02-hotfix-http-proof.mjs --base=http://127.0.0.1:3124 --out=evidence.json
 *
 * 关键判据（缺一即 FAIL，不允许"看起来关着"就通过）:
 *   1. `plans.checkoutReady === false`；
 *   2. `plans.commercialApproval` 必须存在且 `status` 为 `PENDING_APPROVAL`
 *      —— 只看 checkoutReady=false 无法区分"商业门关了"与"凭据没配所以不卖"；
 *   3. 若 health 报 `dodo.checkout === true`（凭据确实就绪），则 `plans.missing` 必须为空
 *      —— 否则说明是**技术门**挡的，商业门根本没被验证；
 *   4. 匿名 POST /checkout 仍返回 401（认证先于配置判定，守卫顺序不能被打乱）。
 */

export function judgeHotfixHttpProof(ev) {
  const reasons = []
  if (!ev.plans || typeof ev.plans.checkoutReady !== 'boolean') {
    return { verdict: 'ERROR', reasons: ['plans_unreachable_or_unparsable'] }
  }
  if (ev.plans.checkoutReady !== false) reasons.push('checkout_still_ready')
  const approval = ev.plans.commercialApproval
  if (!approval) reasons.push('commercial_approval_field_missing')
  else if (approval.status !== 'PENDING_APPROVAL') reasons.push(`unexpected_approval_status:${approval.status}`)
  else if (approval.ref !== null) reasons.push('approval_ref_present_without_human_approval')

  const dodoReady = ev.health?.channels?.['dodo.checkout'] === true
  if (dodoReady && Array.isArray(ev.plans.missing) && ev.plans.missing.length > 0) {
    reasons.push('missing_nonempty_while_credentials_ready')
  }
  if (ev.checkout?.status !== 401) reasons.push(`anonymous_checkout_not_401:${ev.checkout?.status}`)

  return {
    verdict: reasons.length ? 'FAIL' : 'PASS',
    reasons,
    summary: {
      checkoutReady: ev.plans.checkoutReady,
      environment: ev.plans.environment,
      missing: ev.plans.missing,
      approvalStatus: approval?.status ?? null,
      dodoChannelReady: dodoReady,
      anonymousCheckoutStatus: ev.checkout?.status ?? null,
    },
  }
}

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

async function getJson(base, path) {
  const res = await fetch(new URL(path, base), { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, bytes: text.length, json }
}

async function main() {
  const base = arg('base', 'http://127.0.0.1:3000')
  const out = arg('out', '')
  const ev = { checkedAt: new Date().toISOString(), base, readOnly: true }
  try {
    const health = await getJson(base, '/api/health')
    const plans = await getJson(base, '/api/payments/dodo/plans')
    const co = await fetch(new URL('/api/payments/dodo/checkout', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'STARTER', interval: 'monthly' }),
      signal: AbortSignal.timeout(20000),
    })
    ev.health = {
      status: health.status,
      commit: health.json?.commit,
      configured: health.json?.payments?.configured,
      channels: health.json?.payments?.channels,
      missing: health.json?.payments?.missing,
    }
    ev.plans = {
      status: plans.status,
      checkoutReady: plans.json?.checkoutReady,
      environment: plans.json?.environment,
      commercialApproval: plans.json?.commercialApproval ?? null,
      missing: plans.json?.missing,
      catalogVersion: plans.json?.catalogVersion,
    }
    ev.checkout = { status: co.status, body: await co.json().catch(() => null) }
    Object.assign(ev, judgeHotfixHttpProof(ev))
  } catch (e) {
    ev.verdict = 'ERROR'
    ev.reasons = [`probe_failed:${String(e?.message ?? e)}`]
  }
  const printed = JSON.stringify(ev, null, 2)
  process.stdout.write(`${printed}\n`)
  if (out) (await import('node:fs')).writeFileSync(out, `${printed}\n`, 'utf8')
  process.exitCode = ev.verdict === 'PASS' ? 0 : ev.verdict === 'FAIL' ? 2 : 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
