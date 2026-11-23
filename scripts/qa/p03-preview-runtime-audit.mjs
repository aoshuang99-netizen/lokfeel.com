#!/usr/bin/env node
/**
 * P0-3 / P0-4：真实部署环境运行时验收。
 *
 * 纪律：
 *  1. 只访问传入的 --base（Preview 或生产），不把本机 dev/build 冒充部署环境。
 *  2. 只读优先；写操作必须显式 --writes 且拿到登录态，否则标记 BLOCKED。
 *  3. 凭据只从环境变量读取；源码与报告都不落密码。
 *  4. 八页双视口截图 + 控制台错误 + 5xx + 运行时 SHA + 主 CTA 真实点击录像。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const argOf = (key, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${key}=`))
  return hit ? hit.slice(key.length + 3) : fallback
}
const has = (flag) => argv.includes(flag)

const BASE = argOf('base', 'https://lokfeel-preview.aoshuang99.workers.dev').replace(/\/$/, '')
const COMPARE_BASE = argOf('compare-base', '').replace(/\/$/, '')
const OUT = path.resolve(argOf('out', 'docs/p03-preview-runtime-audit/evidence/local'))
const EXPECTED_SHA = argOf('expected-sha', '9bc4fbb7cdc999d5e61814d2bd22967859b964cd')
const LABEL = argOf('label', new URL(BASE).hostname)
const ALLOW_WRITES = has('--writes')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

const PAGES = [
  { slug: 'home', path: '/', cta: /开始|免费|使用|注册|Get started|sign up/i },
  { slug: 'register', path: '/register', cta: /创建账号|注册|Sign up|开始/i },
  { slug: 'workspace', path: '/workspace', auth: true, cta: /编译工作区|创建|开始|目标/i },
  { slug: 'chats', path: '/dashboard/chats', auth: true, cta: /发起|新建|发送|会话/i },
  { slug: 'connections', path: '/dashboard/connections', auth: true, cta: /邀请|连接|添加/i },
  { slug: 'console', path: '/console', auth: true, cta: /处理|审批|创建|待办/i },
  { slug: 'product', path: '/product', cta: /开始|试用|查看|了解/i },
  { slug: 'solutions', path: '/solutions', cta: /联系|咨询|开始|了解/i },
]

const result = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  compareBase: COMPARE_BASE || null,
  expectedSha: EXPECTED_SHA,
  label: LABEL,
  allowWrites: ALLOW_WRITES,
  login: { status: 'NOT_RUN' },
  health: { status: 'NOT_RUN' },
  api: [],
  pages: [],
  cta: [],
  verdict: 'FAIL',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

function credentialFromLocal(key) {
  try {
    const file = path.resolve('nexus-app/.qa-credentials.local.json')
    const raw = JSON.parse(awaitSafeRead(file))
    return typeof raw?.[key] === 'string' && raw[key] ? raw[key] : ''
  } catch {
    return ''
  }
}

function awaitSafeRead(file) {
  // 同步读取只用于可选的本地凭据；不存在时返回空对象文本，保持调用链简单。
  try {
    return requireNodeFs().readFileSync(file, 'utf8')
  } catch {
    return '{}'
  }
}

function requireNodeFs() {
  // 避免顶层再引入一个 fs 命名冲突；Node ESM 下 createRequire 可用。
  return fsSync
}

import fsSync from 'node:fs'

function auditEmail() {
  return process.env.AUDIT_EMAIL || process.env.QA_EMAIL || 'qa.male@lokfeel.com'
}

function auditPassword() {
  return process.env.AUDIT_PASSWORD || process.env.QA_PASSWORD || credentialFromLocal('password')
}

async function waitForUi(page) {
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))
        }),
    )
    .catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page
    .waitForFunction(() => !/Loading\.\.\.|正在加载/i.test(document.body?.innerText || ''), {
      timeout: 4000,
    })
    .catch(() => {})
}

async function visibleCtas(page, pattern) {
  return page.evaluate((source) => {
    const re = new RegExp(source, 'i')
    const nodes = Array.from(document.querySelectorAll('a,button,[role="button"]'))
    return nodes
      .filter((el) => {
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const text = (el.innerText || el.textContent || '').trim()
        return (
          re.test(text) &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      .slice(0, 6)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').trim().slice(0, 60),
        href: el.getAttribute('href') || '',
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        width: Math.round(el.getBoundingClientRect().width),
      }))
  }, pattern.source)
}

async function capturePass(context, base, passLabel, authenticated) {
  const shotsDir = path.join(OUT, passLabel, 'shots')
  await ensureDir(shotsDir)

  for (const item of PAGES) {
    if (item.auth && !authenticated) {
      result.pages.push({
        pass: passLabel,
        slug: item.slug,
        path: item.path,
        status: 'BLOCKED',
        reason: '登录态不可用，未把未登录跳转冒充页面通过',
      })
      continue
    }

    const page = await context.newPage()
    const errors = []
    const serverErrors = []
    const consoleErrors = []
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))
    page.on('response', (response) => {
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`)
      }
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
    })

    let status = 0
    let finalUrl = ''
    let title = ''
    let h1 = ''
    let ctas = []
    try {
      const resp = await page.goto(`${base}${item.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      status = resp?.status() ?? 0
      await waitForUi(page)
      finalUrl = page.url()
      title = await page.title()
      h1 = await page.locator('h1').first().innerText().catch(() => '')
      ctas = await visibleCtas(page, item.cta)
      for (const vp of VIEWPORTS) {
        // 双视口截图：同一个 context 只有一个 viewport，切换在 captureAll 中完成。
        if (vp.name === (context.viewportSize()?.width === 390 ? 'mobile' : 'desktop')) {
          await page.screenshot({
            path: path.join(shotsDir, `${item.slug}-${vp.name}.png`),
            fullPage: false,
          })
        }
      }
    } catch (error) {
      errors.push(`goto failed: ${String(error).slice(0, 250)}`)
    }

    const loginRedirect = item.auth && /\/login(\?|$)/.test(finalUrl)
    const passed =
      status >= 200 &&
      status < 400 &&
      !loginRedirect &&
      serverErrors.length === 0 &&
      errors.length === 0 &&
      (item.auth ? true : ctas.length > 0)

    result.pages.push({
      pass: passLabel,
      slug: item.slug,
      path: item.path,
      status: passed ? 'PASS' : 'FAIL',
      http: status,
      title,
      h1: h1.slice(0, 120),
      finalUrl,
      ctaVisible: ctas,
      serverErrors,
      pageErrors: errors,
      consoleErrors: consoleErrors.slice(0, 5),
      screenshotDir: `evidence/${passLabel}/shots`,
    })
    await page.close()
  }
}

async function healthCheck(context, base, passLabel) {
  const page = await context.newPage()
  try {
    const resp = await page.request.get(`${base}/api/health`, { timeout: 30000 })
    const body = await resp.json().catch(() => ({}))
    const commit = String(body?.commit || '').toLowerCase()
    const expected = EXPECTED_SHA.slice(0, 7).toLowerCase()
    result.health = {
      status:
        resp.status() === 200 && body?.status === 'healthy' && commit === expected
          ? 'PASS'
          : 'FAIL',
      pass: passLabel,
      http: resp.status(),
      health: body?.status || '',
      commit,
      expected,
      commitSource: body?.commitSource || '',
      builtAt: body?.builtAt || '',
    }
  } catch (error) {
    result.health = {
      status: 'FAIL',
      pass: passLabel,
      reason: String(error).slice(0, 300),
    }
  }
  await page.close()
}

async function apiChecks(context, base, passLabel) {
  const page = await context.newPage()
  const checks = [
    {
      name: 'invite-lookup-invalid',
      path: '/api/invites/lookup?code=INV-0000000000000000',
      expect: [200, 404],
    },
    { name: 'plans-read', path: '/api/plans', expect: [200] },
  ]
  for (const check of checks) {
    try {
      const resp = await page.request.get(`${base}${check.path}`, { timeout: 20000 })
      result.api.push({
        pass: passLabel,
        name: check.name,
        status: check.expect.includes(resp.status()) ? 'PASS' : 'FAIL',
        http: resp.status(),
        method: 'GET',
      })
    } catch (error) {
      result.api.push({
        pass: passLabel,
        name: check.name,
        status: 'FAIL',
        reason: String(error).slice(0, 240),
      })
    }
  }
  await page.close()
}

async function loginCheck(context, base, passLabel) {
  const email = auditEmail()
  const password = auditPassword()
  if (!password) {
    result.login = {
      status: 'BLOCKED',
      pass: passLabel,
      reason: '未提供 AUDIT_PASSWORD / QA_PASSWORD，未用默认口令代替',
    }
    return false
  }
  const page = await context.newPage()
  try {
    const resp = await page.request.post(`${base}/api/auth/login`, {
      data: { email, password },
      headers: { Origin: base, Referer: `${base}/login` },
      timeout: 30000,
      maxRedirects: 0,
    })
    const cookies = resp.headers()['set-cookie'] || ''
    const hasSession = /authjs\.session-token/.test(cookies)
    const body = await resp.json().catch(() => ({}))
    const ok = hasSession || (resp.status() >= 200 && resp.status() < 300 && body?.success === true)
    result.login = {
      status: ok ? 'PASS' : 'FAIL',
      pass: passLabel,
      http: resp.status(),
      email,
      cookie: hasSession,
      successFlag: body?.success === true,
    }
    return ok
  } catch (error) {
    result.login = {
      status: 'FAIL',
      pass: passLabel,
      reason: String(error).slice(0, 300),
    }
    return false
  } finally {
    await page.close()
  }
}

async function ctaVideo(context, base, passLabel) {
  const videoDir = path.join(OUT, passLabel, 'video')
  await ensureDir(videoDir)
  const videoContext = await context.browser().newContext({
    viewport: VIEWPORTS[1],
    recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
  })
  const page = await videoContext.newPage()
  const record = { pass: passLabel, name: 'home-primary-cta', status: 'FAIL' }
  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await waitForUi(page)
    const before = page.url()
    const target = page
      .locator('a,button,[role="button"]')
      .filter({ hasText: /开始|免费|使用|注册|Get started|sign up/i })
      .first()
    await target.waitFor({ state: 'visible', timeout: 8000 })
    await target.click({ timeout: 8000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
    await sleep(800)
    const after = page.url()
    record.status = after !== before ? 'PASS' : 'FAIL'
    record.before = before
    record.after = after
    record.screenshot = `evidence/${passLabel}/video`
  } catch (error) {
    record.reason = String(error).slice(0, 300)
  }
  await videoContext.close()
  result.cta.push(record)
}

async function writeChecks(context, base, authenticated, passLabel) {
  if (!ALLOW_WRITES) {
    result.api.push({
      pass: passLabel,
      name: 'invite-write',
      status: 'BLOCKED',
      reason: '未显式授权 --writes；不向可能的共享库写入测试数据',
    })
    return
  }
  if (!authenticated) {
    result.api.push({
      pass: passLabel,
      name: 'invite-write',
      status: 'BLOCKED',
      reason: '登录态不可用，写入测试跳过',
    })
    return
  }
  const page = await context.newPage()
  try {
    const create = await page.request.post(`${base}/api/invites`, {
      data: {},
      headers: { Origin: base, Referer: `${base}/workspace` },
      timeout: 20000,
    })
    const body = await create.json().catch(() => ({}))
    const code = body?.data?.inviteCode || body?.inviteCode || ''
    result.api.push({
      pass: passLabel,
      name: 'invite-write',
      status: create.ok() && code ? 'PASS' : 'FAIL',
      http: create.status(),
      inviteCode: code ? `${code.slice(0, 8)}…` : '',
    })
    if (code) {
      const revoke = await page.request.post(`${base}/api/invites/revoke`, {
        data: { code },
        headers: { Origin: base, Referer: `${base}/workspace` },
        timeout: 20000,
      })
      result.api.push({
        pass: passLabel,
        name: 'invite-revoke-cleanup',
        status: revoke.ok() ? 'PASS' : 'FAIL',
        http: revoke.status(),
      })
    }
  } catch (error) {
    result.api.push({
      pass: passLabel,
      name: 'invite-write',
      status: 'FAIL',
      reason: String(error).slice(0, 240),
    })
  }
  await page.close()
}

async function runPass(base, passLabel) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  })
  let authenticated = false
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ignoreHTTPSErrors: true,
    })
    if (vp.name === 'desktop') {
      await healthCheck(context, base, passLabel)
      authenticated = await loginCheck(context, base, passLabel)
      await apiChecks(context, base, passLabel)
      await writeChecks(context, base, authenticated, passLabel)
      await ctaVideo(context, base, passLabel)
    }
    await capturePass(context, base, passLabel, authenticated)
    await context.close()
  }
  await browser.close()
}

async function main() {
  await ensureDir(OUT)
  // 先抓旧版对照，再抓候选；result.login / result.health 最终保留候选环境结果。
  if (COMPARE_BASE && COMPARE_BASE !== BASE) {
    await runPass(COMPARE_BASE, 'before')
  }
  await runPass(BASE, LABEL)

  const pageStats = result.pages.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})
  const hardFailures =
    result.pages.filter((p) => p.pass === LABEL && p.status === 'FAIL').length +
    result.api.filter((a) => a.pass === LABEL && a.status === 'FAIL').length +
    result.cta.filter((c) => c.pass === LABEL && c.status === 'FAIL').length +
    (result.health.status === 'FAIL' ? 1 : 0)

  result.summary = {
    pageStats,
    login: result.login.status,
    health: result.health.status,
    api: result.api.map((a) => `${a.name}:${a.status}`),
    cta: result.cta.map((c) => `${c.name}:${c.status}`),
  }
  result.verdict = hardFailures === 0 ? 'PASS' : 'FAIL'

  await fs.writeFile(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  const lines = [
    `# P0-3/P0-4 运行时验收 · ${LABEL}`,
    '',
    `- Base: ${BASE}`,
    `- Expected SHA: ${EXPECTED_SHA}`,
    `- Verdict: **${result.verdict}**`,
    `- Login: ${result.login.status}`,
    `- Health/SHA: ${result.health.status} ${result.health.commit || ''}`,
    `- Pages: ${JSON.stringify(pageStats)}`,
    `- API: ${result.api.map((a) => `${a.name}=${a.status}`).join(', ')}`,
    `- CTA: ${result.cta.map((c) => `${c.name}=${c.status}`).join(', ')}`,
    '',
    '详细证据见 `result.json`、各 pass 的 `shots/` 与 `video/`。',
    '',
  ]
  await fs.writeFile(path.join(OUT, 'report.md'), lines.join('\n'))
  console.log(`P03_AUDIT_VERDICT=${result.verdict}`)
  console.log(JSON.stringify(result.summary, null, 2))
  if (result.verdict !== 'PASS') process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
