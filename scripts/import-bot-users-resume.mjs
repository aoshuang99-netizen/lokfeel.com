/**
 * LokFeel Bot User Import - Resumable (continues from where it left off)
 * 
 * Uses Prisma with proper error handling and retry logic.
 * Checks existing users and skips already-imported ones.
 * 
 * Usage: cd nexus-app && node scripts/import-bot-users-resume.mjs
 */

import { createRequire } from 'module';
import { config } from 'dotenv';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

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
    'Serious Relationship': 'LONG_TERM', 'Long-term Partnership': 'LONG_TERM',
    'Casual Dating': 'DATING', 'Marriage': 'LONG_TERM', 'Friendship First': 'FRIENDSHIP',
    'Open to Explore': 'NOT_SURE', 'Short-term Fun': 'DATING',
    'Life Partnership': 'LONG_TERM', 'Companionship': 'FRIENDSHIP',
  };
  return goalMap[goal] || 'NOT_SURE';
}

function mapGender(gender) { return gender === 'female' ? 'FEMALE' : 'MALE'; }

function generateAvatarUrl(gender, avatarType, userId) {
  const style = avatarType === 'cartoon' ? 'avataaars' : 'notionists';
  const seed = `${userId}-${gender}`;
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

function transformBotUser(botUser, passwordHash) {
  const email = generateBotEmail(botUser.id);
  const avatarUrl = generateAvatarUrl(botUser.gender, botUser.profile.avatarType, botUser.id);
  const personalityData = JSON.stringify({
    attachmentStyle: botUser.personality.attachmentStyle,
    communicationStyle: botUser.personality.communicationStyle,
    conflictStyle: botUser.personality.conflictStyle,
    loveLanguages: botUser.personality.loveLanguages,
    lifePriorities: botUser.personality.lifePriorities,
    personalityTraits: botUser.personality.personalityTraits,
  });
  const botConfig = JSON.stringify({
    originalId: botUser.id, ageGroup: botUser.profile.ageGroup,
    region: botUser.profile.region, profession: botUser.profile.profession,
    interests: { mustHave: botUser.preferences.mustHaveInterests, niceToHave: botUser.preferences.niceToHaveInterests },
    activityPattern: { dailyActiveHours: [18, 22], responseTimeMinutes: { min: 5, max: 120 }, messageFrequency: 'medium' },
    matchingPreferences: {
      preferredLocations: botUser.preferences.locationPreference, dealbreakers: botUser.preferences.dealbreakers,
      preferredAttachmentStyles: botUser.preferences.preferredAttachmentStyle,
      preferredCommunicationStyles: botUser.preferences.preferredCommunicationStyle,
      preferredConflictStyles: botUser.preferences.preferredConflictStyle,
    },
  });
  return {
    user: {
      email, password: passwordHash, name: botUser.profile.name,
      emailVerified: new Date(), isBot: true, botType: 'simulation', botConfig,
    },
    profile: {
      displayName: botUser.profile.name, age: botUser.profile.age,
      gender: mapGender(botUser.gender), genderIdentity: botUser.gender,
      sexuality: 'Straight', bio: botUser.profile.bio, avatar: avatarUrl,
      avatarType: botUser.profile.avatarType === 'realistic' ? 'photo' : 'cartoon',
      city: botUser.profile.city, country: botUser.profile.country,
      relationshipGoal: mapRelationshipGoal(botUser.preferences.relationshipGoal),
      attachmentStyle: botUser.personality.attachmentStyle,
      communicationStyle: botUser.personality.communicationStyle,
      conflictResolution: botUser.personality.conflictStyle,
      loveLanguage: Array.isArray(botUser.personality.loveLanguages) ? botUser.personality.loveLanguages[0] : botUser.personality.loveLanguages,
      boundaries: '[]',
      dealbreakers: JSON.stringify(botUser.preferences.dealbreakers),
      lifePriorities: JSON.stringify(botUser.personality.lifePriorities),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: botUser.preferences.ageRangePreference.min,
      preferredAgeMax: botUser.preferences.ageRangePreference.max,
      preferredGender: botUser.gender === 'female' ? 'male' : 'female',
      preferredDistance: 100,
      preferredLocation: botUser.preferences.locationPreference[0] || botUser.profile.city,
      profileStatus: 'APPROVED', onboardingStep: 8,
      isApproved: true, isVerified: true, personalityData,
    },
  };
}

async function importOneUser(botUser, passwordHash, retries = 2) {
  const data = transformBotUser(botUser, passwordHash);
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Check if exists
      const existing = await prisma.user.findUnique({ where: { email: data.user.email } });
      if (existing) return { skipped: true };

      await prisma.user.create({
        data: { ...data.user, profile: { create: data.profile } },
      });
      return { success: true };
    } catch (error) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      } else {
        return { error: error.message, email: data.user.email };
      }
    }
  }
}

async function main() {
  console.log('🚀 LokFeel Bot User Import - Resumable Mode');
  console.log('=============================================\n');

  const startTime = Date.now();

  try {
    await prisma.$connect();
    console.log('✅ Database connected\n');

    // Load data
    const dataDir = path.join(__dirname, '..', '..');
    const femaleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'female-users.json'), 'utf-8'));
    const maleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'male-users.json'), 'utf-8'));
    const allUsers = [...femaleData.users, ...maleData.users];
    console.log(`📂 ${femaleData.users.length} female + ${maleData.users.length} male = ${allUsers.length} total\n`);

    // Generate hash
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    console.log('🔐 Password hash ready\n');

    // Import one at a time (sequential for stability)
    let imported = 0, skipped = 0, errors = 0;
    const BATCH_LOG = 100;

    for (let i = 0; i < allUsers.length; i++) {
      const botUser = allUsers[i];
      const result = await importOneUser(botUser, passwordHash);

      if (result.success) {
        imported++;
      } else if (result.skipped) {
        skipped++;
      } else {
        errors++;
        if (errors <= 10) console.error(`❌ ${result.email}: ${result.error}`);
      }

      // Progress log
      if ((i + 1) % BATCH_LOG === 0 || i === allUsers.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((i + 1) / (Date.now() - startTime) * 1000).toFixed(1);
        console.log(`📊 ${i + 1}/${allUsers.length} | ✅${imported} ⏭️${skipped} ❌${errors} | ${rate} users/s | ${elapsed}s`);
      }

      // Small delay for rate limiting
      if (i % 10 === 9) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\n✅ Import Complete! (${totalTime}s)`);
    console.log(`  ✅ Imported: ${imported}`);
    console.log(`  ⏭️ Skipped: ${skipped}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log(`  📈 Success: ${((imported / allUsers.length) * 100).toFixed(1)}%`);

    // Verify
    const botCount = await prisma.user.count({ where: { isBot: true } });
    console.log(`\n🗄️ Total bot users in DB: ${botCount}`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
