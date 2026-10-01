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

const tbl = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
const names = tbl.rows.map(r => r.name)
console.log('=== 全部表 ===')
console.log(names.join('\n'))

const msgish = names.filter(n => /message|chat|im/i.test(n))
console.log('\n=== 消息相关表 ===')
console.log(msgish.join(', ') || '(无)')

for (const t of msgish.slice(0, 6)) {
  try {
    const r = await db.execute(`PRAGMA table_info('${t}')`)
    console.log(`\n--- ${t} ---`)
    console.log('  ' + r.rows.map(c => `${c.name}:${c.type}${c.notnull ? ' NN' : ''}`).join('\n  '))
  } catch (e) { console.log(`  ${t} ERR ${e.message}`) }
}

const ids = await db.execute(`SELECT id FROM User LIMIT 2`)
console.log('\n=== User.id 样例 ===')
for (const r of ids.rows) console.log(`  ${r.id} (len=${String(r.id).length})`)

await db.close()
