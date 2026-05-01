/**
 * Step 2: 从 JSON 文件批量导入到 Turso
 * 使用事务加速，每表一个 batch
 */
const { createClient } = require('@libsql/client');
const fs = require('fs');

const TURSO_URL = 'libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io';
const TURSO_TK = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Nzc1NTEzMTcsImlkIjoiMDE5ZGRkMDMtZGQwMS03Y2VmLWI5NjQtNzg4OThmMjljNTgwIiwicmlkIjoiNTNmMGQ0MjYtNjgzNC00ZjJkLTg1YjAtZTY3MTk4MmI2YTg1In0.ELXcqcJUSGKZpS6HPc8hjY2KZL7ZsKeGYmCr9UdwhfyYrTM57-4_mC5h8b8OrjUgjrcN_DO_xwWGGC1ajs7pCw';

const BATCH_SIZE = 50; // 50 rows per transaction

async function importTable(turso, table, rows) {
  if (!rows || rows.length === 0) return 0;
  
  const columns = Object.keys(rows[0]);
  const colStr = columns.map(c => `"${c}"`).join(',');
  let totalImported = 0;
  
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    
    // Build multi-row INSERT
    const sql = `INSERT OR IGNORE INTO "${table}" (${colStr}) VALUES ` + 
      batch.map(row => {
        const vals = columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          return "'" + String(val).replace(/'/g, "''") + "'";
        });
        return `(${vals.join(',')})`;
      }).join(',');
    
    try {
      await turso.execute(sql);
      totalImported += batch.length;
    } catch (e) {
      // Fallback: row by row for this batch
      for (const row of batch) {
        try {
          const vals = columns.map(col => {
            const val = row[col];
            if (val === null || val === undefined) return 'NULL';
            return "'" + String(val).replace(/'/g, "''") + "'";
          });
          const singleSql = `INSERT OR IGNORE INTO "${table}" (${colStr}) VALUES (${vals.join(',')})`;
          await turso.execute(singleSql);
          totalImported++;
        } catch {}
      }
    }
    
    process.stdout.write(`    ${table}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`);
  }
  
  process.stdout.write(`    ${table}: ${totalImported}/${rows.length} ✅\n`);
  return totalImported;
}

async function main() {
  console.log('📥 从 JSON 导入到 Turso...\n');
  
  // Load data
  const data = JSON.parse(fs.readFileSync('/tmp/neon-export.json', 'utf-8'));
  console.log('📂 已加载 JSON (' + Object.keys(data).length + ' 张表)\n');
  
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TK });
  await turso.execute('SELECT 1');
  await turso.execute('PRAGMA foreign_keys = OFF');
  console.log('✅ Turso FK 关闭\n');
  
  // Sort tables by row count (smallest first for quick wins)
  const sorted = Object.entries(data).sort((a, b) => a[1].length - b[1].length);
  
  let grandTotal = 0;
  for (const [table, rows] of sorted) {
    const count = await importTable(turso, table, rows);
    grandTotal += count;
  }
  
  await turso.execute('PRAGMA foreign_keys = ON');
  
  console.log(`\n📊 导入完成! 总计: ${grandTotal}`);
  
  // Verify
  console.log('\n🔍 验证:');
  const verify = ['User','Profile','BotProfile','BotAvatar','Subscription','Match','Message','ChatRoom','Conversation','Payment'];
  let vTotal = 0;
  for (const t of verify) {
    const r = await turso.execute(`SELECT count(*) as c FROM "${t}"`);
    vTotal += r.rows[0].c;
    console.log(`  ${t}: ${r.rows[0].c}`);
  }
  console.log(`  验证总计: ${vTotal}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
