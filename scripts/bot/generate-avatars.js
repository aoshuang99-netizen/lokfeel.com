const https = require('https');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// 使用DiceBear API生成头像
// 免费、多样化、无需API Key
const DICEBEAR_API = 'https://api.dicebear.com/7.x';

const STYLES = ['avataaars', 'bottts', 'fun-emoji', 'lorelei', 'notionists', 'open-peeps'];

const ETHNICITY_SEEDS = {
  'CAUCASIAN': ['Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia'],
  'ASIAN': ['Liam', 'Noah', 'Oliver', 'Elijah', 'James', 'William', 'Benjamin', 'Lucas'],
  'AFRICAN_AMERICAN': ['Aaliyah', 'Destiny', 'Imani', 'Jada', 'Kiara', 'Layla', 'Makayla'],
  'HISPANIC_LATINO': ['Sofia', 'Isabella', 'Camila', 'Valentina', 'Luciana', 'Mariana'],
  'SOUTH_ASIAN': ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Arnav'],
  'MIDDLE_EASTERN': ['Mohammed', 'Ali', 'Omar', 'Ahmed', 'Hassan', 'Youssef']
};

async function fetchImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('🎨 开始为数字用户生成头像...');
  
  const client = await pool.connect();
  
  try {
    // 获取需要头像的用户
    const usersResult = await client.query(`
      SELECT bp.id, bp.ethnicity, p.gender, p."displayName"
      FROM "BotProfile" bp
      JOIN "Profile" p ON bp."profileId" = p.id
      WHERE bp."avatarSource" = 'generated' 
        AND (p."avatar" IS NULL OR p."avatar" = '')
      LIMIT 100
    `);
    
    const users = usersResult.rows;
    console.log(`找到 ${users.length} 名需要头像的用户`);
    
    if (users.length === 0) {
      console.log('所有用户已有头像，检查总数...');
      const countResult = await client.query(`
        SELECT COUNT(*) as total FROM "BotProfile" WHERE "avatarSource" = 'generated'
      `);
      console.log(`BotProfile总数: ${countResult.rows[0].total}`);
      return;
    }
    
    let updated = 0, errors = 0;
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      
      try {
        // 选择头像风格
        const style = STYLES[Math.floor(Math.random() * STYLES.length)];
        
        // 生成种子（基于用户名和种族）
        const seedBase = ETHNICITY_SEEDS[user.ethnicity] || ETHNICITY_SEEDS['CAUCASIAN'];
        const seed = `${seedBase[Math.floor(Math.random() * seedBase.length)]}${Math.floor(Math.random() * 1000)}`;
        
        // 构建DiceBear URL
        const avatarUrl = `${DICEBEAR_API}/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
        
        // 更新用户头像
        await client.query(`
          UPDATE "Profile" 
          SET "avatar" = $1, "avatarType" = 'CARTOON'
          WHERE id = (SELECT "profileId" FROM "BotProfile" WHERE id = $2)
        `, [avatarUrl, user.id]);
        
        updated++;
        
        if ((i + 1) % 10 === 0) {
          console.log(`进度: ${i + 1}/${users.length} (更新: ${updated}, 错误: ${errors})`);
        }
        
        // 延迟避免请求过快
        await new Promise(r => setTimeout(r, 100));
        
      } catch (error) {
        errors++;
        console.error(`错误处理用户 ${user.id}:`, error.message);
      }
    }
    
    console.log('\n✅ 头像生成完成!');
    console.log(`更新: ${updated}, 错误: ${errors}`);
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
