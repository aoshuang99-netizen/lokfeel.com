#!/usr/bin/env node
/**
 * P0-01：Cloudflare Preview 500 第一现场取证。
 *
 * 只做三件只读事情：
 *  1. `wrangler deployments list --name lokfeel-preview --json` —— 记录当前 deployment；
 *  2. `wrangler tail lokfeel-preview --format json --status error` —— 抓真实异常；
 *  3. 独立请求公开路由 / health / 只读 API —— 记录 status、CF-Ray、Content-Type、脱敏响应体摘要。
 *
 * 纪律：
 *  - 不打印任何 token/cookie/密码；输出前统一脱敏；
 *  - 不写任何业务接口；
 *  - 结果落 result.json，由 workflow 推到独立 `audit-results/p500-<run_id>` 分支供复核。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const argOf = (key, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${key}=`))
  return hit ? hit.slice(key.length + 3) : fallback
}

const BASE = argOf('base', 'https://lokfeel-preview.aoshuang99.workers.dev').replace(/\/$/, '')
const OUT = path.resolve(argOf('out', 'docs/p03-preview-runtime-audit/evidence/triage'))
const WORKER = argOf('worker', 'lokfeel-preview')
const EXPECTED_SHA = argOf('expected-sha', '9bc4fbb7cdc999d5e61814d2bd22967859b964cd')
const REQUESTS = [
  { name: 'home', path: '/' },
  { name: 'register', path: '/register' },
  { name: 'product', path: '/product' },
  { name: 'solutions', path: '/solutions' },
  { name: 'health', path: '/api/health' },
  { name: 'invite-lookup-invalid', path: '/api/invites/lookup?code=INV-0000000000000000' },
  { name: 'plans-read', path: '/api/payments/dodo/plans' },
]

function redact(value) {
  return String(value ?? '')
    .replace(/(bearer\s+|token[=:]\s*|password[=:]\s*|secret[=:]\s*|auth[=:]\s*)[^\s"'&,;]+/gi, '$1[REDACTED]')
    .replace(/(sk-[A-Za-z0-9._-]{8,}|whsec_[A-Za-z0-9._-]{8,})/g, '[REDACTED]')
}

function truncate(value, max = 700) {
  return String(value ?? '').slice(0, max)
}

async function fetchEndpoint(base, item) {
  const started = Date.now()
  try {
    const resp = await fetch(`${base}${item.path}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'lokfeel-p500-triage/1.0' },
    })
    const headers = {}
    for (const key of ['cf-ray', 'content-type', 'location', 'server']) {
      const value = resp.headers.get(key)
      if (value) headers[key] = redact(value)
    }
    const text = await resp.text()
    return {
      name: item.name,
      path: item.path,
      status: resp.status,
      ok: resp.ok,
      cfRay: headers['cf-ray'] || '',
      contentType: headers['content-type'] || '',
      location: headers['location'] || '',
      ms: Date.now() - started,
      bodySnippet: truncate(redact(text)),
    }
  } catch (error) {
    return {
      name: item.name,
      path: item.path,
      status: 0,
      ok: false,
      cfRay: '',
      contentType: '',
      location: '',
      ms: Date.now() - started,
      bodySnippet: truncate(redact(error?.stack || error?.message || String(error))),
    }
  }
}

function wranglerVersion() {
  try {
    return execFileSync('npx', ['wrangler', '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch (error) {
    return `unknown (${String(error?.message || error).slice(0, 120)})`
  }
}

function listDeployments(worker) {
  try {
    const raw = execFileSync('npx', ['wrangler', 'deployments', 'list', '--name', worker, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    })
    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { parseError: true, rawSnippet: truncate(redact(raw), 2000) }
    }
    return { command: 'wrangler deployments list --json', parsed }
  } catch (error) {
    return {
      command: 'wrangler deployments list --json',
      error: truncate(redact(error?.stderr || error?.message || String(error)), 1200),
    }
  }
}

function summarizeTailLine(line) {
  const raw = line.trim()
  if (!raw.startsWith('{')) return { parse: 'not-json', raw: truncate(redact(raw), 800) }
  try {
    const obj = JSON.parse(raw)
    const eventRequest = obj?.event?.request || {}
    return {
      outcome: obj?.outcome || '',
      scriptName: obj?.scriptName || '',
      eventTime: obj?.eventTimestamp || obj?.event?.request?.timestamp || '',
      requestId: obj?.id || obj?.event?.request?.id || eventRequest?.id || '',
      url: redact(eventRequest?.url || ''),
      method: eventRequest?.method || '',
      statusCode: obj?.response?.status ?? eventRequest?.response?.status ?? '',
      exceptions: (obj?.exceptions || []).map((exc) => ({
        name: exc?.name || '',
        message: truncate(redact(exc?.message || ''), 1200),
        timestamp: exc?.timestamp || '',
      })),
      logs: (obj?.logs || []).slice(0, 10).map((log) => truncate(redact(log?.message || ''), 600)),
    }
  } catch {
    return { parse: 'json-error', raw: truncate(redact(raw), 800) }
  }
}

async function captureTail(base, worker, endpoints) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['wrangler', 'tail', worker, '--format', 'json', '--status', 'error'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdoutChunks = []
    const stderrChunks = []
    child.stdout.on('data', (chunk) => stdoutChunks.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderrChunks.push(String(chunk)))

    const startedAt = Date.now()
    const delay = (ms) => new Promise((r) => setTimeout(r, ms))

    async function run() {
      // 给 tail 一点连接时间，再触发真实请求。
      await delay(4000)
      for (const endpoint of endpoints) {
        await fetchEndpoint(base, endpoint)
        await delay(250)
      }
      // 再等 tail 回传最后一条异常。
      await delay(6000)
      child.kill('SIGINT')
    }

    run().catch(() => child.kill('SIGINT'))

    child.on('exit', (code, signal) => {
      const raw = stdoutChunks.join('')
      const stderr = stderrChunks.join('')
      const lines = raw.split('\n').filter((line) => line.trim().length > 0)
      const events = lines.map(summarizeTailLine)
      const withExceptions = events.filter(
        (event) => (event.exceptions?.length || 0) > 0 || event.outcome === 'exception',
      )
      resolve({
        exitCode: code,
        signal,
        lines: lines.length,
        events,
        exceptionEvents: withExceptions,
        firstException: withExceptions[0] || null,
        stderrSnippet: truncate(redact(stderr), 1200),
        elapsedMs: Date.now() - startedAt,
      })
    })
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const version = wranglerVersion()
  const deployments = listDeployments(WORKER)
  const endpoints = []
  for (const endpoint of REQUESTS) {
    endpoints.push(await fetchEndpoint(BASE, endpoint))
  }
  const tail = await captureTail(BASE, WORKER, REQUESTS)

  const health = endpoints.find((endpoint) => endpoint.name === 'health')
  const any500 = endpoints.some((endpoint) => endpoint.status >= 500)
  const result = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    worker: WORKER,
    expectedSha: EXPECTED_SHA,
    wranglerVersion: version,
    deployments,
    endpoints,
    tail,
    verdict: any500 || health?.status !== 200 ? 'FAIL' : 'PASS',
  }

  fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  const first = tail.firstException
  const lines = [
    `# P500 Cloudflare triage · ${BASE}`,
    '',
    `- Verdict: **${result.verdict}**`,
    `- Wrangler: ${version}`,
    `- Endpoints: ${endpoints.map((endpoint) => `${endpoint.name}=${endpoint.status}`).join(', ')}`,
    `- Tail lines: ${tail.lines}; exception events: ${tail.exceptionEvents.length}`,
    `- First exception: ${
      first
        ? `${first.outcome} ${first.url} :: ${(first.exceptions || []).map((exc) => `${exc.name}: ${exc.message}`).join(' | ')}`
        : 'none captured'
    }`,
    '',
    '详细字段见 `result.json`。原始 tail 只保存在 workflow artifact，不提交到仓库。',
    '',
  ]
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'))
  console.log(`P500_TRIAGE_VERDICT=${result.verdict}`)
  console.log(JSON.stringify({
    endpoints: endpoints.map((endpoint) => `${endpoint.name}=${endpoint.status}`),
    tailLines: tail.lines,
    exceptionEvents: tail.exceptionEvents.length,
    firstException: tail.firstException || null,
    deploymentSummary: deployments?.parsed?.[0] || deployments?.parsed || null,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
