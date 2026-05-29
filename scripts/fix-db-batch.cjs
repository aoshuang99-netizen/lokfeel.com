#!/usr/bin/env node
// fix-db-batch.cjs - 批量更新 DiceBear → randomuser.me（100 个/请求）
const fs = require('fs');
const https = require('https');
const path = require('path');

// 加载 .env
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const vars = {};
envContent.split('\n').forEach(line => {
  const i = line.indexOf('=');
  if (i > 0) vars[line.slice(0,i).trim()] = line.slice(i+1).trim();
});
const DB_URL = vars.DATABASE_URL;
const TOKEN = vars.TURSO_AUTH_TOKEN;

console.log('🔧 批量修复数据库：DiceBear 卡通 → randomuser.me 真实照片\n');

function getPhotoUrl(seed, gender) {
  const female = (gender||'').toUpperCase() === 'FEMALE' || (gender||'').toUpperCase() === 'WOMAN';
  let hash = 0;
  for (let i = 0; i < (seed||'x').length; i++) hash = ((hash<<5)-hash+(seed||'x').charCodeAt(i))|0;
  const idx = (Math.abs(hash) % 99) + 1;
  return `https://randomuser.me/api/portraits/${female?'women':'men'}/${idx}.jpg`;
}

function tursoBatch(statements) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ statements });
    const url = new URL(DB_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (r.errors) { reject(new Error(JSON.stringify(r.errors))); return; }
          resolve(r); // { results: [{columns, rows}, ...] }
        } catch(e) { reject(new Error('Parse: ' + d.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // 1. 查询所有需要修复的 profiles
  console.log('📊 查询需要修复的 profiles...');
  const queryResult = await tursoBatch([{
    q: `SELECT id, displayName, gender FROM profile WHERE avatar LIKE ? LIMIT 10000`,
    params: ['%dicebear.com%']
  }]);
  
  const resultData = queryResult.results && queryResult.results[0] ? queryResult.results[0] : null;
  if (!resultData || !resultData.rows) {
    console.error('❌ 查询失败:', JSON.stringify(queryResult).slice(0,300));
    process.exit(1);
  }
  
  const rows = resultData.rows;
  console.log(`   找到 ${rows.length} 个需要修复\n`);
  if (!rows.length) { console.log('✅ 数据库中已无 DiceBear URL！'); return; }

  // 2. 批量更新（100 个/请求）
  console.log('🔄 开始批量更新（100 个/请求）...');
  let updated = 0;
  let errors = 0;
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const statements = batch.map(([id, name, gender]) => ({
      q: `UPDATE profile SET avatar = ?, "avatarType" = ? WHERE id = ?`,
      params: [getPhotoUrl(name || id, gender), 'photo', id]
    }));
    
    try {
      await tursoBatch(statements);
      updated += batch.length;
      if (updated % 1000 === 0 || updated === rows.length) {
        console.log(`  进度: ${updated}/${rows.length} (${(updated/rows.length*100).toFixed(1)}%)`);
      }
    } catch(e) {
      errors += batch.length;
      console.error(`  ❌ 批次 ${Math.floor(i/BATCH_SIZE)+1} 失败:`, e.message.slice(0,100));
    }
  }
  
  console.log(`\n✅ 完成！更新了 ${updated} 个 profile，错误: ${errors}\n`);
  
  // 3. 验证结果
  console.log('🔍 验证修复结果...');
  const checkResult = await tursoBatch([{
    q: `SELECT COUNT(*) FROM profile WHERE avatar LIKE ?`,
    params: ['%dicebear.com%']
  }]);
  const remaining = checkResult.results[0].rows[0][0];
  console.log(`   剩余 DiceBear URLs: ${remaining}`);
  
  if (remaining === 0) {
    console.log('🎉 数据库中已无 DiceBear URL！所有用户都有真实照片！');
  } else {
    console.log(`⚠️  还有 ${remaining} 个 DiceBear URL 需要修复`);
  }
}

main()
  .then(() => { console.log('\n✅ 脚本执行完成'); process.exit(0); })
  .catch(e => { console.error('\n❌ 脚本执行失败:', e.message); process.exit(1); });
