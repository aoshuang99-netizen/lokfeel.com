/**
 * fix-avatars-batch.ts
 * 
 * Fast batch avatar fix using raw SQL.
 * Links BotAvatar → Profile.avatar and generates DiceBear URLs for the rest.
 * 
 * Usage: npx tsx scripts/fix-avatars-batch.ts
 */

import 'dotenv/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('../src/generated/index.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg');

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl) throw new Error('DATABASE_URL required');
const adapter = new PrismaPg({ connectionString: databaseUrl.trim() });
const db = new PrismaClient({ adapter });

async function main() {
  console.log('🔧 Fast batch avatar fix...\n');

  // ─── Step 1: Link BotAvatar → Profile via raw SQL ──────────────
  console.log('📋 Step 1: Linking BotAvatars to Profiles (raw SQL)...');

  const linkResult = await db.$executeRawUnsafe(`
    UPDATE "Profile" p
    SET "avatar" = ba."processedUrl",
        "avatarType" = 'illustration'
    FROM "BotAvatar" ba
    WHERE p."userId" = ba."botId"
      AND ba."status" = 'active'
      AND ba."processedUrl" IS NOT NULL
      AND (p."avatar" IS NULL OR p."avatar" = '')
  `);

  console.log(`   ✅ Linked ${linkResult} profiles from BotAvatar.processedUrl`);

  // ─── Step 2: Link remaining BotAvatars via originalUrl ──────────
  console.log('\n📋 Step 2: Linking remaining BotAvatars (originalUrl)...');

  const linkResult2 = await db.$executeRawUnsafe(`
    UPDATE "Profile" p
    SET "avatar" = ba."originalUrl",
        "avatarType" = 'illustration'
    FROM "BotAvatar" ba
    WHERE p."userId" = ba."botId"
      AND ba."status" = 'active'
      AND (p."avatar" IS NULL OR p."avatar" = '')
  `);

  console.log(`   ✅ Linked ${linkResult2} profiles from BotAvatar.originalUrl`);

  // ─── Step 3: Generate DiceBear avatars for remaining profiles ───
  console.log('\n📋 Step 3: Generating avatars for remaining profiles...');

  // Count remaining
  const remaining = await db.profile.count({
    where: { OR: [{ avatar: null }, { avatar: '' }] },
  });
  console.log(`   Remaining profiles without avatar: ${remaining}`);

  if (remaining > 0) {
    // Batch update with DiceBear URLs based on gender and displayName
    // Female profiles
    const femaleUpdated = await db.$executeRawUnsafe(`
      UPDATE "Profile"
      SET "avatar" = 'https://api.dicebear.com/7.x/notionists/svg?seed=' || REPLACE("displayName", ' ', '%20') || '-FEMALE&backgroundColor=b6e3f4,c0aede,d1d4f9&size=256',
          "avatarType" = 'illustration'
      WHERE ("avatar" IS NULL OR "avatar" = '')
        AND "gender" = 'FEMALE'
        AND "displayName" IS NOT NULL
    `);
    console.log(`   ✅ Generated ${femaleUpdated} female avatars (notionists style)`);

    // Male profiles
    const maleUpdated = await db.$executeRawUnsafe(`
      UPDATE "Profile"
      SET "avatar" = 'https://api.dicebear.com/7.x/notionists/svg?seed=' || REPLACE("displayName", ' ', '%20') || '-MALE&backgroundColor=b6e3f4,c0aede,d1d4f9&size=256',
          "avatarType" = 'illustration'
      WHERE ("avatar" IS NULL OR "avatar" = '')
        AND "gender" = 'MALE'
        AND "displayName" IS NOT NULL
    `);
    console.log(`   ✅ Generated ${maleUpdated} male avatars (notionists style)`);

    // Other/null gender profiles
    const otherUpdated = await db.$executeRawUnsafe(`
      UPDATE "Profile"
      SET "avatar" = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' || REPLACE("displayName", ' ', '%20') || '&backgroundColor=b6e3f4,c0aede,d1d4f9&size=256',
          "avatarType" = 'illustration'
      WHERE ("avatar" IS NULL OR "avatar" = '')
        AND "displayName" IS NOT NULL
    `);
    console.log(`   ✅ Generated ${otherUpdated} other avatars (avataaars style)`);
  }

  // ─── Step 4: Verify ─────────────────────────────────────────────
  console.log('\n📋 Step 4: Verifying results...');

  const total = await db.profile.count();
  const withAvatar = await db.profile.count({
    where: { NOT: { OR: [{ avatar: null }, { avatar: '' }] } },
  });
  const stillMissing = total - withAvatar;

  console.log(`   Total profiles: ${total}`);
  console.log(`   ✅ With avatar: ${withAvatar} (${Math.round(withAvatar / total * 100)}%)`);
  console.log(`   ❌ Still missing: ${stillMissing}`);

  // Sample some fixed profiles
  const samples = await db.profile.findMany({
    where: { NOT: { avatar: null } },
    select: { displayName: true, avatar: true, avatarType: true, gender: true },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });
  console.log('\n📋 Sample profiles with avatars:');
  samples.forEach((p: any) => {
    const url = p.avatar?.substring(0, 80) || 'null';
    console.log(`   ${p.displayName} (${p.gender}) | ${p.avatarType} | ${url}...`);
  });

  await db.$disconnect();
  console.log('\n🎉 Done!');
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
