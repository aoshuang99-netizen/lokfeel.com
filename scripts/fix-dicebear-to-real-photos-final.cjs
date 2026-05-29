#!/usr/bin/env node
// fix-dicebear-to-real-photos-final.cjs
// 批量将数据库中的 DiceBear 卡通 URL 替换为 randomuser.me 真实照片
// 正确解析 Turso HTTP API 响应格式

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
console.log('   DB URL:', DATABASE_URL.slice(0, 60) + '...');

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

function getRandomUserPhotoUrl(seed, gender) {
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN';
  const hash = hashSeed(seed || 'default');
  const index = (hash % 99) + 1;
  const folder = isFemale ? 'women' : 'men';
  return `${RANDOMUSER_BASE}/${folder}/${index}.jpg`;
}

// Turso HTTP API 请求封装
// 正确响应格式: [{"columns":[...],"rows":[[...]]}]
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
          const response = JSON.parse(data);
          
          // 检查是否是错误响应
          if (response.errors && Array.isArray(response.errors)) {
            reject(new Error(JSON.stringify(response.errors)));
            return;
          }
          
          // 成功响应是数组格式: [{"columns":[...],"rows":[[...]]}]
          if (Array.isArray(response) && response.length > 0) {
            resolve(response[0]); // 返回第一个 statement 的结果
          } else if (response.results && Array.isArray(response.results)) {
            // 兼容旧格式
            resolve(response.results[0]);
          } else {
            console.warn('⚠️  未知响应格式:', data.slice(0, 300));
            resolve(response);
          }
        } catch(e) {
          reject(new Error('JSON 解析失败: ' + data.slice(0, 200)));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  // 1. 查询需要修复的 profiles
  console.log('\n📊 查询需要修复的 profiles...');
  
  const profilesData = await tursoRequest(`
    SELECT id, displayName, gender, avatar
    FROM profile
    WHERE avatar LIKE '%dicebear.com%'
    LIMIT 5000
  `);
  
  if (!profilesData || !profilesData.rows) {
    console.error('❌ 查询失败，响应:', JSON.stringify(profilesData).slice(0, 300));
    process.exit(1);
  }
  
  const profiles = profilesData.rows.map(row => ({
    id: row[0],
    displayName: row[1],
    gender: row[2],
    avatar: row[3],
  }));
  
  console.log(`   找到 ${profiles.length} 个需要修复的 profile（DiceBear → 真实照片）`);
  
  if (profiles.length === 0) {
    console.log('✅ 数据库中没有 DiceBear URL！');
    return;
  }
  
  // 2. 批量更新
  console.log('\n🔄 开始批量更新...');
  let updated = 0;
  let errors = 0;
  
  for (const profile of profiles) {
    try {
      const photoUrl = getRandomUserPhotoUrl(profile.displayName || profile.id, profile.gender);
      
      await tursoRequest(`
        UPDATE profile 
        SET avatar = $1, "avatarType" = $2
        WHERE id = $3
      `, [photoUrl, 'photo', profile.id]);
      
      updated++;
      if (updated % 100 === 0) {
        console.log(`  进度: ${updated}/${profiles.length}`);
      }
    } catch (err) {
      errors++;
      if (errors <= 10) {
        console.error(`  ❌ 处理 ${profile.id} 失败:`, err.message);
      }
    }
  }
  
  console.log(`\n✅ 完成！更新了 ${updated} 个 profile，错误: ${errors}`);
  
  // 3. 验证结果
  console.log('\n🔍 验证修复结果...');
  const remainingData = await tursoRequest(`
    SELECT COUNT(*) 
    FROM profile
    WHERE avatar LIKE '%dicebear.com%'
  `);
  
  const remaining = remainingData.rows[0][0];
  console.log(`   剩余 DiceBear URL: ${remaining}`);
  
  if (remaining === 0) {
    console.log('🎉 数据库中已无 DiceBear URL！所有用户都有真实照片！');
  } else {
    console.log('⚠️  还有 ' + remaining + ' 个 DiceBear URL 需要修复');
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
