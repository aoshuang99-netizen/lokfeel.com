// 使用Prisma的queryRaw直接操作数据库
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const ETHNICITIES = ['CAUCASIAN', 'ASIAN', 'AFRICAN_AMERICAN', 'HISPANIC_LATINO', 'SOUTH_ASIAN', 'MIDDLE_EASTERN'];
const ETHNICITY_WEIGHTS = [35, 25, 15, 12, 8, 5];

const OCCUPATIONS = [
  'Software Engineer', 'Product Manager', 'Data Scientist', 'UX Designer', 'Marketing Manager',
  'Teacher', 'Nurse', 'Doctor', 'Lawyer', 'Accountant', 'Financial Analyst', 'Consultant',
  'Writer', 'Journalist', 'Photographer', 'Musician', 'Artist', 'Chef', 'Entrepreneur',
  'Sales Manager', 'HR Manager', 'Operations Manager', 'Researcher', 'Professor',
  'Physical Therapist', 'Psychologist', 'Social Worker', 'Architect', 'Interior Designer'
];

const INDUSTRIES = [
  'Technology', 'Healthcare', 'Education', 'Finance', 'Entertainment', 'Media',
  'Retail', 'Hospitality', 'Manufacturing', 'Consulting', 'Government', 'Non-profit'
];

const INTERESTS_POOL = [
  'hiking', 'cooking', 'photography', 'traveling', 'reading', 'gaming', 'yoga', 'running',
  'swimming', 'cycling', 'dancing', 'painting', 'writing', 'music', 'movies', 'theater',
  'concerts', 'festivals', 'museums', 'art galleries', 'wine tasting', 'craft beer',
  'coffee', 'tea', 'vegan', 'fitness', 'crossfit', 'pilates', 'meditation', 'mindfulness'
];

const ONLINE_PATTERNS = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT', 'RANDOM', 'WORK_HOURS', 'AFTER_WORK'];
const ACTIVITY_LEVELS = ['GHOST', 'LOW', 'MEDIUM', 'HIGH', 'FULL'];
const BOT_TYPES = ['SEED', 'SIMULATION', 'TRAINING', 'ACTIVE'];
const PERSONALITY_TYPES = ['explorer', 'selective', 'social', 'passive', 'enthusiastic', 'cautious'];

function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    random -= weights[i];
    if (random <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomSample(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, array.length));
}

function generateBehaviorConfig(personality) {
  const configs = {
    explorer: { matchAcceptRate: 0.7, messageResponseRate: 0.8, superLikeRate: 0.15 },
    selective: { matchAcceptRate: 0.3, messageResponseRate: 0.6, superLikeRate: 0.05 },
    social: { matchAcceptRate: 0.6, messageResponseRate: 0.9, superLikeRate: 0.1 },
    passive: { matchAcceptRate: 0.4, messageResponseRate: 0.4, superLikeRate: 0.02 },
    enthusiastic: { matchAcceptRate: 0.8, messageResponseRate: 0.95, superLikeRate: 0.2 },
    cautious: { matchAcceptRate: 0.25, messageResponseRate: 0.5, superLikeRate: 0.03 }
  };
  return JSON.stringify(configs[personality] || configs.explorer);
}

async function main() {
  console.log('🤖 开始为数字用户生成BotProfile...');
  
  const client = await pool.connect();
  
  try {
    // 获取所有数字用户
    const botUsersResult = await client.query(`
      SELECT p.id, p.gender, p.age 
      FROM "Profile" p
      JOIN "User" u ON p."userId" = u.id
      WHERE u.email LIKE '%@lokfeel.bot'
    `);
    
    const botUsers = botUsersResult.rows;
    console.log(`找到 ${botUsers.length} 名数字用户`);
    
    let created = 0, skipped = 0, errors = 0;
    
    for (let i = 0; i < botUsers.length; i++) {
      const profile = botUsers[i];
      
      try {
        // 检查是否已存在
        const existing = await client.query(
          'SELECT id FROM "BotProfile" WHERE "profileId" = $1',
          [profile.id]
        );
        
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }
        
        // 生成数据
        const gender = profile.gender;
        const ethnicityWeights = gender === 'FEMALE' 
          ? ETHNICITY_WEIGHTS.map((w, i) => i === 3 ? w * 1.3 : w) // ASIAN index is 3
          : ETHNICITY_WEIGHTS;
        
        const ethnicity = weightedRandom(ETHNICITIES, ethnicityWeights);
        const occupation = OCCUPATIONS[Math.floor(Math.random() * OCCUPATIONS.length)];
        const industry = INDUSTRIES[Math.floor(Math.random() * INDUSTRIES.length)];
        
        const age = profile.age || 28;
        let educationLevel = "Bachelor's";
        if (age < 23) educationLevel = "High School";
        else if (age > 35 && Math.random() > 0.7) educationLevel = "Master's";
        
        const incomeRanges = ['$30k-50k', '$50k-75k', '$75k-100k', '$100k-150k', '$150k-200k', '$200k+'];
        const incomeRange = incomeRanges[Math.floor(Math.random() * incomeRanges.length)];
        
        const interests = randomSample(INTERESTS_POOL, 3 + Math.floor(Math.random() * 5));
        const onlinePattern = ONLINE_PATTERNS[Math.floor(Math.random() * ONLINE_PATTERNS.length)];
        const personality = PERSONALITY_TYPES[Math.floor(Math.random() * PERSONALITY_TYPES.length)];
        const behaviorConfig = generateBehaviorConfig(personality);
        const activityLevel = ACTIVITY_LEVELS[Math.floor(Math.random() * ACTIVITY_LEVELS.length)];
        const avatarStyle = ['professional', 'casual', 'artistic'][Math.floor(Math.random() * 3)];
        
        await client.query(`
          INSERT INTO "BotProfile" (
            id, "profileId", "botType", "activityLevel", ethnicity, occupation, industry,
            "educationLevel", "incomeRange", interests, "onlinePattern", "avgResponseTime",
            "maxDailyMatches", "behaviorConfig", "preferredEthnicities", "preferredOccupations",
            "preferredEducation", "avatarStyle", "avatarSource", "isActive", "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid(), $1, 'ACTIVE', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'generated', true, NOW(), NOW()
          )
        `, [
          profile.id, activityLevel, ethnicity, occupation, industry,
          educationLevel, incomeRange, interests, onlinePattern,
          10 + Math.floor(Math.random() * 120), // avgResponseTime
          1 + Math.floor(Math.random() * 10), // maxDailyMatches
          behaviorConfig,
          randomSample(ETHNICITIES, 2),
          randomSample(OCCUPATIONS, 3),
          randomSample(["High School", "Bachelor's", "Master's", "PhD"], 2),
          avatarStyle
        ]);
        
        created++;
        
        if ((i + 1) % 100 === 0) {
          console.log(`进度: ${i + 1}/${botUsers.length} (创建: ${created}, 跳过: ${skipped})`);
        }
      } catch (error) {
        errors++;
        console.error(`错误处理用户 ${profile.id}:`, error.message);
      }
    }
    
    console.log('\n✅ BotProfile生成完成!');
    console.log(`总计: ${botUsers.length}, 创建: ${created}, 跳过: ${skipped}, 错误: ${errors}`);
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
