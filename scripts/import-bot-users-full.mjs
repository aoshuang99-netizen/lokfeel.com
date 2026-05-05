/**
 * LokFeel Bot User Import - Full 3500 Users
 * 
 * Import all bot users from female-users.json and male-users.json
 * into production Turso database.
 * 
 * Usage: cd nexus-app && node scripts/import-bot-users-full.mjs
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

// Configuration
const CONFIG = {
  BATCH_SIZE: 50,
  PASSWORD_SALT_ROUNDS: 10,
  BOT_EMAIL_DOMAIN: 'lokfeel.bot',
  DEFAULT_PASSWORD: 'BotUser2026!Secure',
  DELAY_BETWEEN_BATCHES_MS: 100,
};

function generateBotEmail(userId) {
  return `bot-${userId.toLowerCase()}@${CONFIG.BOT_EMAIL_DOMAIN}`;
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

async function importBatch(botUsers, passwordHash, startIndex, totalCount) {
  const results = await Promise.all(
    botUsers.map(async (botUser, idx) => {
      const data = transformBotUser(botUser, passwordHash);
      
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email: data.user.email },
        });

        if (existingUser) {
          return { success: false, skipped: true };
        }

        await prisma.user.create({
          data: {
            ...data.user,
            profile: {
              create: data.profile,
            },
          },
        });

        const currentIndex = startIndex + idx + 1;
        if (currentIndex % 10 === 0 || currentIndex === totalCount) {
          process.stdout.write(`\r  📊 Progress: ${currentIndex}/${totalCount}`);
        }

        return { success: true, skipped: false };
      } catch (error) {
        console.error(`\n  ❌ Error importing ${botUser.id}:`, error.message || error);
        return { success: false, skipped: false, error: error.message };
      }
    })
  );

  const successCount = results.filter(r => r.success).length;
  const skipCount = results.filter(r => r.skipped).length;
  
  return { successCount, skipCount };
}

async function main() {
  console.log('🚀 LokFeel Bot User Import - Full Import');
  console.log('=========================================\n');

  try {
    // Test DB connection
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

    const allUsers = [...femaleData.users, ...maleData.users];
    console.log(`  ✅ Loaded ${femaleData.users.length} female users`);
    console.log(`  ✅ Loaded ${maleData.users.length} male users`);
    console.log(`  📊 Total: ${allUsers.length} users\n`);

    // Generate password hash
    console.log('🔐 Generating password hash...');
    const passwordHash = await bcrypt.hash(CONFIG.DEFAULT_PASSWORD, CONFIG.PASSWORD_SALT_ROUNDS);
    console.log('  ✅ Password hash ready\n');

    // Import users in batches
    console.log('📥 Starting import...\n');
    let totalImported = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (let i = 0; i < allUsers.length; i += CONFIG.BATCH_SIZE) {
      const batch = allUsers.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNumber = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allUsers.length / CONFIG.BATCH_SIZE);

      console.log(`\n📝 Batch ${batchNumber}/${totalBatches} (${batch.length} users)`);
      
      const { successCount, skipCount } = await importBatch(batch, passwordHash, i, allUsers.length);
      totalImported += successCount;
      totalSkipped += skipCount;

      // Delay between batches
      if (i + CONFIG.BATCH_SIZE < allUsers.length) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BATCHES_MS));
      }
    }

    console.log('\n\n✅ Import Complete!');
    console.log('==================');
    console.log(`  📊 Total Users: ${allUsers.length}`);
    console.log(`  ✅ Imported: ${totalImported}`);
    console.log(`  ⏭️ Skipped: ${totalSkipped}`);
    console.log(`  ❌ Errors: ${totalErrors}`);
    console.log(`  📈 Success Rate: ${(((totalImported) / allUsers.length) * 100).toFixed(1)}%`);

    // Final verification
    const finalBotCount = await prisma.user.count({ where: { isBot: true } });
    console.log(`\n🔍 Final bot user count in DB: ${finalBotCount}`);

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
