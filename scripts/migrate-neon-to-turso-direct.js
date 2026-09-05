/**
 * Neon → Turso 增量迁移 v5
 * 每表独立连接，外键关闭，大表分批
 */
const { Client } = require('pg');
const { createClient } = require('@libsql/client');

const NEON = 'postgresql://neondb_owner:npg_aLwCpO05iAln@ep-cool-fire-ambu6n9x.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';
const TURSO_URL = 'libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io';
const TURSO_TK = process.env.TURSO_TOKEN;

const ARRAY_FIELDS = new Set([
  'selectedTags', 'galleryPhotos', 'complianceTags',
  'interests', 'hobbies', 'musicGenres', 'movieGenres',
  'preferredEthnicities', 'preferredOccupations', 'preferredEducation',
]);

const BATCH = 500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function migrateTable(turso, table) {
  // 1. Check current count in Turso
  const cur = (await turso.execute(`SELECT count(*) as c FROM "${table}"`)).rows[0].c;
  
  // 2. Connect to Neon and get total
  const pg = new Client({ connectionString: NEON, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await pg.connect();
  const total = (await pg.query(`SELECT count(*) as c FROM "${table}"`)).rows[0].c;
  
  if (total === 0 || cur >= total) {
    await pg.end();
    return { table, total, imported: 0, skipped: true };
  }
  
  const needed = total - cur;
  console.log(`  📥 ${table}: Neon=${total} Turso=${cur} 需导入=${needed}`);
  
  // 3. Fetch from Neon (skip already imported rows if possible)
  // For tables with 'id', use OFFSET = cur
  let rows = [];
  let offset = cur; // Assume IDs are sequential, skip already-imported rows
  let fetched = 0;
  
  try {
    while (fetched < needed) {
      const batch = await pg.query(`SELECT * FROM "${table}" ORDER BY "id" ASC LIMIT ${BATCH} OFFSET ${offset}`);
      if (batch.rows.length === 0) break;
      rows.push(...batch.rows);
      fetched += batch.rows.length;
      offset += batch.rows.length;
      process.stdout.write(`      读取 ${fetched}/${needed}\r`);
      await sleep(100);
    }
  } catch (e) {
    // If OFFSET fails, try without it (for tables where IDs aren't sequential)
    console.log(`\n      ⚠️ OFFSET失败，全量读取...`);
    rows = [];
    offset = 0;
    while (true) {
      const batch = await pg.query(`SELECT * FROM "${table}" ORDER BY "id" ASC LIMIT ${BATCH} OFFSET ${offset}`);
      if (batch.rows.length === 0) break;
      rows.push(...batch.rows);
      offset += batch.rows.length;
      process.stdout.write(`      读取 ${offset}\r`);
      await sleep(100);
    }
  }
  
  process.stdout.write(`      读取完成: ${rows.length} 行   \n`);
  await pg.end();
  
  // 4. Insert to Turso (skip duplicates via INSERT OR IGNORE)
  let imported = 0, dupes = 0;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  
  if (columns.length === 0) return { table, total, imported: 0, skipped: true };
  
  for (const row of rows) {
    try {
      const values = [];
      const placeholders = [];
      for (const col of columns) {
        let val = row[col];
        if (ARRAY_FIELDS.has(col) && val !== null && Array.isArray(val)) val = JSON.stringify(val);
        if (val instanceof Date) val = val.toISOString();
        if (val === null || val === undefined) {
          placeholders.push('NULL');
        } else {
          placeholders.push('?');
          values.push(String(val));
        }
      }
      await turso.execute({
        sql: `INSERT OR IGNORE INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${placeholders.join(',')})`,
        args: values,
      });
      imported++;
    } catch (e) {
      dupes++;
    }
  }
  
  // Verify
  const final = (await turso.execute(`SELECT count(*) as c FROM "${table}"`)).rows[0].c;
  console.log(`  ✅ ${table}: 导入${imported} 重复${dupes} 最终=${final}`);
  
  return { table, total, imported, final: final };
}

async function main() {
  console.log('🚀 增量迁移 v5\n');
  
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TK });
  await turso.execute('SELECT 1');
  await turso.execute('PRAGMA foreign_keys = OFF');
  console.log('✅ Turso FK 关闭\n');

  // Tables ordered by importance (core data first)
  const TABLES = [
    'Profile', 'BotProfile', 'BotAvatar', 'Subscription',
    'ChatRoom', 'ChatRoomMember', 'Message', 'IMMessage',
    'Match', 'Conversation', 'ConversationParticipant',
    'VerificationToken', 'Account', 'Payment', 'SincerityWallet',
    'MessageReaction', 'MatchReaction', 'UserReport', 'UserPresence',
    'Notification', 'AnalyticsEvent', 'AuditLog', 'AdminLog',
    'ConsentRequest', 'ConsentGrant', 'SincerityTransaction',
    'BotInteractionLog', 'BotPreference', 'BotLearningRecord',
    'BotLearningBatch', 'PowerBoardRule', 'MessageReceipt',
    // Also try to fill missing Users
    'User',
  ];

  let totalImported = 0;
  
  for (const table of TABLES) {
    try {
      const result = await migrateTable(turso, table);
      if (!result.skipped) totalImported += result.imported;
    } catch (e) {
      console.log(`  ❌ ${table}: ${e.message.substring(0, 100)}`);
    }
    await sleep(300);
  }

  await turso.execute('PRAGMA foreign_keys = ON');
  
  console.log('\n📊 增量迁移完成! 新导入: ' + totalImported);
  
  console.log('\n🔍 最终验证:');
  const verify = ['User','Profile','BotProfile','BotAvatar','Message','IMMessage','Match','ChatRoom','Conversation','Subscription','Payment'];
  let grandTotal = 0;
  for (const t of verify) {
    const r = await turso.execute(`SELECT count(*) as c FROM "${t}"`);
    grandTotal += r.rows[0].c;
    console.log(`  ${t}: ${r.rows[0].c}`);
  }
  console.log(`  总计: ${grandTotal}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
