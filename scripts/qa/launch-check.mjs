#!/usr/bin/env node
/**
 * 上线预检 · 一条命令跑完全部**可自动化**的门禁
 *
 * ## 它替代了什么
 * 以前「上线前要检查的东西」散在十几份文档和人的记忆里：支付未接入契约、发版生效面、
 * 公开域名、依赖安全、迁移漂移、SLO、邮件通道、登录链路、ICE/TURN、Google OAuth 配置。
 * 每漏一项就是一次「上线后才发现」。本脚本把它们串成一条命令 + 一张表 + 一个退出码，
 * 并且**每一项都自带反向对照**（见各子脚本头部），避免"恒绿"。
 *
 * ## 边界（必须说清楚）
 * - **支付凭据本身不在这里验**：用户明确排除；未接入时的行为由 `verify:payment:off` 守住。
 * - 写操作只有两类，且都是自建自删：`verify:prod:session` 临时注册一个 QA 账号并删除
 *   （跑完生产 `User` 计数回到基线）；`verify:email:delivery` 向 Resend 测试收件人发信。
 * - 唯一无法脚本化的一步：在 Google 同意页上点「继续」。其余配置错误由
 *   `verify:oauth:authorize` 直接问 Google 拿到答案。
 *
 * ## 用法
 *   npm run check:launch                    # 全部（在线 + 离线）
 *   npm run check:launch -- --offline        # 只跑不需要网络凭据的
 *   npm run check:launch -- --only=payment,session
 *   npm run check:launch -- --json=reports/launch.json --verbose
 *
 * ## 退出码
 *   0 = 全绿 · 1 = 有失败项 · 2 = 前置不可用（拿不到站点/库/凭据，结论不可信）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '../..')
const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const OFFLINE = argv.includes('--offline')
const VERBOSE = argv.includes('--verbose')
const ONLY = (argOf('only', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const JSON_OUT = argOf('json', '')
/**
 * 目标站点。**必须显式传给子脚本** —— `verify-payment-off.mjs` 的默认 base 是
 * `http://127.0.0.1:3000`（为 CI 里跑构建产物设计）。不传的话本机跑会得到
 * 「连接失败」，然后被正确地判成"探针不可信"—— 也就是说：漏传参数不会静默变绿，
 * 而是变成一条看得见的失败（这是好事，但没必要）。
 */
const BASE = argOf('base', process.env.QA_BASE || 'https://app.lokfeel.com').replace(/\/$/, '')

/**
 * 每个步骤：
 *   id      用于 --only 与报告
 *   label   表里显示的名字
 *   cmd     命令（node 或 npm）
 *   args    参数
 *   online  需要真实生产/凭据；--offline 时跳过
 *   asserts 期望的最小断言数（用于"报告里能看出少跑了"）
 */
const STEPS = [
  {
    id: 'payment',
    label: '支付未接入契约（7 入口 / 503 语义）',
    cmd: 'node',
    args: ['scripts/qa/verify-payment-off.mjs', `--base=${BASE}`],
    online: true,
    asserts: 18,
  },
  {
    id: 'cache',
    label: 'Upstash 写入契约（含变异对照）',
    cmd: 'node',
    args: ['scripts/qa/verify-redis-cache-contract.mjs'],
    online: true,
    asserts: 12,
  },
  {
    id: 'email',
    label: '真实邮件送达（Resend 事件 + 退信对照）',
    cmd: 'node',
    args: ['scripts/qa/verify-email-delivery.mjs'],
    online: true,
    asserts: 5,
  },
  {
    id: 'oauth',
    label: 'Google OAuth 配置（含畸变对照）',
    cmd: 'node',
    args: ['scripts/qa/verify-oauth-authorize.mjs', `--base=${BASE}`],
    online: true,
    asserts: 7,
  },
  {
    id: 'session',
    label: '生产登录→会话→ICE/TURN（自建自删账号）',
    cmd: 'node',
    args: ['scripts/qa/verify-prod-session.mjs', `--base=${BASE}`],
    online: true,
    asserts: 28,
  },
  {
    id: 'origin',
    label: '对外跳转域名（部署域名泄漏扫描）',
    cmd: 'node',
    args: ['scripts/qa/verify-public-origin.mjs'],
    online: true,
    asserts: 13,
  },
  {
    id: 'surface',
    label: '发版生效面（新路由已可达）',
    cmd: 'node',
    args: ['scripts/qa/verify-released-surface.mjs', `--base=${BASE}`],
    online: true,
    asserts: 8,
  },
  {
    id: 'deps',
    label: '依赖安全棘轮（生产可达 high/critical）',
    cmd: 'npm',
    args: ['run', '--silent', 'check:deps'],
    online: false,
    asserts: 1,
  },
  {
    id: 'drift',
    label: 'Schema ↔ 生产库漂移（直连比对，无需 prisma CLI）',
    // 本机 node_modules 是残缺树，`prisma` CLI 不存在 ⇒ 官方 migrate diff 跑不了。
    // 换成自写的直连比对：同样是"比 schema 与库"，但它只依赖 fetch，任何机器都能跑。
    cmd: 'node',
    args: ['scripts/qa/verify-schema-drift.mjs'],
    online: false,
    asserts: 5,
  },
  {
    id: 'slo',
    label: '性能 SLO 规则',
    cmd: 'npm',
    args: ['run', '--silent', 'check:slo'],
    online: false,
    asserts: 1,
  },
]

const useColor = process.stdout.isTTY
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)

function runStep(step) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(step.cmd, step.args, {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', QA_BASE: BASE, QA_BASE_URL: BASE },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      if (VERBOSE) process.stdout.write(d)
    })
    child.stderr.on('data', (d) => {
      out += d
      if (VERBOSE) process.stderr.write(d)
    })
    child.on('error', (e) => {
      resolve({ code: 127, out: `spawn 失败: ${e.message}`, ms: Date.now() - started })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, out, ms: Date.now() - started })
    })
  })
}

/** 从子脚本输出里抽取「结论：a/b …」与失败行，用于汇总 */
function summarize(out) {
  const conclusion = (out.match(/结论：(.+)/g) || []).pop() || ''
  // 一个脚本可能打多组 a/b（如「6/6 达期望 + 2/2 正向对照」）—— 取**分母最大**的那组，
  // 否则会把 2/2 当成总数，误报「只跑了 2 条断言」。
  const pairs = [...out.matchAll(/(\d+)\s*\/\s*(\d+)/g)].map((m) => ({ n: Number(m[1]), d: Number(m[2]), raw: m[0] }))
  const best = pairs.sort((a, b) => b.d - a.d)[0]
  const counts = best ? best.raw.replace(/\s+/g, '') : ''
  const failedLabels = [...out.matchAll(/^\s*❌\s+(.+)$/gm)].map((m) => m[1].trim())
  const blocked = /⛔/.test(out)
  // 真正数一遍通过的断言（对勾）。比从文案里抠 a/b 稳：文案格式会变，对勾不会。
  const checkmarks = (out.match(/✅/g) || []).length
  return { conclusion: conclusion.replace('结论：', '').trim(), counts, checkmarks, failedLabels, blocked }
}

;(async () => {
  console.log('')
  console.log(c('1', '━━━━━━━━━━━━━━━━━━━━━━ 上线预检（除支付凭据外全部自动化）━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(`模式   : ${OFFLINE ? '离线（跳过需要生产/凭据的项）' : '全量'}`)
  console.log(`步骤   : ${STEPS.length} 项${ONLY.length ? `，仅 ${ONLY.join(',')}` : ''}`)
  console.log('')

  const selected = STEPS.filter((s) => (ONLY.length ? ONLY.includes(s.id) : true))
  const results = []

  for (const step of selected) {
    if (OFFLINE && step.online) {
      results.push({ id: step.id, label: step.label, status: 'skip', ms: 0, detail: '离线模式跳过' })
      process.stdout.write(`  ${c('90', '○')} ${step.label} ${c('90', '— 跳过（离线）')}\n`)
      continue
    }
    process.stdout.write(`  ⏳ ${step.label} … `)
    const { code, out, ms } = await runStep(step)
    const s = summarize(out)
    const status = code === 0 ? 'pass' : s.blocked || code === 2 ? 'blocked' : 'fail'
    results.push({
      id: step.id,
      label: step.label,
      status,
      ms,
      exitCode: code,
      detail: s.conclusion || (status === 'pass' ? 'ok' : '见输出'),
      counts: s.counts,
      checkmarks: s.checkmarks,
      failed: s.failedLabels,
    })
    const icon = status === 'pass' ? c('32', '✅') : status === 'blocked' ? c('33', '⛔') : c('31', '❌')
    process.stdout.write(`\r  ${icon} ${step.label} ${c('90', `(${(ms / 1000).toFixed(1)}s)`)}${s.conclusion ? '  ' + s.conclusion : ''}\n`)
    if (status !== 'pass') {
      const tail = out.trim().split('\n').slice(-6).join('\n')
      console.log(c('90', tail.split('\n').map((l) => '      ' + l).join('\n')))
    }
  }

  const pass = results.filter((r) => r.status === 'pass').length
  const fail = results.filter((r) => r.status === 'fail').length
  const blocked = results.filter((r) => r.status === 'blocked').length
  const skip = results.filter((r) => r.status === 'skip').length
  const totalAssertions = results.reduce((n, r) => n + (r.checkmarks || 0), 0)

  console.log('')
  console.log('┌──────────────────────────────────────────────────────────────────────────────┐')
  console.log('│ 汇总                                                                         │')
  console.log('└──────────────────────────────────────────────────────────────────────────────┘')
  console.log(`  ${c('32', `通过 ${pass}`)}  ${fail ? c('31', `失败 ${fail}`) : '失败 0'}  ${blocked ? c('33', `不可信 ${blocked}`) : '不可信 0'}  跳过 ${skip}   · 断言合计 ${totalAssertions}`)
  if (fail || blocked) {
    console.log('')
    for (const r of results.filter((x) => x.status !== 'pass' && x.status !== 'skip')) {
      console.log(`  ${r.status === 'blocked' ? '⛔' : '❌'} ${r.label}`)
      if (r.detail) console.log(`     ${r.detail}`)
      for (const f of r.failed || []) console.log(`     - ${f}`)
    }
  }

  // 少跑检测：断言数低于期望时明确提示（避免"步骤存在但其实没验"）
  const thin = results.filter((r) => {
    const step = STEPS.find((s) => s.id === r.id)
    if (!step || r.status !== 'pass') return false
    return (r.checkmarks || 0) < step.asserts
  })
  if (thin.length) {
    console.log('')
    for (const t of thin) {
      console.log(c('33', `  ⚠️  ${t.label} 只跑了 ${t.checkmarks} 条断言（期望 ≥ ${STEPS.find((s) => s.id === t.id).asserts}）—— 可能被提前短路`))
    }
  }

  console.log('')
  if (blocked) {
    console.log(c('33', '结论：有步骤无法取证（前置不可用），不能据此判定可上线。'))
  } else if (fail) {
    console.log(c('31', '结论：存在失败项 —— 不可上线，先修失败项。'))
  } else if (OFFLINE) {
    console.log(c('36', '结论：离线门禁全绿（在线项未跑，不能据此判定可上线）。'))
  } else {
    console.log(c('32', '结论：除支付凭据外，全部可自动化门禁通过 —— 填上 4 个支付变量即可发布。'))
  }
  console.log('')

  const exitCode = blocked ? 2 : fail ? 1 : 0
  if (JSON_OUT) {
    const p = path.isAbsolute(JSON_OUT) ? JSON_OUT : path.join(ROOT, JSON_OUT)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(
      p,
      JSON.stringify({ at: new Date().toISOString(), offline: OFFLINE, exitCode, pass, fail, blocked, skip, totalAssertions, results }, null, 2),
    )
    console.log(`报告已写入 ${path.relative(ROOT, p)}`)
  }
  process.exit(exitCode)
})()
