#!/usr/bin/env node
/**
 * 自托管环境变量审计。
 *
 * 背景：迁移到自有服务器时，最容易出事的是「少一个变量」，而它的表现各不相同：
 *   · NEXT_PUBLIC_* → 构建期内联，缺了可能是 undefined（也可能正是设计上的"关闭"）
 *   · AUTH_URL     → 回落到 http://localhost:3000，登录回调全错（src/lib/auth/config.ts:32）
 *   · CRON_SECRET  → cron 全 401，机器人不动且不报错
 *   · FIREBASE_*   → 只打一行 warn，桥接 disabled
 *
 * 教训（本脚本第一版踩过）：一开始把「代码引用了 NEXT_PUBLIC_X 但它不在环境里」
 * 一律判红，结果对生产环境报出 7 条"硬伤"——逐个读源码后发现**全部是可选**：
 *   - NEXT_PUBLIC_STUN_URLS / TURN_URLS：`const override = process.env...` 后判空，
 *     缺省即用内置 Google STUN / 空 TURN 列表
 *   - NEXT_PUBLIC_USE_TURN：`=== 'true'`，缺省 false 是默认关闭
 *   - NEXT_PUBLIC_USE_PUSHER：`!== 'false'`，缺省即**启用**（历史缺陷修复后的默认）
 *   - NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION：metadata.verification.google 可选
 *   - NEXT_PUBLIC_SENTRY_DSN：不配就不上报，设计如此
 *   - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY：缺失时代码显式 throw「Payment system not
 *     configured」，是**有意的未接入状态**
 * 静态分析无法判断"可选"，所以判红口径改为**可证伪的两条**：
 *
 *   C1 目标 env 文件必须覆盖来源（Netlify）的**每一个键**（导出不能丢东西）
 *   C2 自托管必需键必须存在且非空
 *
 * 其余全部只作提示；C3 用显式登记记录"为什么可选"，
 * 新出现的、未登记的可选键仍会被点名，避免登记表变成垃圾桶。
 *
 * 用法：
 *   node scripts/qa/selfhost-env-audit.mjs --env-file /etc/lokfeel/env --netlify --site <id>
 *   node scripts/qa/selfhost-env-audit.mjs --env-file .env.example        # 只看模板
 *   node scripts/qa/selfhost-env-audit.mjs --self-test
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../lib/strip-comments.mjs'

const SCAN_DIRS = ['src', 'netlify']
const SCAN_FILES = [
  'proxy.ts',
  'next.config.ts',
  'instrumentation.ts',
  'sentry.client.config.ts',
  'sentry.server.config.ts',
  'sentry.edge.config.ts',
]

/** 自托管必需键：缺一个就不是"体验问题"，而是"跑不起来/登录不了/定时任务全 401" */
export const REQUIRED_FOR_SELFHOST = [
  'AUTH_URL',
  'AUTH_SECRET',
  'NEXTAUTH_URL',
  'DATABASE_URL',
  'CRON_SECRET',
]

/** 前端要连自己：两者至少存在一个 */
const SITE_URL_ANY = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL']

/** 已核实"缺省即默认"的构建期键 —— 每条都必须写明依据 */
const OPTIONAL_BUILD_TIME = {
  NEXT_PUBLIC_STUN_URLS: 'override 模式：缺省用内置 Google STUN（src/config/webrtc.config.ts:21）',
  NEXT_PUBLIC_TURN_URLS: 'override 模式：缺省为空 TURN 列表（src/config/webrtc.config.ts:37）',
  NEXT_PUBLIC_USE_TURN: "=== 'true'，缺省 false = 默认不开 TURN（src/config/webrtc.config.ts:65）",
  NEXT_PUBLIC_USE_PUSHER: "!== 'false'，缺省即启用（src/hooks/use-im-pusher.ts:50）",
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: 'metadata.verification.google 可选（src/app/layout.tsx:90）',
  NEXT_PUBLIC_SENTRY_DSN: '不配则不上报，设计如此（sentry.*.config.ts）',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    '缺失时代码显式 throw「Payment system not configured」，属有意未接入',
}

/** 返回 Map<KEY, {buildTime, hasFallback, files:Set}> */
export function collectReferences(sources) {
  const refs = new Map()
  for (const [file, raw] of sources) {
    const code = stripComments(raw)
    for (const line of code.split('\n')) {
      const re = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["'`]([A-Z][A-Z0-9_]*)["'`]\]/g
      let m
      while ((m = re.exec(line))) {
        const key = m[1] || m[2]
        const tail = line.slice(m.index + m[0].length)
        const hasFallback = /(\|\||\?\?|\?\.)/.test(tail)
        const prev = refs.get(key)
        if (prev) {
          prev.hasFallback = prev.hasFallback || hasFallback
          prev.files.add(file)
        } else {
          refs.set(key, { buildTime: key.startsWith('NEXT_PUBLIC_'), hasFallback, files: new Set([file]) })
        }
      }
    }
  }
  return refs
}

export function parseEnvFile(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(t)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1)
    }
    map.set(m[1], v)
  }
  return map
}

/**
 * 纯函数。expected: Set<string>|null（来源键集）；env: Map<string,string>
 * 返回 { fails, warns, infos, missingServer }
 */
export function audit({ expected, env, refs }) {
  const fails = []
  const warns = []
  const infos = []

  // C1：来源里的每个键都必须出现在目标 env
  if (expected) {
    for (const k of [...expected].sort()) {
      if (!env.has(k)) fails.push(`C1 ${k}：来源有、目标 env 缺失（导出丢键）`)
    }
  }

  // C2：必需键存在且非空
  for (const k of REQUIRED_FOR_SELFHOST) {
    if (!env.has(k)) fails.push(`C2 ${k}：自托管必需键缺失`)
    else if (!String(env.get(k)).trim()) fails.push(`C2 ${k}：值为空`)
  }
  if (!SITE_URL_ANY.some((k) => env.has(k) && String(env.get(k)).trim())) {
    fails.push(`C2 ${SITE_URL_ANY.join(' / ')}：至少要有其一（前端要知道自己跑在哪）`)
  }

  // C3：代码引用但环境缺失的构建期键
  for (const [k, meta] of [...refs.entries()].sort()) {
    if (!meta.buildTime || env.has(k)) continue
    const reason = OPTIONAL_BUILD_TIME[k]
    if (meta.hasFallback) {
      // 代码自带 `|| ''` / `|| 默认值`：缺省是**显式设计**，不是遗漏
      infos.push(`C3 ${k}：代码有 fallback，缺省即默认（${[...meta.files][0]}）`)
    } else if (reason) {
      infos.push(`C3 ${k}：可选 —— ${reason}`)
    } else {
      warns.push(`C3 ${k}：构建期键缺失、无 fallback 且未登记"可选"（若确属可选，请在 OPTIONAL_BUILD_TIME 写明依据）`)
    }
  }

  // C4：服务端引用但未配置（多数是能力开关，缺省即关闭）
  let missingServer = 0
  for (const [k, meta] of [...refs.entries()].sort()) {
    if (meta.buildTime || env.has(k)) continue
    missingServer++
    infos.push(`C4 ${k}：服务端引用、环境未配${meta.hasFallback ? '（代码有 fallback）' : ''}`)
  }
  // C5：环境有、代码不引用
  for (const k of [...env.keys()].sort()) {
    if (!refs.has(k)) infos.push(`C5 ${k}：环境有、代码未引用（可清理，或由框架/运行时消费）`)
  }

  return { fails, warns, infos, missingServer }
}

async function walk(dir, out) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (['node_modules', '.next', '.git', 'generated', 'test-results', 'playwright-report'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue
      await walk(p, out)
    } else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
      out.push(p)
    }
  }
}

async function loadSources() {
  const files = []
  for (const d of SCAN_DIRS) await walk(d, files)
  for (const f of SCAN_FILES) {
    try {
      await fs.access(f)
      files.push(f)
    } catch {
      /* 可选文件 */
    }
  }
  const sources = []
  for (const f of files) sources.push([f, await fs.readFile(f, 'utf8')])
  return sources
}

async function netlifyKeys(site, token) {
  const res = await fetch(`https://api.netlify.com/api/v1/sites/${site}/env`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Netlify API ${res.status}`)
  return new Set((await res.json()).map((e) => e.key))
}

async function selfTest() {
  const t = []
  const refs = collectReferences([
    [
      'a.ts',
      `const x = process.env.NEXT_PUBLIC_X;
       const y = process.env.OPTIONAL || 'd'
       const z = process.env.HARD
       // process.env.IN_COMMENT
       const u = "https://example.com"; const w = process.env.NEXT_PUBLIC_AFTER_URL
       const v = process.env.NEXT_PUBLIC_USE_TURN === 'true'`,
    ],
  ])
  t.push(['行尾注释被剥离', !refs.has('IN_COMMENT')])
  t.push(['字符串里的 // 不吞掉后续引用', refs.has('NEXT_PUBLIC_AFTER_URL')])

  const envFull = parseEnvFile(`
AUTH_URL='https://app.lokfeel.com'
AUTH_SECRET='s'
NEXTAUTH_URL='https://app.lokfeel.com'
DATABASE_URL='libsql://x'
CRON_SECRET='c'
NEXT_PUBLIC_APP_URL='https://app.lokfeel.com'
`)
  t.push(['齐全时无 FAIL', audit({ expected: null, env: envFull, refs }).fails.length === 0])

  const noAuth = new Map(envFull)
  noAuth.delete('AUTH_URL')
  t.push(['缺 AUTH_URL 判红', audit({ expected: null, env: noAuth, refs }).fails.some((f) => f.includes('AUTH_URL'))])

  const emptySecret = new Map(envFull)
  emptySecret.set('CRON_SECRET', '  ')
  t.push(['必需键为空判红', audit({ expected: null, env: emptySecret, refs }).fails.some((f) => f.includes('CRON_SECRET'))])

  t.push([
    'C1 捕获导出丢键',
    audit({ expected: new Set(['AUTH_URL', 'MISSING_KEY']), env: envFull, refs }).fails.some((f) => f.includes('MISSING_KEY')),
  ])

  const r = audit({ expected: null, env: envFull, refs })
  t.push(['C3 未登记的构建期键 → WARN', r.warns.some((w) => w.includes('NEXT_PUBLIC_X'))])
  t.push(['C3 已登记的可选键 → INFO', r.infos.some((i) => i.includes('NEXT_PUBLIC_USE_TURN'))])
  t.push(["缺省即启用的开关（!== 'false'）仍被识别", r.infos.some((i) => i.includes('NEXT_PUBLIC_USE_TURN'))])

  const placeholder = parseEnvFile(
    `CRON_SECRET=请填写\nAUTH_URL=x\nAUTH_SECRET=x\nNEXTAUTH_URL=x\nDATABASE_URL=x\nNEXT_PUBLIC_APP_URL=x`,
  )
  t.push([
    '占位符不被当作空值（另有 C1/C3 兜底）',
    !audit({ expected: null, env: placeholder, refs }).fails.some((f) => f.includes('CRON_SECRET：值为空')),
  ])

  let pass = 0
  for (const [name, ok] of t) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (ok) pass++
  }
  console.log(`\nSELFTEST ASSERTIONS=${t.length} → ${pass} PASS / ${t.length - pass} FAIL`)
  console.log(`ASSERTIONS=${t.length}`)
  return pass === t.length
}

async function main() {
  if (process.argv.includes('--self-test')) process.exit((await selfTest()) ? 0 : 1)

  const argv = process.argv.slice(2)
  const getArg = (name) => {
    const i = argv.indexOf(name)
    if (i >= 0) return argv[i + 1]
    const pref = argv.find((a) => a.startsWith(name + '='))
    return pref ? pref.slice(name.length + 1) : undefined
  }

  const envFile = getArg('--env-file')
  if (!envFile) {
    console.error('需要 --env-file <path>')
    process.exit(64)
  }
  const env = parseEnvFile(await fs.readFile(envFile, 'utf8'))

  let expected = null
  let sourceLabel = '(未提供来源)'
  if (argv.includes('--netlify')) {
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN
    const site = getArg('--site')
    if (!token || !site) {
      console.error('--netlify 需要 NETLIFY_AUTH_TOKEN 环境变量与 --site <id>')
      process.exit(64)
    }
    expected = await netlifyKeys(site, token)
    sourceLabel = `netlify:${site}`
  }

  const refs = collectReferences(await loadSources())
  const { fails, warns, infos, missingServer } = audit({ expected, env, refs })

  console.log('=== 自托管环境变量审计 ===')
  console.log(`来源 ${sourceLabel} · 目标 ${envFile}（${env.size} 键）· 代码引用 ${refs.size} 键\n`)

  console.log(`[硬性] C1 覆盖率：${expected ? `来源 ${expected.size} 键必须全部在目标中` : '跳过（未给 --netlify）'}`)
  console.log(`[硬性] C2 自托管必需键：${REQUIRED_FOR_SELFHOST.length + 1} 项`)
  if (fails.length) for (const f of fails) console.log(`  FAIL  ${f}`)
  else console.log('  ✅ 全部满足')

  if (warns.length) {
    console.log('\n[需确认] C3 构建期键缺失且未登记')
    for (const w of warns) console.log(`  WARN  ${w}`)
  }
  const c3 = infos.filter((i) => i.startsWith('C3'))
  if (c3.length) {
    console.log(`\n[已知可选] ${c3.length} 项（依据已写入脚本）`)
    for (const i of c3) console.log(`  INFO  ${i}`)
  }
  console.log(`\n[提示] 服务端引用但未配：${missingServer} 项；另有 ${infos.length - c3.length} 条明细（--verbose 查看）`)

  if (argv.includes('--verbose')) {
    for (const i of infos) if (!i.startsWith('C3')) console.log(`  INFO  ${i}`)
  }

  console.log(`\nRESULT: ${fails.length === 0 ? 'PASS' : 'FAIL'} · ${fails.length} fail / ${warns.length} warn`)
  console.log(`ASSERTIONS=${REQUIRED_FOR_SELFHOST.length + 1 + (expected ? expected.size : 0)}`)
  process.exit(fails.length === 0 ? 0 : 1)
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (invoked) {
  main().catch((e) => {
    console.error('ERROR', e.message)
    process.exit(1)
  })
}
