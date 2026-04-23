/**
 * fix-avatars.ts
 * 
 * Fixes the broken link between BotAvatar and Profile.avatar
 * 
 * Problem: 7,006 out of 7,016 profiles have avatar=null, but BotAvatar table
 * has 7,500 active avatar records. The seed script created BotAvatars but
 * never wrote them back to Profile.avatar.
 * 
 * This script:
 * 1. Links BotAvatar.processedUrl/originalUrl → Profile.avatar
 * 2. For "realistic" type users without BotAvatar, generates DiceBear avatars
 * 3. Upgrades all avatars to higher resolution versions
 * 
 * Usage: npx tsx scripts/fix-avatars.ts
 */

import 'dotenv/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('../src/generated/index.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg');

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}
const adapter = new PrismaPg({ connectionString: databaseUrl.trim() });
const db = new PrismaClient({ adapter });

// ─── Avatar Style Mapping (for generating high-quality avatars) ──────────

const FEMALE_AVATAR_STYLES = [
  'avataaars',    // Cartoon style
  'notionists',   // Professional illustration
  'lorelei',      // Elegant feminine
  'big-smile',    // Friendly smile
  'bottts',       // Abstract/unique
];

const MALE_AVATAR_STYLES = [
  'avataaars',
  'notionists',
  'big-smile',
  'bottts',
  'micah',
];

const BG_COLORS_FEMALE = 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';
const BG_COLORS_MALE = 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';

function generateHighResAvatarUrl(name: string, gender: string, index: number): string {
  const isFemale = gender?.toUpperCase() === 'FEMALE';
  const styles = isFemale ? FEMALE_AVATAR_STYLES : MALE_AVATAR_STYLES;
  const style = styles[index % styles.length];
  const bgColor = isFemale ? BG_COLORS_FEMALE : BG_COLORS_MALE;
  const seed = encodeURIComponent(`${name}-${gender}`);
  
  // Use larger size (256x256) for better quality
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}&backgroundColor=${bgColor}&size=256`;
}

async function main() {
  console.log('🔧 Fixing avatars for all profiles...\n');

  // ─── Step 1: Link BotAvatar → Profile ───────────────────────────────
  console.log('📋 Step 1: Linking existing BotAvatars to Profiles...');

  const botAvatars = await db.botAvatar.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      botId: true,
      originalUrl: true,
      processedUrl: true,
      style: true,
    },
  });

  console.log(`   Found ${botAvatars.length} active BotAvatars`);

  // Build botId → avatar URL map
  const avatarMap = new Map<string, string>();
  for (const ba of botAvatars) {
    if (ba.botId && !avatarMap.has(ba.botId)) {
      // Prefer processedUrl (higher quality), fallback to originalUrl
      avatarMap.set(ba.botId, ba.processedUrl || ba.originalUrl);
    }
  }
  console.log(`   Mapped ${avatarMap.size} unique bot IDs to avatar URLs`);

  // ─── Step 2: Get all profiles needing avatar fix ────────────────────
  console.log('\n📋 Step 2: Finding profiles without avatars...');

  const profilesWithoutAvatar = await db.profile.findMany({
    where: {
      OR: [{ avatar: null }, { avatar: '' }],
    },
    select: {
      id: true,
      displayName: true,
      gender: true,
      avatarType: true,
      userId: true,
    },
  });

  console.log(`   Found ${profilesWithoutAvatar.length} profiles without avatar`);

  // ─── Step 3: Fix avatars ─────────────────────────────────────────────
  console.log('\n📋 Step 3: Writing avatar URLs to profiles...');

  let fixed = 0;
  let generated = 0;
  const batchSize = 50;

  for (let i = 0; i < profilesWithoutAvatar.length; i += batchSize) {
    const batch = profilesWithoutAvatar.slice(i, i + batchSize);

    for (const profile of batch) {
      let avatarUrl: string | null = null;

      // Try to find avatar from BotAvatar via userId
      if (profile.userId && avatarMap.has(profile.userId)) {
        avatarUrl = avatarMap.get(profile.userId)!;
        fixed++;
      } else {
        // Generate a new high-quality avatar
        avatarUrl = generateHighResAvatarUrl(
          profile.displayName || 'User',
          profile.gender || 'OTHER',
          i
        );
        generated++;
      }

      // Determine avatarType based on the URL
      let avatarType = profile.avatarType;
      if (!avatarType || avatarType === 'NULL') {
        if (avatarUrl?.includes('avataaars') || avatarUrl?.includes('notionists')) {
          avatarType = 'illustration';
        } else if (avatarUrl?.includes('lorelei') || avatarUrl?.includes('big-smile')) {
          avatarType = 'realistic';
        } else {
          avatarType = 'generated';
        }
      }

      await db.profile.update({
        where: { id: profile.id },
        data: {
          avatar: avatarUrl,
          avatarType: avatarType,
        },
      });
    }

    if ((i + batchSize) % 500 === 0 || i + batchSize >= profilesWithoutAvatar.length) {
      console.log(`   Processed ${Math.min(i + batchSize, profilesWithoutAvatar.length)}/${profilesWithoutAvatar.length} profiles...`);
    }
  }

  console.log(`\n✅ Avatar fix complete!`);
  console.log(`   Linked from BotAvatar: ${fixed}`);
  console.log(`   Generated new: ${generated}`);
  console.log(`   Total fixed: ${fixed + generated}`);

  // ─── Step 4: Verify ─────────────────────────────────────────────────
  console.log('\n📋 Step 4: Verifying...');

  const remaining = await db.profile.count({
    where: { OR: [{ avatar: null }, { avatar: '' }] },
  });
  const total = await db.profile.count();
  const withAvatar = total - remaining;

  console.log(`   Total profiles: ${total}`);
  console.log(`   With avatar: ${withAvatar} (${Math.round(withAvatar / total * 100)}%)`);
  console.log(`   Without avatar: ${remaining}`);

  // Avatar type distribution after fix
  const typeStats = await db.profile.findMany({
    select: { avatarType: true },
  });
  const typeCounts: Record<string, number> = {};
  typeStats.forEach(p => {
    const t = p.avatarType || 'NULL';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  console.log('\n   Avatar Type Distribution:');
  Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`   ${k}: ${v}`);
  });

  await db.$disconnect();
  console.log('\n🎉 Done!');
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
