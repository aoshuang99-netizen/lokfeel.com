/**
 * QA 探测 3：Match / Conversation / Message 表结构 + id 格式样例
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

async function cols(t) {
  try {
    const r = await db.execute(`PRAGMA table_info('${t}')`)
    console.log(`\n=== ${t} ===`)
    for (const c of r.rows) console.log(`  ${c.name}:${c.type}${c.notnull ? ' NN' : ''}${c.dflt_value != null ? ' dflt=' + c.dflt_value : ''}`)
    return true
  } catch (e) { console.log(`\n=== ${t} === ERR ${e.message}`); return false }
}

for (const t of ['Match', 'Conversation', 'Message', 'ConversationParticipant', 'UserConsent']) await cols(t)

// 表清单
const tbl = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
const names = tbl.rows.map(r => r.name)
console.log('\n=== 全部表 ===')
console.log('  ' + names.join(', '))

const matchish = names.filter(n => /match|conversation|message|consent|presence|typing/i.test(n))
console.log('\n=== 相关表 ===')
for (const t of matchish) await cols(t)

// id 格式样例
const ids = await db.execute(`SELECT id FROM User LIMIT 3`)
console.log('\n=== User.id 样例 ===')
for (const r of ids.rows) console.log(`  ${r.id}  (len=${String(r.id).length})`)

await db.close()
