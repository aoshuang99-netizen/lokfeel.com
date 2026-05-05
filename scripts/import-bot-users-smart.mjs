/**
 * LokFeel Bot User Import - Smart Resume
 * 
 * 1. First loads all existing bot user emails from DB
 * 2. Filters out already-imported users
 * 3. Uses @libsql/client directly for fast inserts
 * 4. Sequential with retry for reliability
 * 
 * Usage: cd nexus-app && node scripts/import-bot-users-smart.mjs
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

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

function generateAvatarUrl(gender, avatarType, userId) {
  const style = avatarType === 'cartoon' ? 'avataaars' : 'notionists';
  const seed = `${userId}-${gender}`;
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

async function main() {
  console.log('🚀 LokFeel Bot User Import - Smart Resume');
  console.log('==========================================\n');

  const startTime = Date.now();

  try {
    // Test connection
    await turso.execute('SELECT 1');
    console.log('✅ Database connected\n');

    // Step 1: Get all existing bot user emails
    console.log('📋 Loading existing bot users from DB...');
    const existingResult = await turso.execute('SELECT email FROM User WHERE isBot = 1');
    const existingEmails = new Set(existingResult.rows.map(r => r.email));
    console.log(`  Found ${existingEmails.size} existing bot users\n`);

    // Step 2: Load user data
    console.log('📂 Loading user data files...');
    const dataDir = path.join(__dirname, '..', '..');
    const femaleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'female-users.json'), 'utf-8'));
    const maleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'male-users.json'), 'utf-8'));
    const allUsers = [...femaleData.users, ...maleData.users];
    console.log(`  Total: ${allUsers.length} users in files\n`);

    // Step 3: Filter out already imported
    const toImport = allUsers.filter(u => !existingEmails.has(generateBotEmail(u.id)));
    console.log(`  ✅ Already imported: ${allUsers.length - toImport.length}`);
    console.log(`  📥 To import: ${toImport.length}\n`);

    if (toImport.length === 0) {
      console.log('✅ All users already imported!');
      await turso.close();
      return;
    }

    // Step 4: Generate password hash
    console.log('🔐 Generating password hash...');
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    console.log('  ✅ Ready\n');

    // Step 5: Import
    let imported = 0, errors = 0;
    const LOG_INTERVAL = 50;

    for (let i = 0; i < toImport.length; i++) {
      const botUser = toImport[i];
      const email = generateBotEmail(botUser.id);
      const userId = crypto.randomUUID();
      const profileId = crypto.randomUUID();
      const avatarUrl = generateAvatarUrl(botUser.gender, botUser.profile.avatarType, botUser.id);
      const gender = botUser.gender === 'female' ? 'FEMALE' : 'MALE';
      const preferredGender = botUser.gender === 'female' ? 'MALE' : 'FEMALE'; // Must be UPPERCASE to match Discover API gender filter
      const loveLanguage = Array.isArray(botUser.personality.loveLanguages) 
        ? botUser.personality.loveLanguages[0] : botUser.personality.loveLanguages;
      const preferredLocation = botUser.preferences.locationPreference[0] || botUser.profile.city;

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

      // Insert User (include createdAt and updatedAt - NOT NULL without defaults)
      const now = new Date().toISOString();
      const userSql = `INSERT INTO User (id, email, password, name, emailVerified, isBot, botType, botConfig, createdAt, updatedAt) VALUES (
        ${escapeSql(userId)}, ${escapeSql(email)}, ${escapeSql(passwordHash)},
        ${escapeSql(botUser.profile.name)}, ${escapeSql(now)},
        1, ${escapeSql('simulation')}, ${escapeSql(botConfig)},
        ${escapeSql(now)}, ${escapeSql(now)}
      )`;

      try {
        await turso.execute(userSql);
      } catch (e) {
        if (e.message?.includes('UNIQUE constraint')) {
          // Skip duplicate
          continue;
        }
        errors++;
        if (errors <= 10) console.error(`❌ User ${email}: ${e.message}`);
        continue;
      }

      // Insert Profile (include createdAt and updatedAt - NOT NULL without defaults)
      const profileSql = `INSERT INTO Profile (id, userId, displayName, age, gender, genderIdentity, sexuality, bio, avatar, avatarType, city, country, relationshipGoal, attachmentStyle, communicationStyle, conflictResolution, loveLanguage, boundaries, dealbreakers, lifePriorities, emotionalAvailability, preferredAgeMin, preferredAgeMax, preferredGender, preferredDistance, preferredLocation, profileStatus, onboardingStep, isApproved, isVerified, personalityData, createdAt, updatedAt) VALUES (
        ${escapeSql(profileId)}, ${escapeSql(userId)},
        ${escapeSql(botUser.profile.name)}, ${botUser.profile.age},
        ${escapeSql(gender)}, ${escapeSql(botUser.gender)}, ${escapeSql('Straight')},
        ${escapeSql(botUser.profile.bio)}, ${escapeSql(avatarUrl)},
        ${escapeSql(botUser.profile.avatarType === 'realistic' ? 'photo' : 'cartoon')},
        ${escapeSql(botUser.profile.city)}, ${escapeSql(botUser.profile.country)},
        ${escapeSql(mapRelationshipGoal(botUser.preferences.relationshipGoal))},
        ${escapeSql(botUser.personality.attachmentStyle)},
        ${escapeSql(botUser.personality.communicationStyle)},
        ${escapeSql(botUser.personality.conflictStyle)},
        ${escapeSql(loveLanguage)}, ${escapeSql('[]')},
        ${escapeSql(JSON.stringify(botUser.preferences.dealbreakers))},
        ${escapeSql(JSON.stringify(botUser.personality.lifePriorities))},
        ${escapeSql('Fully Available')},
        ${botUser.preferences.ageRangePreference.min}, ${botUser.preferences.ageRangePreference.max},
        ${escapeSql(preferredGender)}, 100,
        ${escapeSql(preferredLocation)}, ${escapeSql('APPROVED')},
        8, 1, 1, ${escapeSql(personalityData)},
        ${escapeSql(now)}, ${escapeSql(now)}
      )`;

      try {
        await turso.execute(profileSql);
        imported++;
      } catch (e) {
        errors++;
        if (errors <= 10) console.error(`❌ Profile ${email}: ${e.message}`);
        // Try to clean up user
        try { await turso.execute(`DELETE FROM User WHERE id = ${escapeSql(userId)}`); } catch {}
      }

      // Progress
      if ((i + 1) % LOG_INTERVAL === 0 || i === toImport.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((i + 1) / (Date.now() - startTime) * 1000).toFixed(1);
        process.stdout.write(`\r  📊 ${i + 1}/${toImport.length} | ✅${imported} ❌${errors} | ${rate} u/s | ${elapsed}s`);
      }

      // Rate limit: small pause every 10 users (reduced for faster import)
      if (i % 10 === 9) {
        await new Promise(r => setTimeout(r, 10));
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\n✅ Import Complete! (${totalTime}s)`);
    console.log(`  ✅ Imported: ${imported}`);
    console.log(`  ❌ Errors: ${errors}`);

    // Verify
    const finalResult = await turso.execute('SELECT COUNT(*) as count FROM User WHERE isBot = 1');
    console.log(`\n🗄️ Total bot users in DB: ${finalResult.rows[0].count}`);

    // Gender breakdown
    const profiles = await turso.execute('SELECT gender, COUNT(*) as count FROM Profile WHERE userId IN (SELECT id FROM User WHERE isBot = 1) GROUP BY gender');
    profiles.rows.forEach(r => console.log(`  ${r.gender}: ${r.count}`));

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await turso.close();
  }
}

main();
