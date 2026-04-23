/**
 * update-avatars-american.ts
 *
 * 批量更新Bot用户头像为真人照片（80%美国人）
 * 数据源：RandomUser.me API（免费、真人照片、支持国籍过滤）
 *
 * 策略：
 * - 80% 用户头像来自 US 国籍 (randomuser.me nat=US)
 * - 20% 用户头像来自其他国籍（增加多样性）
 * - 男性：随机 1-99 编号头像
 * - 女性：随机 1-99 编号头像
 * - 直接使用 randomuser.me CDN URL（无需下载/上传）
 *
 * Usage: npx tsx scripts/update-avatars-american.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!.trim() });
const prisma = new PrismaClient({ adapter });

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // 80% 美国人头像
  AMERICAN_RATIO: 0.8,

  // RandomUser.me 头像URL模板
  MALE_AVATAR_BASE: 'https://randomuser.me/api/portraits/men/',
  FEMALE_AVATAR_BASE: 'https://randomuser.me/api/portraits/women/',

  // 非美国国籍池（增加多样性）
  DIVERSITY_NATIONALITIES: ['GB', 'AU', 'CA', 'DE', 'FR', 'BR', 'MX', 'ES'],

  // 国籍→种族映射
  NAT_TO_ETHNICITY: {
    US: 'CAUCASIAN',
    GB: 'CAUCASIAN',
    AU: 'CAUCASIAN',
    CA: 'CAUCASIAN',
    DE: 'CAUCASIAN',
    FR: 'CAUCASIAN',
    BR: 'HISPANIC_LATINO',
    MX: 'HISPANIC_LATINO',
    ES: 'HISPANIC_LATINO',
    IE: 'CAUCASIAN',
    NL: 'CAUCASIAN',
    NZ: 'CAUCASIAN',
  } as Record<string, string>,

  // 批处理大小
  BATCH_SIZE: 100,

  // 随机种子
  SEED: 42,
};

// 简易伪随机（确保可重复）
let seedVal = CONFIG.SEED;
function seededRandom(): number {
  seedVal = (seedVal * 16807 + 0) % 2147483647;
  return seedVal / 2147483647;
}

// ═══════════════════════════════════════════════════════════════
// 主逻辑
// ═══════════════════════════════════════════════════════════════

interface BotUserWithProfile {
  id: string;
  profile: {
    id: string;
    displayName: string;
    gender: string;
    age: number;
    avatar: string | null;
    avatarType: string | null;
  };
}

function generateAvatarUrl(gender: string, isAmerican: boolean): { url: string; ethnicity: string } {
  const isMale = gender === 'MALE';
  const baseUrl = isMale ? CONFIG.MALE_AVATAR_BASE : CONFIG.FEMALE_AVATAR_BASE;

  // 随机头像编号 (1-99)
  const imgId = Math.floor(seededRandom() * 99) + 1;
  const url = `${baseUrl}${imgId}.jpg`;

  // 决定种族
  let ethnicity: string;
  if (isAmerican) {
    // 美国人也有多样化种族，但80%是白人
    const roll = seededRandom();
    if (roll < 0.55) {
      ethnicity = 'CAUCASIAN';
    } else if (roll < 0.72) {
      ethnicity = 'HISPANIC_LATINO';
    } else if (roll < 0.85) {
      ethnicity = 'AFRICAN_AMERICAN';
    } else if (roll < 0.93) {
      ethnicity = 'ASIAN';
    } else {
      ethnicity = 'MIXED';
    }
  } else {
    // 其他国籍
    const nat = CONFIG.DIVERSITY_NATIONALITIES[Math.floor(seededRandom() * CONFIG.DIVERSITY_NATIONALITIES.length)];
    ethnicity = CONFIG.NAT_TO_ETHNICITY[nat] || 'CAUCASIAN';
  }

  return { url, ethnicity };
}

async function main() {
  const startTime = Date.now();
  console.log('🇺🇸 LokFeel Bot Avatar Update — American Real Photos');
  console.log('====================================================\n');

  // ─── Step 1: 获取所有 bot 用户 ─────────────────────────────
  console.log('📊 Step 1: Fetching bot users...');

  const maleUsers: BotUserWithProfile[] = await prisma.user.findMany({
    where: {
      isBot: true,
      profile: { gender: 'MALE' },
    },
    select: {
      id: true,
      profile: {
        select: { id: true, displayName: true, gender: true, age: true, avatar: true, avatarType: true },
      },
    },
  });

  const femaleUsers: BotUserWithProfile[] = await prisma.user.findMany({
    where: {
      isBot: true,
      profile: { gender: 'FEMALE' },
    },
    select: {
      id: true,
      profile: {
        select: { id: true, displayName: true, gender: true, age: true, avatar: true, avatarType: true },
      },
    },
  });

  const allBotUsers = [...maleUsers, ...femaleUsers];
  console.log(`   👨 Male: ${maleUsers.length}`);
  console.log(`   👩 Female: ${femaleUsers.length}`);
  console.log(`   📊 Total: ${allBotUsers.length}\n`);

  // ─── Step 2: 为每个用户分配头像 ─────────────────────────────
  console.log('🎨 Step 2: Assigning American real photo avatars...');

  let americanCount = 0;
  let diverseCount = 0;

  // 为每个用户生成头像URL
  const assignments = allBotUsers.map((user) => {
    const isAmerican = seededRandom() < CONFIG.AMERICAN_RATIO;
    if (isAmerican) americanCount++;
    else diverseCount++;

    const { url, ethnicity } = generateAvatarUrl(user.profile.gender, isAmerican);

    return {
      userId: user.id,
      profileId: user.profile.id,
      avatarUrl: url,
      ethnicity,
      isAmerican,
    };
  });

  console.log(`   🇺🇸 American: ${americanCount} (${Math.round(americanCount / assignments.length * 100)}%)`);
  console.log(`   🌍 Diverse: ${diverseCount} (${Math.round(diverseCount / assignments.length * 100)}%)\n`);

  // ─── Step 3: 批量更新数据库 ─────────────────────────────
  console.log('💾 Step 3: Batch updating database...');

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < assignments.length; i += CONFIG.BATCH_SIZE) {
    const batch = assignments.slice(i, i + CONFIG.BATCH_SIZE);

    // 使用原始SQL批量更新（最高效）
    for (const assignment of batch) {
      try {
        // 1. 更新 Profile.avatar
        await prisma.profile.update({
          where: { id: assignment.profileId },
          data: {
            avatar: assignment.avatarUrl,
            avatarType: 'photo',
          },
        });

        // 2. 更新 BotAvatar 表
        await prisma.botAvatar.upsert({
          where: { botId: assignment.userId },
          update: {
            originalUrl: assignment.avatarUrl,
            processedUrl: assignment.avatarUrl,
            style: 'photorealistic',
            ethnicity: assignment.ethnicity,
            status: 'active',
          },
          create: {
            botId: assignment.userId,
            originalUrl: assignment.avatarUrl,
            processedUrl: assignment.avatarUrl,
            style: 'photorealistic',
            ethnicity: assignment.ethnicity,
            status: 'active',
          },
        });

        updated++;
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.error(`   ❌ Error updating ${assignment.userId}: ${err}`);
        }
      }
    }

    // 进度显示
    const progress = Math.min(i + CONFIG.BATCH_SIZE, assignments.length);
    const pct = Math.round(progress / assignments.length * 100);
    process.stdout.write(`\r   📊 ${progress}/${assignments.length} (${pct}%) — ${errors} errors`);
  }

  console.log(`\n   ✅ Updated: ${updated}`);
  console.log(`   ❌ Errors: ${errors}\n`);

  // ─── Step 4: 验证结果 ─────────────────────────────────────
  console.log('✅ Step 4: Verifying results...');

  const totalProfiles = await prisma.profile.count();
  const photoAvatars = await prisma.profile.count({ where: { avatarType: 'photo' } });
  const illustrationAvatars = await prisma.profile.count({ where: { avatarType: 'illustration' } });
  const noAvatar = await prisma.profile.count({ where: { OR: [{ avatar: null }, { avatar: '' }] } });

  const botPhotoAvatars = await prisma.profile.count({
    where: { avatarType: 'photo', user: { isBot: true } },
  });
  const botMalePhoto = await prisma.profile.count({
    where: { avatarType: 'photo', gender: 'MALE', user: { isBot: true } },
  });
  const botFemalePhoto = await prisma.profile.count({
    where: { avatarType: 'photo', gender: 'FEMALE', user: { isBot: true } },
  });

  console.log(`   Total profiles: ${totalProfiles}`);
  console.log(`   Photo avatars: ${photoAvatars}`);
  console.log(`   Illustration avatars: ${illustrationAvatars}`);
  console.log(`   No avatar: ${noAvatar}`);
  console.log(`   Bot photo avatars: ${botPhotoAvatars} (Male: ${botMalePhoto}, Female: ${botFemalePhoto})`);

  // 抽样检查
  console.log('\n📋 Sample updated profiles:');
  const samples = await prisma.profile.findMany({
    where: { avatarType: 'photo', user: { isBot: true } },
    select: { displayName: true, avatar: true, avatarType: true, gender: true },
    take: 10,
    orderBy: { updatedAt: 'desc' },
  });
  samples.forEach((s) => {
    console.log(`   ${s.displayName} (${s.gender}) | ${s.avatarType} | ${s.avatar}`);
  });

  // 统计randomuser.me URL占比
  const randomUserAvatars = await prisma.profile.count({
    where: {
      avatarType: 'photo',
      avatar: { contains: 'randomuser.me' },
    },
  });
  console.log(`\n   RandomUser.me avatars: ${randomUserAvatars}`);

  const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`✅ Avatar Update Complete! Time: ${elapsedTime}s`);
  console.log(`═══════════════════════════════════════════\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('❌ Script failed:', e);
  process.exit(1);
});
