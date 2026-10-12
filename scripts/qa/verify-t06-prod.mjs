#!/usr/bin/env node
/**
 * T06 生产上线复验（只读为主，无业务副作用）
 *
 * 判据设计（沿用 T03/T04 复验的两条实测判据）：
 *   「路由缺失」     → Next 内置 404（可见文本含 "Page Not Found"，HTML）
 *   「路由存在但未授权」→ 401 且 `application/json`
 * 用 401+JSON 反证 T06 的代码**确实在跑**，而不是靠"某公开路径返回 200"这种
 * 可被静态兜底伪造的信号（公开页永远返回 200，证明不了任何上线事实）。
 *
 * 覆盖：
 *   ① 存活 + 数据库可达
 *   ② T06 四个运营端点**匿名全拒**（AC-02 回归；同时证明路由已注册）
 *   ③ T05 两个连接端点匿名全拒（T05 与 T06 同批上线，一并回归）
 *   ④ cron 驱动器的守卫：无 token / 错 token 一律 401
 *   ⑤ **可选**：带真实 CRON_SECRET 打一次驱动器 → 200 + tick 摘要。
 *      这是唯一能证明「线上运行时真的能读到 C3 三张表」的取证
 *      （`runWorkflowTick` 第一步就是查 `WorkflowJob`，表缺失必然 500）。
 *      本地 secret 与生产不一致时记 SKIP（不是 FAIL）。
 *   ⑥ 披露负测：匿名 401 的响应体里**不得**出现业务字段名
 *
 * 用法:
 *   node scripts/qa/verify-t06-prod.mjs
 *   QA_BASE_URL=https://app.lokfeel.com node scripts/qa/verify-t06-prod.mjs
 *   QA_TICK=0 node scripts/qa/verify-t06-prod.mjs     # 跳过第 ⑤ 步（不碰 cron）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const BASE = (process.env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
const PUBLIC_HOST = new URL(BASE).host

/** 平台部署专用域名的特征：<deploy-id>--<site>.netlify.app */
const DEPLOY_HOST_RE = /--[a-z0-9-]+\.netlify\.app/i

/** 形状合法但不存在的 id（通过形状预检，才能走到鉴权分支） */
const FAKE_JOB_ID = 'cmzzzzzzz0000000000000000'

/** 匿名响应里**不该出现**的业务字段名（出现 = 鉴权之前就把数据装进了响应） */
const FORBIDDEN_KEYS = [
  'dedupeKey',
  'payload',
  'recipientId',
  'rationale',
  'organizationId',
  'proposalId',
  'attempts',
  'lockedUntil',
]

let pass = 0
let fail = 0
let skip = 0
const leaks = []

const ck = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  if (ok) pass++
  else fail++
}
const sk = (label, extra = '') => {
  console.log(`  ⏭️  SKIP ${label}${extra ? '  ' + extra : ''}`)
  skip++
}

async function req(method, path, { body, headers = {}, timeout = 25000 } = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: 'manual',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    const loc = res.headers.get('location') || ''
    if (DEPLOY_HOST_RE.test(loc) || DEPLOY_HOST_RE.test(text)) {
      leaks.push(`${method} ${path} → ${loc || '(body)'}`)
    }
    return { status: res.status, loc, text, ctype: res.headers.get('content-type') || '' }
  } catch (e) {
    return { status: 0, loc: '', text: '', ctype: '', err: `${e.name}: ${e.message}` }
  }
}

const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const isUnregisteredRoute404 = (r) =>
  r.status === 404 && /Page Not Found/i.test(visibleText(r.text))

const isJson = (r) => /application\/json/i.test(r.ctype)

/** 匿名访问必须被拒：401 且 JSON（404 HTML = 代码根本没上线） */
function assertAnonymousRejected(label, r, expect = [401, 403]) {
  if (isUnregisteredRoute404(r)) {
    ck(`${label} → 已注册路由`, false, `拿到未注册 404（HTML 兜底）→ 该代码未上线`)
    return
  }
  ck(`${label} → 拒绝匿名`, expect.includes(r.status), `status=${r.status}`)
  ck(`${label} → 返回 JSON 信封`, isJson(r), `ctype=${r.ctype || '(空)'}`)
}

/** 从 .env.local 读 CRON_SECRET（可被环境变量覆盖） */
function resolveCronSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p)) continue
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line.startsWith('CRON_SECRET')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      let v = line.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (v) return v
    }
  }
  return null
}

const main = async () => {
  console.log(`\n目标 ${BASE}   （T06 上线复验 · 只读为原则）\n`)

  console.log('── 1) 存活与数据库 ──')
  {
    const r = await req('GET', '/api/health')
    ck('GET /api/health → 200', r.status === 200, `status=${r.status}`)
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.text)
        ck('  健康体含 dbLatency（DB 可达）', Number.isFinite(j.dbLatency), `dbLatency=${j.dbLatency}`)
      } catch {
        ck('  健康体可解析', false)
      }
    }
  }

  console.log('\n── 2) T06 运营端点：匿名全拒（AC-02 回归 + 证明路由已注册）──')
  {
    const r = await req('GET', '/api/v1/workflow/jobs')
    assertAnonymousRejected('GET /api/v1/workflow/jobs', r)
  }
  {
    const r = await req('GET', '/api/v1/workflow/overview')
    assertAnonymousRejected('GET /api/v1/workflow/overview', r)
  }
  {
    const r = await req('POST', `/api/v1/workflow/jobs/${FAKE_JOB_ID}/takeover`, {
      body: { note: 'probe' },
    })
    assertAnonymousRejected('POST …/jobs/{id}/takeover', r)
  }
  {
    const r = await req('POST', `/api/v1/workflow/jobs/${FAKE_JOB_ID}/requeue`)
    assertAnonymousRejected('POST …/jobs/{id}/requeue', r)
  }

  console.log('\n── 3) T05 连接端点：匿名全拒（同批上线，一并回归）──')
  {
    const r = await req('GET', '/api/v1/connections/proposals')
    assertAnonymousRejected('GET /api/v1/connections/proposals', r)
  }
  {
    const r = await req('GET', '/api/v1/connections/introductions')
    assertAnonymousRejected('GET /api/v1/connections/introductions', r)
  }

  console.log('\n── 4) cron 驱动器：守卫必须拦住无凭据探测 ──')
  {
    const r = await req('GET', '/api/cron/workflow-tick')
    assertAnonymousRejected('GET /api/cron/workflow-tick（无 token）', r)
  }
  {
    const r = await req('GET', '/api/cron/workflow-tick', {
      headers: { Authorization: 'Bearer definitely-not-the-secret' },
    })
    assertAnonymousRejected('GET /api/cron/workflow-tick（错 token）', r)
  }

  console.log('\n── 5) 带真实 CRON_SECRET 打一次驱动器（证明运行时能读到 C3 三表）──')
  if (process.env.QA_TICK === '0') {
    sk('驱动器实跑', '（QA_TICK=0 显式跳过）')
  } else {
    const secret = resolveCronSecret()
    if (!secret) {
      sk('驱动器实跑', '（本地无 CRON_SECRET 可用）')
    } else {
      const r = await req('GET', '/api/cron/workflow-tick?budgetMs=3000', {
        headers: { Authorization: `Bearer ${secret}` },
        timeout: 40000,
      })
      if (r.status === 401) {
        sk('驱动器实跑', '（本地 CRON_SECRET 与生产不一致 → 401；非缺陷）')
      } else if (r.status !== 200) {
        ck('驱动器实跑 → 200', false, `status=${r.status} body=${r.text.slice(0, 200)}`)
      } else {
        ck('驱动器实跑 → 200', true)
        try {
          const j = JSON.parse(r.text)
          ck('  响应 ok=true（引擎完整跑通，含 WorkflowJob 查询）', j.ok === true)
          const t = j.tick || {}
          console.log(
            `     tick: claimed=${t.claimed ?? '?'} succeeded=${t.succeeded ?? '?'} ` +
              `retried=${t.retried ?? '?'} dead=${t.dead ?? '?'} superseded=${t.superseded ?? '?'} ` +
              `failed=${t.failed ?? '?'}`,
          )
          ck('  tick 返回结构化摘要', typeof t === 'object' && t !== null)
          const rc = j.reconciliation
          if (rc) {
            console.log(
              `     reconcile: scanned=${rc.scanned ?? '?'} enqueued=${rc.enqueued ?? '?'} skipped=${rc.skipped ?? '?'}`,
            )
            ck('  对账段返回结构化摘要', typeof rc === 'object')
          } else {
            ck('  对账段存在（默认开启）', false, 'reconciliation 为 null')
          }
        } catch (e) {
          ck('  响应可解析为 JSON', false, String(e))
        }
      }
    }
  }

  console.log('\n── 6) 披露负测：匿名 401 响应体不得含业务字段名 ──')
  {
    const targets = [
      ['GET', '/api/v1/workflow/jobs'],
      ['GET', '/api/v1/workflow/overview'],
      ['GET', '/api/v1/connections/proposals'],
    ]
    let hit = 0
    for (const [m, p] of targets) {
      const r = await req(m, p)
      for (const k of FORBIDDEN_KEYS) {
        if (r.text.includes(k)) {
          hit++
          console.log(`    ⚠️  ${m} ${p} 响应体含字段名 ${k}`)
        }
      }
    }
    ck('匿名响应体无业务字段泄漏', hit === 0, hit ? `命中 ${hit} 处` : '')
  }

  console.log('\n── 7) 发布窗口期：跳转不得落到部署专用域名 ──')
  console.log(`  （全量扫描：本次共 ${leaks.length} 处泄漏）`)
  for (const l of leaks) console.log(`    ⚠️  ${l}`)
  ck('无部署专用域名泄漏', leaks.length === 0)
  ck('公开 host 与目标一致', PUBLIC_HOST === 'app.lokfeel.com', `host=${PUBLIC_HOST}`)

  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过 ════════\n`)
  process.exit(fail === 0 ? 0 : 1)
}

await main()
