/**
 * update-avatars-fast.ts
 *
 * 高效批量更新：直接用SQL一次性将所有bot用户头像更新为真人照片
 * 使用 RandomUser.me CDN URL（无需下载）
 * 80%美国人头像策略
 *
 * Usage: npx tsx scripts/update-avatars-fast.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!.trim() });
const prisma = new PrismaClient({ adapter });

// 伪随机生成器（可重复）
let seed = 42;
function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

async function main() {
  const startTime = Date.now();
  console.log('🚀 LokFeel Fast Avatar Update — American Real Photos');
  console.log('====================================================\n');

  // Step 1: 获取所有bot用户
  console.log('📊 Step 1: Fetching bot users...');
  const botUsers = await prisma.user.findMany({
    where: { isBot: true },
    select: {
      id: true,
      profile: {
        select: { id: true, gender: true },
      },
    },
  });

  const maleCount = botUsers.filter(u => u.profile?.gender === 'MALE').length;
  const femaleCount = botUsers.filter(u => u.profile?.gender === 'FEMALE').length;
  console.log(`   Total: ${botUsers.length} (Male: ${maleCount}, Female: ${femaleCount})\n`);

  // Step 2: 生成头像URL映射
  console.log('🎨 Step 2: Generating avatar assignments...');
  const assignments: { userId: string; profileId: string; avatarUrl: string; ethnicity: string }[] = [];
  let americanCount = 0;

  for (const user of botUsers) {
    if (!user.profile) continue;
    const isMale = user.profile.gender === 'MALE';
    const isAmerican = rand() < 0.8;
    if (isAmerican) americanCount++;

    const imgId = randInt(1, 99);
    const baseUrl = isMale
      ? 'https://randomuser.me/api/portraits/men/'
      : 'https://randomuser.me/api/portraits/women/';
    const avatarUrl = `${baseUrl}${imgId}.jpg`;

    // 种族分配
    let ethnicity: string;
    if (isAmerican) {
      const r = rand();
      if (r < 0.55) ethnicity = 'CAUCASIAN';
      else if (r < 0.72) ethnicity = 'HISPANIC_LATINO';
      else if (r < 0.85) ethnicity = 'AFRICAN_AMERICAN';
      else if (r < 0.93) ethnicity = 'ASIAN';
      else ethnicity = 'MIXED';
    } else {
      const nats = ['CAUCASIAN', 'CAUCASIAN', 'HISPANIC_LATINO', 'ASIAN', 'CAUCASIAN'];
      ethnicity = nats[randInt(0, nats.length - 1)];
    }

    assignments.push({
      userId: user.id,
      profileId: user.profile.id,
      avatarUrl,
      ethnicity,
    });
  }

  console.log(`   🇺🇸 American: ${americanCount} (${Math.round(americanCount / assignments.length * 100)}%)`);
  console.log(`   🌍 Diverse: ${assignments.length - americanCount} (${Math.round((assignments.length - americanCount) / assignments.length * 100)}%)\n`);

  // Step 3: 批量更新Profile表（用事务分批）
  console.log('💾 Step 3: Batch updating Profiles...');
  const BATCH = 500;
  let profileUpdated = 0;

  for (let i = 0; i < assignments.length; i += BATCH) {
    const batch = assignments.slice(i, i + BATCH);

    // 构建批量UPDATE SQL
    const cases = batch.map((a, idx) => {
      const escapedUrl = a.avatarUrl.replace(/'/g, "''");
      return `WHEN '${a.profileId}' THEN '${escapedUrl}'`;
    }).join('\n          ');

    const typeCases = batch.map(a => {
      return `WHEN '${a.profileId}' THEN 'photo'`;
    }).join('\n          ');

    const ids = batch.map(a => `'${a.profileId}'`).join(',');

    const sql = `
      UPDATE "Profile"
      SET "avatar" = CASE "id"
          ${cases}
        END,
        "avatarType" = CASE "id"
          ${typeCases}
        END
      WHERE "id" IN (${ids})
    `;

    const result = await prisma.$executeRawUnsafe(sql);
    profileUpdated += result;
    const pct = Math.round(Math.min(i + BATCH, assignments.length) / assignments.length * 100);
    process.stdout.write(`\r   📊 Profiles: ${profileUpdated}/${assignments.length} (${pct}%)`);
  }
  console.log(`\n   ✅ Updated ${profileUpdated} profiles\n`);

  // Step 4: 批量更新BotAvatar表
  console.log('💾 Step 4: Batch updating BotAvatars...');
  let avatarUpdated = 0;

  for (let i = 0; i < assignments.length; i += BATCH) {
    const batch = assignments.slice(i, i + BATCH);

    // 用upsert逐条更新BotAvatar（更安全）
    for (const a of batch) {
      try {
        await prisma.botAvatar.upsert({
          where: { botId: a.userId },
          update: {
            originalUrl: a.avatarUrl,
            processedUrl: a.avatarUrl,
            style: 'photorealistic',
            ethnicity: a.ethnicity,
            status: 'active',
          },
          create: {
            botId: a.userId,
            originalUrl: a.avatarUrl,
            processedUrl: a.avatarUrl,
            style: 'photorealistic',
            ethnicity: a.ethnicity,
            status: 'active',
          },
        });
        avatarUpdated++;
      } catch {
        // 忽略单条错误
      }
    }

    const pct = Math.round(Math.min(i + BATCH, assignments.length) / assignments.length * 100);
    process.stdout.write(`\r   📊 BotAvatars: ${avatarUpdated}/${assignments.length} (${pct}%)`);
  }
  console.log(`\n   ✅ Updated ${avatarUpdated} bot avatars\n`);

  // Step 5: 验证
  console.log('✅ Step 5: Verifying...');
  const photoCount = await prisma.profile.count({ where: { avatarType: 'photo' } });
  const illCount = await prisma.profile.count({ where: { avatarType: 'illustration' } });
  const botPhoto = await prisma.profile.count({ where: { avatarType: 'photo', user: { isBot: true } } });
  const botMalePhoto = await prisma.profile.count({ where: { avatarType: 'photo', gender: 'MALE', user: { isBot: true } } });
  const botFemalePhoto = await prisma.profile.count({ where: { avatarType: 'photo', gender: 'FEMALE', user: { isBot: true } } });

  console.log(`   Photo avatars: ${photoCount}`);
  console.log(`   Illustration avatars: ${illCount}`);
  console.log(`   Bot photo: ${botPhoto} (Male: ${botMalePhoto}, Female: ${botFemalePhoto})`);

  // 抽样
  console.log('\n📋 Sample updated profiles:');
  const samples = await prisma.profile.findMany({
    where: { avatarType: 'photo', user: { isBot: true } },
    select: { displayName: true, avatar: true, gender: true },
    take: 8,
    orderBy: { updatedAt: 'desc' },
  });
  samples.forEach(s => console.log(`   ${s.displayName} (${s.gender}) | ${s.avatar}`));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`✅ Complete! Time: ${elapsed}s`);
  console.log(`═══════════════════════════════════════════\n`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
