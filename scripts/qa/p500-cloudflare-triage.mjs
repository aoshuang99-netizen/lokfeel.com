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
      signal: AbortSignal.timeout(20000),
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
      timeout: 30000,
      killSignal: 'SIGKILL',
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
      timeout: 30000,
      killSignal: 'SIGKILL',
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

function listSecrets(worker) {
  try {
    const raw = execFileSync('npx', ['wrangler', 'secret', 'list', '--name', worker, '--format', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
      killSignal: 'SIGKILL',
    })
    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { parseError: true, rawSnippet: truncate(redact(raw), 2000) }
    }
    // 只保留名称/类型/时间，绝不保留值（secret list 本身也不返回值）。
    return {
      command: 'wrangler secret list --json',
      names: Array.isArray(parsed) ? parsed.map((item) => ({ name: item?.name, type: item?.type })) : parsed,
    }
  } catch (error) {
    return {
      command: 'wrangler secret list --json',
      error: truncate(redact(error?.stderr || error?.message || String(error)), 1200),
    }
  }
}

function listVersions(worker) {
  try {
    const raw = execFileSync('npx', ['wrangler', 'versions', 'list', '--name', worker, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
      killSignal: 'SIGKILL',
    })
    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { parseError: true, rawSnippet: truncate(redact(raw), 2000) }
    }
    return { command: 'wrangler versions list --json', parsed }
  } catch (error) {
    return {
      command: 'wrangler versions list --json',
      error: truncate(redact(error?.stderr || error?.message || String(error)), 1200),
    }
  }
}

function summarizeTailObject(obj) {
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
}

function summarizeTailRaw(rawText) {
  const text = String(rawText ?? '').trim()
  if (!text) return []
  const attempts = [
    () => JSON.parse(text),
    () => JSON.parse(`[${text.replace(/}\s*\{/g, '},{')}]`),
  ]
  for (const attempt of attempts) {
    try {
      const parsed = attempt()
      const items = Array.isArray(parsed) ? parsed : [parsed]
      return items.map(summarizeTailObject)
    } catch {
      // 尝试下一种解析方式
    }
  }
  return [{ parse: 'raw-error', raw: truncate(redact(text), 1200) }]
}

async function captureTail(base, worker, endpoints) {
  const startedAt = Date.now()
  // 先启动后台 tail（有硬超时），再触发真实请求；避免 Node 子进程挂起 job。
  const tailPath = path.join(OUT, 'tail.raw.jsonl')
  const tailErrPath = path.join(OUT, 'tail.stderr.txt')
  const tailChild = spawn('npx', ['wrangler', 'tail', worker, '--format', 'json', '--sampling-rate', '0.25'], {
    env: process.env,
    stdio: ['ignore', fs.openSync(tailPath, 'w'), fs.openSync(tailErrPath, 'w')],
    detached: false,
  })
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  await delay(4000)
  for (const endpoint of endpoints) {
    await fetchEndpoint(base, endpoint)
    await delay(250)
  }
  await delay(6000)
  tailChild.kill('SIGTERM')

  // 即使 wrangler 不立刻退出，也在 8 秒后按已有数据出结果；job 不被挂起。
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('FORCE_TIMEOUT'), 8000)
    tailChild.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve(code ?? signal ?? 'unknown')
    })
  })
  const raw = fs.existsSync(tailPath) ? fs.readFileSync(tailPath, 'utf8') : ''
  const stderr = fs.existsSync(tailErrPath) ? fs.readFileSync(tailErrPath, 'utf8') : ''
  const events = summarizeTailRaw(raw)
  const withExceptions = events.filter(
    (event) => (event.exceptions?.length || 0) > 0 || event.outcome === 'exception',
  )
  return {
    exitCode,
    events,
    exceptionEvents: withExceptions,
    firstException: withExceptions[0] || null,
    stderrSnippet: truncate(redact(stderr), 1200),
    elapsedMs: Date.now() - startedAt,
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const version = wranglerVersion()
  const deployments = listDeployments(WORKER)
  const secrets = listSecrets(WORKER)
  const versions = listVersions(WORKER)
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
    secrets,
    versions,
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
    `- Tail events: ${tail.events.length}; exception events: ${tail.exceptionEvents.length}`,
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
    tailEvents: tail.events.length,
    exceptionEvents: tail.exceptionEvents.length,
    firstException: tail.firstException || null,
    deploymentSummary: deployments?.parsed?.[0] || deployments?.parsed || null,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
