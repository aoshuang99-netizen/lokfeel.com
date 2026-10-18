#!/usr/bin/env node
/**
 * Upstash 写入契约（真实往返）—— 把「缓存写入会不会静默丢字段/丢 TTL」变成可复跑断言
 *
 * ## 为什么需要它
 * `src/lib/redis-cache.ts` 的 SET 曾经写错参数形态，Upstash **不报错**（返回 OK），
 * 只是把 `["<json>","EX",75]` 当成值存下来、并且**不设 TTL**。单测能钉住「我们发出去
 * 的请求长什么样」，但钉不住「Upstash 收到之后到底存成了什么」—— 那只能真打一次。
 *
 * 本脚本做三件事：
 *   ① 用**当前实现同款**命令写一个探针键，读回来必须**对象相等**且 TTL ∈ (0, ttl]
 *   ② **变异对照**：用旧写法写一个键，读回来必须是「字符串数组 + TTL=-1」——
 *      证明 ① 的断言真的会失败（否则就是恒真断言，等于没测）
 *   ③ 两个键都删掉，不给生产留垃圾
 *
 * 只用 `UPSTASH_REDIS_REST_URL/TOKEN`，不碰业务数据；键名带随机后缀。
 *
 * 退出码：0 = 契约成立 · 1 = 契约被破坏 · 2 = 无凭据（拒绝静默跳过）
 *
 * 用法：
 *   node scripts/qa/verify-redis-cache-contract.mjs
 *   node scripts/qa/verify-redis-cache-contract.mjs --json out.json
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { loadEnv } from './lib/turso-http.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const JSON_OUT = argOf('json', '')

const env = loadEnv()
const URL_BASE = (env.UPSTASH_REDIS_REST_URL || '').trim()
const TOKEN = (env.UPSTASH_REDIS_REST_TOKEN || '').trim()

const results = []
const ck = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  → ' + detail : ''}`)
}

if (!URL_BASE || !TOKEN) {
  console.log('\n⛔ 缺少 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（拒绝静默跳过）\n')
  process.exit(2)
}

const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(URL_BASE + path, {
    method,
    headers: H,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, result: json?.result ?? null, error: json?.error || null }
}

const get = (k) => call(`/get/${encodeURIComponent(k)}`).then((r) => r.result)
const ttlOf = (k) => call(`/ttl/${encodeURIComponent(k)}`).then((r) => r.result)
const del = (k) => call(`/del/${encodeURIComponent(k)}`)

const TTL = 90
const suffix = crypto.randomBytes(6).toString('hex')
const KEY_OK = `launch:probe:set-ok:${suffix}`
const KEY_BAD = `launch:probe:set-bad:${suffix}`

// 用 tokenVersion: 0 当夹具 —— 它正是被吃掉的那个 falsy 字段
const VALUE = { id: 'probe-user', email: 'probe@example.invalid', image: null, role: 'USER', tokenVersion: 0 }

async function main() {
  console.log('\n━━━ Upstash 写入契约（真实往返 + 变异对照）━━━\n')

  // 清理可能残留
  await del(KEY_OK).catch(() => {})
  await del(KEY_BAD).catch(() => {})

  // ① 当前实现同款：命令数组 POST /
  const setOk = await call('/', {
    method: 'POST',
    body: ['SET', KEY_OK, JSON.stringify(VALUE), 'EX', String(TTL)],
  })
  ck('写入：命令数组形式返回 OK', setOk.result === 'OK', String(setOk.result))

  const readOk = await get(KEY_OK)
  let parsed = null
  try {
    parsed = JSON.parse(readOk)
  } catch {
    parsed = null
  }
  ck('读回：是**对象**而不是字符串数组', parsed !== null && !Array.isArray(parsed), typeof parsed === 'object' ? 'object' : String(parsed).slice(0, 40))
  ck('读回：字段逐一相等（含 tokenVersion=0）', JSON.stringify(parsed) === JSON.stringify(VALUE), '')
  ck('读回：tokenVersion 仍是数字 0（falsy 字段没被丢）', parsed?.tokenVersion === 0, `typeof=${typeof parsed?.tokenVersion}`)

  const ttlOk = await ttlOf(KEY_OK)
  ck('TTL：已生效（0 < ttl ≤ ' + TTL + '）', typeof ttlOk === 'number' && ttlOk > 0 && ttlOk <= TTL, `ttl=${ttlOk}`)

  // ② 变异对照：旧写法（/set/{key} + 数组 body）必须读不回对象、且没有 TTL
  const setBad = await call(`/set/${encodeURIComponent(KEY_BAD)}`, {
    method: 'POST',
    body: [JSON.stringify(VALUE), 'EX', String(TTL)],
  })
  ck('变异：旧写法**也**返回 OK（说明它不会自己报错，只能靠断言抓）', setBad.result === 'OK', String(setBad.result))

  const readBad = await get(KEY_BAD)
  let parsedBad = null
  try {
    parsedBad = JSON.parse(readBad)
  } catch {
    parsedBad = null
  }
  ck('变异：旧写法读回不是对象（正是 P0 的成因）', Array.isArray(parsedBad) || parsedBad === null, Array.isArray(parsedBad) ? 'array' : String(parsedBad).slice(0, 40))
  ck('变异：旧写法 TTL = -1（永不过期 ⇒ 坏值会一直毒害读方）', (await ttlOf(KEY_BAD)) === -1, `ttl=${await ttlOf(KEY_BAD)}`)

  // ③ 删除契约：/del/{key} 只认 POST，DELETE 方法返回 405（第二个同类坑）
  const KEY_DEL = `launch:probe:del:${suffix}`
  await call('/', { method: 'POST', body: ['SET', KEY_DEL, '1', 'EX', String(TTL)] })

  const delDelete = await fetch(`${URL_BASE}/del/${encodeURIComponent(KEY_DEL)}`, {
    method: 'DELETE',
    headers: H,
  }).then((r) => r.status)
  ck('删除：DELETE 方法被拒（405）—— 用它会让 invalidate 静默空转', delDelete === 405, `HTTP ${delDelete}`)
  ck('删除：DELETE 之后键仍在（正是「失效没生效」的样子）', (await get(KEY_DEL)) !== null, '')

  const delPost = await call(`/del/${encodeURIComponent(KEY_DEL)}`, { method: 'POST' })
  ck('删除：POST 方法返回 1 并真的删掉', delPost.result === 1 && (await get(KEY_DEL)) === null, `result=${delPost.result}`)

  // ④ 清理
  for (const k of [KEY_OK, KEY_BAD, KEY_DEL]) await del(k)
  const goneOk = await get(KEY_OK)
  const goneBad = await get(KEY_BAD)
  ck('清理：探针键都已删除（不给生产留垃圾）', goneOk === null && goneBad === null, '')
}

;(async () => {
  let exitCode = 0
  try {
    await main()
  } catch (e) {
    results.push({ label: '未预期异常', ok: false, detail: e.message })
  }
  const failed = results.filter((r) => !r.ok)
  const passed = results.length - failed.length
  console.log('')
  if (failed.length) {
    console.log(`结论：${failed.length} 项失败（共 ${results.length} 项）`)
    for (const f of failed) console.log(`   ❌ ${f.label}${f.detail ? ' → ' + f.detail : ''}`)
    exitCode = 1
  } else {
    console.log(`结论：${passed}/${results.length} 通过（含变异对照）`)
  }
  console.log('')
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), exitCode, results }, null, 2))
  }
  process.exit(exitCode)
})()
