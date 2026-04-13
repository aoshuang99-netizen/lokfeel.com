/**
 * LokFeel Bot Avatar Fast Generation Script
 *
 * 快速生成方案：直接使用 RandomUser.me CDN URL，无需本地下载
 * 为所有 2271 个 bot 用户创建 BotAvatar 记录
 *
 * Usage: npx tsx scripts/generate-avatar-fast.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import fetch from 'node-fetch';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Types
interface RandomUserResult {
  name: { first: string; last: string; title: string };
  gender: 'male' | 'female';
  email: string;
  picture: { large: string; medium: string; thumbnail: string };
  nat: string;
  dob: { age: number };
}

interface RandomUserResponse {
  results: RandomUserResult[];
  info: { seed: string; results: number };
}

// Configuration
const CONFIG = {
  RANDOM_USER_API: 'https://randomuser.me/api/',
  BATCH_SIZE: 100,
  REQUEST_DELAY_MS: 200,
  NATIONALITY_TO_ETHNICITY: {
    US: 'CAUCASIAN', GB: 'CAUCASIAN', AU: 'CAUCASIAN', CA: 'CAUCASIAN',
    IE: 'CAUCASIAN', NZ: 'CAUCASIAN', ZA: 'CAUCASIAN',
    BR: 'HISPANIC_LATINO', ES: 'HISPANIC_LATINO', MX: 'HISPANIC_LATINO',
    FR: 'CAUCASIAN', DE: 'CAUCASIAN', IT: 'CAUCASIAN', NL: 'CAUCASIAN',
    CH: 'CAUCASIAN', AT: 'CAUCASIAN', BE: 'CAUCASIAN', NO: 'CAUCASIAN',
    DK: 'CAUCASIAN', FI: 'CAUCASIAN', SE: 'CAUCASIAN', RU: 'CAUCASIAN',
    UA: 'CAUCASIAN', CN: 'ASIAN', JP: 'ASIAN', KR: 'ASIAN', TW: 'ASIAN',
    HK: 'ASIAN', SG: 'ASIAN', TH: 'ASIAN', IN: 'SOUTH_ASIAN', PK: 'SOUTH_ASIAN',
    BD: 'SOUTH_ASIAN', NG: 'AFRICAN_AMERICAN', GH: 'AFRICAN_AMERICAN',
    KE: 'AFRICAN_AMERICAN', ZW: 'AFRICAN_AMERICAN', EG: 'MIDDLE_EASTERN',
    TR: 'MIDDLE_EASTERN', IR: 'MIDDLE_EASTERN', IQ: 'MIDDLE_EASTERN',
    SA: 'MIDDLE_EASTERN', AE: 'MIDDLE_EASTERN', IL: 'MIDDLE_EASTERN',
  } as Record<string, string>,
};

/**
 * 批量获取 RandomUser 数据
 */
async function fetchRandomUsersBatch(count: number, gender?: 'male' | 'female'): Promise<RandomUserResult[]> {
  const params = new URLSearchParams({
    results: count.toString(),
    inc: 'name,gender,email,picture,nat,dob',
  });
  if (gender) params.set('gender', gender);

  try {
    const response = await fetch(`${CONFIG.RANDOM_USER_API}?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as RandomUserResponse;
    return data.results;
  } catch (error) {
    console.error('❌ Failed to fetch:', error);
    return [];
  }
}

/**
 * 批量更新 BotAvatar 记录
 */
async function batchUpsertBotAvatar(records: Array<{
  botId: string;
  originalUrl: string;
  processedUrl: string;
  style: string;
  ethnicity: string;
}>) {
  // 使用小批次避免超时
  const BATCH = 20;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map(record =>
        prisma.botAvatar.upsert({
          where: { botId: record.botId },
          update: {
            originalUrl: record.originalUrl,
            processedUrl: record.processedUrl,
            style: record.style,
            ethnicity: record.ethnicity,
            status: 'active',
          },
          create: {
            botId: record.botId,
            originalUrl: record.originalUrl,
            processedUrl: record.processedUrl,
            style: record.style,
            ethnicity: record.ethnicity,
            status: 'active',
          },
        })
      )
    );
  }
}

/**
 * 批量更新 Profile 头像
 */
async function batchUpdateProfileAvatar(updates: Array<{ userId: string; avatar: string; avatarType: string }>) {
  const BATCH = 20;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map(update =>
        prisma.profile.update({
          where: { userId: update.userId },
          data: { avatar: update.avatar, avatarType: update.avatarType },
        })
      )
    );
  }
}

async function main() {
  console.log('🎨 LokFeel Bot Avatar Fast Generation');
  console.log('=====================================\n');

  const startTime = Date.now();

  try {
    // 1. 获取所有 bot 用户
    console.log('📊 Step 1: Fetching bot users...');
    const maleUsers = await prisma.user.findMany({
      where: { isBot: true, profile: { gender: 'MALE' } },
      select: { id: true, email: true, profile: { select: { avatar: true } } },
    });
    const femaleUsers = await prisma.user.findMany({
      where: { isBot: true, profile: { gender: 'FEMALE' } },
      select: { id: true, email: true, profile: { select: { avatar: true } } },
    });

    console.log(`   ✅ Male users: ${maleUsers.length}`);
    console.log(`   ✅ Female users: ${femaleUsers.length}`);
    console.log(`   ✅ Total: ${maleUsers.length + femaleUsers.length}\n`);

    // 2. 批量获取 RandomUser 数据
    console.log('📥 Step 2: Fetching RandomUser.me data...');
    const maleCount = maleUsers.length;
    const batches = Math.ceil(maleCount / CONFIG.BATCH_SIZE);
    const allRandomUsers: RandomUserResult[] = [];

    for (let i = 0; i < batches; i++) {
      const batchCount = Math.min(CONFIG.BATCH_SIZE, maleCount - i * CONFIG.BATCH_SIZE);
      const data = await fetchRandomUsersBatch(batchCount, 'male');
      allRandomUsers.push(...data);
      process.stdout.write(`\r   📥 Batch ${i + 1}/${batches}: ${data.length} records`);
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_DELAY_MS));
      }
    }
    console.log(`\n   ✅ Fetched ${allRandomUsers.length} random user records\n`);

    // 3. 准备男性用户的头像数据
    console.log('👨 Step 3: Preparing male avatar data...');
    const maleAvatarRecords: Array<{
      botId: string;
      originalUrl: string;
      processedUrl: string;
      style: string;
      ethnicity: string;
    }> = [];
    const maleProfileUpdates: Array<{ userId: string; avatar: string; avatarType: string }> = [];

    for (let i = 0; i < maleUsers.length; i++) {
      const user = maleUsers[i];
      const randomUser = allRandomUsers[i];

      if (randomUser) {
        const avatarUrl = randomUser.picture.large;
        const ethnicity = CONFIG.NATIONALITY_TO_ETHNICITY[randomUser.nat] || 'OTHER';

        maleAvatarRecords.push({
          botId: user.id,
          originalUrl: avatarUrl,
          processedUrl: avatarUrl, // 使用 CDN URL
          style: 'photorealistic',
          ethnicity,
        });

        maleProfileUpdates.push({
          userId: user.id,
          avatar: avatarUrl,
          avatarType: 'photo',
        });
      }
    }
    console.log(`   ✅ Prepared ${maleAvatarRecords.length} male avatar records\n`);

    // 4. 批量创建男性 BotAvatar 记录
    console.log('💾 Step 4: Creating male BotAvatar records...');
    const dbBatchSize = 50;
    for (let i = 0; i < maleAvatarRecords.length; i += dbBatchSize) {
      const batch = maleAvatarRecords.slice(i, i + dbBatchSize);
      await batchUpsertBotAvatar(batch);
      process.stdout.write(`\r   💾 Progress: ${Math.min(i + dbBatchSize, maleAvatarRecords.length)}/${maleAvatarRecords.length}`);
    }
    console.log('\n');

    // 5. 批量更新男性 Profile 头像
    console.log('💾 Step 5: Updating male Profile avatars...');
    for (let i = 0; i < maleProfileUpdates.length; i += dbBatchSize) {
      const batch = maleProfileUpdates.slice(i, i + dbBatchSize);
      await batchUpdateProfileAvatar(batch);
      process.stdout.write(`\r   💾 Progress: ${Math.min(i + dbBatchSize, maleProfileUpdates.length)}/${maleProfileUpdates.length}`);
    }
    console.log('\n');

    // 6. 处理女性用户
    console.log('👩 Step 6: Creating female BotAvatar records...');
    const femaleAvatarRecords: Array<{
      botId: string;
      originalUrl: string;
      processedUrl: string;
      style: string;
      ethnicity: string;
    }> = [];

    for (const user of femaleUsers) {
      const avatarUrl = user.profile?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`;
      femaleAvatarRecords.push({
        botId: user.id,
        originalUrl: avatarUrl,
        processedUrl: avatarUrl,
        style: 'illustration',
        ethnicity: 'OTHER',
      });
    }

    // 批量创建
    for (let i = 0; i < femaleAvatarRecords.length; i += dbBatchSize) {
      const batch = femaleAvatarRecords.slice(i, i + dbBatchSize);
      await batchUpsertBotAvatar(batch);
      process.stdout.write(`\r   💾 Progress: ${Math.min(i + dbBatchSize, femaleAvatarRecords.length)}/${femaleAvatarRecords.length}`);
    }
    console.log('\n');

    // 7. 最终统计
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('═══════════════════════════════════════════');
    console.log('✅ Avatar Generation Complete!');
    console.log(`⏱️ Time elapsed: ${elapsedTime}s`);
    console.log('═══════════════════════════════════════════\n');

    // 统计
    const finalStats = await prisma.botAvatar.groupBy({
      by: ['status', 'style'],
      _count: true,
    });

    console.log('📋 BotAvatar Stats:');
    for (const stat of finalStats) {
      console.log(`   - ${stat.style} / ${stat.status}: ${stat._count}`);
    }

    const totalAvatars = await prisma.botAvatar.count();
    console.log(`   📊 Total: ${totalAvatars}`);

    // 检查样本数据
    console.log('\n📸 Sample Male Avatars:');
    const maleAvatars = await prisma.botAvatar.findMany({
      where: { style: 'photorealistic' },
      take: 3,
      select: { botId: true, originalUrl: true, ethnicity: true },
    });
    for (const avatar of maleAvatars) {
      console.log(`   - ${avatar.botId}: ${avatar.originalUrl?.substring(0, 50) ?? 'N/A'}...`);
    }

  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
