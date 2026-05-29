#!/usr/bin/env node
// fix-real-user-avatar-type.cjs
// 修复真实用户的 avatarType 字段（之前 onboarding 完成时没有设置 avatarType: 'photo'）

const fs = require('fs');
const https = require('https');
const path = require('path');

// 加载 .env
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) { console.error('❌ .env not found'); process.exit(1); }

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

const DATABASE_URL = process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !TURSO_AUTH_TOKEN) { console.error('❌ ENV not set'); process.exit(1); }

function tursoQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ statements: [{ q: sql, params: params }] });
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
        const result = JSON.parse(data);
        result.errors ? reject(new Error(JSON.stringify(result.errors))) : resolve(result);
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function tursoExecute(sql, params = []) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ statements: [{ q: sql, params: params }] });
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
        const result = JSON.parse(data);
        result.errors ? reject(new Error(JSON.stringify(result.errors))) : resolve(result);
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('🔧 修复真实用户 avatarType 字段...\n');
  
  // 1. 查询需要修复的用户
  console.log('📊 查询需要修复的用户...');
  const needFixResult = await tursoQuery(`
    SELECT id, displayName, avatar, avatarType
    FROM profile
    WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
    AND avatar IS NOT NULL AND avatar != ''
    AND avatar NOT LIKE '%dicebear.com%'
    AND (avatarType IS NULL OR avatarType != 'photo')
    LIMIT 5000
  `);
  
  if (!needFixResult.results || !needFixResult.results[0]) {
    console.error('❌ 查询失败:', JSON.stringify(needFixResult).slice(0, 300));
    process.exit(1);
  }
  
  const users = needFixResult.results[0].rows.map(row => ({
    id: row[0],
    displayName: row[1],
    avatar: row[2],
    avatarType: row[3],
  }));
  
  console.log(`   找到 ${users.length} 个需要修复的用户\n`);
  
  if (users.length === 0) {
    console.log('✅ 所有真实用户已有正确的 avatarType！');
    
    // 验证一下
    const verifyResult = await tursoQuery(`
      SELECT avatarType, COUNT(*) as cnt
      FROM profile
      WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
      AND avatar IS NOT NULL AND avatar != ''
      GROUP BY avatarType
    `);
    
    if (verifyResult.results && verifyResult.results[0]) {
      console.log('\navatarType 分布:');
      for (const row of verifyResult.results[0].rows) {
        console.log(`  ${row[0] || 'NULL'}: ${row[1]}`);
      }
    }
    
    return;
  }
  
  // 2. 批量更新
  console.log('🔄 开始批量更新...\n');
  let updated = 0;
  let errors = 0;
  
  for (const user of users) {
    try {
      await tursoExecute(`
        UPDATE profile 
        SET avatarType = 'photo'
        WHERE id = ?
      `, [user.id]);
      
      updated++;
      if (updated % 100 === 0) {
        console.log(`  进度: ${updated}/${users.length}`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`  ❌ 更新失败 ${user.id}:`, err.message.slice(0, 100));
      }
    }
  }
  
  console.log(`\n✅ 完成！更新了 ${updated} 个用户，错误: ${errors}\n`);
  
  // 3. 验证结果
  console.log('🔍 验证修复结果...\n');
  const remainingResult = await tursoQuery(`
    SELECT COUNT(*) as cnt
    FROM profile
    WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
    AND avatar IS NOT NULL AND avatar != ''
    AND avatar NOT LIKE '%dicebear.com%'
    AND (avatarType IS NULL OR avatarType != 'photo')
  `);
  
  if (remainingResult.results && remainingResult.results[0]) {
    const remaining = remainingResult.results[0].rows[0][0];
    console.log(`   剩余未修复: ${remaining}`);
    
    if (remaining === 0) {
      console.log('\n🎉 所有真实用户已有正确的 avatarType！');
    }
  }
  
  // 4. 显示最终分布
  const finalResult = await tursoQuery(`
    SELECT avatarType, COUNT(*) as cnt
    FROM profile
    WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
    AND avatar IS NOT NULL AND avatar != ''
    GROUP BY avatarType
  `);
  
  if (finalResult.results && finalResult.results[0]) {
    console.log('\n📊 最终 avatarType 分布:');
    for (const row of finalResult.results[0].rows) {
      console.log(`  ${row[0] || 'NULL'}: ${row[1]}`);
    }
  }
}

main()
  .then(() => { console.log('\n✅ 脚本执行完成'); process.exit(0); })
  .catch(e => { console.error('\n❌ 脚本执行失败:', e.message); process.exit(1); });
