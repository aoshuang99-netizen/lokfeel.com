/**
 * LokFeel Bot Avatar Batch Generation Script
 *
 * 高效批量处理：先获取所有 RandomUser 数据，再批量更新数据库
 *
 * Usage: npx tsx scripts/generate-avatar-batch.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

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

interface BatchUpdate {
  botId: string;
  originalUrl: string;
  processedUrl: string;
  style: string;
  ethnicity: string;
}

// Configuration
const CONFIG = {
  RANDOM_USER_API: 'https://randomuser.me/api/',
  BATCH_SIZE: 100,
  REQUEST_DELAY_MS: 300,
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
 * 保存头像到本地
 */
async function saveAvatarLocally(imageUrl: string, botId: string, gender: string): Promise<string> {
  const outputDir = path.join(process.cwd(), 'public', 'bot-avatars', gender.toLowerCase());
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `${botId}.jpg`;
  const filepath = path.join(outputDir, filename);

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    return `/bot-avatars/${gender.toLowerCase()}/${filename}`;
  } catch (error) {
    console.error(`❌ Failed to save ${botId}:`, error);
    return imageUrl;
  }
}

async function main() {
  console.log('🎨 LokFeel Bot Avatar Batch Generation');
  console.log('======================================\n');

  try {
    // 1. 获取所有 bot 用户
    console.log('📊 Step 1: Fetching bot users...');
    const maleUsers = await prisma.user.findMany({
      where: { isBot: true, profile: { gender: 'MALE' } },
      select: { id: true, profile: { select: { avatar: true } } },
    });
    const femaleUsers = await prisma.user.findMany({
      where: { isBot: true, profile: { gender: 'FEMALE' } },
      select: { id: true, profile: { select: { avatar: true } } },
    });

    console.log(`   Found ${maleUsers.length} male users`);
    console.log(`   Found ${femaleUsers.length} female users`);

    // 2. 获取现有 BotAvatar 记录
    const existingAvatars = await prisma.botAvatar.count();
    console.log(`   Existing BotAvatar records: ${existingAvatars}\n`);

    // 3. 批量获取 RandomUser 数据
    console.log('📥 Step 2: Fetching RandomUser.me data...');
    const maleCount = maleUsers.length;
    const batches = Math.ceil(maleCount / CONFIG.BATCH_SIZE);

    const allRandomUsers: RandomUserResult[] = [];
    for (let i = 0; i < batches; i++) {
      const batchCount = Math.min(CONFIG.BATCH_SIZE, maleCount - i * CONFIG.BATCH_SIZE);
      const data = await fetchRandomUsersBatch(batchCount, 'male');
      allRandomUsers.push(...data);
      console.log(`   Batch ${i + 1}/${batches}: Fetched ${data.length} records`);
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_DELAY_MS));
      }
    }
    console.log(`   ✅ Total: ${allRandomUsers.length} random users fetched\n`);

    // 4. 处理男性用户 - 下载头像并更新
    console.log('👨 Step 3: Processing male avatars...');
    let processed = 0;
    let saved = 0;

    for (let i = 0; i < maleUsers.length; i++) {
      const user = maleUsers[i];
      const randomUser = allRandomUsers[i];

      if (randomUser) {
        const originalUrl = randomUser.picture.large;
        const ethnicity = CONFIG.NATIONALITY_TO_ETHNICITY[randomUser.nat] || 'OTHER';

        // 下载并保存到本地
        const localUrl = await saveAvatarLocally(originalUrl, user.id, 'male');
        saved++;

        // 创建/更新 BotAvatar 记录
        await prisma.botAvatar.upsert({
          where: { botId: user.id },
          update: {
            originalUrl,
            processedUrl: localUrl,
            style: 'photorealistic',
            ethnicity,
            status: 'active',
          },
          create: {
            botId: user.id,
            originalUrl,
            processedUrl: localUrl,
            style: 'photorealistic',
            ethnicity,
            status: 'active',
          },
        });

        // 更新 Profile 头像
        await prisma.profile.update({
          where: { userId: user.id },
          data: { avatar: localUrl, avatarType: 'photo' },
        });
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`   📊 Progress: ${processed}/${maleUsers.length}`);
      }
    }
    console.log(`   ✅ Saved ${saved} avatars locally\n`);

    // 5. 处理女性用户 - 创建 BotAvatar 记录
    console.log('👩 Step 4: Processing female users (BotAvatar records)...');
    for (const user of femaleUsers) {
      const avatarUrl = user.profile?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`;

      await prisma.botAvatar.upsert({
        where: { botId: user.id },
        update: {
          originalUrl: avatarUrl,
          processedUrl: avatarUrl,
          style: 'illustration',
          ethnicity: 'OTHER',
          status: 'active',
        },
        create: {
          botId: user.id,
          originalUrl: avatarUrl,
          processedUrl: avatarUrl,
          style: 'illustration',
          ethnicity: 'OTHER',
          status: 'active',
        },
      });
    }
    console.log(`   ✅ Created ${femaleUsers.length} BotAvatar records\n`);

    // 6. 最终统计
    console.log('═══════════════════════════════════════════');
    console.log('✅ Avatar Generation Complete!');
    console.log('═══════════════════════════════════════════');

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

    // 检查头像目录
    const maleDir = path.join(process.cwd(), 'public', 'bot-avatars', 'male');
    const femaleDir = path.join(process.cwd(), 'public', 'bot-avatars', 'female');

    if (fs.existsSync(maleDir)) {
      const maleFiles = fs.readdirSync(maleDir).length;
      console.log(`\n📁 Saved male avatars: ${maleFiles}`);
    }
    if (fs.existsSync(femaleDir)) {
      const femaleFiles = fs.readdirSync(femaleDir).length;
      console.log(`📁 Female avatars dir exists (using DiceBear)`);
    }

  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
