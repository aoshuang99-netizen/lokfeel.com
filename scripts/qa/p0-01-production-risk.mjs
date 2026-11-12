#!/usr/bin/env node
/**
 * P0-01 · 生产风险完整只读取证（V20.7 上线作战包 §1）
 *
 * 与作战包自带的 scripts/release-preflight.mjs 的关系：
 *   · 原脚本保留原文（sha 可核验），负责 health/plans/远端 SHA 的最小判定；
 *   · 本脚本补上任务书 P0-01 要求的完整取证面：/pricing 页面 CTA、
 *     响应头、health.payments 通道、productionCommit 与远端 SHA 的可追溯性，
 *     并对「证据缺失」执行拒绝式判定（缺一即 ERROR，绝不判 CLOSED/PASS）。
 *
 * 只读：全过程仅 GET + git ls-remote，不写生产、不发交易、不改环境变量。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

/** 只读取证计划 —— 测试会钉住「全 GET、无请求体」。 */
export function buildP001Plan(base) {
  const root = base.replace(/\/$/, '')
  return [
    { name: 'health', method: 'GET', url: `${root}/api/health` },
    { name: 'plans', method: 'GET', url: `${root}/api/payments/dodo/plans` },
    { name: 'pricing', method: 'GET', url: `${root}/pricing` },
    { name: 'git', method: 'GIT_LS_REMOTE', url: 'origin refs/heads/main' },
  ]
}

const REQUIRED = ['health', 'plans', 'pricing', 'headers', 'git']

/**
 * 纯函数判定层：输入已取到的证据，输出结论。
 * 任何一个必需证据块缺失 / HTTP 非 200 / 关键字段缺失 ⇒ ERROR。
 */
export function evaluateProductionRisk(evidence) {
  const reasons = []
  for (const key of REQUIRED) {
    if (!evidence?.[key] || typeof evidence[key] !== 'object') return { verdict: 'ERROR', reasons: [`evidence_missing:${key}`], traceability: null }
  }
  const { health, plans, pricing, headers, git } = evidence
  for (const [name, block] of Object.entries({ health, plans, pricing })) {
    if (block.httpStatus !== 200) return { verdict: 'ERROR', reasons: [`${name}_http_${block.httpStatus}`], traceability: null }
  }
  if (health.status !== 'healthy' || typeof health.commit !== 'string' || !/^[a-f\d]{7,40}$/.test(health.commit)) {
    return { verdict: 'ERROR', reasons: ['health_status_or_commit_invalid'], traceability: null }
  }
  for (const key of ['environment', 'catalogVersion', 'approvedAt']) {
    if (typeof plans[key] !== 'string' || !plans[key].trim()) return { verdict: 'ERROR', reasons: [`plans_${key}_missing`], traceability: null }
  }
  if (typeof plans.checkoutReady !== 'boolean') return { verdict: 'ERROR', reasons: ['plans_checkoutReady_missing'], traceability: null }
  if (typeof pricing.hasCheckoutCta !== 'boolean') return { verdict: 'ERROR', reasons: ['pricing_cta_evidence_missing'], traceability: null }
  // 页面取证必须真的拿到内容：HTTP 200 + 空 body 属于"没扫到"，不能当成"已关闭"。
  // 否则一个恒返回空页的代理会让 P0-01 变成空集恒真的假绿。
  if (typeof pricing.bytes !== 'number' || pricing.bytes <= 0) {
    return { verdict: 'ERROR', reasons: ['pricing_empty_body_not_a_scan'], traceability: null }
  }
  if (typeof health.charging !== 'boolean' || typeof health.dodoCheckoutChannel !== 'boolean') {
    return { verdict: 'ERROR', reasons: ['health_payments_channels_missing'], traceability: null }
  }
  if (!/^[a-f\d]{40}$/.test(git.remoteMainSha || '')) return { verdict: 'ERROR', reasons: ['remote_sha_missing'], traceability: null }
  if (!headers.server || typeof headers.server !== 'string') return { verdict: 'ERROR', reasons: ['headers_server_missing'], traceability: null }

  const traceability = {
    productionCommit: health.commit,
    remoteMainSha: git.remoteMainSha,
    shaDrift: !git.remoteMainSha.startsWith(health.commit),
    edge: headers.server,
    charging: health.charging,
    dodoCheckoutChannel: health.dodoCheckoutChannel,
    pricingCtaVisible: pricing.hasCheckoutCta,
    catalogVersion: plans.catalogVersion,
    approvedAt: plans.approvedAt,
    environment: plans.environment,
  }

  const live = plans.checkoutReady === true && plans.environment === 'live_mode'
  if (live) {
    reasons.push('live_checkout_enabled_on_old_production_code')
    reasons.push('R15_settlement_dedupe_defect_present_in_production_commit')
    if (pricing.hasCheckoutCta) reasons.push('pricing_page_exposes_clickable_checkout_cta')
    if (traceability.shaDrift) reasons.push('production_commit_drifts_from_remote_main_candidate')
    return { verdict: 'RISK_OPEN', reasons, traceability }
  }
  if (plans.checkoutReady === false) {
    reasons.push('no_live_checkout_enabled')
    return { verdict: 'CLOSED', reasons, traceability }
  }
  return { verdict: 'ERROR', reasons: ['unclassified_plans_state'], traceability }
}

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

async function get(base, pathname) {
  const u = new URL(pathname, base)
  if (u.protocol !== 'https:') throw new Error(`HTTPS required: ${u.origin}`)
  const started = Date.now()
  const resp = await fetch(u, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), cache: 'no-store' })
  const body = await resp.text()
  return { httpStatus: resp.status, elapsedMs: Date.now() - started, body, headers: resp.headers }
}

async function main() {
  const base = arg('base', 'https://app.lokfeel.com')
  const out = arg('out', '')
  const at = new Date().toISOString()
  const result = { checkedAt: at, base, readOnly: true, plan: buildP001Plan(base), verdict: 'ERROR', reasons: [], evidence: {}, traceability: null }
  try {
    const plan = buildP001Plan(base)
    const [healthResp, plansResp, pricingResp] = await Promise.all([
      get(base, new URL(plan[0].url).pathname),
      get(base, new URL(plan[1].url).pathname),
      get(base, new URL(plan[2].url).pathname),
    ])
    const health = JSON.parse(healthResp.body)
    const plans = JSON.parse(plansResp.body)
    const remoteRaw = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8', timeout: 20000 }).trim()
    result.evidence = {
      health: {
        httpStatus: healthResp.httpStatus, elapsedMs: healthResp.elapsedMs,
        status: health.status, commit: health.commit,
        charging: health.payments?.charging,
        dodoCheckoutChannel: health.payments?.channels?.['dodo.checkout'],
        paymentsMissing: health.payments?.missing,
        paymentsConfigured: health.payments?.configured,
      },
      plans: {
        httpStatus: plansResp.httpStatus, elapsedMs: plansResp.elapsedMs,
        environment: plans.environment, checkoutReady: plans.checkoutReady,
        approvedAt: plans.approvedAt ?? null, catalogVersion: plans.catalogVersion,
        planCount: Array.isArray(plans.plans) ? plans.plans.length : null,
        commercialApproval: plans.commercialApproval ?? null,
      },
      pricing: {
        httpStatus: pricingResp.httpStatus, elapsedMs: pricingResp.elapsedMs,
        bytes: pricingResp.body.length,
        hasCheckoutCta: /checkout|subscribe|start trial/i.test(pricingResp.body),
        ctaKeywords: [...new Set((pricingResp.body.match(/checkout|subscribe|start trial/gi) || []).map((s) => s.toLowerCase()))],
      },
      headers: { server: pricingResp.headers.get('server'), cfRay: pricingResp.headers.get('cf-ray'), nfRequestId: pricingResp.headers.get('x-nf-request-id') },
      git: { remoteMainSha: remoteRaw.split(/\s+/)[0] },
    }
    const verdict = evaluateProductionRisk(result.evidence)
    result.verdict = verdict.verdict
    result.reasons = verdict.reasons
    result.traceability = verdict.traceability
  } catch (e) {
    result.verdict = 'ERROR'
    result.reasons.push(`fetch_or_parse_failed:${String(e?.message ?? e)}`)
  }
  const printed = JSON.stringify(result, null, 2)
  process.stdout.write(`${printed}\n`)
  if (out) writeFileSync(out, `${printed}\n`, 'utf8')
  process.exitCode = result.verdict === 'CLOSED' ? 0 : result.verdict === 'RISK_OPEN' ? 2 : 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
