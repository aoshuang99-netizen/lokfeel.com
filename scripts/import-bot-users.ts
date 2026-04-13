/**
 * LokFeel Digital User Import Script
 * 
 * 将3500个数字用户导入数据库
 * - Female: 1000 users (female-users.json)
 * - Male: 2500 users (male-users.json)
 * 
 * Usage: npx ts-node scripts/import-bot-users.ts
 */

import 'dotenv/config'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('../src/generated/index.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg')
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// Types based on JSON structure
interface BotUser {
  id: string;
  gender: 'female' | 'male';
  profile: {
    name: string;
    firstName: string;
    lastName: string;
    age: number;
    ageGroup: string;
    birthDate: string;
    city: string;
    country: string;
    region: string;
    profession: string;
    bio: string;
    avatarType: 'cartoon' | 'realistic';
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
    locationPreference: string[];
    mustHaveInterests: string[];
    niceToHaveInterests: string[];
    dealbreakers: string[];
    preferredAttachmentStyle: string[];
    preferredCommunicationStyle: string[];
    preferredConflictStyle: string[];
  };
}

interface UserDataFile {
  users: BotUser[];
}

// Configuration
const CONFIG = {
  BATCH_SIZE: 50, // 每批导入数量
  PASSWORD_SALT_ROUNDS: 10,
  BOT_EMAIL_DOMAIN: 'lokfeel.bot',
  DEFAULT_PASSWORD: 'BotUser2026!Secure',
};

/**
 * Generate bot user email
 */
function generateBotEmail(userId: string): string {
  return `bot-${userId.toLowerCase()}@${CONFIG.BOT_EMAIL_DOMAIN}`;
}

/**
 * Map relationship goal string to enum
 */
function mapRelationshipGoal(goal: string): string {
  const goalMap: Record<string, string> = {
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

/**
 * Map gender string to enum
 */
function mapGender(gender: string): string {
  return gender === 'female' ? 'FEMALE' : 'MALE';
}

/**
 * Generate avatar URL based on gender and type
 */
function generateAvatarUrl(gender: string, avatarType: string, userId: string): string {
  // Use DiceBear API for consistent avatar generation
  const style = avatarType === 'cartoon' ? 'avataaars' : 'notionists';
  const seed = `${userId}-${gender}`;
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

/**
 * Transform bot user data to Prisma format
 */
async function transformBotUser(botUser: BotUser, passwordHash: string) {
  const email = generateBotEmail(botUser.id);
  const avatarUrl = generateAvatarUrl(botUser.gender, botUser.profile.avatarType, botUser.id);
  
  // Build personality data JSON
  const personalityData = {
    attachmentStyle: botUser.personality.attachmentStyle,
    communicationStyle: botUser.personality.communicationStyle,
    conflictStyle: botUser.personality.conflictStyle,
    loveLanguages: botUser.personality.loveLanguages,
    lifePriorities: botUser.personality.lifePriorities,
    personalityTraits: botUser.personality.personalityTraits,
  };

  // Build bot config
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
      dailyActiveHours: [18, 22], // 6PM - 10PM
      responseTimeMinutes: { min: 5, max: 120 },
      messageFrequency: 'medium', // low, medium, high
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
      sexuality: 'Straight', // Default, can be customized
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
      onboardingStep: 8, // Completed
      isApproved: true,
      isVerified: true,
      personalityData: JSON.stringify(personalityData),
    },
  };
}

/**
 * Import a batch of bot users
 */
async function importBatch(
  botUsers: BotUser[],
  passwordHash: string,
  startIndex: number,
  totalCount: number
): Promise<number> {
  const results = await Promise.all(
    botUsers.map(async (botUser, idx) => {
      const data = await transformBotUser(botUser, passwordHash);
      
      try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: data.user.email },
        });

        if (existingUser) {
          console.log(`  ⚠️ User ${botUser.id} already exists, skipping...`);
          return { success: false, skipped: true };
        }

        // Create user with profile
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
        console.error(`\n  ❌ Error importing ${botUser.id}:`, error);
        return { success: false, skipped: false, error };
      }
    })
  );

  const successCount = results.filter(r => r.success).length;
  const skipCount = results.filter(r => r.skipped).length;
  
  return successCount;
}

/**
 * Main import function
 */
async function main() {
  console.log('🚀 LokFeel Bot User Import Script');
  console.log('=================================\n');

  try {
    // Load user data
    console.log('📂 Loading user data files...');
    const femaleData: UserDataFile = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), '..', 'female-users.json'), 'utf-8')
    );
    const maleData: UserDataFile = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), '..', 'male-users.json'), 'utf-8')
    );

    const allUsers = [...femaleData.users, ...maleData.users];
    console.log(`  ✅ Loaded ${femaleData.users.length} female users`);
    console.log(`  ✅ Loaded ${maleData.users.length} male users`);
    console.log(`  📊 Total: ${allUsers.length} users\n`);

    // Generate password hash (same for all bot users for simplicity)
    console.log('🔐 Generating password hash...');
    const passwordHash = await bcrypt.hash(CONFIG.DEFAULT_PASSWORD, CONFIG.PASSWORD_SALT_ROUNDS);
    console.log('  ✅ Password hash ready\n');

    // Import users in batches
    console.log('📥 Starting import...\n');
    let totalImported = 0;
    let totalSkipped = 0;

    for (let i = 0; i < allUsers.length; i += CONFIG.BATCH_SIZE) {
      const batch = allUsers.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNumber = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allUsers.length / CONFIG.BATCH_SIZE);

      console.log(`\n📝 Batch ${batchNumber}/${totalBatches} (${batch.length} users)`);
      
      const imported = await importBatch(batch, passwordHash, i, allUsers.length);
      totalImported += imported;

      // Small delay between batches to avoid overwhelming the database
      if (i + CONFIG.BATCH_SIZE < allUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('\n\n✅ Import Complete!');
    console.log('==================');
    console.log(`  📊 Total Users: ${allUsers.length}`);
    console.log(`  ✅ Imported: ${totalImported}`);
    console.log(`  ⏭️ Skipped: ${allUsers.length - totalImported}`);
    console.log(`  📈 Success Rate: ${((totalImported / allUsers.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main();
