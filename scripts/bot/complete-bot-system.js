#!/usr/bin/env node
/**
 * 数字用户系统完整实施脚本
 * 任务：完成BotProfile填充、头像生成、行为引擎部署
 */

const { Pool } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ===== 配置数据 =====
const ETHNICITIES = ['CAUCASIAN', 'ASIAN', 'AFRICAN_AMERICAN', 'HISPANIC_LATINO', 'SOUTH_ASIAN', 'MIDDLE_EASTERN'];
const ETHNICITY_WEIGHTS = [35, 25, 15, 12, 8, 5];

const OCCUPATIONS = [
  'Software Engineer', 'Product Manager', 'Data Scientist', 'UX Designer', 'Marketing Manager',
  'Teacher', 'Nurse', 'Doctor', 'Lawyer', 'Accountant', 'Financial Analyst', 'Consultant',
  'Writer', 'Journalist', 'Photographer', 'Musician', 'Artist', 'Chef', 'Entrepreneur',
  'Sales Manager', 'HR Manager', 'Operations Manager', 'Researcher', 'Professor'
];

const INDUSTRIES = ['Technology', 'Healthcare', 'Education', 'Finance', 'Entertainment', 'Media', 'Retail', 'Hospitality'];

const INTERESTS_POOL = [
  'hiking', 'cooking', 'photography', 'traveling', 'reading', 'gaming', 'yoga', 'running',
  'swimming', 'cycling', 'dancing', 'painting', 'writing', 'music', 'movies', 'theater',
  'concerts', 'festivals', 'museums', 'wine tasting', 'coffee', 'fitness', 'meditation'
];

const ONLINE_PATTERNS = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT', 'RANDOM', 'WORK_HOURS'];
const ACTIVITY_LEVELS = ['GHOST', 'LOW', 'MEDIUM', 'HIGH', 'FULL'];
const PERSONALITY_TYPES = ['explorer', 'selective', 'social', 'passive', 'enthusiastic', 'cautious'];

// ===== 工具函数 =====
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

// ===== 任务1: 填充缺失的BotProfile =====
async function fillMissingBotProfiles(client) {
  console.log('\n📋 任务1: 检查并填充BotProfile...');
  
  const botUsersResult = await client.query(`
    SELECT p.id, p.gender, p.age 
    FROM "Profile" p
    JOIN "User" u ON p."userId" = u.id
    WHERE u.email LIKE '%@lokfeel.bot'
    AND NOT EXISTS (SELECT 1 FROM "BotProfile" bp WHERE bp."profileId" = p.id)
  `);
  
  const botUsers = botUsersResult.rows;
  console.log(`找到 ${botUsers.length} 名需要BotProfile的数字用户`);
  
  if (botUsers.length === 0) {
    console.log('✅ 所有数字用户已有BotProfile');
    return 0;
  }
  
  let created = 0, errors = 0;
  
  for (const profile of botUsers) {
    try {
      const gender = profile.gender;
      const ethnicityWeights = gender === 'FEMALE' 
        ? ETHNICITY_WEIGHTS.map((w, i) => i === 3 ? w * 1.3 : w)
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
        10 + Math.floor(Math.random() * 120),
        1 + Math.floor(Math.random() * 10),
        behaviorConfig,
        randomSample(ETHNICITIES, 2),
        randomSample(OCCUPATIONS, 3),
        randomSample(["High School", "Bachelor's", "Master's", "PhD"], 2),
        avatarStyle
      ]);
      
      created++;
      if (created % 100 === 0) {
        process.stdout.write(`\r进度: ${created}/${botUsers.length}`);
      }
    } catch (error) {
      errors++;
      console.error(`\n错误: ${profile.id}`, error.message);
    }
  }
  
  console.log(`\n✅ 完成: 创建 ${created} 个BotProfile, 错误 ${errors} 个`);
  return created;
}

// ===== 任务2: 生成头像URL =====
async function generateAvatarUrls(client) {
  console.log('\n🖼️ 任务2: 生成头像URL...');
  
  const botsWithoutAvatar = await client.query(`
    SELECT p.id, p.gender, bp.ethnicity, bp."avatarStyle"
    FROM "Profile" p
    JOIN "User" u ON p."userId" = u.id
    JOIN "BotProfile" bp ON bp."profileId" = p.id
    WHERE u.email LIKE '%@lokfeel.bot'
    AND (p.avatar IS NULL OR p.avatar = '')
  `);
  
  const bots = botsWithoutAvatar.rows;
  console.log(`找到 ${bots.length} 名需要头像的数字用户`);
  
  if (bots.length === 0) {
    console.log('✅ 所有数字用户已有头像');
    return 0;
  }
  
  let updated = 0, errors = 0;
  
  for (const bot of bots) {
    try {
      // 使用DiceBear API生成头像
      const seed = `${bot.id}-${Date.now()}`;
      const style = bot.gender === 'FEMALE' ? 'avataaars' : 'bottts';
      const avatarUrl = `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
      
      await client.query(`
        UPDATE "Profile" SET avatar = $1, "updatedAt" = NOW() WHERE id = $2
      `, [avatarUrl, bot.id]);
      
      updated++;
      if (updated % 100 === 0) {
        process.stdout.write(`\r进度: ${updated}/${bots.length}`);
      }
    } catch (error) {
      errors++;
    }
  }
  
  console.log(`\n✅ 完成: 更新 ${updated} 个头像, 错误 ${errors} 个`);
  return updated;
}

// ===== 任务3: 验证系统完整性 =====
async function verifySystem(client) {
  console.log('\n🔍 任务3: 验证系统完整性...');
  
  const stats = await client.query(`
    SELECT 
      COUNT(DISTINCT p.id) as total_bots,
      COUNT(DISTINCT bp.id) as with_profile,
      COUNT(DISTINCT CASE WHEN p.avatar IS NOT NULL AND p.avatar != '' THEN p.id END) as with_avatar,
      COUNT(DISTINCT CASE WHEN p.gender = 'FEMALE' THEN p.id END) as female_count,
      COUNT(DISTINCT CASE WHEN p.gender = 'MALE' THEN p.id END) as male_count
    FROM "Profile" p
    JOIN "User" u ON p."userId" = u.id
    LEFT JOIN "BotProfile" bp ON bp."profileId" = p.id
    WHERE u.email LIKE '%@lokfeel.bot'
  `);
  
  const s = stats.rows[0];
  console.log('\n========== 数字用户系统统计 ==========');
  console.log(`总数字用户: ${s.total_bots}`);
  console.log(`有BotProfile: ${s.with_profile} (${Math.round(s.with_profile/s.total_bots*100)}%)`);
  console.log(`有头像: ${s.with_avatar} (${Math.round(s.with_avatar/s.total_bots*100)}%)`);
  console.log(`女性用户: ${s.female_count}`);
  console.log(`男性用户: ${s.male_count}`);
  console.log('=====================================\n');
  
  return s;
}

// ===== 主函数 =====
async function main() {
  console.log('🚀 数字用户系统实施脚本启动');
  console.log('=====================================');
  
  const client = await pool.connect();
  
  try {
    // 执行三个任务
    const profilesCreated = await fillMissingBotProfiles(client);
    const avatarsUpdated = await generateAvatarUrls(client);
    const stats = await verifySystem(client);
    
    // 生成报告
    console.log('\n📊 实施报告');
    console.log('=====================================');
    console.log(`✅ BotProfile创建: ${profilesCreated}`);
    console.log(`✅ 头像URL生成: ${avatarsUpdated}`);
    console.log(`\n🎯 系统状态: ${stats.with_profile >= stats.total_bots && stats.with_avatar >= stats.total_bots ? '完整' : '部分完成'}`);
    
    if (stats.with_profile >= stats.total_bots && stats.with_avatar >= stats.total_bots) {
      console.log('\n🎉 所有数字用户已准备就绪！');
      console.log('   - BotProfile: ✅ 完整');
      console.log('   - 头像: ✅ 完整');
      console.log('   - 行为配置: ✅ 已生成');
      console.log('\n下一步: 部署行为引擎到生产环境');
    }
    
  } catch (error) {
    console.error('❌ 错误:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
