#!/usr/bin/env node
/**
 * 真实邮件送达取证（Resend 事件驱动，不需要人去翻收件箱）
 *
 * ## 为什么不能只「调一次 send 然后看 200」
 * Resend 的 `POST /emails` 返回 200 只代表**它收下了**，不代表送达：
 * 域名没验证、收件域不存在、被退信，都还是 200。要证明「这封信真的到了」，
 * 只能看它之后的投递事件 —— `GET /emails/{id}` 的 `last_event`。
 *
 * ## 怎么做到「不打扰任何人」
 * 用 Resend 官方测试收件人：
 *   - `delivered@resend.dev` → 一定被投递（不计入退信率、不进真人收件箱）
 *   - `bounced@resend.dev`   → 一定退信（**变异对照**，见下）
 *
 * ## 变异对照（防止「随便什么都是绿」）
 * 只测 delivered，有个隐患：万一我的轮询逻辑永远读到同一个值（比如一直 `sent`
 * 我也当成功），测试就是恒真的。所以同一轮再发一封到 `bounced@resend.dev`，
 * 断言它最终是 `bounced`。能区分「送到」与「没送到」，delivered 才有意义。
 * 用 `--no-control` 关闭（介意退信噪音时）。
 *
 * ## 退出码
 *   0 = 真实送达 + 对照通过      1 = 没送达/事件异常      2 = 无 RESEND_API_KEY
 *
 * ## 用法
 *   node scripts/qa/verify-email-delivery.mjs
 *   node scripts/qa/verify-email-delivery.mjs --to you@example.com   # 改投自己邮箱
 *   node scripts/qa/verify-email-delivery.mjs --no-control
 *   node scripts/qa/verify-email-delivery.mjs --json out.json
 */
import fs from 'node:fs'
import { loadEnv } from './lib/turso-http.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const TO = argOf('to', 'delivered@resend.dev')
const CONTROL = !argv.includes('--no-control')
const JSON_OUT = argOf('json', '')
const TIMEOUT_MS = Number(argOf('timeout', '60000'))

// 凭据来源优先级：
//   ① 进程环境  ② .env.local / .env.production / .env（本地副本）
//   ③ **Netlify 单键端点**（生产真正在用的值；本地副本可能为空，见下）
// 注意 `.env.production` 里这一项是空字符串（Vercel 时代的快照被清空过），
// 所以"本地有 key 名"不等于"有值" —— 必须落到 ③ 才算真值。
const env = loadEnv(['.env', '.env.production', '.env.local'])
let KEY = (env.RESEND_API_KEY || '').trim()
let keySource = KEY ? 'local-env' : ''
if (!KEY) {
  try {
    const { readNetlifyEnv } = await import('./lib/netlify-env.mjs')
    KEY = (await readNetlifyEnv('RESEND_API_KEY', { env })) || ''
    keySource = KEY ? 'netlify' : ''
  } catch (e) {
    console.log(`  ·  读取 Netlify 变量失败：${e.message}`)
  }
}
const FROM = (env.SMTP_FROM || env.RESEND_FROM || 'LokFeel <noreply@lokfeel.com>').trim()

const results = []
const ck = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  → ' + detail : ''}`)
}

if (!KEY) {
  console.log('\n⛔ 缺少 RESEND_API_KEY（.env.production / .env.local）—— 拒绝静默跳过\n')
  process.exit(2)
}

const API = 'https://api.resend.com'
const H = { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function send({ to, subject, tag }) {
  const res = await fetch(`${API}/emails`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      text: `LokFeel 上线预检探针（${tag}）。收到本信说明 Resend 通道可用；无需回复。`,
      html: `<p>LokFeel 上线预检探针（<code>${tag}</code>）。</p><p>收到本信说明 Resend 通道可用；无需回复。</p>`,
      tags: [{ name: 'probe', value: tag }],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, id: json?.id || null, error: json?.message || json?.error || null }
}

async function eventOf(id) {
  const res = await fetch(`${API}/emails/${id}`, { headers: H, signal: AbortSignal.timeout(20_000) })
  const json = await res.json().catch(() => null)
  if (!res.ok) return { status: res.status, lastEvent: null }
  return { status: res.status, lastEvent: json?.last_event || null }
}

/** 轮询到终态或超时；返回见过的全部事件（便于报告「卡在哪一步」） */
async function waitForEvent(id, accepted, timeoutMs) {
  const seen = new Set()
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const { lastEvent } = await eventOf(id)
    if (lastEvent) {
      seen.add(lastEvent)
      last = lastEvent
      if (accepted.includes(lastEvent)) break
    }
    await sleep(2500)
  }
  return { last, seen: [...seen] }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')

async function main() {
  console.log('\n━━━ 真实邮件送达（Resend 事件）━━━')
  console.log(`发件   : ${FROM}`)
  console.log(`凭据   : ${keySource === 'netlify' ? '生产 Netlify 变量' : '本地 env 副本'}`)
  console.log(`收件   : ${TO}${CONTROL ? ' + bounced@resend.dev（变异对照）' : ''}\n`)

  // ① 正常投递
  const ok = await send({ to: TO, subject: `[LokFeel] 上线预检 ${stamp}`, tag: 'delivered' })
  ck('发送：Resend 接受请求并返回 message id', ok.status === 200 && Boolean(ok.id), `HTTP ${ok.status}${ok.error ? ' ' + ok.error : ''}`)
  if (!ok.id) {
    results.push({ label: '发送失败，后续未执行', ok: false, detail: ok.error || '' })
    return
  }

  const delivered = await waitForEvent(ok.id, ['delivered', 'bounced', 'complained', 'failed'], TIMEOUT_MS)
  ck(
    '送达：最终事件为 delivered',
    delivered.last === 'delivered',
    `last=${delivered.last} seen=[${delivered.seen.join(',')}]`,
  )

  // ② 变异对照：一定能被区分出来
  if (CONTROL) {
    const bad = await send({ to: 'bounced@resend.dev', subject: `[LokFeel] 退信对照 ${stamp}`, tag: 'bounce-control' })
    ck('对照：退信探针也被接受', bad.status === 200 && Boolean(bad.id), `HTTP ${bad.status}`)
    if (bad.id) {
      const bounced = await waitForEvent(bad.id, ['bounced', 'delivered', 'failed'], TIMEOUT_MS)
      ck(
        '对照：退信探针最终事件是 bounced（证明本探针能区分成败）',
        bounced.last === 'bounced',
        `last=${bounced.last} seen=[${bounced.seen.join(',')}]`,
      )
    }
  }
}

;(async () => {
  let exitCode = 0
  try {
    await main()
  } catch (e) {
    results.push({ label: '未预期异常', ok: false, detail: e.message })
  }
  // 安全断言：任何一个输出片段都不该带出 API key
  const leaked = results.some((r) => String(r.detail).includes(KEY.slice(0, 8)))
  ck('安全：输出未回显任何凭据片段', !leaked, '')

  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (failed.length) {
    console.log(`结论：${failed.length} 项失败（共 ${results.length} 项）`)
    for (const f of failed) console.log(`   ❌ ${f.label}${f.detail ? ' → ' + f.detail : ''}`)
    exitCode = 1
  } else {
    console.log(`结论：${results.length}/${results.length} 通过（含变异对照）`)
  }
  console.log('')
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), exitCode, results }, null, 2))
  process.exit(exitCode)
})()
