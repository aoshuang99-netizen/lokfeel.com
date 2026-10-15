#!/usr/bin/env node
/**
 * T08 Slice 4 · **AC-18** 端到端取证：社群控制台七屏「**可达**且**无空按钮**」
 * ═══════════════════════════════════════════════════════════════
 * AC-18 的原文（`BACKLOG.md` §3 T07 / `T07/plan.md` §4）：
 *   「Dashboard / Missions / Members / Connections / Agents / Outcomes / Settings
 *     **可达**且**无空按钮**（Playwright）」
 *
 * 本脚本判的是**渲染层**，回答两个只有真浏览器能回答的问题：
 *   ① **可达**：登录态下有组织的用户，六屏真的能打开吗？数据面真的接上了吗？
 *      —— 不是"路由返回 200"，而是"页面渲染出了 h1、且它自己打的 `/api/v1/*` 全部 2xx"。
 *   ② **无空按钮**：页面上每一个按钮，点了**真的有事发生**吗？
 *      —— 判据是"点击前后页面状态或网络确实变了"，而不是"源码里有 onClick"。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 与 `check:ui-invariants` 的 R2 是**两道不同的门**（互补，不是重复）
 * ═══════════════════════════════════════════════════════════════
 *   · R2（静态）：源码里每个 `<button>` 开标签必须有 `onClick` / `disabled` / `type=submit`。
 *     它便宜、能扫全量，但**看不到运行时**：一个 `onClick` 里写错分支的按钮照样通过。
 *   · 本脚本（动态）：**真的点下去**，要求可观察的变化。
 *   更关键的是 —— R2 的扫描面此前**不含 `src/app/console`**（2026-10-14 才补上），
 *   所以"AC-18 的判据"在渲染层一直是**空白**。本脚本是它的另一条腿。
 *
 * ═══════════════════════════════════════════════════════════════
 * 判据（每屏一组，全部为"必须"）
 * ═══════════════════════════════════════════════════════════════
 *   (a) h1 是该屏的标题（值级，不是"页面不空"）
 *   (b) 没有被登录守卫弹回 `/login`、没有渲染 no-org 说明页、没有 404
 *   (c) 该屏**自己发起**的 `/api/v1/*` 请求**至少 1 条**且**全部 < 400**
 *       —— 这一条把"屏是空壳"和"屏是假的"都挡住了：一条都不发 = 数据面没接；
 *          有 4xx/5xx = 页面会把错误态画出来，那就不是"可达"。
 *   (d) 每个**可见** `<button>` 在 React props 里必须有 `onClick` 函数 / `disabled` / `type=submit`
 *       （渲染层版本的 R2 —— 直接读 fiber props，比源码正则硬）
 *   (e) 每个**可见且非 disabled** 的 button，点击后必须产生可观察变化
 *       （URL / 主区文本 hash / aria 状态 / 网络请求数 任一变化）
 *   (f) 导航里未就绪的「智能体」必须是 **`aria-disabled` 的非链接元素**（不是死链）
 *   (g) 导航里所有 `/console/*` 链接在登录态下可达（非 404）
 *   (h) 全程 `pageerror`（页面级未捕获异常）= 0
 *
 * ═══════════════════════════════════════════════════════════════
 * 两条"防假失败"的设计（上一轮 P2 渲染取证踩出来的，直接继承）
 * ═══════════════════════════════════════════════════════════════
 *   ① **点击前必须等 hydration**（判据 = React fiber 已挂到 host 节点）。
 *      SSR 出来的按钮"看得见"，但 `onClick` 还没挂上，此时点击会被**静默丢弃** ——
 *      与"空按钮"的表现一模一样。不设这道门，整页按钮会集体误判为空的。
 *   ② **同组惰性按钮走"组内活性"复核**。像 tab 组：点**已选中**的那一个，页面当然不变，
 *      但那不是"空按钮"（点另一个就切了）。所以惰性按钮若与某个"确实有反应"的按钮
 *      **共享父容器**，判为"组活性已证"；只有既没反应、又不在任何活组里的，才判空。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么自管服务（没有 attach 模式）
 * ═══════════════════════════════════════════════════════════════
 *   夹具必须**已知且唯一**（"导航里恰好有一个未就绪项"这类断言），
 *   且必须**不碰生产**。所以永远自己起隔离库 + dev server，`--reset` 保证起点干净。
 *   这也让"六屏可达"里的"可达"是可复现的，而不是"某天某台机器上曾经能打开"。
 *
 * 用法：
 *   npm run verify:ac18:console
 *   → 覆盖：AC18_PORT=3117 AC18_DB_FILE=/tmp/x.db
 *   退出码 0 = AC-18 通过。截图落在 /tmp/lf-ac18-shots/。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PORT = Number(process.env.AC18_PORT || '3117')
const BASE = `http://localhost:${PORT}`
const DB_FILE = process.env.AC18_DB_FILE || '/tmp/ac18-console.db'
const DDL_FILE = process.env.AC18_DDL_FILE || '/tmp/ac18-console-ddl.sql'
const SHOTS = process.env.AC18_SHOT_DIR || '/tmp/lf-ac18-shots'
const LOG_DIR = process.env.AC18_LOG_DIR || '/tmp/lf-ac18-logs'
const PASSWORD = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'e2e.owner@example.test'

/**
 * **七屏**的定义。`h1` 是**值级**期望（取自各屏源码），`expectVisible` 是
 * 夹具里已知会渲染出来的字符串（只在有夹具数据的屏上用）。
 *
 * 🔴 T09 接线后第 7 屏 Agents 已实现 ⇒ 它从"由 (f) 断言不可点"变成**本列表的一员**。
 *    这不是把断言放松，而是把判据从"未实现的屏要诚实"换成"七屏都要真的打开"。
 *    Agents 屏不设 `expectVisible`：夹具里没有 Agent 运行（运行由 ② 现场造一条，
 *    用来证明动作按钮有真实数据来源，而不是硬编码的假按钮）。
 */
const ZONES = [
  { path: '/console', h1: '社群总览' },
  { path: '/console/missions', h1: '连接任务', expectVisible: '寻找东南亚渠道伙伴' },
  { path: '/console/members', h1: '成员' },
  { path: '/console/connections', h1: '连接' },
  { path: '/console/agents', h1: '智能体' },
  { path: '/console/outcomes', h1: '成果' },
  { path: '/console/settings', h1: '设置', expectVisible: 'E2E 跨境社群' },
]

/** no-org 说明页 / Next 404 的可见特征 —— 出现即说明"这一屏没打开"。 */
const NO_ORG_TEXT = '你还没有加入任何社群'
const NOT_FOUND_TEXT = 'Page Not Found'

// ── 计数与输出 ─────────────────────────────────────────────
let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`)
}
const info = (msg) => console.log(`     ℹ️  ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const section = (t) => console.log(`\n${t}`)

// ── 子进程 ────────────────────────────────────────────────
const children = []

function spawnBg(name, cmd, args, env, logName) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const logPath = path.join(LOG_DIR, `${logName}.log`)
  const out = fs.openSync(logPath, 'a')
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    // detached 让它自成进程组：dev server 会派生子进程，只杀父进程会留下占端口的孤儿。
    detached: true,
    stdio: ['ignore', out, out],
  })
  child.on('error', (e) => console.log(`  ⚠️ ${name} 启动失败：${e.message}`))
  children.push({ name, child, logPath })
  return child
}

function killAll() {
  for (const { child } of children) {
    if (!child || child.exitCode !== null) continue
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* 已经没了 */
      }
    }
  }
}

function runToCompletion(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } })
    let tail = ''
    const keep = (chunk) => {
      tail = `${tail}${chunk.toString()}`.slice(-1500)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', () => resolve({ code: -1, tail }))
    child.on('exit', (code) => resolve({ code, tail }))
  })
}

async function waitForHttp(url, { timeoutMs, label }) {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      return { ok: true, status: r.status }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await sleep(1000)
  }
  console.log(`  ⚠️ ${label} 未在 ${timeoutMs}ms 内就绪（最后：${last}）`)
  return { ok: false, status: 0 }
}

// ── HTTP 会话 ─────────────────────────────────────────────

/** 用**真实登录端点**换 cookie（不是 NextAuth 的 callback —— 见记忆里的 QA 盲区）。 */
async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status !== 200) {
    throw new Error(`登录失败 ${email}: status=${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  if (raw.length === 0) throw new Error(`登录成功但没拿到任何 Set-Cookie（${email}）`)
  return raw.map((c) => c.split(';')[0])
}

async function head(cookie, p) {
  const res = await fetch(`${BASE}${p}`, {
    headers: { cookie: cookie.join('; '), Origin: BASE, Referer: `${BASE}/console` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  // 只要状态码；body 丢掉（避免把整页 HTML 读进内存）。
  try {
    await res.arrayBuffer()
  } catch {
    /* 忽略 */
  }
  return res.status
}

// ── 页面内探针（全部在浏览器里求值）────────────────────────
const PAGE_HELPERS = {
  /** 只读**可见**文本：innerText 遵守可见性，`display:none` 的内容不会出现。 */
  visibleText: () => (document.body.innerText || '').trim(),

  /** 主区 h1（屏标题）。注意 shell 头部另有一个 <h1>（社群名），故限定 main。 */
  zoneH1: () => {
    const h = document.querySelector('main h1')
    return h ? (h.textContent || '').trim() : ''
  },

  /** React 是否已接管这棵树（hydration 已发生的**直接**证据）。 */
  hydrated: () => {
    const nodes = [document.body, document.body.firstElementChild].filter(Boolean)
    return nodes.some((el) =>
      Object.keys(el).some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')),
    )
  },

  /**
   * 逐个按钮读**React 真实 props**（而不是源码正则）。
   * 含 `group` —— 同父容器的按钮视为同一控件族（tab bar 等），用于"组内活性"复核。
   */
  buttons: () =>
    Array.from(document.querySelectorAll('button')).map((el) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))
      const props = key ? el[key] : null
      const rect = el.getBoundingClientRect()
      const parent = el.parentElement
      return {
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 44),
        visible: rect.width > 0 && rect.height > 0,
        hasOnClick: !!props && typeof props.onClick === 'function',
        disabled: el.disabled === true || (!!props && props.disabled === true),
        type: el.getAttribute('type') || '',
        group: parent ? `${parent.tagName}.${String(parent.className || '').slice(0, 40)}` : 'root',
      }
    }),

  /**
   * 页面状态签名：URL + 主区文本 hash + 主区 aria 状态。
   * 三者任一变化即"点击有事发生"。刻意**不含** `body.innerText`（时间类噪声）。
   */
  stateSig: () => {
    const main = document.querySelector('main')
    const txt = main ? main.innerText || '' : ''
    let h = 0
    for (let i = 0; i < txt.length; i += 1) h = (h * 31 + txt.charCodeAt(i)) | 0
    const aria = Array.from(
      document.querySelectorAll('main [aria-pressed], main [aria-expanded], main [aria-selected]'),
    )
      .map(
        (el) =>
          `${el.getAttribute('aria-pressed') || ''}/${el.getAttribute('aria-expanded') || ''}/${el.getAttribute('aria-selected') || ''}`,
      )
      .join(',')
    return `${location.pathname}${location.search}|${h}|${aria}`
  },

  /** 导航里 `aria-disabled` 的未就绪项（必须**不是**链接）。 */
  disabledNav: () =>
    Array.from(
      document.querySelectorAll('nav[aria-label="社群控制台导航"] [aria-disabled="true"]'),
    ).map((el) => ({
      tag: el.tagName,
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      isLink: el.tagName === 'A' || !!el.querySelector('a'),
      title: el.getAttribute('title') || '',
    })),

  /** 导航里所有 /console/* 链接（用于可达性探针）。 */
  consoleLinks: () =>
    Array.from(document.querySelectorAll('nav[aria-label="社群控制台导航"] a[href^="/console"]')).map(
      (a) => a.getAttribute('href'),
    ),
}

// ═══════════════════════════════════════════════════════════
const main = async () => {
  console.log(`\nAC-18 · 社群控制台七屏「可达 + 无空按钮」端到端取证`)
  console.log(`  目标 ${BASE}`)
  console.log(`  隔离库 ${DB_FILE}`)
  console.log(`  截图目录 ${SHOTS}`)

  fs.mkdirSync(SHOTS, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })

  // ═══════════════════════════════════════════════════════════
  section('── ⓪ 引导：隔离库（含组织 + OWNER）→ dev server → 真实登录')
  // ═══════════════════════════════════════════════════════════
  const seed = await runToCompletion(
    'node',
    ['scripts/qa/seed-t02-e2e.mjs', '--reset', '--regenerate'],
    { E2E_DB_FILE: DB_FILE, E2E_DDL_FILE: DDL_FILE, E2E_PASSWORD: PASSWORD },
  )
  ck(
    '夹具就绪：组织 org_e2e（ACTIVE）+ OWNER e2e.owner + MEMBER e2e.member + 一条 ACTIVE 任务',
    seed.code === 0,
    seed.code === 0 ? '' : seed.tail.slice(-300),
  )
  if (seed.code !== 0) return

  spawnBg(
    'next-dev',
    'npx',
    ['next', 'dev', '--turbopack', '-p', String(PORT)],
    {
      DATABASE_URL: `file:${DB_FILE}`,
      AUTH_URL: BASE,
      NEXTAUTH_URL: BASE,
      NEXT_PUBLIC_APP_URL: BASE,
    },
    'next-dev',
  )
  const devReady = await waitForHttp(`${BASE}/api/health`, { timeoutMs: 240_000, label: 'dev server' })
  ck('dev server 就绪（/api/health 可达）', devReady.ok, `status=${devReady.status}`)
  if (!devReady.ok) return

  let owner
  try {
    owner = await login(OWNER_EMAIL)
  } catch (e) {
    ck(`真实登录端点（${OWNER_EMAIL}）`, false, e instanceof Error ? e.message : String(e))
    return
  }
  ck(`真实登录端点换到会话 cookie（OWNER ${OWNER_EMAIL}）`, owner.length > 0)

  const cookieObjs = owner.map((pair) => {
    const i = pair.indexOf('=')
    return {
      name: pair.slice(0, i),
      value: pair.slice(i + 1),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
    }
  })

  // ═══════════════════════════════════════════════════════════
  section('── ① 真实 Chrome：七屏可达 + 无空按钮')
  // ═══════════════════════════════════════════════════════════
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await ctx.addCookies(cookieObjs)
  const page = await ctx.newPage()

  /** 页面级未捕获异常 —— 比 console.error 严重得多。 */
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  · 浏览器 console.error：${m.text().slice(0, 160)}`)
  })
  // 意外弹窗会**阻塞**点击 —— 一律 dismiss。
  page.on('dialog', (d) => {
    console.log(`  · 浏览器 dialog（已 dismiss）：${d.message().slice(0, 120)}`)
    d.dismiss().catch(() => {})
  })

  /** 该屏自己发起的 API 调用（每次导航前清空）。 */
  const apiCalls = []
  page.on('response', (res) => {
    const u = res.url()
    const i = u.indexOf('/api/v1/')
    if (i >= 0) apiCalls.push({ path: u.slice(i).split('?')[0], status: res.status() })
  })

  const shot = async (name) => {
    try {
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
    } catch {
      /* 截图只是证据，失败不影响判定 */
    }
  }

  const waitHydrated = async (timeout = 90_000) => {
    try {
      await page.waitForFunction(PAGE_HELPERS.hydrated, undefined, { timeout })
      await sleep(400)
      return true
    } catch {
      return false
    }
  }

  /**
   * 打开某屏并等它稳定。返回诊断信息。
   *
   * 🔴 为什么不能"goto + 固定 sleep"：dev 模式**每条路由首次访问都要现场编译**
   *   （Turbopack 每路由 5–20s），`domcontentloaded` 会在编译完成前返回 ——
   *   第一轮实测就是这样把**渲染正常的 /console** 采样成「h1 空 / 0 条 API /
   *   0 个按钮」的（截图里屏明明是好的，左下角还挂着 dev overlay 的 "1 Issue"）。
   *   所以这里等的是**内容信号**：main h1 非空（90s，足够覆盖首次编译），
   *   再等数据面请求落定（连续 ~1.2s 无新响应）。
   */
  const openZone = async (zone, { waitH1 = true, waitApi = true } = {}) => {
    apiCalls.length = 0
    await page.goto(`${BASE}${zone.path}`, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    let ready = true
    if (waitH1) {
      try {
        await page.waitForFunction(
          () => {
            const h = document.querySelector('main h1')
            return !!h && (h.textContent || '').trim().length > 0
          },
          undefined,
          { timeout: 90_000 },
        )
      } catch {
        ready = false
      }
    } else {
      // 404 屏没有 main h1 —— 等 Next 的 404 文案出现
      try {
        await page.waitForFunction(
          () => (document.body.innerText || '').includes('Page Not Found'),
          undefined,
          { timeout: 60_000 },
        )
      } catch {
        ready = false
      }
    }
    const hydrated = await waitHydrated()
    // 🔴 等数据面：先等**第一条** /api/v1/* 响应，再等静止。
    //   链路是 session（1–3s）→ useApiGet 在 authStatus=loading 期间**不发**请求 →
    //   fetch（dev 模式 2–4s）—— 第一版"静止 1.2s 即认为稳定"在这个链路面前
    //   会在第一条响应到达**之前**就退出，把渲染正常的屏判成"0 条 API"。
    //   404 屏没有 API（waitApi=false 跳过）。
    if (waitApi) {
      const t0 = Date.now()
      while (Date.now() - t0 < 45_000 && apiCalls.length === 0) await sleep(500)
      let quiet = 0
      while (Date.now() - t0 < 60_000) {
        const n = apiCalls.length
        await sleep(600)
        if (apiCalls.length === n) {
          quiet += 1
          if (quiet >= 4) break
        } else {
          quiet = 0
        }
      }
    }
    const h1 = await page.evaluate(PAGE_HELPERS.zoneH1)
    const text = await page.evaluate(PAGE_HELPERS.visibleText)
    return { hydrated, ready, h1, text, url: page.url() }
  }

  let navLinksChecked = false

  for (const zone of ZONES) {
    section(`── 屏 ${zone.path}`)
    const st = await openZone(zone)
    const tag = `[${zone.path}]`

    ck(`${tag} hydration 完成（React 已接管 DOM）`, st.hydrated)
    ck(`${tag} 未被登录守卫弹回 /login`, st.url.includes(zone.path), `url=${st.url}`)
    ck(`${tag} 渲染 no-org 说明页`, !st.text.includes(NO_ORG_TEXT))
    ck(`${tag} 渲染 404 兜底页`, !st.text.includes(NOT_FOUND_TEXT))
    ck(`${tag} h1 = 「${zone.h1}」`, st.h1 === zone.h1, `实际=「${st.h1}」`)

    // (c) 数据面：该屏自己打的 /api/v1/* 至少 1 条，且全部 < 400
    const badCalls = apiCalls.filter((c) => c.status >= 400)
    ck(
      `${tag} 数据面已接上（自身发起 ${apiCalls.length} 条 /api/v1/*，全部 < 400）`,
      apiCalls.length > 0 && badCalls.length === 0,
      apiCalls.length === 0 ? '一条都没发 → 屏是空壳' : badCalls.map((c) => `${c.path}=${c.status}`).join(' '),
    )
    if (zone.expectVisible) {
      // 首采样可能早于列表渲染完成 —— 给一次等待机会再判（避免把"慢"当成"没数据"）。
      let shown = st.text.includes(zone.expectVisible)
      if (!shown) {
        shown = await page
          .waitForFunction(
            (t) => (document.body.innerText || '').includes(t),
            zone.expectVisible,
            { timeout: 20_000 },
          )
          .then(() => true)
          .catch(() => false)
      }
      ck(`${tag} 渲染出夹具数据「${zone.expectVisible}」`, shown)
    }

    // (d) 渲染层 R2：每个可见按钮在 React props 里有 onClick / disabled / submit
    const btns = await page.evaluate(PAGE_HELPERS.buttons)
    const visibleBtns = btns.filter((b) => b.visible)
    const badStatic = visibleBtns.filter(
      (b) => !b.hasOnClick && !b.disabled && b.type !== 'submit',
    )
    ck(
      `${tag} 每个可见按钮都"有事可做"（React props：onClick/disabled/submit）`,
      badStatic.length === 0,
      `${visibleBtns.length} 个可见按钮` +
        (badStatic.length ? ` · 无绑定：${badStatic.map((b) => `「${b.text}」`).join(' ')}` : ''),
    )

    // (e) 动态"无空按钮"：逐个真点
    const clickable = visibleBtns.filter((b) => !b.disabled)
    const inert = []
    for (let j = 0; j < clickable.length; j += 1) {
      const rst = await openZone(zone)
      if (!rst.hydrated) {
        ck(`${tag} 重开页面以测按钮 #${j}`, false, '未 hydration')
        break
      }
      const live = (await page.evaluate(PAGE_HELPERS.buttons)).filter((b) => b.visible && !b.disabled)
      if (j >= live.length) break
      const label = live[j].text || `(按钮#${j})`
      // 有输入框的屏先填探针词（如成员搜索要求"≥2 字"），否则"提交空表单"型按钮
      // 会因输入为空而**合理地**不产生任何请求 —— 那是业务规则，不是空按钮。
      // stateSig 的基线在填写**之后**采集，所以"填词本身"不会被误判成按钮的反应。
      const probeInputs = page.locator('main input[type="text"], main input[type="search"]')
      const inputCount = await probeInputs.count()
      for (let k = 0; k < inputCount; k += 1) {
        await probeInputs.nth(k).fill('e2e').catch(() => {})
      }
      const before = await page.evaluate(PAGE_HELPERS.stateSig)
      apiCalls.length = 0
      let clicked = true
      try {
        await page.locator('button:visible:not([disabled])').nth(j).click({ timeout: 6000 })
      } catch (e) {
        clicked = false
        info(`按钮「${label}」点击抛错：${e instanceof Error ? e.message.split('\n')[0] : e}`)
      }
      // 🔴 等"按钮的反应"：轮询「新的 API 响应 或 页面状态变化」，最多 15s。
      //   第一版"sleep 500ms + networkidle 3s"在 dev 模式下必假失败 —— API 响应
      //   要 2–4s，networkidle 会在响应回来**之前**就超时放弃，"刷新"这类
      //   只发请求不改 DOM 的按钮就会被误判成"点了没反应"。
      let changed = false
      const n0 = apiCalls.length
      if (clicked) {
        const t0 = Date.now()
        while (Date.now() - t0 < 15_000) {
          await sleep(400)
          if (apiCalls.length > n0) {
            changed = true
            break
          }
          const sig = await page.evaluate(PAGE_HELPERS.stateSig)
          if (sig !== before) {
            changed = true
            break
          }
        }
      }
      const newCalls = apiCalls.length - n0
      console.log(
        `     ${changed ? '·' : '⚠️'} 按钮「${label}」→ ${changed ? '有反应' : '**点了没反应**'}` +
          (newCalls > 0 ? `（触发 ${newCalls} 条 API）` : ''),
      )
      if (!changed) inert.push({ index: j, label, group: live[j].group })
      continue
    }

    // 组内活性复核：惰性按钮若与"有反应的按钮"同父容器，则属同一控件族（如 tab 组），
    // 点已选中项当然不变 —— 那不是空按钮。
    const reactiveGroups = new Set()
    for (let j = 0; j < clickable.length; j += 1) {
      if (!inert.some((x) => x.index === j)) reactiveGroups.add(clickable[j].group)
    }
    const realInert = inert.filter((x) => !reactiveGroups.has(x.group))
    const groupedInert = inert.filter((x) => reactiveGroups.has(x.group))

    ck(
      `${tag} 无空按钮（${clickable.length} 个可点按钮全部有可观察反应）`,
      realInert.length === 0,
      realInert.length ? `无反应：${realInert.map((x) => `「${x.label}」`).join(' ')}` : '',
    )
    if (groupedInert.length) {
      info(
        `组内活性已证（同控件族里已有按钮被点动）：${groupedInert.map((x) => `「${x.label}」`).join(' ')}`,
      )
    }

    // (f) 七屏全部就绪：OWNER 视角下导航里**不应再有** aria-disabled 项。
    //     （此前第 7 屏 Agents 未实现，是全站唯一一项；T09 接线后它已成为链接。）
    //     ⚠️ 断言方向是刻意反转的：旧断言"必须存在一个不可点项"在接线后会**恒假**，
    //        若继续留着，它就从"判据"退化成了"阻碍接线"。而"未就绪项必须有原因"
    //        这条（R4）由 check:ui-invariants 在**静态**层覆盖，不因本处反转而失守。
    const disabledNav = await page.evaluate(PAGE_HELPERS.disabledNav)
    ck(
      `${tag} 导航里没有"施工中/无权限"项（七屏全部就绪）`,
      disabledNav.length === 0,
      disabledNav.map((d) => `「${d.text}」title=${d.title}`).join(' ') || '(0 项)',
    )

    // (g) 导航链接可达（只需验一次 —— shell 是共享的）
    if (!navLinksChecked) {
      navLinksChecked = true
      const links = Array.from(new Set(await page.evaluate(PAGE_HELPERS.consoleLinks)))
      ck(`${tag} 导航里至少有 7 条 /console/* 链接`, links.length >= 7, `共 ${links.length} 条`)
      for (const href of links) {
        const status = await head(owner, href)
        ck(`  导航链接 ${href} 可达（登录态）`, status >= 200 && status < 400, `status=${status}`)
      }
    }

    await shot(`zone${zone.path.replace(/\//g, '-')}`)
  }

  // ═══════════════════════════════════════════════════════════
  section('── ② 第 7 屏 Agents：已实现 —— 可达、入口可点、动作按钮有真实来源')
  // ═══════════════════════════════════════════════════════════
  //
  // 这一段取代了 T08 时期的三条断言（"未实现的屏必须 404"）。断言被**替换**而不是删除：
  // 判据从"未实现的屏要诚实"换成"已实现的屏要真的能打开、按钮要真的有事可做"。
  {
    const status = await head(owner, '/console/agents')
    ck(
      '已实现的 /console/agents 可达（不是 404）',
      status >= 200 && status < 400,
      `status=${status}`,
    )

    const st = await openZone({ path: '/console/agents' })
    ck(
      '直访 /console/agents 打开的是 Agent 屏（不是 404 兜底页）',
      !st.text.includes(NOT_FOUND_TEXT),
      `h1=「${st.h1}」`,
    )
    ck('Agent 屏 h1 = 「智能体」', st.h1 === '智能体', `实际=「${st.h1}」`)
    await shot('zone-agents')

    const agentsNavIsLink = await page.evaluate(
      () => !!document.querySelector('nav[aria-label="社群控制台导航"] a[href="/console/agents"]'),
    )
    ck('导航里的「智能体」是可点链接（不再是"施工中"的 span）', agentsNavIsLink)

    // ── 造一条**真实**运行，证明动作按钮有数据来源（而不是硬编码的假按钮）──
    //    该运行为低风险技能（requiresApproval=false）⇒ 状态 PROPOSED/DEGRADED
    //    ⇒ 服务端下发 execution.available=true ⇒ 屏上应出现「执行」按钮。
    let runId = null
    try {
      const res = await ctx.request.post(`${BASE}/api/v1/agents/runs`, {
        headers: { 'Idempotency-Key': `ac18-agents-${Date.now()}` },
        data: {
          skill: 'COORDINATION_ADVICE',
          input: { goal: 'AC-18 取证：为两位成员对接合作事宜', allowedCandidateIds: [] },
        },
      })
      const body = await res.json().catch(() => null)
      runId = body?.data?.run?.id ?? null
      ck(
        `能造出一条 Agent 运行（POST /api/v1/agents/runs → ${res.status()}）`,
        res.status() === 201 && !!runId,
        runId ? `id=${runId}` : `body=${JSON.stringify(body).slice(0, 200)}`,
      )
    } catch (e) {
      ck('能造出一条 Agent 运行', false, e instanceof Error ? e.message : String(e))
    }

    if (runId) {
      const st2 = await openZone({ path: '/console/agents' })
      ck(
        '刚造出的运行被真正渲染出来（服务端数据 → 屏）',
        st2.text.includes('AC-18 取证'),
        `h1=「${st2.h1}」`,
      )
      const btns2 = await page.evaluate(PAGE_HELPERS.buttons)
      ck(
        '该运行渲染出「执行」按钮（execution.available 由服务端下发，不是前端自算）',
        btns2.some((b) => b.visible && (b.text || '').includes('执行')),
        btns2.filter((b) => b.visible).map((b) => `「${b.text}」`).join(' '),
      )
      await shot('zone-agents-with-run')
    }
  }

  // ═══════════════════════════════════════════════════════════
  section('── ③ 全局')
  // ═══════════════════════════════════════════════════════════
  ck(
    '浏览器全程无未捕获异常（pageerror = 页面级 JS 崩溃）',
    pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ').slice(0, 200) : '',
  )

  await browser.close()

  console.log(
    `\n════════ AC-18 结果：${pass} 通过 / ${fail} 失败 ════════\n` +
      `（七屏全部可达 + 无空按钮；第 7 屏 Agents 已实现并经"造一条运行 → 渲染 → 动作按钮"取证）\n`,
  )
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error('\n❌ 取证脚本异常：', err?.stack || err?.message || err)
    process.exitCode = 1
  })
  .finally(() => {
    killAll()
    console.log('（已停止本次启动的子进程；截图见上方目录）')
  })
