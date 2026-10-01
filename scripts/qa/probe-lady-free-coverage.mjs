// 只读取证：女性用户的 LADY_FREE 订阅覆盖情况 + cardVerified 分布
import fs from 'node:fs'
import { createClient } from '@libsql/client'

function parseEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = { ...parseEnv('.env'), ...parseEnv('.env.local') }
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })
const q = async (label, sql) => {
  const r = await db.execute(sql)
  console.log('\n=== ' + label + ' ===')
  for (const row of r.rows) console.log(JSON.stringify(row))
}

await q('性别分布', `SELECT gender, COUNT(*) n FROM Profile GROUP BY gender ORDER BY n DESC`)
await q('女性中 LADY_FREE 订阅覆盖', `
  SELECT p.gender,
         SUM(CASE WHEN EXISTS (
           SELECT 1 FROM Subscription s WHERE s.userId = p.userId AND s.plan='LADY_FREE' AND s.status='ACTIVE'
         ) THEN 1 ELSE 0 END) AS with_lady_free,
         COUNT(*) AS total
  FROM Profile p
  WHERE p.gender IN ('FEMALE','WOMAN')
  GROUP BY p.gender`)
await q('cardVerified 分布', `SELECT cardVerified, COUNT(*) n FROM User GROUP BY cardVerified`)
await q('订阅计划分布', `SELECT plan, status, COUNT(*) n FROM Subscription GROUP BY plan, status ORDER BY n DESC`)
await q('已发过 >=3 条消息的女性', `
  SELECT u.email, p.gender, (SELECT COUNT(*) FROM IMMessage m WHERE m.senderId = u.id) AS msgs
  FROM User u JOIN Profile p ON p.userId = u.id
  WHERE p.gender IN ('FEMALE','WOMAN')
    AND (SELECT COUNT(*) FROM IMMessage m WHERE m.senderId = u.id) >= 3
  ORDER BY msgs DESC LIMIT 10`)
