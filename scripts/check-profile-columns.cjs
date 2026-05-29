#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const path = require('path');

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

const DATABASE_URL = process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

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
        try {
          const result = JSON.parse(data);
          result.errors ? reject(new Error(JSON.stringify(result.errors))) : resolve(result);
        } catch(e) { reject(new Error('Parse: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('📊 查询 profile 表列信息...\n');
  
  const result = await tursoQuery(`PRAGMA table_info(profile)`, []);
  
  if (!result.results || !result.results[0]) {
    console.error('❌ 查询失败:', JSON.stringify(result).slice(0, 300));
    process.exit(1);
  }
  
  console.log('profile 表所有列:');
  for (const row of result.results[0].rows) {
    console.log(`  ${row[1]} (${row[2]})`);
  }
  
  console.log('\n📊 查询 avatarType 分布...\n');
  
  const distResult = await tursoQuery(`
    SELECT avatarType, COUNT(*) as cnt
    FROM profile
    WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
    AND avatar IS NOT NULL AND avatar != ''
    GROUP BY avatarType
  `);
  
  if (distResult.results && distResult.results[0]) {
    console.log('avatarType 分布 (真实用户):');
    for (const row of distResult.results[0].rows) {
      console.log(`  ${row[0] || 'NULL'}: ${row[1]}`);
    }
  }
  
  // 统计需要修复的数量
  const needFixResult = await tursoQuery(`
    SELECT COUNT(*) as cnt
    FROM profile
    WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
    AND avatar IS NOT NULL AND avatar != ''
    AND avatar NOT LIKE '%dicebear.com%'
    AND (avatarType IS NULL OR avatarType != 'photo')
  `);
  
  if (needFixResult.results && needFixResult.results[0]) {
    const needFix = needFixResult.results[0].rows[0][0];
    console.log(`\n⚠️  需要修复 avatarType 的真实用户: ${needFix}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
