#!/usr/bin/env node
/**
 * QA 登录诊断（只读）—— 生产真实登录 401 时，先分清是「本地密码过期」还是「服务端缺陷」。
 *
 * WHY：
 *   `verify-login-realpath.mjs` 返回 401 `Invalid email or password` 有两种完全不同的成因：
 *     ① 本地 `.qa-credentials.local.json` 里的密码已过期（账号被重建 / 改过密码）→ 工具问题
 *     ② 账号在库里被删、被软删（`deletedAt` 非空）、或密码哈希被改坏 → 环境问题
 *   只看 HTTP 状态码分不出来。本脚本**在本地用 bcrypt 直接对库里的哈希验一次**，
 *   于是结论是确定的：
 *     哈希对得上 → 凭据没问题，问题在服务端（窗口期 / 守卫 / 会话下发）
 *     哈希对不上 → 本地密码过期，去要新密码，别动代码
 *
 * 只读：仅 SELECT。不写任何数据。
 *
 * 用法：
 *   node scripts/qa/probe-qa-login.mjs
 *   QA_PASSWORD='...' node scripts/qa/probe-qa-login.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

function parseEnv(f) {
  const o = {}
  if (!fs.existsSync(f)) return o
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return o
}

function localPassword() {
  if (process.env.QA_PASSWORD) return process.env.QA_PASSWORD
  const f = path.join(ROOT, '.qa-credentials.local.json')
  if (!fs.existsSync(f)) return null
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    return typeof j.password === 'string' && j.password ? j.password : null
  } catch {
    return null
  }
}

const env = { ...parseEnv(path.join(ROOT, '.env')), ...parseEnv(path.join(ROOT, '.env.local')) }
if (!env.DATABASE_URL) {
  console.error('❌ 缺少 DATABASE_URL')
  process.exit(2)
}
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })

const EMAILS = (process.env.QA_EMAILS || 'qa.male@lokfeel.com,qa.female@lokfeel.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const pw = localPassword()
console.log(`\n库：${(() => { try { return new URL(env.DATABASE_URL).host } catch { return '?' } })()}`)
console.log(`本地密码：${pw ? `已读入（${pw.length} 字符）` : '❌ 未找到（QA_PASSWORD / .qa-credentials.local.json）'}\n`)

for (const email of EMAILS) {
  console.log(`── ${email} ──`)
  const r = await db.execute({
    sql: `SELECT id, email, role, isBot, "createdAt", "updatedAt", "deletedAt", password
          FROM "User" WHERE email = ?`,
    args: [email],
  })
  if (r.rows.length === 0) {
    console.log('  ❌ 库中不存在该账号 → 需要在生产重建（本地密码再怎么对也没用）\n')
    continue
  }
  const u = r.rows[0]
  const hash = typeof u.password === 'string' ? u.password : ''
  console.log(`  id          ${u.id}`)
  console.log(`  role/isBot  ${u.role} / ${u.isBot}`)
  console.log(`  createdAt   ${u.createdAt}`)
  console.log(`  updatedAt   ${u.updatedAt}`)
  console.log(`  deletedAt   ${u.deletedAt ?? '（未软删）'}`)
  console.log(`  password    ${hash ? `${hash.slice(0, 7)}…（长度 ${hash.length}）` : '❌ 空（该账号无密码登录能力）'}`)

  if (!hash) {
    console.log('  ⟹ 结论：**账号无密码哈希** —— 可能只走 OAuth，或密码被清空\n')
    continue
  }
  if (!pw) {
    console.log('  ⟹ 结论：无法判定（本地无密码可比对）\n')
    continue
  }
  let ok = false
  try {
    ok = await bcrypt.compare(pw, hash)
  } catch (e) {
    console.log(`  ⚠️ bcrypt 比对异常：${e.message}`)
  }
  console.log(
    ok
      ? '  ⟹ 结论：✅ 本地密码与库中哈希**一致** —— 凭据没问题，401 属服务端/环境问题'
      : '  ⟹ 结论：❌ 本地密码与库中哈希**不一致** —— 本地凭据已过期（属工具问题，不是代码缺陷）',
  )
  console.log('')
}
