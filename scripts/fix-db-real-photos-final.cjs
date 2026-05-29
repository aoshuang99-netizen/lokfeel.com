#!/usr/bin/env node
// fix-db-real-photos-final.cjs
// 正确解析 Turso HTTP API 响应格式

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

console.log('🔧 开始修复数据库：DiceBear 卡通 → randomuser.me 真实照片\n');

function getPhotoUrl(seed, gender) {
  const female = (gender||'').toUpperCase() === 'FEMALE' || (gender||'').toUpperCase() === 'WOMAN';
  let hash = 0;
  for (let i = 0; i < (seed||'x').length; i++) hash = ((hash<<5)-hash+(seed||'x').charCodeAt(i))|0;
  const idx = (Math.abs(hash) % 99) + 1;
  return `https://randomuser.me/api/portraits/${female?'women':'men'}/${idx}.jpg`;
}

function turso(sql, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ statements: [{ q: sql, params }] });
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
          // 响应格式: [{"results": {"columns":[...],"rows":[[...]]}}]
          if (Array.isArray(r) && r[0] && r[0].results) {
            resolve(r[0].results);
          } else {
            console.warn('⚠️  未知格式:', d.slice(0,200));
            resolve(r);
          }
        } catch(e) { reject(new Error('Parse: ' + d.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // 1. 查询需要修复的 profiles
  console.log('📊 查询包含 DiceBear 卡通的 profiles...');
  const r = await turso(
    `SELECT id, displayName, gender FROM profile WHERE avatar LIKE ? LIMIT 50000`,
    ['%dicebear.com%']
  );
  const rows = r.rows || [];
  console.log(`   找到 ${rows.length} 个需要修复\n`);
  if (!rows.length) { console.log('✅ 数据库中已无 DiceBear URL！'); return; }

  // 2. 批量更新
  console.log('🔄 开始批量更新...');
  let ok = 0, err = 0;
  for (const row of rows) {
    try {
      const [id, name, gender] = row;
      const url = getPhotoUrl(name || id, gender);
      await turso(
        `UPDATE profile SET avatar = ?, "avatarType" = ? WHERE id = ?`,
        [url, 'photo', id]
      );
      ok++;
      if (ok % 200 === 0) console.log(`  进度: ${ok}/${rows.length}`);
    } catch(e) {
      err++;
      if (err <= 5) console.error(`  ❌ ${row[0]}:`, e.message.slice(0,80));
    }
  }
  console.log(`\n✅ 完成！更新 ${ok} 个，错误 ${err}\n`);

  // 3. 验证
  console.log('🔍 验证结果...');
  const check = await turso(`SELECT COUNT(*) FROM profile WHERE avatar LIKE ?`, ['%dicebear.com%']);
  const remaining = check.rows[0][0];
  console.log(`   剩余 DiceBear URLs: ${remaining}`);
  if (remaining === 0) console.log('🎉 数据库中已无 DiceBear URL！所有用户都有真实照片！');
  else console.log(`⚠️  还有 ${remaining} 个需要修复`);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
