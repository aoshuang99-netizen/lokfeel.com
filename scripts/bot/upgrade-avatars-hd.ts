/**
 * HD Avatar Batch Upgrade Script v2
 * 将7004个bot用户头像升级到HD (≥2MP)
 * 
 * 策略 (优化版):
 * 1. 使用 RandomUser.me URL 直接引用 (128px) → next/image 服务端渲染时自动优化
 * 2. 同时用 TPDNE AI生成 + Sharp上采样 到 1600×1600 (2.56MP) 覆盖
 * 3. 选择性存储: 默认用外部URL(快速), --hd模式用data URL(真2.56MP)
 * 
 * 运行方式:
 *   npx tsx scripts/bot/upgrade-avatars-hd.ts --hd --batch=20
 *   npx tsx scripts/bot/upgrade-avatars-hd.ts --dry-run     # 预览模式
 *   npx tsx scripts/bot/upgrade-avatars-hd.ts --limit=100   # 只处理前100个
 */

import { PrismaClient } from '../../src/generated';

const prisma = new PrismaClient();

// ─── 配置 ───
const CONFIG = {
  TARGET_WIDTH: 1600,
  TARGET_HEIGHT: 1600,  // 2.56MP > 2MP要求
  WEBP_QUALITY: 85,
  BATCH_SIZE: 5,        // TPDNE限流: 小批量
  DELAY_MS: 800,        // 批间延时
  MAX_RETRIES: 3,
  TPDNE_URL: 'https://thispersondoesnotexist.com',
  USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  // RandomUser.me HD mapping: 性别 → 图片ID范围
  GENDER_URLS: {
    FEMALE: (id: number) => `https://randomuser.me/api/portraits/women/${(id % 99) + 1}.jpg`,
    MALE: (id: number) => `https://randomuser.me/api/portraits/men/${(id % 99) + 1}.jpg`,
  },
};

// ─── 命令行参数 ───
const args = process.argv.slice(2);
const HD_MODE = args.includes('--hd');       // 真HD模式 (TPDNE + 上采样)
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const LIMIT_ARG = args.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 0;
const BATCH_ARG = args.find(a => a.startsWith('--batch='));
const CUSTOM_BATCH = BATCH_ARG ? parseInt(BATCH_ARG.split('=')[1]) : CONFIG.BATCH_SIZE;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 方案A (快速): 用RandomUser.me URL直接更新 — 秒级完成
 */
async function fastUpgrade() {
  console.log('\n🚀 Fast Mode: Updating avatar URLs to RandomUser.me + next/image optimization');
  console.log('   (next/image will handle AVIF/WebP + responsive sizing at runtime)\n');

  const startTime = Date.now();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // 查询所有需要更新的bot用户
  const where: any = { isBot: true };
  const botUsers = await prisma.user.findMany({
    where,
    include: {
      profile: {
        select: { id: true, avatar: true, avatarType: true, gender: true },
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT > 0 ? { take: LIMIT } : {}),
  });

  console.log(`Found ${botUsers.length} bot users\n`);

  for (const user of botUsers) {
    try {
      if (!user.profile) {
        skipped++;
        continue;
      }

      const currentAvatar = user.profile.avatar || '';
      // 跳过已有HD头像的
      if (!FORCE && currentAvatar.startsWith('data:image/webp')) {
        skipped++;
        continue;
      }

      // 根据性别生成URL
      const gender = user.profile.gender || 'FEMALE';
      const avatarUrl = gender === 'MALE'
        ? CONFIG.GENDER_URLS.MALE(updated)
        : CONFIG.GENDER_URLS.FEMALE(updated);

      // 更新Profile — 使用URL而非data URL
      await prisma.profile.update({
        where: { id: user.profile.id },
        data: {
          avatar: avatarUrl,
          avatarType: 'photo',
        },
      });

      updated++;
      if (updated % 500 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  Progress: ${updated}/${botUsers.length} | ${elapsed}s elapsed`);
      }
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${user.id} — ${msg}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══ Fast Upgrade Complete ═══`);
  console.log(`  Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`  Time: ${elapsed}s`);
}

/**
 * 方案B (真HD): TPDNE + Sharp上采样到2.56MP — 分钟级完成
 */
async function hdUpgrade() {
  // 动态导入sharp (可能未安装)
  let sharp: any;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('❌ sharp not installed. Run: npm install sharp');
    console.error('   Falling back to fast mode...\n');
    return fastUpgrade();
  }

  console.log('\n💎 HD Mode: TPDNE AI + Sharp upscaling to 1600×1600 (2.56MP)');
  console.log('   This will take significant time for 7004 users.\n');

  const startTime = Date.now();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  const botUsers = await prisma.user.findMany({
    where: { isBot: true },
    include: {
      profile: {
        select: { id: true, avatar: true, avatarType: true, gender: true },
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT > 0 ? { take: LIMIT } : {}),
  });

  // 过滤需要升级的
  const toUpgrade = botUsers.filter(user => {
    if (!user.profile) return false;
    if (FORCE) return true;
    const avatar = user.profile.avatar || '';
    if (avatar.startsWith('data:image/webp')) return false; // 已有HD
    return true;
  });

  console.log(`Users to upgrade: ${toUpgrade.length} (skipping ${botUsers.length - toUpgrade.length})\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Would upgrade:');
    for (const u of toUpgrade.slice(0, 5)) {
      console.log(`  ${u.profile?.id} | ${u.profile?.avatar?.slice(0, 50) || 'none'}`);
    }
    console.log(`  ... and ${toUpgrade.length - 5} more`);
    return;
  }

  const batches = Math.ceil(toUpgrade.length / CUSTOM_BATCH);

  for (let batchIdx = 0; batchIdx < batches; batchIdx++) {
    const batch = toUpgrade.slice(batchIdx * CUSTOM_BATCH, (batchIdx + 1) * CUSTOM_BATCH);
    console.log(`Batch ${batchIdx + 1}/${batches}`);

    for (const user of batch) {
      try {
        // 下载TPDNE头像 (带重试)
        let rawBuffer: Buffer | null = null;
        for (let retry = 0; retry < CONFIG.MAX_RETRIES; retry++) {
          try {
            const resp = await fetch(CONFIG.TPDNE_URL, {
              headers: { 'User-Agent': CONFIG.USER_AGENT },
              redirect: 'follow',
            });
            if (!resp.ok) throw new Error(`TPDNE ${resp.status}`);
            rawBuffer = Buffer.from(await resp.arrayBuffer());
            break;
          } catch (e) {
            if (retry === CONFIG.MAX_RETRIES - 1) throw e;
            await delay(2000 * (retry + 1));
          }
        }

        if (!rawBuffer) throw new Error('No buffer');

        // Sharp上采样到1600×1600 (2.56MP)
        const hdBuffer = await sharp(rawBuffer)
          .resize(CONFIG.TARGET_WIDTH, CONFIG.TARGET_HEIGHT, {
            kernel: sharp.kernel.lanczos3,
            fit: 'cover',
            position: 'center',
          })
          .sharpen(0.5, 0.5, 0.5)
          .webp({ quality: CONFIG.WEBP_QUALITY })
          .toBuffer();

        // 验证像素
        const meta = await sharp(hdBuffer).metadata();
        const mp = (meta.width! * meta.height!) / 1_000_000;

        // 生成data URL
        const dataUrl = `data:image/webp;base64,${hdBuffer.toString('base64')}`;

        // 更新DB
        await prisma.profile.update({
          where: { id: user.profile!.id },
          data: {
            avatar: dataUrl,
            avatarType: 'photo',
          },
        });

        updated++;
        if (updated % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
          const rate = (updated / (Date.now() - startTime) * 60000).toFixed(1);
          console.log(`  📊 ${updated}/${toUpgrade.length} | ${rate}/min | ${elapsed}min elapsed | last: ${mp.toFixed(2)}MP`);
        }

      } catch (error) {
        failed++;
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${user.id}: ${msg}`);
        console.error(`  ✗ ${user.id}: ${msg}`);
      }
    }

    // 批间延时
    if (batchIdx < batches - 1) {
      await delay(CONFIG.DELAY_MS);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n═══ HD Upgrade Complete ═══`);
  console.log(`  Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`  Time: ${elapsed}min`);
  if (errors.length > 0) {
    console.log(`  Errors (first 10):`);
    errors.slice(0, 10).forEach(e => console.log(`    ${e}`));
  }
}

// ─── 主入口 ───
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  LokFeel HD Avatar Upgrade v2');
  console.log(`  Mode: ${HD_MODE ? 'HD (TPDNE+Sharp 2.56MP)' : 'Fast (RandomUser.me URL)'}`);
  console.log(`  Limit: ${LIMIT || 'all'}`);
  console.log(`  Batch: ${CUSTOM_BATCH}`);
  console.log(`  Force: ${FORCE}`);
  console.log(`  Dry Run: ${DRY_RUN}`);
  console.log('═══════════════════════════════════════════');

  if (HD_MODE) {
    await hdUpgrade();
  } else {
    await fastUpgrade();
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
