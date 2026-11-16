/**
 * V22 · W02 生产真实页面逐路由取证（只读，不改生产）
 *
 * 证据纪律（对齐总令 §A / §J V22-G01）：
 *   LIVE              = 真浏览器成功访问且取到该路由正文
 *   REDIRECT_NO_AUTH  = 被重定向到登录页，**不算**该工作区路由的 LIVE 证据
 *   NOT_TESTED        = 未取到页面（网络/超时/404），不估算、不冒充
 *   ERROR             = 取到了但浏览器报错，单独记录
 *
 * 输出：docs/v22/evidence/live-<ts>.json + screenshots/*.png + capture.har
 * 复现：env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v22-live-capture.mjs
 *
 * 🔴 不采集 cookie / Authorization 头；HAR 落盘前由 recordHar 的 content 策略
 *    仅保留请求行与响应状态，避免把会话凭据写进仓库。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const BASE = (process.env.V22_BASE || 'https://app.lokfeel.com').replace(/\/$/, '')
const OUT_DIR = path.join(ROOT, 'docs/v22/evidence')
const SHOT_DIR = path.join(OUT_DIR, 'screenshots')
const MATRIX = path.join(ROOT, 'docs/v22/spec/V22_ROUTE_BY_ROUTE_GATE_MATRIX.csv')
const TS = new Date().toISOString().replace(/[:.]/g, '-')

fs.mkdirSync(SHOT_DIR, { recursive: true })

/** 27 项矩阵 + 7 个内部 key；矩阵是唯一事实源，不另写一份路由表。 */
function readRoutes() {
  const raw = fs.readFileSync(MATRIX, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.trim().split(/\r?\n/)
  const head = lines[0].split(',')
  const iRoute = head.indexOf('route')
  const iPrio = head.indexOf('priority')
  const iLevel = head.indexOf('evidence_level')
  const iJob = head.indexOf('job_to_be_done')
  const routes = []
  for (const line of lines.slice(1)) {
    // CSV 里有引号包裹的含逗号字段，做一次最小解析
    const cells = []
    let cur = '', quoted = false
    for (const ch of line) {
      if (ch === '"') { quoted = !quoted; continue }
      if (ch === ',' && !quoted) { cells.push(cur); cur = ''; continue }
      cur += ch
    }
    cells.push(cur)
    const route = cells[iRoute]?.trim()
    if (!route || !route.startsWith('/')) continue
    routes.push({ route, priority: cells[iPrio], matrixLevel: cells[iLevel], job: cells[iJob] })
  }
  return routes
}

/** 工作区七个内部 key 是验收硬项，矩阵只列了其中几个，这里补齐。 */
const WORKSPACE_KEYS = ['now', 'studio', 'field', 'consent', 'outcomes', 'agents', 'missions']

function git(cmd) {
  try { return execFileSync('git', cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return 'NOT_AVAILABLE' }
}

async function readProductionCommit() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { status: res.status, commit: 'NOT_AVAILABLE' }
    const j = await res.json()
    return { status: res.status, commit: j.commit ?? 'NOT_AVAILABLE', commitSource: j.commitSource ?? null, builtAt: j.builtAt ?? null, version: j.version ?? null }
  } catch (e) { return { status: 0, commit: 'NOT_AVAILABLE', error: String(e?.message || e) } }
}

const facts = {
  capturedAt: new Date().toISOString(),
  base: BASE,
  worktreeSha: git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']),
  originMainSha: (() => { const v = git(['ls-remote', 'origin', 'main']); return v === 'NOT_AVAILABLE' ? v : v.split(/\s+/)[0] })(),
  previewSha: 'NOT_AVAILABLE',
  previewNote: 'V22 未获授权推送，故无 Preview 部署；不把 production commit 冒充 Preview',
  protectedMain: 'NOT_VERIFIED_THIS_RUN',
  protectedMainNote: '本机无 gh CLI / admin PAT；用户已通过 GitHub connector 实测 protected=false、rulesets=[]（REPORT/LIVE 由其提供）',
  netlifyDeployId: 'NOT_AVAILABLE',
  netlifyRequestIdNote: 'x-nf-request-id 是请求 ID，不是 deploy ID；总令 §C.1 明确禁止冒充',
  production: null,
}

facts.production = await readProductionCommit()

const routes = readRoutes()
// 追加缺少的 workspace key 为独立取证项
for (const key of WORKSPACE_KEYS) {
  const r = `/workspace?view=${key}`
  if (!routes.some((x) => x.route === r)) {
    routes.push({ route: r, priority: 'P0', matrixLevel: 'SOURCE', job: `工作区内部 key: ${key}` })
  }
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true })
const harPath = path.join(OUT_DIR, `capture-${TS}.har`)
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordHar: { path: harPath, mode: 'minimal', content: 'omit' },
})
await context.addInitScript(() => {
  // 不注入任何业务状态；只关闭动画，保证截图可比
  const s = document.createElement('style')
  s.textContent = '*,*::before,*::after{animation-duration:0.001ms!important;transition-duration:0.001ms!important}'
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s))
})

const results = []
for (const def of routes) {
  const url = `${BASE}${def.route}`
  const item = {
    route: def.route,
    url,
    priority: def.priority,
    matrixLevel: def.matrixLevel,
    jobToBeDone: def.job,
    evidenceLevel: 'NOT_TESTED',
    httpStatus: null,
    finalUrl: null,
    title: null,
    visibleText: null,
    consoleErrors: [],
    pageErrors: [],
    responseHeaders: {},
    screenshot: null,
    note: null,
  }
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') item.consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => item.pageErrors.push(String(e).slice(0, 300)))
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(1200)
    item.httpStatus = resp?.status() ?? null
    item.finalUrl = page.url()
    item.title = await page.title().catch(() => null)
    item.visibleText = (await page.locator('body').innerText({ timeout: 8000 }).catch(() => ''))
      .replace(/\s+/g, ' ').trim().slice(0, 1600)
    const h = resp?.headers() ?? {}
    for (const k of ['server', 'cf-cache-status', 'cf-ray', 'x-nf-request-id', 'content-type', 'cache-control']) {
      if (h[k]) item.responseHeaders[k] = h[k]
    }
    const shot = path.join(SHOT_DIR, `${def.route.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root'}.png`)
    await page.screenshot({ path: shot, fullPage: false, animations: 'disabled' }).catch(() => {})
    if (fs.existsSync(shot)) item.screenshot = path.relative(ROOT, shot)

    const finalPath = new URL(item.finalUrl).pathname
    if (def.route.startsWith('/workspace')) {
      if (finalPath.startsWith('/login') || finalPath.startsWith('/api/auth')) {
        item.evidenceLevel = 'REDIRECT_NO_AUTH'
        item.note = '无生产登录态，被重定向到登录页；该工作区屏本轮 NOT_TESTED，不得计为 LIVE'
      } else if (item.httpStatus === 200) {
        item.evidenceLevel = 'LIVE'
      } else {
        item.evidenceLevel = 'NOT_TESTED'
        item.note = `非 200：${item.httpStatus}`
      }
    } else if (item.httpStatus === 200) {
      item.evidenceLevel = 'LIVE'
    } else {
      item.evidenceLevel = 'NOT_TESTED'
      item.note = `非 200：${item.httpStatus}`
    }
    if (item.pageErrors.length || item.consoleErrors.length) {
      item.note = `${item.note ?? ''} browserErrors=console:${item.consoleErrors.length}/page:${item.pageErrors.length}`.trim()
    }
  } catch (e) {
    item.evidenceLevel = 'NOT_TESTED'
    item.note = `capture failed: ${String(e?.message || e).slice(0, 240)}`
  } finally {
    await page.close().catch(() => {})
  }
  results.push(item)
  console.log(`${item.evidenceLevel.padEnd(17)} ${String(item.httpStatus ?? '-').padEnd(4)} ${def.route}`)
}

await context.close()
await browser.close()

const summary = {
  LIVE: results.filter((r) => r.evidenceLevel === 'LIVE').length,
  REDIRECT_NO_AUTH: results.filter((r) => r.evidenceLevel === 'REDIRECT_NO_AUTH').length,
  NOT_TESTED: results.filter((r) => r.evidenceLevel === 'NOT_TESTED').length,
  routesTotal: results.length,
}
const out = { facts, summary, har: path.relative(ROOT, harPath), results }
const outPath = path.join(OUT_DIR, `live-${TS}.json`)
fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`\nSUMMARY ${JSON.stringify(summary)}`)
console.log(`EVIDENCE ${path.relative(ROOT, outPath)}`)
console.log(`PROD_COMMIT ${facts.production.commit} / ORIGIN_MAIN ${facts.originMainSha} / WORKTREE ${facts.worktreeSha}`)
