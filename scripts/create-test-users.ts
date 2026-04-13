/**
 * Create Test Users Script
 * 
 * 创建3个测试账号供用户体验测试
 * - 测试账号1: 女性用户 (已完成Onboarding)
 * - 测试账号2: 男性用户 (已完成Onboarding)
 * - 测试账号3: 新注册用户 (未完成Onboarding)
 * 
 * Usage: npx tsx scripts/create-test-users.ts
 */

import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaClient, $Enums } from '../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const PASSWORD = 'Test123456!';

type Gender = 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER';

interface TestUser {
  email: string;
  name: string;
  gender: Gender;
  sexuality: string;
  age: number;
  city: string;
  bio: string;
  onboardingStep: number;
  profileStatus: $Enums.ProfileStatus;
  avatarType: string;
}

const testUsers: TestUser[] = [
  {
    email: 'test.female@lokfeel.com',
    name: 'Emma Thompson',
    gender: 'FEMALE',
    sexuality: 'Straight',
    age: 28,
    city: 'New York',
    bio: 'Love hiking, cooking, and meaningful conversations. Looking for someone who values emotional connection.',
    onboardingStep: 8,
    profileStatus: 'APPROVED',
    avatarType: 'cartoon',
  },
  {
    email: 'test.male@lokfeel.com',
    name: 'Michael Chen',
    gender: 'MALE',
    sexuality: 'Straight',
    age: 32,
    city: 'San Francisco',
    bio: 'Software engineer by day, musician by night. Seeking a partner to explore life with.',
    onboardingStep: 8,
    profileStatus: 'APPROVED',
    avatarType: 'photo',
  },
  {
    email: 'test.new@lokfeel.com',
    name: 'Sarah Wilson',
    gender: 'FEMALE',
    sexuality: 'Bisexual',
    age: 26,
    city: 'Los Angeles',
    bio: '',
    onboardingStep: 2,
    profileStatus: 'DRAFT',
    avatarType: 'cartoon',
  },
];

async function createTestUser(userData: TestUser, passwordHash: string) {
  const existingUser = await prisma.user.findUnique({
    where: { email: userData.email },
  });

  if (existingUser) {
    console.log(`  ⚠️  User ${userData.email} already exists, skipping...`);
    return { success: false, skipped: true, user: existingUser };
  }

  // Generate avatar URL
  const avatarSeed = `${userData.name}-${userData.gender}`;
  const avatarStyle = userData.avatarType === 'cartoon' ? 'avataaars' : 'notionists';
  const avatarUrl = `https://api.dicebear.com/7.x/${avatarStyle}/svg?seed=${encodeURIComponent(avatarSeed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;

  const user = await prisma.user.create({
    data: {
      email: userData.email,
      name: userData.name,
      password: passwordHash,
      role: 'USER',
      emailVerified: new Date(),
      isBot: false,
      profile: {
        create: {
          displayName: userData.name,
          age: userData.age,
          gender: userData.gender,
          sexuality: userData.sexuality,
          bio: userData.bio,
          avatar: avatarUrl,
          avatarType: userData.avatarType,
          city: userData.city,
          country: 'US',
          relationshipGoal: 'LONG_TERM',
          attachmentStyle: 'Secure',
          communicationStyle: 'Direct',
          conflictResolution: 'Collaborative',
          loveLanguage: 'Quality Time',
          boundaries: JSON.stringify(['Respect personal space', 'Honest communication']),
          dealbreakers: JSON.stringify(['Dishonesty', 'Lack of ambition']),
          lifePriorities: JSON.stringify(['Career', 'Family', 'Health']),
          emotionalAvailability: 'Fully Available',
          preferredAgeMin: 25,
          preferredAgeMax: 40,
          preferredGender: userData.gender === 'FEMALE' ? 'male' : 'female',
          preferredDistance: 50,
          preferredLocation: userData.city,
          profileStatus: userData.profileStatus,
          onboardingStep: userData.onboardingStep,
          isApproved: userData.profileStatus === 'APPROVED',
          isVerified: true,
        },
      },
    },
  });

  return { success: true, skipped: false, user };
}

async function main() {
  console.log('🚀 Creating Test Users for LokFeel');
  console.log('===================================\n');

  try {
    // Generate password hash
    console.log('🔐 Generating password hash...');
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    console.log('  ✅ Password hash ready\n');

    console.log('📥 Creating test users...\n');

    const results = [];
    for (const userData of testUsers) {
      console.log(`  📝 Creating: ${userData.name} (${userData.email})`);
      const result = await createTestUser(userData, passwordHash);
      results.push({ ...result, userData });
      
      if (result.success) {
        console.log(`     ✅ Created successfully`);
      } else if (result.skipped) {
        console.log(`     ⏭️  Already exists`);
      }
    }

    console.log('\n\n✅ Test Users Created!');
    console.log('======================');
    console.log('\n📋 Login Credentials:');
    console.log('---------------------');
    
    for (const result of results) {
      const status = result.userData.onboardingStep >= 8 ? '✅ Onboarding Complete' : '📝 Onboarding In Progress';
      console.log(`\n👤 ${result.userData.name}`);
      console.log(`   Email:    ${result.userData.email}`);
      console.log(`   Password: ${PASSWORD}`);
      console.log(`   Gender:   ${result.userData.gender}`);
      console.log(`   Status:   ${status}`);
      console.log(`   Profile:  ${result.userData.profileStatus}`);
    }

    console.log('\n\n🔗 Login URL: https://app.lokfeel.com/login');
    console.log('\n💡 Usage Tips:');
    console.log('   - Use these accounts to test the full user flow');
    console.log('   - Female/Male accounts can match with each other');
    console.log('   - New user account shows onboarding experience');
    console.log('   - All accounts have email pre-verified');

  } catch (error) {
    console.error('\n❌ Failed to create test users:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
