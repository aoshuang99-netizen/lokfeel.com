#!/usr/bin/env node
/**
 * 源码级防回归：cron 调度器调用的方法，必须是 route 真实导出的方法。
 *
 * 为什么需要这个门禁（2026-10-20）：
 *   `netlify/functions/cron-runner.ts` 曾对所有端点统一 `POST`，而
 *   `bot-tick` / `bot-online` / `bot-chat` / `bot-match` / `status` 只导出 GET
 *   ⇒ Next 返回 **405**，这些 cron 从未执行。线上实测 GET=401 / POST=405。
 *   这类缺陷**不报错、不告警**，只表现为「机器人不动」，靠人眼永远看不出来。
 *
 * 判据（三条，任一不满足即红）：
 *   C1 每个 job 的 path 都能找到对应 `src/app/api/cron/<name>/route.ts`
 *   C2 job 声明的方法（缺省 GET）在该 route 的**真实导出**里存在
 *   C3 反向：route 导出了 GET 但 job 用 POST（或反之）也算不一致
 *
 * 设计纪律：
 *   - **先剥注释再断言**（注释里的 `{ path: ... }` 不是配置）；
 *   - 缺文件/缺导出 ⇒ 红，不静默跳过（空集恒真是假绿的高发区）；
 *   - `--self-test` 用变异验证引擎本身：注入 4 种错误，必须 4/4 被抓到。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const RUNNER = 'netlify/functions/cron-runner.ts'
const ROUTE_DIR = 'src/app/api/cron'

import { stripComments } from '../lib/strip-comments.mjs'

/** 从 route.ts 取导出方法 */
export function parseRouteMethods(src) {
  const code = stripComments(src)
  const out = new Set()
  const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g
  let m
  while ((m = re.exec(code))) out.add(m[1] || m[2])
  return [...out]
}

/** 从 cron-runner.ts 取 job 列表（path + method，缺省 GET） */
export function parseRunnerJobs(src) {
  const code = stripComments(src)
  const start = code.indexOf('CRON_JOBS')
  if (start < 0) return { error: 'CRON_JOBS 未找到' }
  // 注意：`const CRON_JOBS: CronJob[] = [` 的类型注解里也有一个 `[]`。
  // 必须先跳到 `=` 之后，再找数组字面量 —— 否则会把类型里的空元组当数组体，
  // 解析出 0 个 job，然后被 C0 判红（或更糟：被当成"没有可检查项"跳过）。
  const eq = code.indexOf('=', start)
  if (eq < 0) return { error: 'CRON_JOBS 缺少赋值' }
  const open = code.indexOf('[', eq)
  if (open < 0) return { error: 'CRON_JOBS 缺少数组字面量' }
  // 取到匹配的 ]
  let depth = 0
  let end = -1
  for (let i = open; i < code.length; i++) {
    if (code[i] === '[') depth++
    else if (code[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return { error: 'CRON_JOBS 数组未闭合' }
  const body = code.slice(open + 1, end)

  const jobs = []
  const re = /path:\s*["'`]([^"'`]+)["'`](?:\s*,\s*method:\s*["'`]([A-Z]+)["'`])?/g
  let m
  while ((m = re.exec(body))) jobs.push({ path: m[1], method: (m[2] || 'GET').toUpperCase() })
  return { jobs }
}

/**
 * 纯函数判定。routes: Map<name, string[]>
 * 返回 { failures: string[], warnings: string[], checked: number }
 */
export function checkJobs(jobs, routes) {
  const failures = []
  const warnings = []
  let checked = 0

  if (!Array.isArray(jobs) || jobs.length === 0) {
    failures.push('C0 调度表为空：没有可检查的 job（空集不得判绿）')
    return { failures, warnings, checked }
  }

  for (const job of jobs) {
    const name = String(job.path || '').replace(/^\/api\/cron\//, '')
    if (!job.path || !job.path.startsWith('/api/cron/')) {
      failures.push(`C1 job path 不在 /api/cron/ 下：${job.path}`)
      continue
    }
    const methods = routes instanceof Map ? routes.get(name) : routes[name]
    if (!methods || methods.length === 0) {
      failures.push(`C1 找不到 route 导出：${job.path}（期望 ${ROUTE_DIR}/${name}/route.ts）`)
      continue
    }
    checked++
    const want = String(job.method || 'GET').toUpperCase()
    if (!methods.includes(want)) {
      failures.push(
        `C2 ${job.path} 用 ${want} 调用，但 route 只导出 [${methods.join(', ')}] ⇒ 线上会 405`
      )
    }
  }

  // 反向提示：route 存在但调度器完全没引用（可能是刻意停用，如 lifecycle-sweep）
  const referenced = new Set(
    jobs.map((j) => String(j.path || '').replace(/^\/api\/cron\//, ''))
  )
  for (const name of routes instanceof Map ? routes.keys() : Object.keys(routes)) {
    if (!referenced.has(name)) warnings.push(`W1 ${ROUTE_DIR}/${name} 未被调度器引用（刻意停用可忽略）`)
  }

  return { failures, warnings, checked }
}

async function load() {
  const runnerSrc = await fs.readFile(path.join(ROOT, RUNNER), 'utf8')
  const parsed = parseRunnerJobs(runnerSrc)
  if (parsed.error) throw new Error(`${RUNNER}: ${parsed.error}`)

  const routes = new Map()
  const entries = await fs.readdir(path.join(ROOT, ROUTE_DIR), { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const f = path.join(ROOT, ROUTE_DIR, e.name, 'route.ts')
    try {
      routes.set(e.name, parseRouteMethods(await fs.readFile(f, 'utf8')))
    } catch {
      routes.set(e.name, [])
    }
  }
  return { jobs: parsed.jobs, routes }
}

async function selfTest() {
  const results = []
  const t = (name, ok, detail = '') => results.push({ name, ok, detail })

  const routeSrc = `
    // 注释里的 export async function POST 不该被算进来
    export async function GET() { return new Response('ok') }
  `
  t('P1 只识别真实导出（注释里的 POST 不算）',
    JSON.stringify(parseRouteMethods(routeSrc)) === JSON.stringify(['GET']),
    JSON.stringify(parseRouteMethods(routeSrc)))

  const runnerSrc = `
    const CRON_JOBS: CronJob[] = [
      { path: "/api/cron/bot-tick", method: "GET" },
      // { path: "/api/cron/disabled-one", method: "GET" },
      { path: "/api/cron/migrate-avatars", method: "POST" },
    ]
  `
  const parsed = parseRunnerJobs(runnerSrc)
  t('P2 注释掉的 job 不被解析', parsed.jobs?.length === 2, JSON.stringify(parsed))

  const routes = new Map([
    ['bot-tick', ['GET']],
    ['migrate-avatars', ['POST']],
  ])
  const base = checkJobs(parsed.jobs, routes)
  t('P3 正确的调度表判绿', base.failures.length === 0, JSON.stringify(base.failures))

  // 变异 1：route 少了方法
  const mutRoutes1 = new Map([
    ['bot-tick', ['POST']],
    ['migrate-avatars', ['POST']],
  ])
  const m1 = checkJobs(parsed.jobs, mutRoutes1)
  t('M1 捕获「只导出 POST 却用 GET 调」', m1.failures.length === 1, m1.failures.join(' | '))

  // 变异 2：路径打错 / route 不存在
  const m2 = checkJobs([{ path: '/api/cron/bot-tik', method: 'GET' }], routes)
  t('M2 捕获路径拼错', m2.failures.length === 1, m2.failures.join(' | '))

  // 变异 3：空调度表必须红（防空集假绿）
  const m3 = checkJobs([], routes)
  t('M3 空调度表判红', m3.failures.length === 1, m3.failures.join(' | '))

  let pass = 0
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.detail}`}`)
    if (r.ok) pass++
  }
  console.log(`\nSELFTEST ASSERTIONS=${results.length} → ${pass} PASS / ${results.length - pass} FAIL`)
  return pass === results.length
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const ok = await selfTest()
    console.log(`ASSERTIONS=${6}`)
    process.exit(ok ? 0 : 1)
  }

  const { jobs, routes } = await load()
  const { failures, warnings, checked } = checkJobs(jobs, routes)

  console.log('=== cron 方法一致性 ===')
  console.log(`jobs=${jobs.length}  routes=${routes.size}  checked=${checked}`)
  for (const w of warnings) console.log(`WARN  ${w}`)
  for (const f of failures) console.log(`FAIL  ${f}`)

  const assertions = checked + 1
  console.log(
    `\nRESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'} · ${jobs.length - failures.length} ok / ${failures.length} bad`
  )
  console.log(`ASSERTIONS=${assertions}`)
  process.exit(failures.length === 0 ? 0 : 1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  main().catch((e) => {
    console.error('ERROR', e.message)
    process.exit(1)
  })
}
