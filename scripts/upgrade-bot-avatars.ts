/**
 * upgrade-bot-avatars.ts
 * 
 * 给所有bot和数字用户配置高清展示照片和头像
 * 使用 Pexels API (免费, 高质量, 合法商用) 下载真实人物肖像
 * 
 * 策略:
 * - 女性: 多维度搜索 (professional, casual, artistic, natural, diverse ethnicity)
 * - 男性: 多维度搜索 (professional, casual, outdoor, diverse ethnicity)
 * - 每个 search query 获取多页结果确保多样性
 * - 下载 portrait 尺寸 (800x1200) 的 JPEG
 * - 保存到 public/bot-avatars/{gender}/ 目录
 * - 更新数据库 Profile.avatar 字段
 * 
 * 用法:
 *   npx tsx scripts/upgrade-bot-avatars.ts [--dry-run] [--gender female|male|all] [--limit N]
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

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

// Pexels API Key (免费, 每小时200次请求)
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
const PEXELS_BASE = 'https://api.pexels.com/v1';

// Download directory
const AVATAR_DIR = path.join(process.cwd(), 'public', 'bot-avatars');
const MALE_DIR = path.join(AVATAR_DIR, 'male');
const FEMALE_DIR = path.join(AVATAR_DIR, 'female');

// Ensure directories exist
for (const dir of [MALE_DIR, FEMALE_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Search Queries for Diversity ────────────────────────────

const FEMALE_QUERIES = [
  // Professional / Business
  'professional woman portrait smiling',
  'business woman headshot confident',
  'corporate woman portrait elegant',
  
  // Casual / Natural
  'woman portrait natural light smiling',
  'casual woman portrait outdoor',
  'happy woman portrait lifestyle',
  
  // Artistic / Fashion
  'fashion portrait woman elegant',
  'artistic woman portrait creative',
  'beauty woman portrait studio',
  
  // Diverse Ethnicities
  'asian woman portrait smiling',
  'african american woman portrait beautiful',
  'hispanic latina woman portrait',
  'indian woman portrait professional',
  'middle eastern woman portrait elegant',
  
  // Age Diversity
  'young woman portrait confident',
  'mature woman portrait professional',
  
  // Style Diversity
  'woman portrait curly hair',
  'blonde woman portrait smiling',
  'brunette woman portrait confident',
  'woman portrait short hair stylish',
];

const MALE_QUERIES = [
  // Professional / Business
  'professional man portrait smiling',
  'business man headshot confident',
  'corporate man portrait suit',
  
  // Casual / Natural
  'man portrait natural light casual',
  'outdoor man portrait lifestyle',
  'happy man portrait smiling',
  
  // Artistic / Fashion
  'fashion portrait man stylish',
  'man portrait black and white artistic',
  'handsome man portrait studio',
  
  // Diverse Ethnicities
  'asian man portrait professional',
  'african american man portrait handsome',
  'hispanic man portrait confident',
  'indian man portrait professional',
  'middle eastern man portrait',
  
  // Style Diversity
  'man portrait beard stylish',
  'man portrait short hair professional',
  'man portrait athletic fit',
  'man portrait casual outdoor',
];

// ─── Pexels API Helper ──────────────────────────────────────

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  src: {
    original: string;
    portrait: string; // 800x1200 crop
    large: string;
    medium: string;
    small: string;
    tiny: string;
  };
  alt: string;
  photographer: string;
}

interface PexelsSearchResult {
  photos: PexelsPhoto[];
  total_results: number;
  page: number;
  per_page: number;
  next_page: string | null;
}

async function searchPexels(
  query: string,
  page: number = 1,
  perPage: number = 80
): Promise<PexelsPhoto[]> {
  if (!PEXELS_API_KEY) {
    console.error('⚠️  PEXELS_API_KEY not set. Cannot search Pexels.');
    return [];
  }

  try {
    const url = `${PEXELS_BASE}/search?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=${perPage}&page=${page}`;
    const response = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
    });

    if (!response.ok) {
      console.error(`Pexels API error: ${response.status} for query "${query}"`);
      return [];
    }

    const data: PexelsSearchResult = await response.json();
    return data.photos || [];
  } catch (error) {
    console.error(`Pexels search failed for "${query}":`, error);
    return [];
  }
}

// ─── Download Helper ─────────────────────────────────────────

async function downloadPhoto(
  url: string,
  filepath: string
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return false;

    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Validate size (20KB - 5MB)
    if (buffer.length < 20000 || buffer.length > 5000000) return false;

    fs.writeFileSync(filepath, buffer);
    return true;
  } catch {
    return false;
  }
}

// ─── Main Logic ──────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const genderFilter = args.find(a => a.startsWith('--gender='))?.split('=')[1] 
    || (args.indexOf('--gender') !== -1 ? args[args.indexOf('--gender') + 1] : 'all');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');

  console.log('🎨 LokFee Bot Avatar HD Upgrade');
  console.log('═'.repeat(60));
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Gender: ${genderFilter}`);
  console.log(`  Limit: ${limit || 'unlimited'}`);
  console.log(`  Pexels API: ${PEXELS_API_KEY ? '✅ Configured' : '❌ NOT SET'}`);
  console.log();

  if (!PEXELS_API_KEY) {
    console.error('❌ PEXELS_API_KEY environment variable is required!');
    console.error('   Get a free key at: https://www.pexels.com/api/');
    console.error('   Then set: export PEXELS_API_KEY=your_key_here');
    process.exit(1);
  }

  // Step 1: Get all bot users from DB
  const botUsers = await db.user.findMany({
    where: {
      isBot: true,
      profile: { isNot: null },
    },
    include: {
      profile: {
        select: {
          id: true,
          displayName: true,
          gender: true,
          avatar: true,
          avatarType: true,
        },
      },
    },
    ...(limit ? { take: limit } : {}),
    orderBy: { createdAt: 'asc' },
  });

  console.log(`📊 Found ${botUsers.length} bot users with profiles`);

  // Group by gender
  const femaleBots = botUsers.filter(u => u.profile?.gender === 'FEMALE');
  const maleBots = botUsers.filter(u => u.profile?.gender === 'MALE');
  const otherBots = botUsers.filter(u => u.profile?.gender !== 'FEMALE' && u.profile?.gender !== 'MALE');

  console.log(`   👩 Female: ${femaleBots.length}`);
  console.log(`   👨 Male: ${maleBots.length}`);
  console.log(`   ❓ Other: ${otherBots.length}`);
  console.log();

  // Step 2: Collect photos from Pexels
  const femalePhotos: PexelsPhoto[] = [];
  const malePhotos: PexelsPhoto[] = [];

  if (genderFilter === 'all' || genderFilter === 'female') {
    console.log('🔍 Searching Pexels for female portraits...');
    for (const query of FEMALE_QUERIES) {
      const photos = await searchPexels(query, 1, 15);
      femalePhotos.push(...photos);
      console.log(`   "${query}": ${photos.length} photos`);
      await new Promise(r => setTimeout(r, 200)); // Rate limit
    }
    console.log(`   Total unique female photos: ${femalePhotos.length}`);
  }

  if (genderFilter === 'all' || genderFilter === 'male') {
    console.log('🔍 Searching Pexels for male portraits...');
    for (const query of MALE_QUERIES) {
      const photos = await searchPexels(query, 1, 15);
      malePhotos.push(...photos);
      console.log(`   "${query}": ${photos.length} photos`);
      await new Promise(r => setTimeout(r, 200)); // Rate limit
    }
    console.log(`   Total unique male photos: ${malePhotos.length}`);
  }

  // Deduplicate by photo ID
  const uniqueFemalePhotos = [...new Map(femalePhotos.map(p => [p.id, p])).values()];
  const uniqueMalePhotos = [...new Map(malePhotos.map(p => [p.id, p])).values()];

  console.log();
  console.log(`📸 After deduplication:`);
  console.log(`   Female: ${uniqueFemalePhotos.length} unique photos`);
  console.log(`   Male: ${uniqueMalePhotos.length} unique photos`);

  if (dryRun) {
    console.log();
    console.log('🏃 DRY RUN - showing first 5 matches per gender:');
    
    for (let i = 0; i < Math.min(5, femaleBots.length); i++) {
      const bot = femaleBots[i];
      const photo = uniqueFemalePhotos[i % uniqueFemalePhotos.length];
      console.log(`   👩 ${bot.profile?.displayName}: ${photo?.src.portrait?.substring(0, 80)}`);
    }
    
    for (let i = 0; i < Math.min(5, maleBots.length); i++) {
      const bot = maleBots[i];
      const photo = uniqueMalePhotos[i % uniqueMalePhotos.length];
      console.log(`   👨 ${bot.profile?.displayName}: ${photo?.src.portrait?.substring(0, 80)}`);
    }

    await db.$disconnect();
    return;
  }

  // Step 3: Download photos and assign to bots
  let upgraded = 0;
  let failed = 0;
  let skipped = 0;

  // Process female bots
  if (genderFilter !== 'male' && uniqueFemalePhotos.length > 0) {
    console.log();
    console.log(`👩 Processing ${femaleBots.length} female bots...`);

    for (let i = 0; i < femaleBots.length; i++) {
      const bot = femaleBots[i];
      const photo = uniqueFemalePhotos[i % uniqueFemalePhotos.length];
      
      if (!photo || !bot.profile?.id) {
        skipped++;
        continue;
      }

      try {
        // Download portrait-size image
        const filename = `${bot.id}.jpg`;
        const filepath = path.join(FEMALE_DIR, filename);
        
        const downloaded = await downloadPhoto(photo.src.portrait, filepath);
        
        if (!downloaded) {
          // Fallback: use the URL directly
          await db.profile.update({
            where: { id: bot.profile.id },
            data: {
              avatar: photo.src.portrait,
              avatarType: 'photo',
            },
          });
          upgraded++;
        } else {
          // Use local file path
          const avatarUrl = `/bot-avatars/female/${filename}`;
          
          await db.profile.update({
            where: { id: bot.profile.id },
            data: {
              avatar: avatarUrl,
              avatarType: 'photo',
            },
          });
          
          // Also update gallery photos (add 2-3 extra photos)
          const extraPhotos = uniqueFemalePhotos
            .filter((_, idx) => idx !== i % uniqueFemalePhotos.length)
            .slice(0, 3)
            .map(p => p.src.portrait);
          
          if (extraPhotos.length > 0) {
            const existingGallery = JSON.parse(bot.profile.galleryPhotos || '[]');
            await db.profile.update({
              where: { id: bot.profile.id },
              data: {
                galleryPhotos: JSON.stringify([...existingGallery, ...extraPhotos.slice(0, 3)]),
              },
            });
          }
          
          upgraded++;
        }

        if ((i + 1) % 50 === 0) {
          console.log(`   Progress: ${i + 1}/${femaleBots.length} (${upgraded} upgraded, ${failed} failed)`);
        }
        
        // Rate limiting for downloads
        await new Promise(r => setTimeout(r, 100));
      } catch (error) {
        failed++;
        console.error(`   ❌ Failed for ${bot.profile?.displayName}: ${error}`);
      }
    }
  }

  // Process male bots
  if (genderFilter !== 'female' && uniqueMalePhotos.length > 0) {
    console.log();
    console.log(`👨 Processing ${maleBots.length} male bots...`);
    
    const previousUpgraded = upgraded;
    const previousFailed = failed;

    for (let i = 0; i < maleBots.length; i++) {
      const bot = maleBots[i];
      const photo = uniqueMalePhotos[i % uniqueMalePhotos.length];
      
      if (!photo || !bot.profile?.id) {
        skipped++;
        continue;
      }

      try {
        const filename = `${bot.id}.jpg`;
        const filepath = path.join(MALE_DIR, filename);
        
        const downloaded = await downloadPhoto(photo.src.portrait, filepath);
        
        if (!downloaded) {
          await db.profile.update({
            where: { id: bot.profile.id },
            data: {
              avatar: photo.src.portrait,
              avatarType: 'photo',
            },
          });
          upgraded++;
        } else {
          const avatarUrl = `/bot-avatars/male/${filename}`;
          
          await db.profile.update({
            where: { id: bot.profile.id },
            data: {
              avatar: avatarUrl,
              avatarType: 'photo',
            },
          });
          
          // Add gallery photos
          const extraPhotos = uniqueMalePhotos
            .filter((_, idx) => idx !== i % uniqueMalePhotos.length)
            .slice(0, 3)
            .map(p => p.src.portrait);
          
          if (extraPhotos.length > 0) {
            const existingGallery = JSON.parse(bot.profile.galleryPhotos || '[]');
            await db.profile.update({
              where: { id: bot.profile.id },
              data: {
                galleryPhotos: JSON.stringify([...existingGallery, ...extraPhotos.slice(0, 3)]),
              },
            });
          }
          
          upgraded++;
        }

        if ((i + 1) % 50 === 0) {
          console.log(`   Progress: ${i + 1}/${maleBots.length} (${upgraded - previousUpgraded} upgraded, ${failed - previousFailed} failed)`);
        }
        
        await new Promise(r => setTimeout(r, 100));
      } catch (error) {
        failed++;
        console.error(`   ❌ Failed for ${bot.profile?.displayName}: ${error}`);
      }
    }
  }

  // Step 4: Summary
  console.log();
  console.log('═'.repeat(60));
  console.log('📊 Upgrade Summary:');
  console.log(`   ✅ Upgraded: ${upgraded}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   📁 Female avatars: ${fs.readdirSync(FEMALE_DIR).length} files`);
  console.log(`   📁 Male avatars: ${fs.readdirSync(MALE_DIR).length} files`);
  console.log();
  console.log('🎉 Avatar upgrade complete!');

  await db.$disconnect();
}

main()
  .catch(e => {
    console.error('❌ Avatar upgrade failed:', e);
    process.exit(1);
  });
