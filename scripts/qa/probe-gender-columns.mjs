/**
 * 列出生产库中所有含 gender / preferredGender 列的表，并给出各列的取值分布。
 * 用途：迁移前确认"影响面只有 Profile"，避免漏表。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const root = path.resolve(import.meta.dirname, '../..');
function parseEnv(f) {
  const o = {};
  if (!fs.existsSync(f)) return o;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
}
const env = { ...parseEnv(path.join(root, '.env')), ...parseEnv(path.join(root, '.env.local')) };
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map((r) => r.name);
const hits = [];
for (const t of tables) {
  const cols = (await db.execute(`PRAGMA table_info("${t}")`)).rows;
  const gcols = cols.filter((c) => /gender/i.test(c.name)).map((c) => c.name);
  if (gcols.length) hits.push({ table: t, cols: gcols });
}

console.log('=== 含 gender 相关列的表 ===');
for (const h of hits) console.log(`  ${h.table}: ${h.cols.join(', ')}`);

console.log('\n=== 各列取值分布 ===');
for (const h of hits) {
  for (const c of h.cols) {
    const rows = (await db.execute(`SELECT "${c}" v, COUNT(*) n FROM "${h.table}" GROUP BY "${c}" ORDER BY n DESC LIMIT 12`)).rows;
    console.log(`  ${h.table}.${c}: ` + rows.map((r) => `${r.v}=${r.n}`).join('  '));
  }
}
await db.close();
