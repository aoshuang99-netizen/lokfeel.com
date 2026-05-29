#!/usr/bin/env node
// fix-db-real-photos.cjs
// 真正执行：批量将 DiceBear 卡通 URL 替换为 randomuser.me 真实照片

const fs = require('fs');
const https = require('https');
const path = require('path');

// 加载 .env
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      process.env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
    }
  }
}

const DB_URL = process.env.DATABASE_URL;
const TOKEN = process.env.TURSO_AUTH_TOKEN;

function hashSeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getPhotoUrl(seed, gender) {
  const female = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN';
  const idx = (hashSeed(seed || 'x') % 99) + 1;
  return `https://randomuser.me/api/portraits/${female ? 'women' : 'men'}/${idx}.jpg`;
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
          const j = JSON.parse(d);
          // 错误响应：{"errors": [...]}
          if (j.errors) { reject(new Error(JSON.stringify(j.errors))); return; }
          // 成功响应：[{"columns":[...],"rows":[[...]]}]
          if (Array.isArray(j) && j[0]) resolve(j[0]);
          else if (j.results && j.results[0]) resolve(j.results[0]);
          else resolve(j);
        } catch(e) { reject(new Error('Parse: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('🔍 查询需要修复的 profiles...');
  const r = await turso(`SELECT id, displayName, gender FROM profile WHERE avatar LIKE '%dicebear.com%' LIMIT 5000`);
  const rows = r.rows || [];
  console.log(`   找到 ${rows.length} 个需要修复`);
  if (!rows.length) { console.log('✅ 无 DiceBear URL！'); return; }

  let ok = 0, err = 0;
  for (const row of rows) {
    try {
      const [id, name, gender] = row;
      const url = getPhotoUrl(name || id, gender);
      await turso(`UPDATE profile SET avatar = $1, "avatarType" = $2 WHERE id = $3`, [url, 'photo', id]);
      ok++;
      if (ok % 200 === 0) console.log(`  进度: ${ok}/${rows.length}`);
    } catch(e) {
      err++;
      if (err < 5) console.error('  ❌', e.message.slice(0, 100));
    }
  }
  console.log(`\n✅ 完成！更新 ${ok}，错误 ${err}`);

  const check = await turso(`SELECT COUNT(*) FROM profile WHERE avatar LIKE '%dicebear.com%'`);
  console.log(`   剩余 DiceBear URLs: ${check.rows[0][0]}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
