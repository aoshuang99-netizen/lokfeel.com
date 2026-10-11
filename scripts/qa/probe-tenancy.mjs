/**
 * 生产库普查：租户面是否已有真实用户数据（只读）
 * 用法: node scripts/qa/probe-tenancy.mjs
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
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })

const tables = ['Organization', 'Membership', 'Mission', 'MissionParticipation', 'SocialIntent', 'IdempotencyRecord']

for (const t of tables) {
  try {
    const r = await db.execute(`SELECT COUNT(*) AS n FROM "${t}"`)
    console.log(String(r.rows[0].n).padStart(6), t)
  } catch (e) {
    console.log('   ERR ', t, e.message.slice(0, 70))
  }
}

// 有租户成员关系的用户数（决定 T03 端点是否对真实用户可达）
try {
  const r = await db.execute(
    `SELECT COUNT(DISTINCT "userId") AS n FROM "Membership" WHERE "status"='ACTIVE'`
  )
  console.log('\nACTIVE 成员关系覆盖的用户数:', r.rows[0].n)
} catch (e) {
  console.log('\nMembership 查询失败:', e.message.slice(0, 80))
}
