/**
 * LokFeel Bot Avatar Generation - Sequential Processing
 *
 * 使用顺序处理避免事务超时
 *
 * Usage: npx tsx scripts/generate-avatar-final.ts
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
  picture: { large: string; medium: string; thumbnail: string };
  nat: string;
}

interface RandomUserResponse {
  results: RandomUserResult[];
  info: { seed: string; results: number };
}

// Configuration
const CONFIG = {
  RANDOM_USER_API: 'https://randomuser.me/api/',
  BATCH_SIZE: 100,
  REQUEST_DELAY_MS: 150,
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

async function fetchRandomUsers(count: number, gender?: 'male' | 'female'): Promise<RandomUserResult[]> {
  const params = new URLSearchParams({
    results: count.toString(),
    inc: 'name,gender,picture,nat',
  });
  if (gender) params.set('gender', gender);

  try {
    const response = await fetch(`${CONFIG.RANDOM_USER_API}?${params.toString()}`);
    if (!response.ok) return [];
    const data = (await response.json()) as RandomUserResponse;
    return data.results;
  } catch {
    return [];
  }
}

async function main() {
  console.log('🎨 LokFeel Bot Avatar Generation');
  console.log('================================\n');

  const startTime = Date.now();

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

    console.log(`   ✅ Male: ${maleUsers.length}, Female: ${femaleUsers.length}\n`);

    // 2. 批量获取 RandomUser 数据
    console.log('📥 Step 2: Fetching RandomUser.me data...');
    const batches = Math.ceil(maleUsers.length / CONFIG.BATCH_SIZE);
    const allRandomUsers: RandomUserResult[] = [];

    for (let i = 0; i < batches; i++) {
      const batchCount = Math.min(CONFIG.BATCH_SIZE, maleUsers.length - i * CONFIG.BATCH_SIZE);
      const data = await fetchRandomUsers(batchCount, 'male');
      allRandomUsers.push(...data);
      process.stdout.write(`\r   📥 ${i + 1}/${batches}`);
      if (i < batches - 1) await new Promise(r => setTimeout(r, CONFIG.REQUEST_DELAY_MS));
    }
    console.log(`\n   ✅ Fetched ${allRandomUsers.length} records\n`);

    // 3. 处理男性用户 - 直接创建/更新
    console.log('👨 Step 3: Processing male avatars...');
    let success = 0;

    for (let i = 0; i < maleUsers.length; i++) {
      const user = maleUsers[i];
      const randomUser = allRandomUsers[i];

      if (randomUser) {
        const avatarUrl = randomUser.picture.large;
        const ethnicity = CONFIG.NATIONALITY_TO_ETHNICITY[randomUser.nat] || 'OTHER';

        // 直接使用 upsert 避免事务
        await prisma.botAvatar.upsert({
          where: { botId: user.id },
          update: {
            originalUrl: avatarUrl,
            processedUrl: avatarUrl,
            style: 'photorealistic',
            ethnicity,
            status: 'active',
          },
          create: {
            botId: user.id,
            originalUrl: avatarUrl,
            processedUrl: avatarUrl,
            style: 'photorealistic',
            ethnicity,
            status: 'active',
          },
        });

        // 更新 Profile
        await prisma.profile.update({
          where: { userId: user.id },
          data: { avatar: avatarUrl, avatarType: 'photo' },
        });

        success++;
      }

      if ((i + 1) % 200 === 0) {
        process.stdout.write(`\r   📊 ${i + 1}/${maleUsers.length}`);
      }
    }
    console.log(`\n   ✅ Created ${success} male BotAvatar records\n`);

    // 4. 处理女性用户
    console.log('👩 Step 4: Processing female avatars...');
    for (let i = 0; i < femaleUsers.length; i++) {
      const user = femaleUsers[i];
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

      if ((i + 1) % 200 === 0) {
        process.stdout.write(`\r   📊 ${i + 1}/${femaleUsers.length}`);
      }
    }
    console.log(`\n   ✅ Created ${femaleUsers.length} female BotAvatar records\n`);

    // 5. 最终统计
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('═══════════════════════════════════════════');
    console.log('✅ Avatar Generation Complete!');
    console.log(`⏱️ Time: ${elapsedTime}s`);
    console.log('═══════════════════════════════════════════\n');

    const totalAvatars = await prisma.botAvatar.count();
    const maleAvatars = await prisma.botAvatar.count({ where: { style: 'photorealistic' } });
    const femaleAvatars = await prisma.botAvatar.count({ where: { style: 'illustration' } });

    console.log('📋 BotAvatar Stats:');
    console.log(`   - Total: ${totalAvatars}`);
    console.log(`   - Male (photorealistic): ${maleAvatars}`);
    console.log(`   - Female (illustration): ${femaleAvatars}`);

  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
