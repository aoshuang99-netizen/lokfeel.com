#!/usr/bin/env node
/**
 * P2 **渲染层**端到端取证（真实 Chrome + 隔离库 + 真实 HTTP）
 *
 * ═══════════════════════════════════════════════════════════════
 * 它与 `verify:p2:e2e` 的分工（两个脚本回答**不同**的问题）
 * ═══════════════════════════════════════════════════════════════
 *   · `verify-p2-workspace-e2e.mts` = **HTTP 层**：端点契约、状态机、装配器输入。
 *     它证明「服务端下发了什么」。
 *   · 本脚本 = **渲染层**：浏览器真的把那些数据画出来了吗？窄屏会撑破吗？
 *     两套主题真的作用在令牌上吗？键盘能走完主路径吗？
 *     它证明「用户真的能看见、能够到」。**这是 HTTP 层原理上覆盖不到的一段**：
 *     400 与 200 都正确的服务端，仍然可以渲染出一片空态或一个撑破的表格。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 四条断言纪律（本脚本的核心设计，不是装饰）
 * ═══════════════════════════════════════════════════════════════
 *   ① **只读可见文本**。一律用 `body.innerText`（Playwright 的 innerText 遵守可见性，
 *      `display:none` 的内容**不会**出现）—— 而不是 `textContent`。
 *      否则"渲染出了内容"会退化成"DOM 里有这个字符串"（隐藏元素也算），
 *      那正好放过了最该抓的一类缺陷：数据到了 DOM 但**没画出来**。
 *
 *   ② **期望值由我们自己写进去**。夹具里每个可断言字符串都带唯一标记（`MARK`），
 *      先经**真实端点**写入，再断言它在对应区**可见**。这样"渲染出了真实数据"
 *      才是可判定的；只断言"页面不空"等于什么都没说。
 *
 *   ③ **反向断言同权**。每个区都同时断言"**空态文案不可见**"
 *      （例如「当前没有任何成果记录」）与"**错误态文案不可见**"（「读取失败」）。
 *      少了这一半，一个渲染成空态的页面会全绿 —— 这正是本仓踩过的假绿形态。
 *
 *   ④ **窄屏判据取"页面级横向滚动"**，而不是"有没有元素超出视口"：
 *      表格用 `overflow-x-auto` 在容器内滚动是**正确**设计，它的 `rect.right`
 *      必然超出视口。所以判据是 `documentElement.scrollWidth <= clientWidth`，
 *      另加一条"越界元素必须被某个可滚动/裁剪祖先兜住"作为补充诊断。
 *
 *   ⑤ 🔴 **"DOM 出现了" ≠ "可以交互了"**。页面由 SSR 先出一版 HTML，
 *      React 随后才 hydrate；在 hydrate 完成之前，按钮上的 `onClick` **尚未挂上**，
 *      此时点击会被**静默丢弃**：不报错、不抛异常、console 里什么都没有，
 *      只表现为"点了没反应"。本脚本第一版就是这样把所有点击类断言一起打红的 ——
 *      看上去像页面坏了，实际是**测试抢跑**。所以每次进入交互前必须先过
 *      `waitHydrated()`（判据 = React 是否已把 fiber 挂到 host 节点上），
 *      并在最前面用一个**纯客户端状态**的动作（主题开关）自证"事件真的挂上了"。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么只有一个模式（自管服务，**没有** attach 模式）
 * ═══════════════════════════════════════════════════════════════
 * 断言②要求夹具是**已知且唯一**的（例如"披露表里恰好只有一条意图"）。
 * 若能 attach 到一个别人的服务上，同一套断言就会在不同前提下运行 ——
 * 那是"看起来一样、其实测的不是一回事"，也就是假绿的经典来源。
 * 因此本脚本**永远**自己起隔离库 + 假模型端点 + dev server，并用 `--reset` 保证夹具唯一。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么用真实 Chrome 而不是 Playwright 自带 Chromium
 * ═══════════════════════════════════════════════════════════════
 * 本机 ms-playwright 缓存里没有 `@playwright/test` 1.63 要求的 headless-shell 版本
 * （只有 1208/1217/1223），而系统装了真实 Chrome ⇒ 用 `channel: 'chrome'`。
 * 好处是顺带验证了"真实浏览器"而不是"某个特定修订版"。
 *
 * ⚠️ `.mjs` 是 `tsc` 的覆盖盲区（tsconfig 只含 `src/` 与 `scripts/` 下的 `.mts`）。
 *    本文件的语法/标识符由 `npm run check:script-decls` 把守，行为由它自己的运行结果把守。
 *
 * 用法：
 *   npm run verify:p2:render
 *   → 覆盖端口：RENDER_PORT=3199 RENDER_DB_FILE=/tmp/x.db
 *   退出码 0 = 全部通过。截图落在 /tmp/lf-render-shots/（供人眼看渲染结果）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PORT = Number(process.env.RENDER_PORT || '3099')
const PROVIDER_PORT = Number(process.env.FAKE_OPENAI_PORT || '3199')
const BASE = `http://localhost:${PORT}`
const DB_FILE = process.env.RENDER_DB_FILE || '/tmp/p2-render-e2e.db'
const DDL_FILE = process.env.RENDER_DDL_FILE || '/tmp/p2-render-full-ddl.sql'
const SHOTS = process.env.RENDER_SHOT_DIR || '/tmp/lf-render-shots'
const LOG_DIR = process.env.RENDER_LOG_DIR || '/tmp/lf-render-logs'
const PASSWORD = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'
const OWNER_EMAIL = 'e2e.owner@example.test'
const MEMBER_EMAIL = 'e2e.member@example.test'

/**
 * 夹具的唯一标记。所有会被断言的字符串都带它 —— 这样"我在页面上看到的正是我刚写进去的"
 * 是可判定的，而"页面上有某个非空文本"不是。
 */
const MARK = '渲染取证'
const FIX = {
  displayName: `${MARK}·主人`,
  company: `${MARK}渠道公司`,
  bio: `${MARK}：十年东南亚渠道落地经验`,
  need: `${MARK}：寻找东南亚渠道伙伴`,
  offer: '提供样品与渠道培训',
  outcome: `${MARK}：完成首轮试销并签署合作备忘`,
  runGoal: `${MARK}：为两位成员起草一条克制的开场介绍`,
}

/** 服务端会下发的**空态/错误态**文案 —— 出现即说明"这一区其实没数据"。 */
const EMPTY_TEXTS = [
  '你还没有提交过任何意图',
  '当前没有与你相关的连接提案',
  '当前没有任何成果记录',
  '当前没有任何 Agent 运行记录',
]
const ERROR_TEXTS = ['读取失败']

// ── 计数与输出 ─────────────────────────────────────────────
let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const section = (t) => console.log(`\n${t}`)

// ── 子进程 ────────────────────────────────────────────────
const children = []

function spawnBg(name, cmd, args, env, logName) {
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

function runToCompletion(name, cmd, args, env) {
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
    void name
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

async function api(cookie, method, p, body, headers = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie: cookie.join('; '),
      Origin: BASE,
      Referer: `${BASE}/workspace`,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

let seq = 0
const idem = (tag) => ({ 'Idempotency-Key': `p2render-${tag}-${Date.now()}-${++seq}` })
const asRec = (v) => (typeof v === 'object' && v !== null ? v : {})
const asArr = (v) => (Array.isArray(v) ? v : [])
const s = (v) => (typeof v === 'string' ? v : '')
const dataOf = (r) => asRec(asRec(r.json).data)

/**
 * 经**真实端点**写入夹具，返回后续断言需要的 id。
 * 每个步骤都先断言自己的状态码 —— 夹具没建起来却继续跑，后面会以"页面空"的形式
 * 伪装成渲染缺陷（那是 QA 里最贵的一类误判）。
 */
async function createFixture(owner, member) {
  const steps = []
  const must = (label, ok, extra = '') => {
    steps.push({ label, ok, extra })
    return ok
  }

  // ① 本人档案 —— 披露投影的**取值来源是 Profile 行**，不写它则三个受众全是空对象。
  const prof = await api(owner, 'PUT', '/api/profile', {
    displayName: FIX.displayName,
    company: FIX.company,
    bio: FIX.bio,
  })
  must('写入本人档案 → 2xx', prof.status >= 200 && prof.status < 300, `status=${prof.status}`)

  // ② 任务 + 双方加入
  const mission = await api(
    owner,
    'POST',
    '/api/v1/missions',
    {
      goal: '在 30 天内对接 5 家东南亚渠道伙伴',
      offer: '社群引荐与联合投放预算',
      successCriteria: '至少 3 家进入试销',
      constraints: ['东南亚市场经验'],
      publish: true,
    },
    idem('mission'),
  )
  const missionId = s(dataOf(mission).id)
  const shareToken = s(dataOf(mission).shareToken)
  must('创建任务 → 201', mission.status === 201, `status=${mission.status}`)
  must('任务返回 id 与分享令牌', missionId.length > 0 && shareToken.length > 0)

  for (const [who, cookie] of [
    ['owner', owner],
    ['member', member],
  ]) {
    const j = await api(cookie, 'POST', `/api/v1/public/missions/${shareToken}/join`, {})
    must(`${who} 加入任务 → 2xx`, j.status >= 200 && j.status < 300, `status=${j.status}`)
  }

  // ③ 带**显式披露**的意图（三项落在三个不同档位 —— 才能验证渲染出的三列真的不同）
  const intent = await api(
    owner,
    'POST',
    '/api/v1/intents',
    {
      missionId,
      need: FIX.need,
      offer: FIX.offer,
      disclosure: { displayName: 'ORGANIZER', company: 'COUNTERPARTY', bio: 'CANDIDATE' },
    },
    idem('intent'),
  )
  const intentId = s(dataOf(intent).id)
  must('提交意图（带显式披露）→ 201', intent.status === 201, `status=${intent.status}`)

  // 🔴 对方**也必须有**一条有效意图：`introduceConnection()` 在 `evaluateIntroducibility()`
  //    之外还叠了一层 IO 判据（`proposer_intent_not_live` / `candidate_intent_not_live`）。
  //    漏掉这一步的症状是 `introduce` → 409，然后 `POST /outcomes` 连带 409（提案不是
  //    `INTRODUCED`）—— 会在渲染层伪装成"成果区没数据"。
  const memberIntent = await api(
    member,
    'POST',
    '/api/v1/intents',
    { missionId, need: '寻找早期客户验证产品', offer: '提供本地化落地经验' },
    idem('intent-member'),
  )
  must('对方提交意图（介绍的前置）→ 201', memberIntent.status === 201, `status=${memberIntent.status}`)

  // ④ 提案 → 双方同意 → 介绍 → 上报成果 → 对手方确认（让成果进入"已验证"）
  const members = await api(owner, 'GET', '/api/v1/members?pageSize=50')
  const candidateId = s(
    asArr(dataOf(members))
      .map(asRec)
      .find((m) => s(m.email) === MEMBER_EMAIL)?.userId,
  )
  must('解析出对方 userId', candidateId.length > 0, candidateId)

  const prop = await api(
    owner,
    'POST',
    '/api/v1/connections/proposals',
    { missionId, candidateId, rationale: '双方在印尼市场都有落地经验' },
    idem('proposal'),
  )
  const proposalId = s(dataOf(prop).id)
  must('发起提案 → 201', prop.status === 201, `status=${prop.status}`)

  for (const [who, cookie] of [
    ['owner', owner],
    ['member', member],
  ]) {
    const r = await api(cookie, 'POST', `/api/v1/connections/${proposalId}/consent`, {
      decision: 'accept',
    })
    must(`${who} 接受提案 → 200`, r.status === 200, `status=${r.status}`)
  }
  const intro = await api(owner, 'POST', `/api/v1/connections/${proposalId}/introduce`)
  must('执行介绍 → 200', intro.status === 200, `status=${intro.status}`)

  const outcome = await api(owner, 'POST', '/api/v1/outcomes', {
    proposalId,
    summary: FIX.outcome,
  })
  const outcomeId = s(dataOf(outcome).id)
  must('上报成果 → 201', outcome.status === 201, `status=${outcome.status}`)

  const confirm = await api(member, 'POST', `/api/v1/outcomes/${outcomeId}/confirm`, {})
  must('对手方确认（成果升级为已验证）→ 2xx', confirm.status >= 200 && confirm.status < 300, `status=${confirm.status}`)

  // ⑤ 一条落在 AWAITING_APPROVAL 的 Agent 运行（需要假模型端点；缺它只会得到 FAILED）
  const run = await api(
    owner,
    'POST',
    '/api/v1/agents/runs',
    {
      skill: 'INTRO_DRAFT',
      input: {
        goal: FIX.runGoal,
        subjectLabel: '我',
        counterpartLabel: '对方成员',
        allowedFieldKeys: ['displayName'],
      },
      subjectLabel: '我',
    },
    idem('agent-run'),
  )
  const runStatus = s(asRec(dataOf(run).run).status)
  must('发起 INTRO_DRAFT 运行 → 201', run.status === 201, `status=${run.status}`)
  must('运行落在 AWAITING_APPROVAL（否则后面的"批准"测不到成功路径）', runStatus === 'AWAITING_APPROVAL', runStatus)

  return { steps, intentId, proposalId, outcomeId }
}

// ── 浏览器阶段 ────────────────────────────────────────────

/** 标题、正文、对比度所需的取值都在页面里算 —— 不要在 Node 侧重算一份。 */
const PAGE_HELPERS = {
  visibleText: () => (document.body.innerText || '').trim(),
  theme: () => {
    const el = document.querySelector('[data-lf-theme]')
    return el ? el.getAttribute('data-lf-theme') : null
  },
  tokenBg: () => {
    const el = document.querySelector('[data-lf-theme]')
    return el ? window.getComputedStyle(el).getPropertyValue('--lf-bg').trim() : null
  },
  /** React 是否已接管这棵树（hydration 已发生的**直接**证据）。 */
  hydrated: () => {
    const nodes = [document.body, document.body.firstElementChild].filter(Boolean)
    return nodes.some((el) =>
      Object.keys(el).some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')),
    )
  },
  zoneH1: () => {
    const h = document.querySelector('main h1')
    return h ? (h.textContent || '').trim() : ''
  },
  /** 某字段在披露表里那一行的四个单元格（你的档位 + 三个受众）。 */
  disclosureRow: (key) => {
    for (const tr of Array.from(document.querySelectorAll('table tbody tr'))) {
      const hit = Array.from(tr.querySelectorAll('th span')).find(
        (sp) => (sp.textContent || '').trim() === key,
      )
      if (hit) return Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').trim())
    }
    return null
  },
  /** 页面级横向滚动 + "没人兜住"的越界元素。 */
  overflow: () => {
    const de = document.documentElement
    const vw = window.innerWidth
    const offenders = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.right <= vw + 1 && r.left >= -1) continue
      let clipped = false
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = window.getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
          clipped = true
          break
        }
      }
      if (!clipped) {
        offenders.push(
          `${el.tagName.toLowerCase()}[${String(el.className).slice(0, 36)}] right=${Math.round(r.right)}`,
        )
      }
    }
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      vw,
      offenders: offenders.slice(0, 6),
    }
  },
  /** 表格的滚动容器是否**真的能滚**（而非把内容裁掉）。 */
  tableScroll: () => {
    const t = document.querySelector('table')
    if (!t) return null
    for (let p = t.parentElement; p; p = p.parentElement) {
      const ox = window.getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll') {
        return { scrollWidth: p.scrollWidth, clientWidth: p.clientWidth }
      }
    }
    return null
  },
  /** 正文对比度（前景 vs 最近的**非透明**祖先背景）。 */
  contrast: (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const nums = (c) => {
      const m = String(c).match(/[\d.]+/g)
      return m ? m.map(Number) : null
    }
    const lum = (rgb) => {
      const f = rgb.map((v) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
    }
    const fg = nums(window.getComputedStyle(el).color)
    let bg = null
    for (let p = el; p; p = p.parentElement) {
      const cs = window.getComputedStyle(p).backgroundColor
      const c = nums(cs)
      if (c && c.length >= 4 && c[3] === 0) continue
      if (c && c.length >= 3) {
        bg = c.slice(0, 3)
        break
      }
    }
    if (!fg || !bg) return null
    const a = lum(fg)
    const b = lum(bg)
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    return Math.round(ratio * 100) / 100
  },
  /** 当前获得焦点的元素描述（键盘可达性用）。 */
  focused: () => {
    const a = document.activeElement
    if (!a) return null
    return {
      tag: a.tagName.toLowerCase(),
      id: a.id || '',
      text: (a.innerText || '').trim().slice(0, 24),
      aria: a.getAttribute('aria-label') || '',
      cls: String(a.className || ''),
    }
  },
}

async function main() {
  fs.rmSync(SHOTS, { recursive: true, force: true })
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })

  console.log(`\nP2 渲染层端到端取证  目标 ${BASE}`)
  console.log(`  隔离库 ${DB_FILE}`)
  console.log(`  截图目录 ${SHOTS}`)

  // ═══════════════════════════════════════════════════════════
  section('── ⓪ 引导：隔离库 → 假模型端点 → dev server')
  // ═══════════════════════════════════════════════════════════
  const seed = await runToCompletion('seed', 'node', ['scripts/qa/seed-t02-e2e.mjs', '--reset', '--regenerate'], {
    E2E_DB_FILE: DB_FILE,
    E2E_DDL_FILE: DDL_FILE,
    E2E_PASSWORD: PASSWORD,
  })
  ck('隔离库夹具就绪（reset + 重建 DDL）', seed.code === 0, seed.code === 0 ? '' : seed.tail.slice(-300))

  spawnBg('fake-provider', 'node', ['scripts/qa/fake-openai-provider.mjs'], { FAKE_OPENAI_PORT: String(PROVIDER_PORT) }, 'fake-provider')
  const provReady = await waitForHttp(`http://127.0.0.1:${PROVIDER_PORT}/v1/chat/completions`, {
    timeoutMs: 20_000,
    label: '假模型端点',
  })
  ck('假模型端点监听中', provReady.ok, `status=${provReady.status}`)

  spawnBg(
    'next-dev',
    'npx',
    ['next', 'dev', '--turbopack', '-p', String(PORT)],
    {
      DATABASE_URL: `file:${DB_FILE}`,
      // 让服务端把"模型"指向本地假端点 ⇒ 走完整真实调用链但结果确定。
      OPENAI_API_KEY: 'fake-for-e2e',
      OPENAI_BASE_URL: `http://127.0.0.1:${PROVIDER_PORT}/v1`,
      AUTH_URL: BASE,
      NEXTAUTH_URL: BASE,
      NEXT_PUBLIC_APP_URL: BASE,
    },
    'next-dev',
  )
  const devReady = await waitForHttp(`${BASE}/api/health`, { timeoutMs: 240_000, label: 'dev server' })
  ck('dev server 就绪（/api/health 可达）', devReady.ok, `status=${devReady.status}`)
  if (!devReady.ok) return

  const owner = await login(OWNER_EMAIL)
  const member = await login(MEMBER_EMAIL)
  ck('真实登录端点换到会话 cookie（owner / member）', owner.length > 0 && member.length > 0)
  const cookieObjs = owner.map((pair) => {
    const i = pair.indexOf('=')
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: 'localhost', path: '/', httpOnly: true, secure: false }
  })

  // ═══════════════════════════════════════════════════════════
  section('── ① 夹具（全部经真实端点写入，期望值由本脚本决定）')
  // ═══════════════════════════════════════════════════════════
  const fixture = await createFixture(owner, member)
  for (const st of fixture.steps) ck(st.label, st.ok, st.extra)

  // ═══════════════════════════════════════════════════════════
  section('── ② 真实 Chrome 打开 /workspace')
  // ═══════════════════════════════════════════════════════════
  const browser = await chromium.launch({ channel: 'chrome' })
  const shot = async (page, name) => {
    try {
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
    } catch {
      /* 截图只是证据，失败不影响判定 */
    }
  }
  const textOf = (page) => page.evaluate(PAGE_HELPERS.visibleText)
  const waitText = async (page, t, timeout = 40_000) => {
    try {
      await page.waitForFunction((x) => (document.body.innerText || '').includes(x), t, { timeout })
      return true
    } catch {
      return false
    }
  }
  /**
   * 🔴 等 hydration 完成 —— 整个脚本最关键的一道门禁（理由见文件头纪律 ⑤）。
   * 判据是"React 是否已经把 fiber 挂到 host 节点上"，而不是"某个元素出现了"：
   * 后者在 SSR 输出里就已经成立，等于没等。
   */
  const waitHydrated = async (page, timeout = 90_000) => {
    try {
      await page.waitForFunction(PAGE_HELPERS.hydrated, undefined, { timeout })
      await sleep(400)
      return true
    } catch {
      return false
    }
  }
  /**
   * 切区。**前提是已经 hydration 完成**。
   * 失败时把现场打出来：是"点击没被响应"还是"响应了但渲染成别的区"，
   * 这两类故障的修法完全不同，日志必须能区分。
   */
  const goZone = async (page, navLabel, h1Needle) => {
    await page.locator('nav[aria-label="工作区导航"] button', { hasText: navLabel }).first().click()
    try {
      await page.waitForFunction(
        (t) => {
          const h = document.querySelector('main h1')
          return !!h && (h.textContent || '').includes(t)
        },
        h1Needle,
        { timeout: 30_000 },
      )
      return true
    } catch {
      const diag = await page.evaluate(() => {
        const cur = Array.from(document.querySelectorAll('nav[aria-label] button')).find(
          (b) => b.getAttribute('aria-current') === 'page',
        )
        const h = document.querySelector('main h1')
        return {
          h1: h ? (h.textContent || '').trim() : '(无 h1)',
          current: cur ? (cur.textContent || '').trim() : '(无 aria-current)',
          hydrated: Object.keys(document.body).some((k) => k.startsWith('__reactFiber$')),
        }
      })
      console.log(
        `     ↳ 现场：h1=${JSON.stringify(diag.h1)} · aria-current=${diag.current} · hydrated=${diag.hydrated}`,
      )
      return false
    }
  }

  try {
    // 深色系统偏好 ⇒ 初始主题应为 field（这一条同时被 §⑤ 反向再验一次）
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: 'dark',
    })
    await ctx.addCookies(cookieObjs)
    const page = await ctx.newPage()
    /** 页面级**未捕获异常**。比 console.error 严重得多：前者说明页面真的坏了。 */
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`  · 浏览器 console.error：${m.text().slice(0, 160)}`)
    })

    await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    const hasNav = await page
      .waitForSelector('nav[aria-label="工作区导航"]', { timeout: 60_000 })
      .then(() => true)
      .catch(() => false)
    ck('登录态下 /workspace 渲染出工作区外壳（未被守卫弹回登录）', hasNav, page.url())

    // 🔴 先证明"页面可交互"，再断言任何点击结果。
    //    否则一旦事件没挂上，所有点击类断言会一起变红，无从归因（本脚本第一版的实际情形）。
    ck('hydration 完成（React 已接管 DOM —— 点击类断言的前提）', await waitHydrated(page))
    {
      // 自证用**纯客户端状态**的动作（主题开关），不含任何网络往返。
      const themeToggle = page.locator('button[aria-label*="切换到"]')
      const themeBefore = await page.evaluate(PAGE_HELPERS.theme)
      await themeToggle.first().click()
      const flipped = await page
        .waitForFunction(
          (b) => {
            const el = document.querySelector('[data-lf-theme]')
            return !!el && el.getAttribute('data-lf-theme') !== b
          },
          themeBefore,
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false)
      ck(
        '🔴 预自证：主题开关能拨动（证明事件真的挂上了，而不是 SSR 出来的死节点）',
        flipped && themeBefore !== null,
        `${themeBefore} → ${await page.evaluate(PAGE_HELPERS.theme)}`,
      )
      await themeToggle.first().click().catch(() => {})
    }

    // ═════════════════════════════════════════════════════════
    section('── ③ 三区渲染真实数据（期望值 = 夹具写入值）')
    // ═════════════════════════════════════════════════════════
    ck('默认落在 now 区（今日工作台）', (await page.evaluate(PAGE_HELPERS.zoneH1)).includes('今日工作台'))
    await shot(page, '01-now-1280')

    // ── Consent ──
    ck('点 Consent 切区', await goZone(page, 'Consent', 'Consent Gate'))
    const needShown = await waitText(page, FIX.need)
    ck('Consent：意图按钮渲染出夹具 need（不是空态）', needShown, needShown ? '' : (await textOf(page)).slice(0, 200))
    const consentText = await textOf(page)
    ck('Consent：意图空态文案**不可见**', !consentText.includes('你还没有提交过任何意图'))
    ck('Consent：提案空态文案**不可见**', !consentText.includes('当前没有与你相关的连接提案'))
    ck('Consent：无「读取失败」错误态', !ERROR_TEXTS.some((t) => consentText.includes(t)))

    const tableReady = await page
      .waitForSelector('table tbody tr', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    ck('Consent：披露表渲染出行（表体非空）', tableReady)
    const rowDisplay = await page.evaluate(PAGE_HELPERS.disclosureRow, 'displayName')
    const rowCompany = await page.evaluate(PAGE_HELPERS.disclosureRow, 'company')
    const rowBio = await page.evaluate(PAGE_HELPERS.disclosureRow, 'bio')
    const rowEmail = await page.evaluate(PAGE_HELPERS.disclosureRow, 'email')
    ck('Consent：披露表渲染出 displayName / company / bio / email 四行', Boolean(rowDisplay && rowCompany && rowBio && rowEmail), `email=${JSON.stringify(rowEmail)}`)

    if (rowDisplay && rowCompany && rowBio) {
      // 单元格顺序 = [你的档位, 组织者, 对手方, 同任务伙伴]（与 CONSENT_EXTERNAL_AUDIENCES 同序）
      ck(
        '🔴 值级：displayName **只在组织者列可见**（对手方/同任务伙伴列为「未披露」）',
        rowDisplay[1] === FIX.displayName && rowDisplay[2] === '未披露' && rowDisplay[3] === '未披露',
        JSON.stringify(rowDisplay),
      )
      ck(
        '🔴 值级：company 在组织者与对手方列可见、**同任务伙伴列不可见**',
        rowCompany[1] === FIX.company && rowCompany[2] === FIX.company && rowCompany[3] === '未披露',
        JSON.stringify(rowCompany),
      )
      ck(
        '值级：bio 三列**都**可见（CANDIDATE 档覆盖最宽）',
        rowBio[1] === FIX.bio && rowBio[2] === FIX.bio && rowBio[3] === FIX.bio,
        JSON.stringify(rowBio),
      )
    }
    if (rowEmail) {
      ck(
        '🔴 email 行渲染为「不可授权」+ 三个受众均为「联系方式走同意流程」（结构性不可披露，不是"用户没开"）',
        rowEmail[0] === '不可授权' && rowEmail.slice(1).every((v) => v === '联系方式走同意流程'),
        JSON.stringify(rowEmail),
      )
    }
    await shot(page, '02-consent-1280')

    // ── Outcomes ──
    ck('点 Outcomes 切区', await goZone(page, 'Outcomes', 'Outcome Observatory'))
    const outcomeShown = await waitText(page, FIX.outcome)
    ck('Outcomes：时间轴渲染出夹具成果摘要', outcomeShown)
    const outcomesText = await textOf(page)
    ck('Outcomes：成果空态文案**不可见**', !outcomesText.includes('当前没有任何成果记录'))
    ck('Outcomes：无「读取失败」错误态', !ERROR_TEXTS.some((t) => outcomesText.includes(t)))
    ck(
      '🔴 Outcomes：对手方确认后渲染为「已验证」（读服务端布尔，不是本地重算）',
      outcomesText.includes('已验证'),
    )
    ck('Outcomes：漏斗五级主线可见（指标区接了真实端点）', outcomesText.includes('商业指标'))
    await shot(page, '03-outcomes-1280')

    // ── Agents ──
    ck('点 Agents 切区', await goZone(page, 'Agents', 'Agent 运行与审批'))
    const goalShown = await waitText(page, FIX.runGoal)
    ck('Agents：运行卡片渲染出夹具 goal', goalShown)
    // 🔴 runs 与 usage 是两个请求：run 卡片先到不代表诚实块已渲染 —— 不等就抓文本，会把
    //    "usage 还在路上"误判成"诚实块缺失"（已实测踩到：截图里块明明在，断言却失败）。
    //    「已启用/未启用」两条变体都含「真实模型调用」，故用它做"块已渲染"的等待键，再断言档位。
    await waitText(page, '真实模型调用', 30_000)
    const agentsText = await textOf(page)
    ck('Agents：运行空态文案**不可见**', !agentsText.includes('当前没有任何 Agent 运行记录'))
    ck('Agents：无「读取失败」错误态', !ERROR_TEXTS.some((t) => agentsText.includes(t)))
    ck('Agents：状态渲染为「等待人工批准」', agentsText.includes('等待人工批准'))
    ck('Agents：风险档位文案可见（高风险必须显式告知）', agentsText.includes('高风险'))
    ck(
      '🔴 Agents：**服务端文案不含 markdown 强调标记**（否则界面显示字面星号）',
      !agentsText.includes('**'),
    )
    ck(
      'Agents：诚实块与真实调用状态一致（有 fake key ⇒ 报「已启用」）',
      agentsText.includes('真实模型调用已启用') && !agentsText.includes('真实模型调用未启用'),
    )
    await shot(page, '04-agents-1280')

    // ═════════════════════════════════════════════════════════
    section('── ④ 审批写操作（**在浏览器里点**，并验证拒绝也 fail loud）')
    // ═════════════════════════════════════════════════════════
    const approveBtn = page.getByRole('button', { name: '批准', exact: true })
    ck('渲染出「批准」按钮（总是渲染，不在前端自己判权限）', (await approveBtn.count()) >= 1)
    await approveBtn.first().click()

    const approved = await waitText(page, '裁决：已批准', 40_000)
    ck('🔴 点击批准 → 服务端接受 → 界面出现「裁决：已批准」', approved, approved ? '' : (await textOf(page)).slice(-300))
    const afterApprove = await textOf(page)
    ck('审批结果文案来自 `useLivingPost`（「裁决已写入」）', afterApprove.includes('裁决已写入'))
    ck('状态标签由「等待人工批准」变为「已批准」', afterApprove.includes('已批准') && !afterApprove.includes('等待人工批准'))
    await shot(page, '05-agents-approved-1280')

    // 第二次批准 ⇒ 服务端 409（已有裁决）；**原文**必须到达界面，不能被概括成"操作失败"
    await page.getByRole('button', { name: '批准', exact: true }).first().click()
    const conflictShown = await waitText(page, '不可改判', 40_000)
    ck('🔴 二次批准 → 409 原文到达界面（「不可改判」，未被概括成"操作失败"）', conflictShown)
    const afterConflict = await textOf(page)
    ck('409 后按钮**没有卡在 pending**（pendingUrl 已清）', !(await page.getByRole('button', { name: '批准', exact: true }).first().isDisabled()))
    ck('409 未污染已成立的裁决展示', afterConflict.includes('裁决：已批准'))

    // ═════════════════════════════════════════════════════════
    section('── ⑤ 360px 窄屏：页面级无横向溢出')
    // ═════════════════════════════════════════════════════════
    await page.setViewportSize({ width: 360, height: 800 })
    for (const [navLabel, h1Needle, name] of [
      ['Now', '今日工作台', '06-now-360'],
      ['Consent', 'Consent Gate', '07-consent-360'],
      ['Outcomes', 'Outcome Observatory', '08-outcomes-360'],
      ['Agents', 'Agent 运行与审批', '09-agents-360'],
    ]) {
      await goZone(page, navLabel, h1Needle)
      await sleep(400)
      const o = await page.evaluate(PAGE_HELPERS.overflow)
      ck(
        `360px · ${navLabel}：页面级无横向滚动`,
        o.scrollWidth <= o.clientWidth + 1,
        `scrollWidth=${o.scrollWidth} clientWidth=${o.clientWidth}`,
      )
      ck(
        `360px · ${navLabel}：没有"没人兜住"的越界元素`,
        o.offenders.length === 0,
        o.offenders.join(' | '),
      )
      if (navLabel === 'Consent') {
        const ts = await page.evaluate(PAGE_HELPERS.tableScroll)
        ck(
          '360px · Consent：披露表落在**可滚动**容器里（内容可及，而非被裁掉）',
          Boolean(ts) && ts.scrollWidth > ts.clientWidth,
          ts ? `容器 scrollWidth=${ts.scrollWidth} clientWidth=${ts.clientWidth}` : '未找到滚动容器',
        )
      }
      await shot(page, name)
    }

    // ═════════════════════════════════════════════════════════
    section('── ⑥ 两套主题：跟随系统偏好 + 手动切换 + 持久化 + 对比度')
    // ═════════════════════════════════════════════════════════
    await page.setViewportSize({ width: 1280, height: 800 })
    // 从"没有记忆"的状态测系统偏好 —— 否则会被前面自证开关留下的 localStorage 干扰。
    await page.evaluate(() => localStorage.removeItem('lf-theme'))
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForSelector('nav[aria-label="工作区导航"]', { timeout: 60_000 })
    await waitHydrated(page)
    await goZone(page, 'Consent', 'Consent Gate')
    const theme1 = await page.evaluate(PAGE_HELPERS.theme)
    ck('主题跟随系统偏好（prefers-color-scheme: dark → field）', theme1 === 'field', String(theme1))
    const bgField = await page.evaluate(PAGE_HELPERS.tokenBg)
    const contrastField = await page.evaluate(PAGE_HELPERS.contrast, 'main h1')
    ck('field 主题下正文对比度 ≥ 4.5', typeof contrastField === 'number' && contrastField >= 4.5, String(contrastField))
    await shot(page, '10-theme-field-1280')

    await page.locator('button[aria-label*="切换到明亮模式"]').click()
    const switched = await page
      .waitForFunction(() => {
        const el = document.querySelector('[data-lf-theme]')
        return !!el && el.getAttribute('data-lf-theme') === 'paper'
      }, undefined, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    ck('点主题按钮 → 根节点 data-lf-theme 变为 paper', switched, String(await page.evaluate(PAGE_HELPERS.theme)))
    const bgPaper = await page.evaluate(PAGE_HELPERS.tokenBg)
    ck('🔴 两套主题的 --lf-bg 令牌取值不同（主题真的作用在令牌上，不只是改属性）', Boolean(bgField) && bgField !== bgPaper, `${bgField} → ${bgPaper}`)
    const contrastPaper = await page.evaluate(PAGE_HELPERS.contrast, 'main h1')
    ck('paper 主题下正文对比度 ≥ 4.5', typeof contrastPaper === 'number' && contrastPaper >= 4.5, String(contrastPaper))
    ck('主题选择写入 localStorage（lf-theme）', (await page.evaluate(() => localStorage.getItem('lf-theme'))) === 'paper')
    await shot(page, '11-theme-paper-1280')

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForSelector('nav[aria-label="工作区导航"]', { timeout: 60_000 })
    await waitHydrated(page)
    ck(
      '刷新后主题仍为 paper（持久化生效，且首屏无 hydration 失配报错）',
      (await page.evaluate(PAGE_HELPERS.theme)) === 'paper',
      String(await page.evaluate(PAGE_HELPERS.theme)),
    )

    // ═════════════════════════════════════════════════════════
    section('── ⑦ 键盘可达：Tab 走到导航与输入框，回车能切区')
    // ═════════════════════════════════════════════════════════
    await goZone(page, 'Now', '今日工作台')
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
      window.scrollTo(0, 0)
    })
    const seen = []
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press('Tab')
      const f = await page.evaluate(PAGE_HELPERS.focused)
      if (f) seen.push(f)
      if (seen.some((x) => x.id === 'lf-composer')) break
    }
    ck('键盘可达：Tab 能到达底部目标输入框 #lf-composer', seen.some((x) => x.id === 'lf-composer'), `共 ${seen.length} 次 Tab`)
    ck('键盘可达：Tab 能到达左侧导航按钮', seen.some((x) => x.text === 'Consent' || x.text === 'Agents'), seen.map((x) => x.text).slice(0, 12).join('/'))
    const focusables = seen.filter((x) => x.tag === 'button' || x.tag === 'a' || x.tag === 'textarea' || x.tag === 'input')
    const noRing = focusables.filter((x) => !x.cls.includes('lf-focus-ring'))
    ck(
      '键盘可达：每个可聚焦控件都有可见焦点环（lf-focus-ring）',
      noRing.length === 0,
      noRing.map((x) => `${x.tag}:${x.text || x.aria}`).join(' | '),
    )

    // 键盘（而不是鼠标）真正驱动一次导航
    let reached = false
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab')
      const f = await page.evaluate(PAGE_HELPERS.focused)
      reached = Boolean(f && f.text === 'Outcomes')
    }
    ck('键盘可达：Tab 能聚焦到 Outcomes 导航按钮', reached)
    if (reached) {
      await page.keyboard.press('Enter')
      const switchedByKey = await page
        .waitForFunction(
          () => {
            const h = document.querySelector('main h1')
            return !!h && (h.textContent || '').includes('Outcome Observatory')
          },
          undefined,
          { timeout: 30_000 },
        )
        .then(() => true)
        .catch(() => false)
      ck('🔴 回车即切区（导航是真正的键盘可操作控件）', switchedByKey)
    }

    // 另一套系统偏好：light ⇒ 无 localStorage 时主题应为 paper（反向证明"跟随"而非"默认值")
    const ctxLight = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: 'light',
    })
    await ctxLight.addCookies(cookieObjs)
    const lightPage = await ctxLight.newPage()
    await lightPage.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await lightPage.waitForSelector('nav[aria-label="工作区导航"]', { timeout: 60_000 })
    await waitHydrated(lightPage)
    // 🔴 SSR 快照恒为 field，而 React 在 hydration 期间**不排** useSyncExternalStore 的
    //    快照一致性检查（react-dom 19.3：`isHydrating || … || pushStoreConsistencyCheck`），
    //    LivingShell 又不持有数据 hook（children 是 prop）→ 挂载后可能迟迟没有重渲染，
    //    主题停在 field 直到某次重渲染发生。单次读取会把"重渲染还没发生"误判成
    //    "不跟随系统偏好"，故轮询给足余量；超时仍是 field 才判失败（现场随断言打印）。
    let themeLight = 'field'
    let settledMs = -1
    {
      const t0 = Date.now()
      while (Date.now() - t0 < 10_000) {
        themeLight = await lightPage.evaluate(PAGE_HELPERS.theme)
        if (themeLight === 'paper') {
          settledMs = Date.now() - t0
          break
        }
        await sleep(500)
      }
    }
    const lightDiag = await lightPage.evaluate(() => ({
      mm: window.matchMedia('(prefers-color-scheme: light)').matches,
      saved: window.localStorage.getItem('lf-theme'),
    }))
    ck(
      '主题跟随系统偏好（prefers-color-scheme: light → paper）',
      themeLight === 'paper' && lightDiag.mm && !lightDiag.saved,
      `theme=${themeLight} · matchMedia.light=${lightDiag.mm} · saved=${lightDiag.saved} · settle=${settledMs}ms`,
    )
    await lightPage.close()
    await ctxLight.close()

    ck(
      '浏览器全程无未捕获异常（pageerror = 页面级 JS 崩溃）',
      pageErrors.length === 0,
      pageErrors.map((m) => m.slice(0, 120)).join(' | '),
    )
  } catch (e) {
    fail += 1
    console.log(`\n  ❌ 浏览器阶段抛错：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await browser.close().catch(() => {})
  }
}

// ── 入口 ──────────────────────────────────────────────────
main()
  .catch((e) => {
    fail += 1
    console.error(`\n❌ 失败：${e instanceof Error ? e.stack || e.message : String(e)}`)
  })
  .finally(() => {
    killAll()
    console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
    if (fail > 0) {
      console.log(`  截图：${SHOTS}`)
      console.log(`  服务端日志：${LOG_DIR}`)
    }
    process.exit(fail === 0 ? 0 : 1)
  })
