#!/usr/bin/env node
/**
 * S-01 · 生产安全热修复前置只读取证（V20.7 总令）
 *
 * 只读契约：所有 HTTP 均为 GET（redirect:'error'、cache:'no-store'），
 * 唯一外部命令是 `git ls-remote`。不写生产、不写账本、不产生扣款。
 *
 * 覆盖任务书 §1：health / plans / pricing / 五个公开路由 / 源站响应头 /
 * 远端 main SHA / 生产 deploy ID 线索。任一请求失败或空 body 一律 ERROR，
 * 禁止沿用历史快照冒充实时证据。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export const PUBLIC_ROUTES = [
  '/product',
  '/solutions',
  '/stories',
  '/how-it-works',
  '/help',
]

export const CORE_ROUTES = [
  '/api/health',
  '/api/payments/dodo/plans',
  '/pricing',
  ...PUBLIC_ROUTES,
]

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

export function buildS01Plan(base) {
  return [
    ...CORE_ROUTES.map((pathname) => ({ name: pathname, method: 'GET', url: new URL(pathname, base).toString() })),
    { name: 'git-ls-remote', method: 'GIT_LS_REMOTE', url: 'origin refs/heads/main' },
  ]
}

/**
 * 判定层：与取数分离，便于 TDD 注入负控。
 * 注意：x-nf-request-id 是请求 ID，不能冒充 deploy ID；没有 Netlify API
 * 通道时 deployId 必须保持 null，绝不从 request id 推导。
 */
export function evaluateS01Evidence(ev) {
  const reasons = []
  const routes = ev.routes || {}
  const core = ['/api/health', '/api/payments/dodo/plans', '/pricing']
  for (const r of core) {
    const row = routes[r]
    if (!row || row.httpStatus !== 200) return { verdict: 'ERROR', reasons: [`${r}_not_200`], traceability: null }
    if (!(row.bytes > 0)) return { verdict: 'ERROR', reasons: [`${r}_empty_body_not_a_scan`], traceability: null }
  }
  for (const r of PUBLIC_ROUTES) {
    const row = routes[r]
    if (!row || typeof row.httpStatus !== 'number' || row.httpStatus === 0) {
      return { verdict: 'ERROR', reasons: [`${r}_fetch_failed`], traceability: null }
    }
  }
  if (!ev.headers?.server) return { verdict: 'ERROR', reasons: ['missing_server_header'], traceability: null }
  if (!/^[a-f\d]{40}$/.test(String(ev.git?.remoteMainSha || ''))) {
    return { verdict: 'ERROR', reasons: ['remote_sha_missing'], traceability: null }
  }
  if (!ev.plans || typeof ev.plans.checkoutReady !== 'boolean') {
    return { verdict: 'ERROR', reasons: ['plans_checkoutReady_missing'], traceability: null }
  }
  if (!ev.health?.commit) return { verdict: 'ERROR', reasons: ['health_commit_missing'], traceability: null }

  const open = ev.plans.checkoutReady === true && ev.plans.environment === 'live_mode'
  if (open) reasons.push('live_checkout_enabled_on_production')
  if (ev.health.commit !== ev.git.remoteMainSha.slice(0, 7)) reasons.push('production_drifts_from_remote_main')
  const missingPages = PUBLIC_ROUTES.filter((r) => routes[r].httpStatus !== 200)
  if (missingPages.length) reasons.push(`public_routes_not_200:${missingPages.join(',')}`)
  if (!ev.deploy?.deployId) reasons.push('netlify_deploy_id_not_available_without_api_channel')

  return {
    verdict: open ? 'RISK_OPEN' : 'CLOSED',
    reasons,
    traceability: {
      productionCommit: ev.health.commit,
      remoteMainSha: ev.git.remoteMainSha,
      shaDrift: ev.health.commit !== ev.git.remoteMainSha.slice(0, 7),
      edge: ev.headers.server,
      checkoutReady: ev.plans.checkoutReady,
      environment: ev.plans.environment,
      commercialApproval: ev.plans.commercialApproval ?? null,
      missingPublicPages: missingPages,
      deployId: ev.deploy?.deployId ?? null,
    },
  }
}

async function get(base, pathname) {
  const u = new URL(pathname, base)
  if (u.protocol !== 'https:') throw new Error(`HTTPS required: ${u.origin}`)
  const started = Date.now()
  const resp = await fetch(u, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(25000), cache: 'no-store' })
  const body = await resp.text()
  return { httpStatus: resp.status, elapsedMs: Date.now() - started, bytes: body.length, body, headers: resp.headers }
}

async function main() {
  const base = arg('base', 'https://app.lokfeel.com')
  const out = arg('out', '')
  const result = {
    checkedAt: new Date().toISOString(),
    base,
    readOnly: true,
    plan: buildS01Plan(base),
    verdict: 'ERROR',
    reasons: [],
    routes: {},
    health: null,
    plans: null,
    headers: {},
    deploy: { deployId: null, source: 'netlify_api_or_console_required' },
    git: null,
    traceability: null,
  }
  try {
    const responses = await Promise.all(CORE_ROUTES.map(async (p) => [p, await get(base, p)]))
    for (const [pathname, r] of responses) {
      result.routes[pathname] = { httpStatus: r.httpStatus, elapsedMs: r.elapsedMs, bytes: r.bytes }
    }
    const byPath = Object.fromEntries(responses)
    const health = JSON.parse(byPath['/api/health'].body)
    const plans = JSON.parse(byPath['/api/payments/dodo/plans'].body)
    const pricingHeaders = byPath['/pricing'].headers
    result.health = {
      status: health.status,
      commit: health.commit,
      charging: health.payments?.charging,
      dodoCheckoutChannel: health.payments?.channels?.['dodo.checkout'],
      paymentsMissing: health.payments?.missing,
    }
    result.plans = {
      environment: plans.environment,
      checkoutReady: plans.checkoutReady,
      approvedAt: plans.approvedAt ?? null,
      catalogVersion: plans.catalogVersion,
      planCount: Array.isArray(plans.plans) ? plans.plans.length : null,
      commercialApproval: plans.commercialApproval ?? null,
    }
    result.headers = {
      server: pricingHeaders.get('server'),
      cfRay: pricingHeaders.get('cf-ray'),
      nfRequestId: pricingHeaders.get('x-nf-request-id'),
      // 只有 Netlify 真的返回 deploy id 响应头时才采信；request id 不算。
      nfDeployId: pricingHeaders.get('x-nf-deploy-id'),
    }
    if (result.headers.nfDeployId) {
      result.deploy = { deployId: result.headers.nfDeployId, source: 'x-nf-deploy-id response header' }
    }
    const remoteRaw = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8', timeout: 25000 }).trim()
    result.git = { remoteMainSha: remoteRaw.split(/\s+/)[0] }
    const verdict = evaluateS01Evidence(result)
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
