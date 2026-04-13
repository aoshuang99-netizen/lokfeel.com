/**
 * LokFeel Bot Avatar Generation Script v2
 *
 * 使用 RandomUser.me API 生成真实头像
 * 为所有 3500 个 bot 用户创建 BotAvatar 记录
 *
 * 女性用户：卡通风格头像（使用 DiceBear）
 * 男性用户：真实照片（使用 RandomUser.me）
 *
 * Usage: npx tsx scripts/generate-avatar-v2.ts
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

interface BotUser {
  id: string;
  email: string;
  botType: string | null;
  profile: {
    gender: string;
    avatar: string | null;
  } | null;
}

// Configuration
const CONFIG = {
  // RandomUser.me API
  RANDOM_USER_API: 'https://randomuser.me/api/',

  // 头像尺寸
  AVATAR_SIZE: 512,

  // 批次大小
  BATCH_SIZE: 50,

  // 请求间隔（毫秒）
  REQUEST_DELAY_MS: 500,

  // 最大重试次数
  MAX_RETRIES: 3,

  // 种族映射
  NATIONALITY_TO_ETHNICITY: {
    US: 'CAUCASIAN',
    GB: 'CAUCASIAN',
    AU: 'CAUCASIAN',
    CA: 'CAUCASIAN',
    IE: 'CAUCASIAN',
    NZ: 'CAUCASIAN',
    ZA: 'CAUCASIAN',
    BR: 'HISPANIC_LATINO',
    ES: 'HISPANIC_LATINO',
    MX: 'HISPANIC_LATINO',
    FR: 'CAUCASIAN',
    DE: 'CAUCASIAN',
    IT: 'CAUCASIAN',
    NL: 'CAUCASIAN',
    CH: 'CAUCASIAN',
    AT: 'CAUCASIAN',
    BE: 'CAUCASIAN',
    NO: 'CAUCASIAN',
    DK: 'CAUCASIAN',
    FI: 'CAUCASIAN',
    SE: 'CAUCASIAN',
    RU: 'CAUCASIAN',
    UA: 'CAUCASIAN',
    CN: 'ASIAN',
    JP: 'ASIAN',
    KR: 'ASIAN',
    TW: 'ASIAN',
    HK: 'ASIAN',
    SG: 'ASIAN',
    TH: 'ASIAN',
    IN: 'SOUTH_ASIAN',
    PK: 'SOUTH_ASIAN',
    BD: 'SOUTH_ASIAN',
    NG: 'AFRICAN_AMERICAN',
    GH: 'AFRICAN_AMERICAN',
    KE: 'AFRICAN_AMERICAN',
    ZW: 'AFRICAN_AMERICAN',
    EG: 'MIDDLE_EASTERN',
    TR: 'MIDDLE_EASTERN',
    IR: 'MIDDLE_EASTERN',
    IQ: 'MIDDLE_EASTERN',
    SA: 'MIDDLE_EASTERN',
    AE: 'MIDDLE_EASTERN',
    IL: 'MIDDLE_EASTERN',
  } as Record<string, string>,

  // 头像风格
  MALE_AVATAR_STYLE: 'photorealistic',
  FEMALE_AVATAR_STYLE: 'illustration',
};

/**
 * 获取随机用户数据
 */
async function fetchRandomUsers(count: number, gender?: 'male' | 'female'): Promise<RandomUserResult[]> {
  const params = new URLSearchParams({
    results: count.toString(),
    inc: 'name,gender,email,picture,nat,dob',
  });

  if (gender) {
    params.set('gender', gender);
  }

  const url = `${CONFIG.RANDOM_USER_API}?${params.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as RandomUserResponse;
    return data.results;
  } catch (error) {
    console.error('❌ Failed to fetch random users:', error);
    throw error;
  }
}

/**
 * 下载并保存头像到本地
 */
async function downloadAndSaveAvatar(imageUrl: string, botId: string, gender: string): Promise<string> {
  const outputDir = path.join(process.cwd(), 'public', 'bot-avatars', gender.toLowerCase());

  // 确保目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `${botId}.jpg`;
  const filepath = path.join(outputDir, filename);

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  // 返回相对 URL
  return `/bot-avatars/${gender.toLowerCase()}/${filename}`;
}

/**
 * 处理单个 bot 用户
 */
async function processBotUser(
  user: BotUser,
  randomUserData?: RandomUserResult
): Promise<{ botId: string; success: boolean; message: string }> {
  const { id, email } = user;

  if (!user.profile) {
    return { botId: id, success: false, message: 'No profile' };
  }

  const gender = user.profile.gender.toLowerCase();
  const isMale = gender === 'male';

  try {
    let avatarUrl: string;
    let style: string;
    let ethnicity: string;
    let existingAvatar = user.profile.avatar;

    if (isMale && !existingAvatar?.includes('randomuser')) {
      // 男性：使用 RandomUser.me 的真实头像
      const randomData = randomUserData || (await fetchRandomUsers(1, 'male'))[0];

      if (randomData) {
        avatarUrl = randomData.picture.large;
        style = CONFIG.MALE_AVATAR_STYLE;
        ethnicity = CONFIG.NATIONALITY_TO_ETHNICITY[randomData.nat] || 'OTHER';

        // 下载并保存到本地
        const localUrl = await downloadAndSaveAvatar(avatarUrl, id, 'male');

        // 创建 BotAvatar 记录
        await prisma.botAvatar.upsert({
          where: { botId: id },
          update: {
            originalUrl: avatarUrl,
            processedUrl: localUrl,
            style,
            ethnicity,
            status: 'active',
            useCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
          create: {
            botId: id,
            originalUrl: avatarUrl,
            processedUrl: localUrl,
            style,
            ethnicity,
            status: 'active',
            useCount: 1,
            lastUsedAt: new Date(),
          },
        });

        // 更新 Profile 的头像
        await prisma.profile.update({
          where: { userId: id },
          data: { avatar: localUrl, avatarType: 'photo' },
        });

        return { botId: id, success: true, message: `Updated avatar` };
      }
    } else {
      // 女性或有现有 DiceBear 头像的用户：创建 BotAvatar 记录
      avatarUrl = existingAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${id}`;
      style = isMale ? CONFIG.MALE_AVATAR_STYLE : CONFIG.FEMALE_AVATAR_STYLE;
      ethnicity = 'OTHER';

      await prisma.botAvatar.upsert({
        where: { botId: id },
        update: {
          originalUrl: avatarUrl,
          processedUrl: avatarUrl,
          style,
          ethnicity,
          status: 'active',
        },
        create: {
          botId: id,
          originalUrl: avatarUrl,
          processedUrl: avatarUrl,
          style,
          ethnicity,
          status: 'active',
        },
      });

      return { botId: id, success: true, message: 'BotAvatar record created' };
    }

    return { botId: id, success: false, message: 'Failed to get avatar' };
  } catch (error) {
    console.error(`  ❌ Error processing ${email}:`, error);
    return { botId: id, success: false, message: String(error) };
  }
}

/**
 * 批量获取 RandomUser.me 数据
 */
async function fetchBatchRandomUsers(
  count: number,
  gender?: 'male' | 'female'
): Promise<RandomUserResult[]> {
  const batchSize = 100;
  const results: RandomUserResult[] = [];

  for (let i = 0; i < count; i += batchSize) {
    const batchCount = Math.min(batchSize, count - i);
    const data = await fetchRandomUsers(batchCount, gender);
    results.push(...data);

    if (i + batchCount < count) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_DELAY_MS));
    }
  }

  return results;
}

/**
 * 主函数
 */
async function main() {
  console.log('🎨 LokFeel Bot Avatar Generation Script v2');
  console.log('===========================================\n');
  console.log('📋 Avatar Strategy:');
  console.log('  - Female Users: Illustration (DiceBear)');
  console.log('  - Male Users: Photorealistic (RandomUser.me)');
  console.log('');

  try {
    // 获取所有 bot 用户
    console.log('🔍 Fetching bot users from database...');
    const botUsers = (await prisma.user.findMany({
      where: { isBot: true },
      include: {
        profile: {
          select: { gender: true, avatar: true },
        },
      },
    })) as BotUser[];

    console.log(`  ✅ Found ${botUsers.length} bot users\n`);

    if (botUsers.length === 0) {
      console.log('⚠️ No bot users found. Please run import-bot-users.ts first.');
      return;
    }

    // 分类统计
    const maleUsers = botUsers.filter(u => u.profile?.gender === 'MALE');
    const femaleUsers = botUsers.filter(u => u.profile?.gender === 'FEMALE');

    console.log('📊 User Distribution:');
    console.log(`  - Male (needs realistic): ${maleUsers.length}`);
    console.log(`  - Female (illustration): ${femaleUsers.length}`);
    console.log('');

    // 检查现有 BotAvatar 记录
    const existingAvatars = await prisma.botAvatar.count();
    console.log(`📋 Existing BotAvatar records: ${existingAvatars}`);
    console.log('');

    // 预估时间
    const estimatedMinutes = Math.ceil((maleUsers.length * CONFIG.REQUEST_DELAY_MS) / 1000 / 60);
    console.log(`⏱️ Estimated time: ~${estimatedMinutes} minutes for male avatars`);
    console.log('');

    let processed = 0;
    let success = 0;
    let failed = 0;

    // 处理男性用户
    if (maleUsers.length > 0) {
      console.log('👨 Processing male users (fetching from RandomUser.me)...\n');

      // 批量获取 RandomUser 数据
      console.log('📥 Fetching RandomUser.me data in batches...');
      const randomUserData = await fetchBatchRandomUsers(maleUsers.length, 'male');
      console.log(`  ✅ Fetched ${randomUserData.length} random user records\n`);

      for (let i = 0; i < maleUsers.length; i++) {
        const user = maleUsers[i];
        const result = await processBotUser(user, randomUserData[i]);

        processed++;

        if (result.success) {
          success++;
        } else {
          failed++;
        }

        process.stdout.write(`\r  📊 Progress: ${processed}/${maleUsers.length} (${((processed / maleUsers.length) * 100).toFixed(1)}%) - Success: ${success} - Failed: ${failed}`);

        // 添加延迟
        if (i < maleUsers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_DELAY_MS));
        }
      }
    }

    // 处理女性用户（只创建 BotAvatar 记录）
    console.log('\n\n👩 Processing female users (creating BotAvatar records)...\n');

    let femaleProcessed = 0;
    for (const user of femaleUsers) {
      const result = await processBotUser(user);

      if (result.success) {
        success++;
      } else {
        failed++;
      }

      femaleProcessed++;
      process.stdout.write(`\r  📊 Progress: ${femaleProcessed}/${femaleUsers.length} (${((femaleProcessed / femaleUsers.length) * 100).toFixed(1)}%)`);
    }

    // 统计结果
    console.log('\n\n');
    console.log('═══════════════════════════════════════════');
    console.log('✅ Avatar Generation Complete!');
    console.log('═══════════════════════════════════════════');
    console.log(`  📊 Total Users Processed: ${processed + femaleUsers.length}`);
    console.log(`  📈 Success: ${success}`);
    console.log(`  ❌ Failed: ${failed}`);
    console.log(`  📈 Success Rate: ${((success / (processed + femaleUsers.length)) * 100).toFixed(1)}%`);
    console.log('');
    console.log('  📁 Avatars saved to: public/bot-avatars/');
    console.log('');

    // 显示 BotAvatar 表统计
    const avatarStats = await prisma.botAvatar.groupBy({
      by: ['status', 'style'],
      _count: true,
    });

    console.log('📋 BotAvatar Table Stats:');
    for (const stat of avatarStats) {
      console.log(`  - ${stat.style} / ${stat.status}: ${stat._count}`);
    }

    const totalAvatars = await prisma.botAvatar.count();
    console.log(`  📊 Total BotAvatar records: ${totalAvatars}`);

  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 运行脚本
main();
