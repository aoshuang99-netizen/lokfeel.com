#!/usr/bin/env node
/**
 * fix-bot-photos-direct.cjs
 * 为 bot 用户批量分配 randomuser.me 真实照片
 * 完全自包含：在脚本内部加载 .env，不依赖外部变量
 * 使用 Turso HTTP API（比 Prisma 快 10 倍）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 从 .env 文件加载变量到 process.env
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env 文件不存在:', envPath);
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      process.env[key] = val;
    }
  }
  console.log('✅ 已加载 .env 文件');
  console.log('   DATABASE_URL prefix:', process.env.DATABASE_URL?.slice(0, 40));
  console.log('   TURSO_AUTH_TOKEN length:', process.env.TURSO_AUTH_TOKEN?.length);
}

loadEnv();

const DB_URL = process.env.DATABASE_URL;
const TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DB_URL || !TOKEN) {
  console.error('❌ 缺少 DATABASE_URL 或 TURSO_AUTH_TOKEN');
  process.exit(1);
}

// 解析 DB_URL 的 hostname 和 path
const urlObj = new URL(DB_URL);
const DB_HOSTNAME = urlObj.hostname;
const DB_PATH = urlObj.pathname || '/';

function tursoQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      statements: [{ q: sql, params: params.map(v => String(v)) }]
    });

    const options = {
      hostname: DB_HOSTNAME,
      path: DB_PATH,
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
          const result = JSON.parse(data);
          if (result.errors) {
            reject(new Error(JSON.stringify(result.errors)));
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
  const hash = Math.abs(
    [...seed].reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0)
  );
  const index = (hash % 99) + 1;
  const folder = isFemale ? 'women' : 'men';
  return `https://randomuser.me/api/portraits/${folder}/${index}.jpg`;
}

async function main() {
  console.log('🔧 开始为 bot 用户分配真实照片 (Turso HTTP API)...');
  console.log('='.repeat(60));

  // 1. 统计需要修复的数量
  const countResult = await tursoQuery(`
    SELECT COUNT(*) as cnt
    FROM profile
    WHERE user_id IN (SELECT id FROM user WHERE is_bot = 1)
      AND (avatar IS NULL OR avatar = '' OR avatar LIKE '%dicebear.com%' OR avatar LIKE 'emoji:%')
  `);

  const needFixCount = countResult.results?.[0]?.rows?.[0]?.[0] || 0;
  console.log(`ℹ️ 需要修复的 bot 用户: ${needFixCount}`);

  if (needFixCount === 0) {
    console.log('✅ 所有 bot 用户已有真实照片！');
    return;
  }

  // 2. 分批处理（每批 500 条）
  let totalUpdated = 0;
  const BATCH_SIZE = 500;

  while (true) {
    const result = await tursoQuery(`
      SELECT p.id, p.display_name, p.gender, p.avatar
      FROM profile p
      JOIN user u ON p.user_id = u.id
      WHERE u.is_bot = 1
        AND (p.avatar IS NULL OR p.avatar = '' OR p.avatar LIKE '%dicebear.com%' OR p.avatar LIKE 'emoji:%')
      LIMIT ${BATCH_SIZE}
    `);

    const rows = result.results?.[0]?.rows || [];
    if (rows.length === 0) break;

    console.log(`  处理批次: ${rows.length} 条`);

    let batchUpdated = 0;
    for (const row of rows) {
      const [id, displayName, gender, avatar] = row;
      try {
        const photoUrl = generateRealPhotoUrl(displayName || id, gender);

        await tursoQuery(
          'UPDATE profile SET avatar = $1, avatar_type = $2 WHERE id = $3',
          [photoUrl, 'photo', id]
        );

        batchUpdated++;
      } catch (err) {
        console.error(`  ❌ 错误处理 ${id}:`, err.message.slice(0, 100));
      }
    }

    totalUpdated += batchUpdated;
    console.log(`  ✅ 本批更新: ${batchUpdated}, 累计: ${totalUpdated}`);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log('='.repeat(60));
  console.log(`✅ 完成！共更新 ${totalUpdated} 个 bot 用户的照片`);

  // 3. 验证剩余数量
  const remainingResult = await tursoQuery(`
    SELECT COUNT(*) as cnt
    FROM profile
    WHERE user_id IN (SELECT id FROM user WHERE is_bot = 1)
      AND (avatar IS NULL OR avatar = '' OR avatar LIKE '%dicebear.com%')
  `);
  const remaining = remainingResult.results?.[0]?.rows?.[0]?.[0] || 0;
  console.log(`ℹ️ 剩余未修复: ${remaining}`);
}

main()
  .then(() => { console.log('✅ 脚本执行完成'); process.exit(0); })
  .catch(e => { console.error('❌ 致命错误:', e.message); process.exit(1); });
