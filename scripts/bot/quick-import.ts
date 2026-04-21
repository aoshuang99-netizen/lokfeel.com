#!/usr/bin/env npx tsx

/**
 * 快速导入3500用户种子数据脚本
 * 适配新的User+Profile分离模型
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { hash } from 'bcryptjs';

// 使用绝对路径导入Prisma Client
const generatedPath = '/Users/frankzhao/WorkBuddy/20260402202519/nexus-app/src/generated';
const { PrismaPg } = require('@prisma/adapter-pg');

const { PrismaClient } = require(generatedPath);

// 导入enum类型
const { RelationshipGoal, ProfileStatus } = require(generatedPath);

// 初始化Prisma Client
const connectionString = (process.env.DATABASE_URL || '').trim();
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter } as any);

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

async function main() {
  console.log('🚀 开始导入3500用户数据...');
  console.log(`时间: ${new Date().toISOString()}`);

  const workspaceRoot = '/Users/frankzhao/WorkBuddy/20260402202519';

  // 加载用户数据
  console.log('\n📂 加载用户数据文件...');
  const femaleData = fs.readFileSync(path.join(workspaceRoot, 'female-users.json'), 'utf-8');
  const maleData = fs.readFileSync(path.join(workspaceRoot, 'male-users.json'), 'utf-8');
  const femaleJson = JSON.parse(femaleData);
  const maleJson = JSON.parse(maleData);
  const femaleUsers: SeedUser[] = femaleJson.users || [];
  const maleUsers: SeedUser[] = maleJson.users || [];
  const allUsers = [...femaleUsers, ...maleUsers]; // 全部3500用户
  console.log(`✅ 加载 ${femaleUsers.length} 女性 + ${maleUsers.length} 男性 = ${allUsers.length} 总用户`);

  // 统计
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // 密码哈希（只做一次）
  const hashedPassword = await hash('BotPassword123!', 10);

  // 批量处理
  const batchSize = 50;
  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    const progress = ((i + 1) / allUsers.length * 100).toFixed(1);

    if ((i + 1) % 500 === 0) {
      console.log(`\n📈 进度: ${i + 1}/${allUsers.length} (${progress}%) - 成功:${successCount}, 跳过:${skipCount}, 错误:${errorCount}`);
    }

    try {
      // 检查是否已存在
      const existingEmail = `${user.id}@lokfeel.bot`;
      const existing = await prisma.user.findUnique({
        where: { email: existingEmail }
      });

      if (existing) {
        skipCount++;
        continue;
      }

      // 映射关系目标
      const goalMap: Record<string, string> = {
        'Serious Relationship': 'LONG_TERM',
        'Long Term': 'LONG_TERM',
        'Marriage': 'MARRIAGE',
        'Casual': 'CASUAL',
        'Friendship': 'FRIENDSHIP',
        'Something Casual': 'CASUAL',
        'Long-term Partner': 'LONG_TERM',
      };

      const relationshipGoal = goalMap[user.preferences.relationshipGoal] || 'LONG_TERM';

      // 创建User记录
      await prisma.user.create({
        data: {
          id: user.id,
          email: existingEmail,
          emailVerified: new Date(),
          password: hashedPassword,
          role: 'USER',
          isBot: true,
          botType: 'seed',
        }
      });

      // 创建Profile记录
      try {
        await prisma.profile.create({
          data: {
            userId: user.id,
            displayName: user.profile.name,
            age: user.profile.age,
            gender: user.gender === 'female' ? 'FEMALE' : 'MALE',
            genderIdentity: user.gender === 'female' ? 'Woman' : 'Man',
            sexuality: 'Straight',
            bio: user.profile.bio,
            avatar: null,
            avatarType: user.profile.avatarType || 'photo',
            city: user.profile.city,
            country: user.profile.country,
            relationshipGoal: RelationshipGoal[relationshipGoal as keyof typeof RelationshipGoal] || RelationshipGoal.LONG_TERM,
            attachmentStyle: user.personality.attachmentStyle,
            communicationStyle: user.personality.communicationStyle,
            conflictResolution: user.personality.conflictStyle,
            loveLanguage: String(user.personality.loveLanguages),
            dealbreakers: JSON.stringify(user.dealbreakers),
            lifePriorities: JSON.stringify(user.personality.lifePriorities),
            preferredAgeMin: user.preferences.ageRangePreference.min,
            preferredAgeMax: user.preferences.ageRangePreference.max,
            occupation: user.profile.profession,
            profileStatus: ProfileStatus.APPROVED,
            onboardingStep: 8,
            isApproved: true,
            personalityData: JSON.stringify({
              personalityTraits: user.personality.personalityTraits,
              interests: user.interests,
              lifestyle: user.lifestyle,
              relationshipStructurePreference: user.preferences.relationshipStructurePreference,
            }),
          }
        });
      } catch (profileErr) {
        // 如果Profile创建失败，删除已创建的User
        await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
        throw profileErr;
      }

      successCount++;

    } catch (error) {
      errorCount++;
      const err = error as any;
      if (errorCount <= 3) {
        console.error(`❌ 错误 (${user.id}):`, err.message || err.meta || JSON.stringify(error).substring(0, 200));
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 导入完成统计:');
  console.log(`   ✅ 成功: ${successCount}`);
  console.log(`   ⏭️  跳过: ${skipCount}`);
  console.log(`   ❌ 错误: ${errorCount}`);
  console.log(`   📈 总计: ${allUsers.length}`);
  console.log('='.repeat(50));

  if (successCount > 0) {
    console.log('\n🎉 用户数据导入成功！');
  }
}

main()
  .catch((e) => {
    console.error('❌ 严重错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
