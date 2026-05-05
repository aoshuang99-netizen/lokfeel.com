/**
 * Fix 3 Bot Users Missing Profiles
 * - bot-f00927@lokfeel.bot (Ella Scott)
 * - bot-m01571@lokfeel.bot (Anthony Williams)
 * - bot-m01964@lokfeel.bot (Nathan Jackson)
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const require = createRequire(import.meta.url);
const { createClient } = require('@libsql/client');

const turso = createClient({ 
  url: process.env.DATABASE_URL, 
  authToken: process.env.TURSO_AUTH_TOKEN 
});

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
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

function generateAvatarUrl(gender, userId) {
  const style = 'notionists';
  const seed = `${userId}-${gender}`;
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

async function main() {
  console.log('=== Fix Missing Bot User Profiles ===\n');

  // Load user data files to find the missing users
  const dataDir = path.join(__dirname, '..', '..');
  const femaleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'female-users.json'), 'utf-8'));
  const maleData = JSON.parse(fs.readFileSync(path.join(dataDir, 'male-users.json'), 'utf-8'));

  const missingEmails = ['bot-f00927@lokfeel.bot', 'bot-m01571@lokfeel.bot', 'bot-m01964@lokfeel.bot'];
  const missingIds = ['F00927', 'M01571', 'M01964'];

  for (const missingId of missingIds) {
    const isFemale = missingId.startsWith('F');
    const dataSource = isFemale ? femaleData.users : maleData.users;
    const botUser = dataSource.find(u => u.id === missingId);

    if (!botUser) {
      console.log(`  ❌ User ${missingId} not found in data files, creating generic profile...`);
      continue;
    }

    // Find the user in DB
    const email = `bot-${missingId.toLowerCase()}@lokfeel.bot`;
    const userResult = await turso.execute(`SELECT id, email, name FROM User WHERE email = ${escapeSql(email)}`);
    
    if (userResult.rows.length === 0) {
      console.log(`  ❌ User ${email} not found in DB`);
      continue;
    }

    const userId = userResult.rows[0].id;
    const profileId = crypto.randomUUID();
    const avatarUrl = generateAvatarUrl(botUser.gender, botUser.id);
    const gender = botUser.gender === 'female' ? 'FEMALE' : 'MALE';
    const preferredGender = botUser.gender === 'female' ? 'MALE' : 'FEMALE';
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

    const now = new Date().toISOString();
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
      console.log(`  ✅ Created profile for ${email}: ${botUser.profile.name}, ${botUser.profile.age}, ${gender}, ${botUser.profile.city}`);
    } catch (e) {
      console.error(`  ❌ Failed to create profile for ${email}: ${e.message}`);
    }
  }

  // Verify
  const missingAfter = await turso.execute(`
    SELECT u.id, u.email FROM User u 
    LEFT JOIN Profile p ON u.id = p.userId 
    WHERE u.isBot = 1 AND p.id IS NULL
  `);
  console.log(`\nRemaining bot users without profiles: ${missingAfter.rows.length}`);

  await turso.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
