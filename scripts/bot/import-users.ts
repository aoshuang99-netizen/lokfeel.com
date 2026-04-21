#!/usr/bin/env npx tsx

/**
 * 导入数字用户种子数据脚本
 * 
 * 将 female-users.json 和 male-users.json 中的数据导入到数据库
 * 
 * 用法:
 *   npx tsx scripts/bot/import-users.ts              # 导入所有用户
 *   npx tsx scripts/bot/import-users.ts --limit 100  # 只导入100个
 *   npx tsx scripts/bot/import-users.ts --dry-run     # 模拟运行
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { hash } from 'bcryptjs';
import { getDb } from '../../src/lib/db';

interface SeedUser {
  id: string;
  gender: string;
  profile: {
    name: string;
    firstName: string;
    lastName: string;
    age: number;
    city: string;
    country: string;
    profession: string;
    bio: string;
    avatarType?: string;
  };
  personality: {
    attachmentStyle: string;
    communicationStyle: string;
    conflictStyle: string;
    loveLanguages: string;
    lifePriorities: string[];
    personalityTraits: string[];
  };
  preferences: {
    relationshipGoal: string;
    ageRangePreference: { min: number; max: number };
    dealbreakers: string[];
    relationshipStructurePreference?: string;
  };
  interests: string[];
  lifestyle: {
    zodiacSign?: string;
    drinkingHabit?: string;
    smokingHabit?: string;
    hasChildren?: boolean;
  };
  dealbreakers: string[];
  metadata?: {
    engagementScore?: number;
  };
}

interface CliArgs {
  limit?: number;
  dryRun?: boolean;
  gender?: 'male' | 'female' | 'all';
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      args.limit = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--dry-run') {
      args.dryRun = true;
    } else if (argv[i] === '--gender' && argv[i + 1]) {
      args.gender = argv[i + 1] as 'male' | 'female';
      i++;
    }
  }

  return args;
}

async function loadSeedData(): Promise<{ female: SeedUser[]; male: SeedUser[] }> {
  const dataDir = path.join(__dirname, '..', '..', '..');
  
  try {
    const femaleData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'female-users.json'), 'utf-8')
    );
    const maleData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'male-users.json'), 'utf-8')
    );
    
    return {
      female: femaleData.users || [],
      male: maleData.users || []
    };
  } catch (error) {
    console.error('❌ Failed to load seed data:', error);
    throw error;
  }
}

function mapRelationshipGoal(goal: string): string {
  const mapping: Record<string, string> = {
    'Serious Relationship': 'LONG_TERM',
    'Long Term': 'LONG_TERM',
    'Casual Dating': 'DATING',
    'Casual': 'DATING',
    'Friendship': 'FRIENDSHIP',
    'Something Casual': 'DATING',
    'Long-term Partner': 'LONG_TERM',
    'Marriage': 'LONG_TERM',
  };
  return mapping[goal] || 'DATING';
}

function mapAttachmentStyle(style: string): string {
  const mapping: Record<string, string> = {
    'Secure': 'Secure',
    'Anxious': 'Anxious-Preoccupied',
    'Avoidant': 'Dismissive-Avoidant',
    'Fearful': 'Fearful-Avoidant',
  };
  return mapping[style] || 'Secure';
}

function mapConflictStyle(style: string): string {
  const mapping: Record<string, string> = {
    'Avoidant': 'Avoiding',
    'Collaborative': 'Collaborative',
    'Compromising': 'Compromising',
    'Accommodating': 'Accommodating',
    'Competitive': 'Competing',
  };
  return mapping[style] || 'Collaborative';
}

async function createBotUser(
  db: any,
  userData: SeedUser,
  password: string
): Promise<{ userId: string; profileId: string; botId: string }> {
  const userId = `bot_${userData.id}`;
  const profileId = `bot_profile_${userData.id}`;
  const botId = `bot_${userData.id}`;

  // 1. Create User
  await db.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: `${userData.id.toLowerCase()}@bot.lokfeel.com`,
      name: userData.profile.name,
      password,
      role: 'USER',
      emailVerified: new Date(),
      image: null,
    },
  });

  // 2. Create Profile
  await db.profile.upsert({
    where: { id: profileId },
    update: {},
    create: {
      id: profileId,
      userId: userId,
      displayName: userData.profile.firstName,
      age: userData.profile.age,
      gender: userData.gender.toUpperCase() as 'MALE' | 'FEMALE',
      sexuality: 'Straight',
      bio: userData.profile.bio,
      avatar: null, // Will be filled by avatar generator
      city: userData.profile.city,
      country: userData.profile.country,
      relationshipGoal: mapRelationshipGoal(userData.preferences.relationshipGoal),
      attachmentStyle: mapAttachmentStyle(userData.personality.attachmentStyle),
      communicationStyle: userData.personality.communicationStyle,
      conflictResolution: mapConflictStyle(userData.personality.conflictStyle),
      loveLanguage: Array.isArray(userData.personality.loveLanguages) 
        ? userData.personality.loveLanguages[0] 
        : userData.personality.loveLanguages,
      boundaries: JSON.stringify([]),
      dealbreakers: JSON.stringify(userData.dealbreakers.slice(0, 5)),
      lifePriorities: JSON.stringify(userData.personality.lifePriorities),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: userData.preferences.ageRangePreference.min,
      preferredAgeMax: userData.preferences.ageRangePreference.max,
      preferredDistance: 50,
      profileStatus: 'APPROVED',
      onboardingStep: 8,
      isApproved: true,
    },
  });

  // 3. Create BotProfile
  await db.botProfile.upsert({
    where: { id: botId },
    update: {},
    create: {
      id: botId,
      profileId: profileId,
      botType: 'SEED',
      activityLevel: 'LOW',
      ethnicity: 'CAUCASIAN', // Will be enhanced with better mapping
      occupation: userData.profile.profession,
      interests: userData.interests.slice(0, 10),
      hobbies: userData.interests.slice(5, 15),
      musicGenres: [],
      movieGenres: [],
      onlinePattern: 'RANDOM',
      avatarStyle: userData.profile.avatarType || 'natural',
      isActive: true,
    },
  });

  return { userId, profileId, botId };
}

async function main() {
  const args = parseArgs();
  const db = getDb();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📥 LokFeel 数字用户数据导入脚本');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📋 配置:');
  console.log(`   - 限制数量: ${args.limit || '无限制'}`);
  console.log(`   - 模拟运行: ${args.dryRun ? '是 ⚠️' : '否'}`);
  console.log(`   - 性别: ${args.gender || 'all'}`);
  console.log('');

  // 1. Load seed data
  console.log('📂 Step 1: 加载种子数据...');
  const { female, male } = await loadSeedData();
  console.log(`   ✓ 女性用户: ${female.length}`);
  console.log(`   ✓ 男性用户: ${male.length}`);
  console.log('');

  // 2. Prepare users to import
  let usersToImport: SeedUser[] = [];
  
  if (!args.gender || args.gender === 'all') {
    usersToImport = [...female, ...male];
  } else if (args.gender === 'female') {
    usersToImport = female;
  } else {
    usersToImport = male;
  }

  if (args.limit) {
    usersToImport = usersToImport.slice(0, args.limit);
  }

  console.log('📊 Step 2: 待导入用户统计');
  console.log(`   - 总计: ${usersToImport.length} 用户`);
  console.log('');

  if (args.dryRun) {
    console.log('⚠️ [DRY RUN] 前10个用户预览:');
    for (const user of usersToImport.slice(0, 10)) {
      console.log(`   - ${user.profile.name} (${user.profile.age}, ${user.profile.city})`);
    }
    console.log('');
    console.log('💡 要实际执行，请去掉 --dry-run 参数');
    return;
  }

  // 3. Import users
  console.log('🚀 Step 3: 开始导入用户...');
  
  const password = await hash('bot123456', 12);
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < usersToImport.length; i++) {
    const user = usersToImport[i];
    
    try {
      await createBotUser(db, user, password);
      successCount++;
      
      if ((i + 1) % 50 === 0) {
        console.log(`   📦 进度: ${i + 1}/${usersToImport.length} (${successCount} 成功, ${failCount} 失败)`);
      }
    } catch (error) {
      failCount++;
      console.error(`   ❌ 失败: ${user.profile.name} - ${error}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // 4. Statistics
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📈 导入结果统计');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`   ⏱️  总耗时: ${elapsed}s`);
  console.log(`   📊 总计: ${usersToImport.length} 用户`);
  console.log(`   ✅ 成功: ${successCount}`);
  console.log(`   ❌ 失败: ${failCount}`);

  // 5. Database stats
  const totalUsers = await db.user.count();
  const totalProfiles = await db.profile.count();
  const totalBots = await db.botProfile.count();

  console.log('');
  console.log('📊 数据库统计:');
  console.log(`   - 用户总数: ${totalUsers}`);
  console.log(`   - Profile总数: ${totalProfiles}`);
  console.log(`   - BotProfile总数: ${totalBots}`);
  console.log('');
  console.log('✨ 导入完成！');
}

// Error handling
main().catch((error) => {
  console.error('');
  console.error('❌ 脚本执行失败:');
  console.error(error);
  process.exit(1);
});
