#!/usr/bin/env node
// fix-dicebear-to-real-photos-v3.cjs
// 将数据库中所有 DiceBear 卡通 URL 替换为 randomuser.me 真人照片
// 用法：node scripts/fix-dicebear-to-real-photos-v3.cjs

const fs = require('fs');
const https = require('https');
const path = require('path');

// 从 .env 文件加载环境变量（在 require() 之前！）
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env 文件不存在:', envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      process.env[key] = value;
    }
  }
}
console.log('✅ 已加载 .env 文件');

const DATABASE_URL = process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error('❌ DATABASE_URL 或 TURSO_AUTH_TOKEN 未设置');
  process.exit(1);
}

console.log('🔧 开始将 DiceBear 卡通替换为真人照片...');
console.log('   DB URL:', DATABASE_URL.slice(0, 50) + '...');

const RANDOMUSER_BASE = 'https://randomuser.me/api/portraits';

function hashSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function generateRealPhotoUrl(seed, gender) {
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN';
  const hash = hashSeed(seed || 'default');
  const index = (hash % 99) + 1;
  const folder = isFemale ? 'women' : 'men';
  return `${RANDOMUSER_BASE}/${folder}/${index}.jpg`;
}

function tursoRequest(sql, params = []) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      statements: [{ q: sql, params: params }]
    });
    
    const url = new URL(DATABASE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TURSO_AUTH_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          // Turso HTTP API: 成功时返回 { results: [...] }
          // 失败时返回 { errors: [...] }
          if (result.errors && result.errors.length > 0) {
            reject(new Error(JSON.stringify(result.errors)));
          } else if (result.results) {
            resolve(result);
          } else {
            reject(new Error('Unknown response: ' + data.slice(0, 200)));
          }
        } catch(e) {
          reject(new Error('Parse error: ' + data.slice(0, 200)));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  // 1. 查询需要修复的 profiles（包含 DiceBear URL）
  console.log('\n📊 查询包含 DiceBear 卡通 URL 的 profiles...');
  
  const botsResult = await tursoRequest(`
    SELECT id, displayName, gender, avatar, avatarType
    FROM profile
    WHERE avatar LIKE '%dicebear.com%'
    LIMIT 5000
  `);
  
  if (!botsResult.results || !botsResult.results[0]) {
    console.error('❌ 查询失败: 无 results 数据');
    process.exit(1);
  }
  
  const profiles = botsResult.results[0].rows.map(row => ({
    id: row[0],
    displayName: row[1],
    gender: row[2],
    avatar: row[3],
    avatarType: row[4],
  }));
  
  console.log(`   找到 ${profiles.length} 个使用 DiceBear 卡通的 profile`);
  
  if (profiles.length === 0) {
    console.log('✅ 数据库中没有 DiceBear URL！');
    return;
  }
  
  // 2. 批量更新为 randomuser.me 真人照片
  console.log('\n🔄 开始批量更新为 randomuser.me 真人照片...');
  let updated = 0;
  let errors = 0;
  
  for (const profile of profiles) {
    try {
      const photoUrl = generateRealPhotoUrl(profile.displayName || profile.id, profile.gender);
      
      await tursoRequest(`
        UPDATE profile 
        SET avatar = $1, avatarType = $2
        WHERE id = $3
      `, [photoUrl, 'photo', profile.id]);
      
      updated++;
      if (updated % 100 === 0) {
        console.log(`  进度: ${updated}/${profiles.length}`);
      }
    } catch (err) {
      errors++;
      if (errors <= 10) {
        console.error(`  错误处理 ${profile.id}:`, err.message);
      }
    }
  }
  
  console.log(`\n✅ 完成！更新了 ${updated} 个 profile 为真人照片，错误: ${errors}`);
  
  // 3. 验证结果
  console.log('\n🔍 验证修复结果...');
  const remainingResult = await tursoRequest(`
    SELECT COUNT(*) 
    FROM profile
    WHERE avatar LIKE '%dicebear.com%'
  `);
  
  const remaining = remainingResult.results[0].rows[0][0];
  console.log(`   剩余 DiceBear URL: ${remaining}`);
  
  if (remaining === 0) {
    console.log('🎉 所有 DiceBear 卡通已替换为真人照片！');
  } else {
    console.log(`⚠️  还有 ${remaining} 个 DiceBear URL 需要修复`);
  }
}

main()
  .then(() => {
    console.log('\n✅ 脚本执行完成');
    process.exit(0);
  })
  .catch(e => {
    console.error('\n❌ 脚本执行失败:', e.message);
    process.exit(1);
  });
