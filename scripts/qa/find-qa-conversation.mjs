/**
 * 查 QA 账号的会话（用于生产端到端 UI 验证时定位聊天室）。
 * 同时检查库内是否残留历史写法（迁移后应恒为 0）。
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

const users = (
  await db.execute({ sql: "SELECT id, email FROM User WHERE email LIKE 'qa.%@lokfeel.com'", args: [] })
).rows;
console.log('=== QA 账号 ===');
for (const u of users) console.log(`  ${u.email}  ${u.id}`);

if (users.length) {
  const ids = users.map((u) => u.id);
  const ph = ids.map(() => '?').join(',');
  const parts = (
    await db.execute({
      sql: `SELECT cp.conversationId, cp.userId, c.createdAt
              FROM ConversationParticipant cp JOIN Conversation c ON c.id = cp.conversationId
             WHERE cp.userId IN (${ph})`,
      args: ids,
    })
  ).rows;
  console.log('\n=== 参与的会话 ===');
  const byConv = new Map();
  for (const p of parts) {
    if (!byConv.has(p.conversationId)) byConv.set(p.conversationId, []);
    byConv.get(p.conversationId).push(p.userId);
  }
  for (const [cid, members] of byConv) {
    const both = ids.every((i) => members.includes(i));
    console.log(`  ${cid}  members=${members.length}  双方都在=${both ? 'yes' : 'no'}`);
  }
  if (byConv.size === 0) console.log('  （无）');

  // 会话里要有消息才会出现在聊天列表并被正常渲染
  if (byConv.size) {
    const cid = [...byConv.keys()][0];
    const n = (await db.execute({ sql: 'SELECT COUNT(*) n FROM Message WHERE conversationId = ?', args: [cid] })).rows[0].n;
    console.log(`\n首个会话 ${cid} 的消息数：${n}`);
  }
}

const legacy = (
  await db.execute({
    sql: `SELECT (SELECT COUNT(*) FROM Profile WHERE gender IN ('MALE','FEMALE')) g,
                 (SELECT COUNT(*) FROM Profile WHERE preferredGender IN ('MALE','FEMALE')) p`,
    args: [],
  })
).rows[0];
console.log(`\n历史写法残留：gender=${legacy.g}  preferredGender=${legacy.p}`);
await db.close();
