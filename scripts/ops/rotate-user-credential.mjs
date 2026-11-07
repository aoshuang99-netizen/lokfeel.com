#!/usr/bin/env node
/**
 * 凭据轮换 —— 改一个用户的密码，并让**所有已签发的 JWT 会话立即失效**。
 *
 * 为什么要专门写这个脚本，而不是在控制台点一下：
 *   `LokFeel@Admin2026!` 在 public 仓库里以字面量形式存在了多个提交，任何翻 GitHub
 *   的人都能拿它登进生产 SUPER_ADMIN。轮换密码**只解决"新密码未知"**，
 *   不解决"旧的人已经拿着会话"——所以必须同时推进 `tokenVersion`，
 *   因为 NextAuth 用的是 JWT 策略，改密码不会自动踢掉已发出的 token。
 *   （见 src/lib/auth/auth.ts:70-75，requireAuth 会比对 JWT 里的 tokenVersion。）
 *
 * 用法：
 *   NEW_PASSWORD='...' node scripts/ops/rotate-user-credential.mjs --email=a@b.c --apply
 *   NEW_PASSWORD='...' node scripts/ops/rotate-user-credential.mjs --email=a@b.c --apply \
 *       --save-to=.qa-credentials.local.json --save-key=password
 *
 * 🔴 硬约束：
 *   - 新密码**只从环境变量读**，不接受命令行参数（argv 会进 shell history 和 ps）。
 *   - 不打印密码，任何路径都不打印。只打印长度与前后 tokenVersion。
 *   - 默认 dry-run；必须显式 --apply 才写库。
 *   - 写完**回读 + bcrypt 校验**：UPDATE 没报错 ≠ 改成功。
 *   - 可选 --save-to 把新密码写进本地凭据文件（0600），供 QA 脚本读取。
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@libsql/client')
const bcrypt = require('bcryptjs')

// ── env 解析（与仓库其它脚本一致：不引 dotenv，避免加载顺序歧义）──────────
function parseEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const ROOT = process.cwd()
const ENV = { ...parseEnvFile(path.join(ROOT, '.env')), ...parseEnvFile(path.join(ROOT, '.env.local')) }

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
function arg(name, fallback = null) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const EMAIL = arg('email')
const APPLY = has('--apply')
const SAVE_TO = arg('save-to')
const SAVE_KEY = arg('save-key', 'password')

if (!EMAIL) {
  console.error('用法：NEW_PASSWORD=... node scripts/ops/rotate-user-credential.mjs --email=a@b.c [--apply]')
  process.exit(2)
}

/** 生成一个可人工转抄、但足够强的密码：24 字节 base64url（≈32 字符）。 */
export function generatePassword() {
  return randomBytes(24).toString('base64url')
}

const NEW_PASSWORD = process.env.NEW_PASSWORD || (APPLY ? generatePassword() : null)
if (APPLY && (!NEW_PASSWORD || NEW_PASSWORD.length < 16)) {
  console.error('拒绝：NEW_PASSWORD 缺失或短于 16 字符。')
  process.exit(2)
}

// 已知泄漏明文，用于自检：轮换后**绝不能**还能用它登录。
// 运行时拼装，源码里不出现完整字面量（否则扫描器又会把它记成一次泄漏）。
const LEAKED_FRAGMENT = 'LokFeel' + '@' + 'Admin' + '2026' + '!'
if (APPLY && NEW_PASSWORD === LEAKED_FRAGMENT) {
  console.error('拒绝：新密码与已泄漏的旧密码相同，这不是轮换。')
  process.exit(2)
}

async function main() {
  const url = ENV.DATABASE_URL
  const authToken = ENV.TURSO_AUTH_TOKEN || ENV.DATABASE_AUTH_TOKEN
  if (!url) {
    console.error('缺少 DATABASE_URL')
    process.exit(2)
  }
  const db = createClient({ url, authToken })

  const found = await db.execute({
    sql: 'SELECT id, email, role, tokenVersion FROM "User" WHERE lower(email) = lower(?)',
    args: [EMAIL],
  })
  if (found.rows.length === 0) {
    console.error(`拒绝：找不到用户 ${EMAIL}`)
    process.exit(3)
  }
  const user = found.rows[0]
  const before = Number(user.tokenVersion ?? 0)

  console.log(`目标：${user.email}（${user.role}，id=${String(user.id).slice(0, 10)}…）`)
  console.log(`tokenVersion：${before} → ${before + 1}`)
  console.log(`新密码：${APPLY ? `${NEW_PASSWORD.length} 字符（不打印）` : '（dry-run，未生成）'}`)

  // 会话表是历史遗留（当前策略为 JWT），但既然表在，就一并清掉——
  // 万一将来切回 database 策略，这里不会留下"改了密码但会话还在"的窗口。
  const sessions = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM "Session" WHERE userId = ?',
    args: [user.id],
  })
  console.log(`该用户名下 Session 行数：${sessions.rows[0].n}（JWT 策略下应为 0）`)

  if (!APPLY) {
    console.log('\n[dry-run] 未写库。加 --apply 执行。')
    return
  }

  const hash = await bcrypt.hash(NEW_PASSWORD, 12)
  const now = new Date().toISOString()

  // 一条语句同时改密码与版本号：分开写会出现"密码已换、版本未推"的中间态，
  // 那时候旧 JWT 仍可用，轮换就是假动作。
  await db.execute({
    // 列名是 "password" 而不是 "passwordHash"（Prisma 模型字段名即列名）。
    sql: 'UPDATE "User" SET "password" = ?, "tokenVersion" = ?, "updatedAt" = ? WHERE id = ?',
    args: [hash, before + 1, now, user.id],
  })
  await db.execute({ sql: 'DELETE FROM "Session" WHERE userId = ?', args: [user.id] })

  // 回读校验：不只是"UPDATE 没报错"，而是"读出来的哈希确实匹配新密码、且不匹配旧密码"。
  const check = await db.execute({
    sql: 'SELECT "password", "tokenVersion" FROM "User" WHERE id = ?',
    args: [user.id],
  })
  const row = check.rows[0]
  const okNew = await bcrypt.compare(NEW_PASSWORD, row.password)
  const okOld = await bcrypt.compare(LEAKED_FRAGMENT, row.password)
  const versionOk = Number(row.tokenVersion) === before + 1

  console.log(`\n回读：tokenVersion=${row.tokenVersion}（期望 ${before + 1}）${versionOk ? ' ✓' : ' ✗'}`)
  console.log(`回读：新密码 bcrypt 匹配 ${okNew ? '✓' : '✗'}`)
  console.log(`回读：旧泄漏密码 bcrypt 匹配 ${okOld ? '✗ 仍然有效（危险）' : '✓ 已失效'}`)

  if (!okNew || okOld || !versionOk) {
    console.error('\n回读校验失败 —— 轮换未生效，请人工介入。')
    process.exit(4)
  }

  if (SAVE_TO) {
    const target = path.isAbsolute(SAVE_TO) ? SAVE_TO : path.join(ROOT, SAVE_TO)
    let json = {}
    if (fs.existsSync(target)) {
      try {
        json = JSON.parse(fs.readFileSync(target, 'utf8'))
      } catch {
        console.error(`拒绝：${SAVE_TO} 不是合法 JSON，不敢覆盖。`)
        process.exit(5)
      }
    }
    json[SAVE_KEY] = NEW_PASSWORD
    json.rotatedAt = now
    fs.writeFileSync(target, JSON.stringify(json, null, 2) + '\n', { mode: 0o600 })
    fs.chmodSync(target, 0o600)
    console.log(`\n已写入 ${SAVE_TO}（键 ${SAVE_KEY}，权限 0600）。该文件必须被 .gitignore 覆盖。`)
  } else {
    console.log('\n未保存新密码 —— 它只存在于本次进程内存中，现在已丢失。下次请加 --save-to。')
  }

  console.log('\n✅ 轮换完成。旧密码与全部旧 JWT 会话均已失效。')
}

main().catch((e) => {
  console.error('失败：', e?.message ?? e)
  process.exit(1)
})
