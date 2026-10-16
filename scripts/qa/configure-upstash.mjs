#!/usr/bin/env node
/**
 * 生产补配 Upstash Redis 环境变量（任务 #51）
 *
 * 前提：凭据已由用户放入仓库根 `.env.local`（避免凭据进入对话记录）：
 *   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN=AXX...
 *
 * 四步（默认 dry-run，`--apply` 才真正写入）：
 *   ① 读取 .env.local 的两个键（缺任一 → 拒绝执行，绝不猜测）
 *   ② 用 Upstash REST API 发 PING 验证凭据有效（只读；写坏凭据到生产 = 全员降级）
 *   ③ 写入 Netlify 站点级 env（POST /accounts/:account/env?site_id=...，is_secret:false，
 *      免费计划无 scopes 字段）
 *   ④ 提示触发部署 + 给出复验命令（部署生效后 health.redis.configured 必须 true）
 *
 * 需要：NETLIFY_AUTH_TOKEN 环境变量（或 .env.local 里的同名键）。
 *
 * 退出码：0 = dry-run 检查全过 / apply 成功；1 = 任一步失败。
 *
 * @module scripts/qa/configure-upstash
 */
import fs from 'node:fs'
import path from 'node:path'

const APPLY = process.argv.includes('--apply')
const ACCOUNT_ID = process.env.NETLIFY_ACCOUNT_ID || 'aoshuang99'
const SITE_ID = process.env.NETLIFY_SITE_ID || 'c46478e9-7ac8-4bcf-9052-7638b04fef83'
const SITE_SLUG = 'lokfeel'
const KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']

function fail(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, i).trim()] = v
  }
  return out
}

async function main() {
  // ── ① 读取凭据（.env.local → 进程环境，后者优先以便覆写测试）
  const envFile = loadEnvFile(path.join(process.cwd(), '.env.local'))
  const creds = {}
  for (const k of KEYS) creds[k] = (process.env[k] || envFile[k] || '').trim()
  const missing = KEYS.filter((k) => !creds[k])
  if (missing.length) {
    fail(`.env.local（或环境变量）缺少：${missing.join(', ')} —— 凭据必须由用户提供，本脚本绝不猜测`)
  }
  if (!/^https:\/\/.+\.upstash\.io\/?$/.test(creds.UPSTASH_REDIS_REST_URL)) {
    fail(`UPSTASH_REDIS_REST_URL 形状不对（期望 https://xxx.upstash.io）：${creds.UPSTASH_REDIS_REST_URL.slice(0, 30)}…`)
  }
  console.log('✅ ① 凭据已就位（URL 形状合法，TOKEN 长度 %d）', creds.UPSTASH_REDIS_REST_TOKEN.length)

  // ── ② PING 验证（只读，防把坏凭据写进生产）
  const pingRes = await fetch(`${creds.UPSTASH_REDIS_REST_URL.replace(/\/+$/, '')}/ping`, {
    headers: { Authorization: `Bearer ${creds.UPSTASH_REDIS_REST_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  })
  const pingBody = await pingRes.text()
  // Upstash REST 的成功形状是 JSON 信封 {"result":"PONG"}（裸 PONG 兜底）
  const pong = /"result"\s*:\s*"PONG"/i.test(pingBody) || pingBody.trim().toUpperCase() === 'PONG'
  if (!pingRes.ok || !pong) {
    fail(`② Upstash PING 失败：HTTP ${pingRes.status} body=${pingBody.slice(0, 120)} —— 修复凭据后再来`)
  }
  console.log('✅ ② Upstash PING 成功（HTTP %d → %s）', pingRes.status, pingBody.trim())

  const netlifyToken = (process.env.NETLIFY_AUTH_TOKEN || envFile.NETLIFY_AUTH_TOKEN || '').trim()
  if (!netlifyToken) fail('缺 NETLIFY_AUTH_TOKEN（环境变量或 .env.local）')
  const auth = { Authorization: `Bearer ${netlifyToken}`, 'content-type': 'application/json' }

  if (!APPLY) {
    console.log('\n—— dry-run 结束：凭据有效，可以写入 ——')
    console.log('执行写入：NETLIFY_AUTH_TOKEN=… node scripts/qa/configure-upstash.mjs --apply')
    process.exit(0)
  }

  // ── ③ 写入 Netlify 站点级 env（写前快照：核对是否已有同名键）
  const listRes = await fetch(
    `https://api.netlify.com/api/v1/accounts/${ACCOUNT_ID}/env?site_id=${SITE_ID}`,
    { headers: auth, signal: AbortSignal.timeout(20000) },
  )
  if (!listRes.ok) fail(`③ 读取 Netlify env 失败：HTTP ${listRes.status} ${await listRes.text().then((t) => t.slice(0, 200))}`)
  const before = await listRes.json()
  // GET /env 返回**数组**（每项含 key/scopes/values/…）—— 不是 map
  const existingKeys = (Array.isArray(before) ? before : []).map((v) => v.key)
  console.log('   · 写前快照：站点 env 共 %d 个键', existingKeys.length)
  for (const k of KEYS) {
    if (existingKeys.includes(k)) console.log('   · %s 已存在，本次将覆盖其值', k)
  }

  // ⚠️ Netlify createEnvVars 的 body 是**数组**（批量，每项含 key/scopes/values/is_secret）——
  //    官方 swagger 定义 schema.type=array；发单对象或 {KEY:[...]} map 都会 400 "_json missing"。
  //    ⚠️ 免费计划**不能指定 scopes**（指定即 403 "Upgrade your Netlify account"），
  //    故省略 scopes（默认全 scope），与既往经验一致。
  const payload = KEYS.map((k) => ({
    key: k,
    is_secret: false,
    values: [{ value: creds[k], context: 'all' }],
  }))
  const putRes = await fetch(
    `https://api.netlify.com/api/v1/accounts/${ACCOUNT_ID}/env?site_id=${SITE_ID}`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    },
  )
  if (!putRes.ok) fail(`③ 写入 env 失败：HTTP ${putRes.status} ${await putRes.text().then((t) => t.slice(0, 200))}`)
  console.log('✅ ③ 已写入站点级 env：%s（site=%s）', KEYS.join(', '), SITE_SLUG)

  // 回读校验（写成功 ≠ 写对：值不回显，只核对键存在 + 长度一致）
  const verifyRes = await fetch(
    `https://api.netlify.com/api/v1/accounts/${ACCOUNT_ID}/env?site_id=${SITE_ID}`,
    { headers: auth, signal: AbortSignal.timeout(20000) },
  )
  const vars = await verifyRes.json()
  for (const k of KEYS) {
    const found = (Array.isArray(vars) ? vars : []).find((v) => v.key === k)
    if (!found) fail(`③ 回读未找到 ${k} —— 写入可能未生效`)
    const len = found.values?.[0]?.value?.length
    if (len !== creds[k].length) fail(`③ 回读 ${k} 值长度不符（Netlify=${len} 期望=${creds[k].length}）`)
    console.log('   ✅ 回读 %s：值长度一致（%d）', k, len)
  }

  // ── ④ 触发构建（env 变更需重新部署才生效）
  const buildRes = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/builds`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(20000),
  })
  if (!buildRes.ok) {
    console.error(`⚠️ ④ API 触发构建失败（HTTP ${buildRes.status}）—— 可改推一个不带 [skip netlify] 的空提交触发`)
  } else {
    const b = await buildRes.json()
    console.log('✅ ④ 已触发 Netlify 构建（deploy id=%s）', (b.id || '').slice(0, 12))
  }

  console.log(`
—— 下一步（部署就绪后，约 3–5 分钟）——
1. 复验生效：
   curl -s https://app.lokfeel.com/api/health | jq .redis
   期望：{"backend":"upstash","configured":true,...}
2. 本地复跑降级回归：npm run check:redis   （16 项断言）
3. 若 backend 仍为 memory：确认部署已完成（Netlify deploy 状态 ready）再查，
   因 env 是构建时注入的 —— 未重建的旧部署读不到新键。`)
}

main().catch((e) => fail(`意外错误：${e.message}`))
