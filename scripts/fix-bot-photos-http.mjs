/**
 * 直接使用 Turso HTTP API 为 bot 用户分配真实照片
 * 绕过 Prisma 的慢速，直接 HTTP 请求
 */

const https = require('https');
const http = require('http');

const DB_URL = 'https://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io';
const TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Nzc1LTEzMTcsImlkIjoiMDE5ZGRkMDMtZGQwMS03Y2VmLWI5NjQtNzg4OThmMjljNTgwIiwicmlkIjoiNTNmMGQ0MjYtNjgzNC00ZjJkLTg1YjAtZTY3MTk4MmI2YTg1In0.ELXcqcJUSGKZpS6HPc8hjY2KZL7ZsKeGYmCr9UdwhfyYrTM57-4_mC5h8b8OrjUgjrcN_DO_xwWGGC1ajs7pCw';

function tursoQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      statements: [{ q: sql, params: params.map(p => ({ type: 'text', value: String(p) })) }]
    });

    const url = new URL('/', DB_URL);
    const options = {
      hostname: url.hostname,
      path: '/',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
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

  // 1. 查询需要修复的 bot profiles
  const result = await tursoQuery(`
    SELECT p.id, p.display_name, p.gender, p.avatar, p.avatar_type, u.email
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
  for (const row of rows) {
    const [id, displayName, gender, avatar, avatarType, email] = row;
    try {
      const photoUrl = generateRealPhotoUrl(displayName || id, gender);
      
      await tursoQuery(
        'UPDATE profile SET avatar = ?, avatar_type = ? WHERE id = ?',
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

  // 验证剩余数量
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
