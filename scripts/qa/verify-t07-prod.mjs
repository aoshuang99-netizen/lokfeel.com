#!/usr/bin/env node
/**
 * T07 · 社群控制台（`/console/*`）生产上线复验 —— Slice 1 + Slice 2 + Slice 3
 *
 * 判据沿用 T03/T04/T06 复验的同一套（避免"公开页 200 就算上线"这种伪信号）：
 *   「路由缺失」       → Next 内置 404（可见文本含 "Page Not Found"，HTML）
 *   「页面受登录保护」 → 307 + Location 含 `/login?callbackUrl=`（与 /dashboard 同款守卫）
 *   「API 未授权」     → 401 且 `application/json`
 *
 * 覆盖：
 *   ① 存活 + 数据库可达
 *   ② 组织态五屏匿名 → 必须 307 跳登录，且回跳地址保留（证明屏幕代码已上线）
 *      Slice 1 ` /console`；Slice 2 `/console/missions` `/console/members`；
 *      Slice 3 `/console/connections` `/console/settings`
 *   ③ `/dashboard` 匿名 → 同款 307（个人态回归，证明两态守卫一致）
 *   ④ API 匿名全拒（AC-02 回归 + 证明路由已注册）：工作流（T06）×2、
 *      成员目录（Slice 2）、连接运营视图 + 组织档案（Slice 3）
 *   ⑤ `/api/cron/lifecycle-sweep` 守卫：无 token / 错 token 一律 401
 *   ⑥ **可选**：带真实 CRON_SECRET 打 `?dry=1` → 200
 *      —— 这是唯一能证明「AC-10 端点已上线且**默认只统计**（未开启自动删）」的取证。
 *      本地 secret 与生产不一致时记 SKIP（不是 FAIL）。
 *   ⑦ 泄漏负测：任何 Location / body 都不得含部署专用域名
 *
 * 用法:
 *   node scripts/qa/verify-t07-prod.mjs
 *   QA_BASE_URL=https://app.lokfeel.com node scripts/qa/verify-t07-prod.mjs
 *   QA_LIFECYCLE=0 node scripts/qa/verify-t07-prod.mjs    # 跳过第 ⑥ 步（不碰 cron）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const BASE = (process.env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')

/** 平台部署专用域名的特征：<deploy-id>--<site>.netlify.app */
const DEPLOY_HOST_RE = /--[a-z0-9-]+\.netlify\.app/i

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

async function req(method, p, { headers = {}, body, timeout = 25000 } = {}) {
  try {
    const res = await fetch(`${BASE}${p}`, {
      method,
      redirect: 'manual',
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    const loc = res.headers.get('location') || ''
    if (DEPLOY_HOST_RE.test(loc) || DEPLOY_HOST_RE.test(text)) {
      leaks.push(`${method} ${p} → ${loc || '(body)'}`)
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

/** 页面必须被登录守卫拦下（307 + /login 回跳）。404 = 代码没上线。 */
function assertLoginGuarded(label, r, expectedCallback) {
  if (isUnregisteredRoute404(r)) {
    ck(`${label} → 已注册路由`, false, '拿到未注册 404（HTML 兜底）→ 该代码未上线')
    return
  }
  ck(`${label} → 307 跳登录`, r.status === 307, `status=${r.status}`)
  ck(`${label} → Location 含 /login`, /\/login\b/.test(r.loc), `loc=${r.loc || '(空)'}`)
  if (expectedCallback) {
    ck(
      `${label} → 回跳地址保留`,
      r.loc.includes(`callbackUrl=${encodeURIComponent(expectedCallback)}`),
      `loc=${r.loc || '(空)'}`
    )
  }
}

/** 匿名访问 API 必须被拒：401 + JSON */
function assertAnonymousRejected(label, r, expect = [401, 403]) {
  if (isUnregisteredRoute404(r)) {
    ck(`${label} → 已注册路由`, false, '拿到未注册 404（HTML 兜底）→ 该代码未上线')
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
  console.log(`\n目标 ${BASE}   （T07 Slice 1+2+3 上线复验 · 只读为原则）\n`)

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

  console.log('\n── 2) 组织态屏幕全部受登录保护（Slice 1 / 2 / 3）──')
  assertLoginGuarded('GET /console（匿名）', await req('GET', '/console'), '/console')
  assertLoginGuarded(
    'GET /console/missions（匿名）',
    await req('GET', '/console/missions'),
    '/console/missions'
  )
  assertLoginGuarded(
    'GET /console/members（匿名）',
    await req('GET', '/console/members'),
    '/console/members'
  )
  assertLoginGuarded(
    'GET /console/connections（匿名）',
    await req('GET', '/console/connections'),
    '/console/connections'
  )
  assertLoginGuarded(
    'GET /console/settings（匿名）',
    await req('GET', '/console/settings'),
    '/console/settings'
  )

  console.log('\n── 3) 个人态 /dashboard 回归（两态守卫应一致）──')
  assertLoginGuarded('GET /dashboard（匿名）', await req('GET', '/dashboard'))

  console.log('\n── 4) API 匿名全拒（AC-02 回归 + 证明路由已注册）──')
  assertAnonymousRejected('GET /api/v1/workflow/overview', await req('GET', '/api/v1/workflow/overview'))
  assertAnonymousRejected('GET /api/v1/workflow/jobs', await req('GET', '/api/v1/workflow/jobs'))
  // Slice 2：成员目录（member.read = OPERATOR+）
  assertAnonymousRejected('GET /api/v1/members', await req('GET', '/api/v1/members'))
  assertAnonymousRejected('GET /api/v1/members?q=x', await req('GET', '/api/v1/members?q=x'))
  // Slice 3：连接运营视图（workflow.read = OPERATOR+）
  assertAnonymousRejected(
    'GET /api/v1/connections/pipeline',
    await req('GET', '/api/v1/connections/pipeline')
  )
  //   非法 bucket 也必须是 401 而非 400 —— 鉴权必须先于参数校验（否则匿名者能探到参数面）
  assertAnonymousRejected(
    'GET /api/v1/connections/pipeline?bucket=__nope__',
    await req('GET', '/api/v1/connections/pipeline?bucket=__nope__')
  )
  // Slice 3：组织档案（读 org.read / 写 org.update）
  assertAnonymousRejected('GET /api/v1/org', await req('GET', '/api/v1/org'))
  assertAnonymousRejected(
    'PATCH /api/v1/org（匿名 · body 空对象）',
    await req('PATCH', '/api/v1/org', {
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  )

  console.log('\n── 5) AC-10 端点守卫：无凭据必须被拦 ──')
  assertAnonymousRejected(
    'GET /api/cron/lifecycle-sweep（无 token）',
    await req('GET', '/api/cron/lifecycle-sweep')
  )
  assertAnonymousRejected(
    'GET /api/cron/lifecycle-sweep（错 token）',
    await req('GET', '/api/cron/lifecycle-sweep', {
      headers: { Authorization: 'Bearer definitely-not-the-secret' },
    })
  )

  console.log('\n── 6) AC-10 端点上线取证（带真 secret · dry=1 只统计）──')
  const secret = resolveCronSecret()
  if (!secret || process.env.QA_LIFECYCLE === '0') {
    sk('GET /api/cron/lifecycle-sweep?dry=1', secret ? '（QA_LIFECYCLE=0）' : '（本地无 CRON_SECRET）')
  } else {
    const r = await req('GET', '/api/cron/lifecycle-sweep?dry=1', {
      headers: { Authorization: `Bearer ${secret}` },
    })
    if (r.status === 401) {
      sk('GET /api/cron/lifecycle-sweep?dry=1', '本地 secret 与生产不一致')
    } else {
      ck('  → 200（端点已上线）', r.status === 200, `status=${r.status}`)
      try {
        const j = JSON.parse(r.text)
        ck('  → ok=true', j.ok === true)
        ck('  → 含 report（只统计，未写库）', j.report && typeof j.report === 'object')
        console.log(`     report: ${JSON.stringify(j.report).slice(0, 320)}`)
      } catch {
        ck('  → 响应可解析为 JSON', false, r.text.slice(0, 120))
      }
    }
  }

  console.log('\n── 7) 泄漏负测：不得出现部署专用域名 ──')
  ck('Location / body 无 --xxx.netlify.app', leaks.length === 0, `命中 ${leaks.length} 处`)
  for (const l of leaks) console.log(`     🔴 ${l}`)

  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过 ════════\n`)
  process.exitCode = fail === 0 ? 0 : 1
}

main()
