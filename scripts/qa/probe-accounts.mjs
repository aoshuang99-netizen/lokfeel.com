/**
 * QA 探测：只读。列出 User/Profile 真实列定义 + 现存测试账号。
 * 用法: node scripts/qa/probe-accounts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'

const root = path.resolve(import.meta.dirname, '../..')

function parseEnv(f) {
  const o = {}
  if (!fs.existsSync(f)) return o
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return o
}

const env = { ...parseEnv(path.join(root, '.env')), ...parseEnv(path.join(root, '.env.local')) }
const url = env.DATABASE_URL
const authToken = env.TURSO_AUTH_TOKEN
if (!url || !authToken) { console.error('缺少 DATABASE_URL / TURSO_AUTH_TOKEN'); process.exit(1) }

const db = createClient({ url, authToken })

async function tableInfo(t) {
  const r = await db.execute(`PRAGMA table_info('${t}')`)
  return r.rows.map(x => `${x.name}:${x.type}${x.notnull ? ' NOT NULL' : ''}${x.dflt_value != null ? ' dflt=' + x.dflt_value : ''}`)
}

const out = {}
for (const t of ['User', 'Profile', 'Subscription']) {
  try { out[t] = await tableInfo(t) } catch (e) { out[t] = ['ERR ' + e.message] }
}

console.log('=== User 列 ===')
out.User.forEach(c => console.log('  ' + c))
console.log('\n=== Profile 列 ===')
out.Profile.forEach(c => console.log('  ' + c))
console.log('\n=== Subscription 列 ===')
out.Subscription.forEach(c => console.log('  ' + c))

// 现存测试/QA 账号
const like = await db.execute(
  `SELECT u.id, u.email, u.name, u.role, u.isBot, u.emailVerified,
          (SELECT gender FROM Profile p WHERE p.userId = u.id) AS gender,
          (SELECT profileStatus FROM Profile p WHERE p.userId = u.id) AS status,
          (SELECT onboardingStep FROM Profile p WHERE p.userId = u.id) AS step
     FROM User u
    WHERE u.email LIKE '%test%' OR u.email LIKE '%qa%' OR u.email LIKE 'e2e%'
    ORDER BY u.createdAt DESC LIMIT 40`
)
console.log('\n=== 现存 test/qa/e2e 账号 ===')
if (!like.rows.length) console.log('  (无)')
for (const r of like.rows) {
  console.log(`  ${r.email} | ${r.name} | role=${r.role} isBot=${r.isBot} gender=${r.gender} status=${r.status} step=${r.step}`)
}

const total = await db.execute('SELECT COUNT(*) AS n FROM User')
console.log('\n总用户数:', total.rows[0].n)

const genders = await db.execute('SELECT gender, COUNT(*) AS n FROM Profile GROUP BY gender')
console.log('Profile 性别分布:', genders.rows.map(r => `${r.gender}=${r.n}`).join(' '))

await db.close()
