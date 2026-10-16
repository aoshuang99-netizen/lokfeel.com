#!/usr/bin/env node
/**
 * 用 Upstash Management API 供给 Redis REST 凭据（任务 #51 的前置）
 *
 * 认证：Basic <email>:<api_key>（.env.local 的 UPSTASH_EMAIL / UPSTASH_API_KEY）
 *
 * 模式（默认 dry-run）：
 *   · dry-run：列出账号下全部 Redis 库（含 endpoint / state / type），不做任何变更
 *   · --apply：
 *       ① 有 active 的库 → 取第一个，GET 详情拿 rest_token
 *       ② 无库 → 创建 lokfeel-prod（primary_region 默认 ap-southeast-1，可用 --region 覆盖）
 *       ③ 把 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 追加进 .env.local
 *          （已存在同名键则报错退出 —— 不静默覆盖生产配置）
 *       ④ 对取到的凭据发 PING 验证（失败即退出，绝不让坏凭据流向 Netlify）
 *
 * 输出纪律：**不打印完整 token**（只打长度/前 6 位）。
 *
 * @module scripts/qa/upstash-provision
 */
import fs from 'node:fs'
import path from 'node:path'

const APPLY = process.argv.includes('--apply')
const REGION = (process.argv.find((a) => a.startsWith('--region=')) || '--region=ap-southeast-1').split('=')[1]
const API = 'https://api.upstash.com/v2'
const DB_NAME = 'lokfeel-prod'
const ENV_FILE = path.join(process.cwd(), '.env.local')

function fail(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const i = raw.indexOf('=')
    if (i > 0) out[raw.slice(0, i).trim()] = raw.slice(i + 1).trim()
  }
  return out
}

function mask(s) {
  return s ? `${s.slice(0, 6)}…(len=${s.length})` : '(空)'
}

function appendEnvKeys(pairs) {
  let text = fs.readFileSync(ENV_FILE, 'utf8')
  // 只判存在 → 只取键名（解构 [k, v] 会让 v 成 unused-vars，lint 棘轮判红过一次）
  for (const k of Object.keys(pairs)) {
    if (new RegExp(`^${k}=`, 'm').test(text)) fail(`.env.local 已存在 ${k}，拒绝覆盖（请手工处理）`)
  }
  if (!text.endsWith('\n')) text += '\n'
  text += `\n# ── Upstash Redis REST 凭据（由 scripts/qa/upstash-provision.mjs 写入，${new Date().toISOString()}）──\n`
  for (const [k, v] of Object.entries(pairs)) text += `${k}=${v}\n`
  fs.writeFileSync(ENV_FILE, text)
}

async function api(method, p, body) {
  const email = process.env.UPSTASH_EMAIL || loadEnvFile(ENV_FILE).UPSTASH_EMAIL
  const key = process.env.UPSTASH_API_KEY || loadEnvFile(ENV_FILE).UPSTASH_API_KEY
  if (!email || !key) fail('缺 UPSTASH_EMAIL / UPSTASH_API_KEY（.env.local）')
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${key}`).toString('base64')}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  if (!res.ok) fail(`Upstash API ${method} ${p} → HTTP ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

async function ping(url, token) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/ping`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })
  const body = await res.text()
  return { res, body }
}

async function main() {
  // ── ① 列库
  const dbs = await api('GET', '/redis/databases')
  console.log(`✅ 认证成功（${(dbs.customer_id || '').replace(/^[^@]+/, '***@')}）· 账号下 Redis 库：${dbs.length}`)
  for (const d of dbs) {
    console.log(`   · ${d.database_name} | state=${d.state} | type=${d.type} | endpoint=${d.endpoint} | region=${d.primary_region || d.region}`)
  }

  if (!APPLY) {
    console.log('\n—— dry-run 结束 ——')
    console.log('执行供给：node scripts/qa/upstash-provision.mjs --apply')
    process.exit(0)
  }

  // ── ② 取库：优先已有 active，否则创建
  let db = dbs.find((d) => d.state === 'active')
  if (db) {
    console.log(`\n② 使用已有库：${db.database_name}（${db.endpoint}）`)
    const detail = await api('GET', `/redis/database/${db.database_id}`)
    db = { ...db, ...detail }
  } else {
    console.log(`\n② 无 active 库 → 创建 ${DB_NAME}（primary_region=${REGION}）`)
    db = await api('POST', '/redis/database', {
      database_name: DB_NAME,
      platform: 'aws',
      primary_region: REGION,
      tls: true,
      eviction: false,
    })
    console.log(`   · 已创建 endpoint=${db.endpoint} state=${db.state}`)
  }

  const token = db.rest_token || ''
  if (!db.endpoint || !token) fail('② 未能取得 endpoint / rest_token（响应字段缺失）—— 如实上报，不硬凑')
  console.log(`   · rest_token = ${mask(token)}`)

  // ── ③ 写 .env.local
  // ⚠️ endpoint 可能是完整主机名（"xxx.upstash.io"）也可能是 slug（"xxx"）——
  //    首版脚本无条件拼 .upstash.io 产出双重后缀被 PING 兜住，故这里判点。
  const host = db.endpoint.includes('.') ? db.endpoint : `${db.endpoint}.upstash.io`
  const url = `https://${host}`
  appendEnvKeys({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token })
  console.log(`✅ ③ 已写入 .env.local：UPSTASH_REDIS_REST_URL=${url} · TOKEN=${mask(token)}`)

  // ── ④ PING 验证
  const { res, body } = await ping(url, token)
  if (!res.ok || !/PONG/i.test(body)) fail(`④ PING 失败：HTTP ${res.status} ${body.slice(0, 120)}`)
  console.log(`✅ ④ PING 成功（HTTP ${res.status} → ${body.trim()}）—— 凭据有效，可继续生产补配`)
  console.log('\n下一步：NETLIFY_AUTH_TOKEN=… node scripts/qa/configure-upstash.mjs --apply')
}

main().catch((e) => fail(`意外错误：${e.message}`))
