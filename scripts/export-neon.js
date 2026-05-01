/**
 * Step 1: 从 Neon 导出所有数据到 JSON 文件（快速断开连接）
 */
const { Client } = require('pg');
const fs = require('fs');

const NEON = 'postgresql://neondb_owner:npg_aLwCpO05iAln@ep-cool-fire-ambu6n9x.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';
const BATCH = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TABLES = [
  'User','Profile','BotProfile','BotAvatar','Subscription',
  'ChatRoom','ChatRoomMember','Message','IMMessage',
  'Match','Conversation','ConversationParticipant',
  'VerificationToken','Account','Payment','SincerityWallet',
  'MessageReaction','MatchReaction','UserReport','UserPresence',
  'Notification','AnalyticsEvent','AuditLog','AdminLog',
  'ConsentRequest','ConsentGrant','SincerityTransaction',
  'BotInteractionLog','BotPreference','BotLearningRecord',
  'BotLearningBatch','PowerBoardRule','MessageReceipt',
];

const ARRAY_FIELDS = new Set([
  'selectedTags', 'galleryPhotos', 'complianceTags',
  'interests', 'hobbies', 'musicGenres', 'movieGenres',
  'preferredEthnicities', 'preferredOccupations', 'preferredEducation',
]);

async function exportTable(pg, table) {
  const cnt = (await pg.query(`SELECT count(*) as c FROM "${table}"`)).rows[0].c;
  if (cnt === 0) return null;
  
  const allRows = [];
  let offset = 0;
  
  while (offset < cnt) {
    const batch = await pg.query(`SELECT * FROM "${table}" ORDER BY "id" LIMIT ${BATCH} OFFSET ${offset}`);
    if (batch.rows.length === 0) break;
    
    for (const row of batch.rows) {
      const converted = {};
      for (const [key, val] of Object.entries(row)) {
        if (ARRAY_FIELDS.has(key) && Array.isArray(val)) {
          converted[key] = JSON.stringify(val);
        } else if (val instanceof Date) {
          converted[key] = val.toISOString();
        } else {
          converted[key] = val;
        }
      }
      allRows.push(converted);
    }
    
    offset += batch.rows.length;
    process.stdout.write(`    ${table}: ${offset}/${cnt}\r`);
    await sleep(50);
  }
  
  process.stdout.write(`    ${table}: ${allRows.length}/${cnt} ✅\n`);
  return allRows;
}

async function main() {
  console.log('📦 从 Neon 导出数据到 JSON...\n');
  
  const pg = new Client({ connectionString: NEON, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await pg.connect();
  console.log('✅ Neon 已连接\n');
  
  const allData = {};
  
  for (const table of TABLES) {
    try {
      const rows = await exportTable(pg, table);
      if (rows) allData[table] = rows;
    } catch (e) {
      console.log(`    ⚠️ ${table}: ${e.message.substring(0, 60)}`);
    }
    await sleep(200);
  }
  
  await pg.end();
  
  // Write to file
  const outPath = '/tmp/neon-export.json';
  fs.writeFileSync(outPath, JSON.stringify(allData));
  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  
  let totalRows = 0;
  for (const [t, rows] of Object.entries(allData)) totalRows += rows.length;
  
  console.log(`\n✅ 导出完成: ${totalRows} 条记录, ${size} MB`);
  console.log(`📁 文件: ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
