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

const MALE = 'dade3176-a40f-4fe4-8ea3-a5fa368e85c0'
const FEMALE = '8ea3bebc-fe58-442b-b679-43fc3286d383'

console.log('=== 该会话全部消息（含发送者归属）===')
const r = await db.execute({
  sql: `SELECT m.seq, m.msgType, m.senderId, m.receiverId,
               CASE m.senderId WHEN ? THEN 'MALE' WHEN ? THEN 'FEMALE' ELSE m.senderId END AS who,
               substr(m.payload,1,45) AS preview
          FROM IMMessage m
         WHERE m.conversationId = ?
         ORDER BY m.seq`,
  args: [MALE, FEMALE, 'cmupjcwau000109l7dcc8avag'],
})
for (const x of r.rows) console.log(`  #${x.seq} ${String(x.msgType).padEnd(7)} ${String(x.who).padEnd(7)} "${x.preview}"`)

console.log('\n=== 每个账号在本会话的已发条数（守门规则1的口径）===')
const c = await db.execute({
  sql: `SELECT CASE senderId WHEN ? THEN 'MALE' WHEN ? THEN 'FEMALE' ELSE senderId END AS who,
               COUNT(*) n, SUM(CASE WHEN msgType='SYSTEM' THEN 1 ELSE 0 END) sysCount
          FROM IMMessage WHERE conversationId=? GROUP BY senderId`,
  args: [MALE, FEMALE, 'cmupjcwau000109l7dcc8avag'],
})
for (const x of c.rows) console.log(`  ${x.who}: 总计 ${x.n} 条，其中 SYSTEM ${x.sysCount} 条`)

console.log('\n=== 各账号全站累计消息数（守门规则2的口径）===')
const t = await db.execute({
  sql: `SELECT CASE senderId WHEN ? THEN 'MALE' WHEN ? THEN 'FEMALE' ELSE senderId END AS who, COUNT(*) n
          FROM IMMessage WHERE senderId IN (?,?) GROUP BY senderId`,
  args: [MALE, FEMALE, MALE, FEMALE],
})
for (const x of t.rows) console.log(`  ${x.who}: ${x.n}`)

console.log('\n=== 账号当前状态 ===')
const u = await db.execute({
  sql: `SELECT u.email, u.cardVerified, p.gender,
               (SELECT plan FROM Subscription s WHERE s.userId=u.id AND s.status='ACTIVE' LIMIT 1) plan
          FROM User u JOIN Profile p ON p.userId=u.id WHERE u.id IN (?,?)`,
  args: [MALE, FEMALE],
})
for (const x of u.rows) console.log(`  ${x.email.padEnd(24)} gender=${x.gender} plan=${x.plan ?? 'NULL(FREE)'} cardVerified=${x.cardVerified}`)

await db.close()
