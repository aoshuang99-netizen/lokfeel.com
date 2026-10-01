// 只读取证：生产库 IMMessage 的 msgType 分布，判定配额统计应排除哪些类型。
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
const client = createClient({
  url: env.DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
})

const rows = await client.execute(
  `SELECT msgType, COUNT(*) AS n FROM IMMessage GROUP BY msgType ORDER BY n DESC`,
)
console.log('=== 全库 IMMessage.msgType 分布 ===')
for (const r of rows.rows) console.log(String(r.msgType).padEnd(20), r.n)

const withSender = await client.execute(
  `SELECT senderId, receiverId, COUNT(*) AS n FROM IMMessage WHERE msgType IN ('SYSTEM','TYPING','READ_RECEIPT') GROUP BY senderId, receiverId ORDER BY n DESC LIMIT 5`,
)
console.log('\n=== 非内容类消息的 sender/receiver 归属（top5）===')
for (const r of withSender.rows) {
  console.log(String(r.senderId).slice(0, 12), '→', String(r.receiverId).slice(0, 12), 'x', r.n)
}

const sample = await client.execute(
  `SELECT msgType, payload FROM IMMessage WHERE msgType != 'TEXT' ORDER BY createdAt DESC LIMIT 8`,
)
console.log('\n=== 非 TEXT 样本 ===')
for (const r of sample.rows) {
  console.log(String(r.msgType).padEnd(16), String(r.payload).slice(0, 60))
}
