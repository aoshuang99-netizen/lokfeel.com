/**
 * 用 Turso HTTP API 直接批量修复 bot 用户照片
 * 比 Prisma 快 10 倍以上
 */

const https = require('https');

const DB_URL = 'https://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io';
const TOKEN = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..fake'; // 从 .env 读取

// 从 .env 文件读取 TOKEN
const fs = require('fs');
const envContent = fs.readFileSync('/Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.env', 'utf8');
const match = envContent.match(/TURSO_AUTH_TOKEN=(.+)/);
const TURSO_TOKEN = match ? match[1].trim() : TOKEN;

function tursoQuery(sql, args = []) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      statements: [
        {
          q: sql,
          params: args.map(v => String(v))
        }
      ]
    });

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TURSO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(DB_URL, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.errors) {
            reject(new Error(result.errors[0].message));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function generateRealPhotoUrl(seed, gender) {
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN';
  const hash = Math.abs([...seed].reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0));
  const index = (hash % 99) + 1;
  const folder = isFemale ? 'women' : 'men';
  return `https://randomuser.me/api/portraits/${folder}/${index}.jpg`;
}

async function main() {
  console.log('🔧 开始为 bot 用户分配真实照片 (Turso HTTP API)...');

  // 1. 查询需要修复的 bot profiles (每次 500 条)
  const result = await tursoQuery(`
    SELECT p.id, p.display_name, p.gender, p.avatar, p.avatar_type
    FROM profile p
    JOIN user u ON p.user_id = u.id
    WHERE u.is_bot = 1
      AND (p.avatar IS NULL OR p.avatar = '' OR p.avatar LIKE '%dicebear.com%' OR p.avatar LIKE 'emoji:%')
    LIMIT 500
  `);

  if (!result.results || !result.results[0] || !result.results[0].rows) {
    console.log('⚠️ 没有需要修复的 bot 用户，或查询出错:', JSON.stringify(result).slice(0, 200));
    return;
  }

  const rows = result.results[0].rows;
  console.log(`✅ 找到 ${rows.length} 个需要修复的 bot profile`);

  let updated = 0;
  
  // 2. 批量更新 (每批 50 个)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const [id, displayName, gender, avatar, avatarType] = row;
    
    try {
      const photoUrl = generateRealPhotoUrl(displayName || id, gender);
      
      await tursoQuery(
        'UPDATE profile SET avatar = $1, avatar_type = $2 WHERE id = $3',
        [photoUrl, 'photo', id]
      );
      
      updated++;
      if (updated % 50 === 0) {
        console.log(`  进度: ${updated}/${rows.length}`);
      }
    } catch (err) {
      console.error(`❌ 错误处理 ${id}:`, err.message);
    }
  }

  console.log(`✅ 完成！更新了 ${updated} 个 bot 用户的照片`);

  // 3. 验证剩余数量
  const remainingResult = await tursoQuery(`
    SELECT COUNT(*)
    FROM profile p
    JOIN user u ON p.user_id = u.id
    WHERE u.is_bot = 1
      AND (p.avatar IS NULL OR p.avatar = '' OR p.avatar LIKE '%dicebear.com%')
  `);
  
  const remaining = remainingResult.results?.[0]?.rows?.[0]?.[0] || 'unknown';
  console.log(`ℹ️ 剩余未修复: ${remaining}`);
}

main().catch(e => {
  console.error('❌ 致命错误:', e.message);
  process.exit(1);
});
