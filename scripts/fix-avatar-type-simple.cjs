#!/usr/bin/env node
// fix-avatar-type-simple.cjs
// 简单直接地修复 avatarType（不解析大 JSON，逐行处理）

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

const DATABASE_URL = process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error('❌ ENV not set');
  process.exit(1);
}

console.log('🚀 开始修复真实用户 avatarType...\n');

// 简单的 HTTP 请求函数
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ statements: [{ q: sql, params: params }] });
    const url = new URL(DATABASE_URL);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TURSO_AUTH_TOKEN,
        'Content-Type': 'application/json',
      },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.errors) {
            reject(new Error(JSON.stringify(result.errors)));
          } else {
            resolve(result);
          }
        } catch(e) {
          // 可能是大响应，先试试能不能拿到 rows
          console.error('⚠️  JSON 解析失败，数据长度:', data.length);
          reject(new Error('Parse error, data length: ' + data.length));
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function execute(sql, params = []) {
  return query(sql, params); // Turso 用同样的接口
}

async function main() {
  console.log('📊 第1步: 统计需要修复的用户数...\n');
  
  // 先统计总数
  let totalNeedFix = 0;
  try {
    const countResult = await query(`
      SELECT COUNT(*) as cnt
      FROM profile
      WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
      AND avatar IS NOT NULL AND avatar != ''
      AND avatar NOT LIKE '%dicebear.com%'
      AND (avatarType IS NULL OR avatarType != 'photo')
    `);
    
    if (countResult.results && countResult.results[0]) {
      totalNeedFix = countResult.results[0].rows[0][0];
      console.log(`   需要修复的用户总数: ${totalNeedFix}\n`);
    }
  } catch(e) {
    console.error('❌ 统计失败:', e.message);
    process.exit(1);
  }
  
  if (totalNeedFix === 0) {
    console.log('✅ 所有真实用户已有正确的 avatarType！');
    return;
  }
  
  console.log('📝 第2步: 分批更新用户...\n');
  
  let offset = 0;
  let batchSize = 500;
  let totalUpdated = 0;
  let totalErrors = 0;
  
  while (offset < totalNeedFix) {
    console.log(`  批次 ${Math.floor(offset / batchSize) + 1}: 查询 ${batchSize} 条记录...`);
    
    // 查询一批需要修复的用户
    let users;
    try {
      const usersResult = await query(`
        SELECT id, displayName, avatar
        FROM profile
        WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
        AND avatar IS NOT NULL AND avatar != ''
        AND avatar NOT LIKE '%dicebear.com%'
        AND (avatarType IS NULL OR avatarType != 'photo')
        LIMIT ${batchSize} OFFSET ${offset}
      `);
      
      if (!usersResult.results || !usersResult.results[0]) {
        console.error('❌ 查询失败');
        break;
      }
      
      users = usersResult.results[0].rows.map(row => ({
        id: row[0],
        displayName: row[1],
        avatar: row[2],
      }));
      
      console.log(`    找到 ${users.length} 个用户，开始更新...`);
      
    } catch(e) {
      console.error('❌ 查询批次失败:', e.message);
      offset += batchSize;
      continue;
    }
    
    // 更新这一批
    let batchUpdated = 0;
    for (const user of users) {
      try {
        await execute(`
          UPDATE profile 
          SET avatarType = 'photo'
          WHERE id = ?
        `, [user.id]);
        
        batchUpdated++;
        totalUpdated++;
        
        if (batchUpdated % 50 === 0) {
          process.stdout.write(`\r    进度: ${batchUpdated}/${users.length}`);
        }
      } catch (err) {
        totalErrors++;
        if (totalErrors <= 5) {
          console.error(`\n  ❌ 更新失败 ${user.id}:`, err.message.slice(0, 100));
        }
      }
    }
    
    console.log(`\r    ✅ 批次完成: 更新 ${batchUpdated} 个，错误 ${totalErrors}`);
    offset += batchSize;
  }
  
  console.log(`\n✅ 全部完成！总共更新 ${totalUpdated} 个用户，错误 ${totalErrors}\n`);
  
  // 验证结果
  console.log('🔍 第3步: 验证修复结果...\n');
  try {
    const remainingResult = await query(`
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
      } else {
        console.log(`\n⚠️  还有 ${remaining} 个用户需要修复，可能需要再次运行脚本`);
      }
    }
  } catch(e) {
    console.error('❌ 验证失败:', e.message);
  }
  
  // 显示最终分布
  console.log('\n📊 第4步: 显示最终 avatarType 分布...\n');
  try {
    const distResult = await query(`
      SELECT avatarType, COUNT(*) as cnt
      FROM profile
      WHERE userId NOT IN (SELECT id FROM user WHERE isBot = 1)
      AND avatar IS NOT NULL AND avatar != ''
      GROUP BY avatarType
    `);
    
    if (distResult.results && distResult.results[0]) {
      console.log('  avatarType 分布:');
      for (const row of distResult.results[0].rows) {
        console.log(`    ${row[0] || 'NULL'}: ${row[1]}`);
      }
    }
  } catch(e) {
    console.error('❌ 查询分布失败:', e.message);
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
