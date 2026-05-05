/**
 * LokFeel Bot User Import - Full 3500 Users (Optimized)
 * 
 * Uses @libsql/client directly for faster bulk inserts.
 * Skips Prisma overhead for better performance.
 * 
 * Usage: cd nexus-app && node scripts/import-bot-users-fast.mjs
 */

import { config } from 'dotenv';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const require = createRequire(import.meta.url);
const { createClient } = require('@libsql/client');

const turso = createClient({ 
  url: process.env.DATABASE_URL, 
  authToken: process.env.TURSO_AUTH_TOKEN 
});

const CONFIG = {
  BATCH_SIZE: 25,
  DEFAULT_PASSWORD: 'BotUser2026!Secure',
  DELAY_MS: 50,
};

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

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

async function importUser(botUser, passwordHash) {
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
    originalId: botUser.id,
    ageGroup: botUser.profile.ageGroup,
    region: botUser.profile.region,
    profession: botUser.profile.profession,
    interests: {
      mustHave: botUser.preferences.mustHaveInterests,
      niceToHave: botUser.preferences.niceToHaveInterests,
    },
    activityPattern: { dailyActiveHours: [18, 22], responseTimeMinutes: { min: 5, max: 120 }, messageFrequency: 'medium' },
    matchingPreferences: {
      preferredLocations: botUser.preferences.locationPreference,
      dealbreakers: botUser.preferences.dealbreakers,
      preferredAttachmentStyles: botUser.preferences.preferredAttachmentStyle,
      preferredCommunicationStyles: botUser.preferences.preferredCommunicationStyle,
      preferredConflictStyles: botUser.preferences.preferredConflictStyle,
    },
  });

  const gender = mapGender(botUser.gender);
  const preferredGender = botUser.gender === 'female' ? 'male' : 'female';
  const loveLanguage = Array.isArray(botUser.personality.loveLanguages) 
    ? botUser.personality.loveLanguages[0] 
    : botUser.personality.loveLanguages;
  const preferredLocation = botUser.preferences.locationPreference[0] || botUser.profile.city;

  // Generate UUID-like ID (cuid style - simplified)
  const userId = crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  // Insert User
  const userSql = `INSERT OR IGNORE INTO User (id, email, password, name, emailVerified, isBot, botType, botConfig) VALUES (
    ${escapeSql(userId)},
    ${escapeSql(email)},
    ${escapeSql(passwordHash)},
    ${escapeSql(botUser.profile.name)},
    ${escapeSql(new Date().toISOString())},
    1,
    ${escapeSql('simulation')},
    ${escapeSql(botConfig)}
  )`;
  
  try {
    const userResult = await turso.execute(userSql);
    if (userResult.rowsAffected === 0) {
      return { skipped: true };
    }
  } catch (e) {
    return { error: e.message, step: 'user', email };
  }

  // Insert Profile
  const profileSql = `INSERT OR IGNORE INTO Profile (id, userId, displayName, age, gender, genderIdentity, sexuality, bio, avatar, avatarType, city, country, relationshipGoal, attachmentStyle, communicationStyle, conflictResolution, loveLanguage, boundaries, dealbreakers, lifePriorities, emotionalAvailability, preferredAgeMin, preferredAgeMax, preferredGender, preferredDistance, preferredLocation, profileStatus, onboardingStep, isApproved, isVerified, personalityData) VALUES (
    ${escapeSql(crypto.randomUUID ? crypto.randomUUID() : 'p-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9))},
    ${escapeSql(userId)},
    ${escapeSql(botUser.profile.name)},
    ${botUser.profile.age},
    ${escapeSql(gender)},
    ${escapeSql(botUser.gender)},
    ${escapeSql('Straight')},
    ${escapeSql(botUser.profile.bio)},
    ${escapeSql(avatarUrl)},
    ${escapeSql(botUser.profile.avatarType === 'realistic' ? 'photo' : 'cartoon')},
    ${escapeSql(botUser.profile.city)},
    ${escapeSql(botUser.profile.country)},
    ${escapeSql(mapRelationshipGoal(botUser.preferences.relationshipGoal))},
    ${escapeSql(botUser.personality.attachmentStyle)},
    ${escapeSql(botUser.personality.communicationStyle)},
    ${escapeSql(botUser.personality.conflictStyle)},
    ${escapeSql(loveLanguage)},
    ${escapeSql('[]')},
    ${escapeSql(JSON.stringify(botUser.preferences.dealbreakers))},
    ${escapeSql(JSON.stringify(botUser.personality.lifePriorities))},
    ${escapeSql('Fully Available')},
    ${botUser.preferences.ageRangePreference.min},
    ${botUser.preferences.ageRangePreference.max},
    ${escapeSql(preferredGender)},
    100,
    ${escapeSql(preferredLocation)},
    ${escapeSql('APPROVED')},
    8,
    1,
    1,
    ${escapeSql(personalityData)}
  )`;

  try {
    await turso.execute(profileSql);
    return { success: true, email };
  } catch (e) {
    return { error: e.message, step: 'profile', email };
  }
}

async function main() {
  console.log('🚀 LokFeel Bot User Import - Fast Mode (Direct SQL)');
  console.log('====================================================\n');

  try {
    // Test connection
    await turso.execute('SELECT 1 as test');
    console.log('✅ Database connected!\n');

    // Count existing
    const existingResult = await turso.execute('SELECT COUNT(*) as count FROM User WHERE isBot = 1');
    const existingBots = Number(existingResult.rows[0].count);
    console.log(`ℹ️ Existing bot users: ${existingBots}\n`);

    // Load data
    console.log('📂 Loading user data...');
    const dataDir = path.join(__dirname, '..', '..');
    const femaleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'female-users.json'), 'utf-8'));
    const maleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'male-users.json'), 'utf-8'));
    const allUsers = [...femaleData.users, ...maleData.users];
    console.log(`  ✅ ${femaleData.users.length} female + ${maleData.users.length} male = ${allUsers.length} total\n`);

    // Generate password hash
    console.log('🔐 Generating password hash...');
    const passwordHash = await bcrypt.hash(CONFIG.DEFAULT_PASSWORD, 10);
    console.log('  ✅ Ready\n');

    // Import
    console.log('📥 Starting import...\n');
    let totalImported = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (let i = 0; i < allUsers.length; i += CONFIG.BATCH_SIZE) {
      const batch = allUsers.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allUsers.length / CONFIG.BATCH_SIZE);

      const results = await Promise.all(batch.map(user => importUser(user, passwordHash)));
      
      for (const r of results) {
        if (r.success) totalImported++;
        else if (r.skipped) totalSkipped++;
        else if (r.error) {
          totalErrors++;
          if (totalErrors <= 5) console.error(`  ❌ ${r.email}: ${r.error} (${r.step})`);
        }
      }

      process.stdout.write(`\r  📊 Batch ${batchNum}/${totalBatches} | Progress: ${Math.min(i + CONFIG.BATCH_SIZE, allUsers.length)}/${allUsers.length} | ✅${totalImported} ⏭️${totalSkipped} ❌${totalErrors}`);

      if (i + CONFIG.BATCH_SIZE < allUsers.length) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_MS));
      }
    }

    // Final count
    const finalResult = await turso.execute('SELECT COUNT(*) as count FROM User WHERE isBot = 1');
    const finalCount = Number(finalResult.rows[0].count);

    console.log(`\n\n✅ Import Complete!`);
    console.log(`  📊 Total in file: ${allUsers.length}`);
    console.log(`  ✅ Imported: ${totalImported}`);
    console.log(`  ⏭️ Skipped: ${totalSkipped}`);
    console.log(`  ❌ Errors: ${totalErrors}`);
    console.log(`  🗄️ Total bot users in DB: ${finalCount}`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await turso.close();
  }
}

main();
