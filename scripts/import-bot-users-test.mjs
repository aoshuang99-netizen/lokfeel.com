/**
 * LokFeel Bot User Import - Test Run (5 users only)
 * Quick validation before full 3500-user import
 * 
 * Usage: node scripts/import-bot-users-test.mjs
 */

import { createRequire } from 'module';
import { config } from 'dotenv';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from nexus-app directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

// Use require for CommonJS Prisma modules
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../src/generated/index.js');
const { PrismaLibSql } = require('@prisma/adapter-libsql');

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL, 
  authToken: process.env.TURSO_AUTH_TOKEN 
});
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = 'BotUser2026!Secure';

function generateBotEmail(userId) {
  return `bot-${userId.toLowerCase()}@lokfeel.bot`;
}

function mapRelationshipGoal(goal) {
  const goalMap = {
    'Serious Relationship': 'LONG_TERM',
    'Long-term Partnership': 'LONG_TERM',
    'Casual Dating': 'DATING',
    'Marriage': 'LONG_TERM',
    'Friendship First': 'FRIENDSHIP',
    'Open to Explore': 'NOT_SURE',
    'Short-term Fun': 'DATING',
    'Life Partnership': 'LONG_TERM',
    'Companionship': 'FRIENDSHIP',
  };
  return goalMap[goal] || 'NOT_SURE';
}

function mapGender(gender) {
  return gender === 'female' ? 'FEMALE' : 'MALE';
}

function generateAvatarUrl(gender, avatarType, userId) {
  const style = avatarType === 'cartoon' ? 'avataaars' : 'notionists';
  const seed = `${userId}-${gender}`;
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

function transformBotUser(botUser, passwordHash) {
  const email = generateBotEmail(botUser.id);
  const avatarUrl = generateAvatarUrl(botUser.gender, botUser.profile.avatarType, botUser.id);

  const personalityData = {
    attachmentStyle: botUser.personality.attachmentStyle,
    communicationStyle: botUser.personality.communicationStyle,
    conflictStyle: botUser.personality.conflictStyle,
    loveLanguages: botUser.personality.loveLanguages,
    lifePriorities: botUser.personality.lifePriorities,
    personalityTraits: botUser.personality.personalityTraits,
  };

  const botConfig = {
    originalId: botUser.id,
    ageGroup: botUser.profile.ageGroup,
    region: botUser.profile.region,
    profession: botUser.profile.profession,
    interests: {
      mustHave: botUser.preferences.mustHaveInterests,
      niceToHave: botUser.preferences.niceToHaveInterests,
    },
    activityPattern: {
      dailyActiveHours: [18, 22],
      responseTimeMinutes: { min: 5, max: 120 },
      messageFrequency: 'medium',
    },
    matchingPreferences: {
      preferredLocations: botUser.preferences.locationPreference,
      dealbreakers: botUser.preferences.dealbreakers,
      preferredAttachmentStyles: botUser.preferences.preferredAttachmentStyle,
      preferredCommunicationStyles: botUser.preferences.preferredCommunicationStyle,
      preferredConflictStyles: botUser.preferences.preferredConflictStyle,
    },
  };

  return {
    user: {
      email,
      password: passwordHash,
      name: botUser.profile.name,
      emailVerified: new Date(),
      isBot: true,
      botType: 'simulation',
      botConfig: JSON.stringify(botConfig),
    },
    profile: {
      displayName: botUser.profile.name,
      age: botUser.profile.age,
      gender: mapGender(botUser.gender),
      genderIdentity: botUser.gender,
      sexuality: 'Straight',
      bio: botUser.profile.bio,
      avatar: avatarUrl,
      avatarType: botUser.profile.avatarType === 'realistic' ? 'photo' : 'cartoon',
      city: botUser.profile.city,
      country: botUser.profile.country,
      relationshipGoal: mapRelationshipGoal(botUser.preferences.relationshipGoal),
      attachmentStyle: botUser.personality.attachmentStyle,
      communicationStyle: botUser.personality.communicationStyle,
      conflictResolution: botUser.personality.conflictStyle,
      loveLanguage: Array.isArray(botUser.personality.loveLanguages) 
        ? botUser.personality.loveLanguages[0] 
        : botUser.personality.loveLanguages,
      boundaries: JSON.stringify([]),
      dealbreakers: JSON.stringify(botUser.preferences.dealbreakers),
      lifePriorities: JSON.stringify(botUser.personality.lifePriorities),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: botUser.preferences.ageRangePreference.min,
      preferredAgeMax: botUser.preferences.ageRangePreference.max,
      preferredGender: botUser.gender === 'female' ? 'male' : 'female',
      preferredDistance: 100,
      preferredLocation: botUser.preferences.locationPreference[0] || botUser.profile.city,
      profileStatus: 'APPROVED',
      onboardingStep: 8,
      isApproved: true,
      isVerified: true,
      personalityData: JSON.stringify(personalityData),
    },
  };
}

async function main() {
  console.log('🧪 LokFeel Bot User Import - TEST RUN (5 users)');
  console.log('================================================\n');

  try {
    // Test DB connection first
    console.log('🔌 Testing database connection...');
    await prisma.$connect();
    console.log('  ✅ Database connected!\n');

    // Count existing bot users
    const existingBots = await prisma.user.count({ where: { isBot: true } });
    console.log(`  ℹ️ Existing bot users in DB: ${existingBots}\n`);

    // Load user data
    console.log('📂 Loading user data files...');
    const dataDir = path.join(__dirname, '..', '..');
    const femaleData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'female-users.json'), 'utf-8')
    );
    const maleData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'male-users.json'), 'utf-8')
    );

    // Take just 3 female + 2 male for test
    const testUsers = [
      ...femaleData.users.slice(0, 3),
      ...maleData.users.slice(0, 2)
    ];
    console.log(`  ✅ Selected ${testUsers.length} test users\n`);

    // Generate password hash
    console.log('🔐 Generating password hash...');
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    console.log('  ✅ Password hash ready\n');

    // Import test users
    console.log('📥 Importing test users...\n');
    
    for (const botUser of testUsers) {
      const data = transformBotUser(botUser, passwordHash);
      
      // Check if already exists
      const existing = await prisma.user.findUnique({
        where: { email: data.user.email }
      });

      if (existing) {
        console.log(`  ⚠️ ${botUser.id} (${data.user.email}) already exists, skipping`);
        continue;
      }

      try {
        const user = await prisma.user.create({
          data: {
            ...data.user,
            profile: {
              create: data.profile,
            },
          },
        });
        console.log(`  ✅ ${botUser.id} (${data.user.email}) - created successfully (id: ${user.id})`);
      } catch (error) {
        console.error(`  ❌ ${botUser.id} failed:`, error.message);
      }
    }

    // Verify
    const botCount = await prisma.user.count({ where: { isBot: true } });
    console.log(`\n📊 Total bot users in DB: ${botCount}`);

    // Test login query
    const testEmail = generateBotEmail(testUsers[0].id);
    const testUser = await prisma.user.findUnique({
      where: { email: testEmail },
      include: { profile: true }
    });
    
    if (testUser && testUser.profile) {
      console.log(`\n✅ Verified: ${testEmail} exists with profile (name: ${testUser.profile.displayName})`);
    } else {
      console.log(`\n⚠️ Warning: ${testEmail} - user=${!!testUser}, profile=${!!testUser?.profile}`);
    }

    console.log('\n🧪 Test import complete! Ready for full import.');

  } catch (error) {
    console.error('\n❌ Test import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
