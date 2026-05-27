/**
 * HD Avatar Generator — DiceBear lorelei → Sharp WebP → Turso base64
 * 
 * 策略:
 * 1. 用 DiceBear 9.x "lorelei" 风格（最逼真，非卡通感）
 * 2. 渲染 512x512 SVG → Sharp 转 256x256 WebP
 * 3. 存为 data:image/webp;base64 到 Profile.avatar (Turso)
 * 4. 批量处理，控制并发防限流
 * 
 * 运行:
 *   npx tsx scripts/bot/generate-hd-avatars-turso.ts --batch=10 --limit=100
 *   npx tsx scripts/bot/generate-hd-avatars-turso.ts --dry-run
 *   npx tsx scripts/bot/generate-hd-avatars-turso.ts --force  # 强制覆盖已有 base64
 */

import 'dotenv/config';
import { getDb } from '../../src/lib/db';

const prisma = getDb();

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const CONFIG = {
  DICEBEAR_BASE: 'https://api.dicebear.com/9.x',
  STYLE: 'lorelei',           // 最逼真的DiceBear风格
  SVG_SIZE: 512,              // 渲染尺寸
  OUTPUT_SIZE: 256,           // 输出 WebP 尺寸
  WEBP_QUALITY: 80,           // WebP 质量
  BATCH_SIZE: 10,             // 每批处理数
  DELAY_BETWEEN_BATCHES: 500, // 批间延时ms
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
};

// ═══════════════════════════════════════════
// GENDER-AWARE COLORS
// ═══════════════════════════════════════════
function getBackgroundColor(gender: string): string {
  const g = gender?.toUpperCase() || '';
  if (g === 'FEMALE' || g === 'WOMAN') return 'fce7f3,fbcfe8,f9a8d4'; // Pink
  if (g === 'MALE' || g === 'MAN') return 'dbeafe,bfdbfe,93c5fd';     // Blue
  return 'f3e8ff,e9d5ff,d8b4fe';                                       // Purple
}

// ═══════════════════════════════════════════
// DICEBEAR URL
// ═══════════════════════════════════════════
function getDiceBearUrl(seed: string, gender: string, size: number): string {
  const bgColor = getBackgroundColor(gender);
  const params = new URLSearchParams({
    seed,
    backgroundColor: bgColor,
    radius: '50',
  });
  return `${CONFIG.DICEBEAR_BASE}/${CONFIG.STYLE}/svg?${params.toString()}`;
}

// ═══════════════════════════════════════════
// DELAY
// ═══════════════════════════════════════════
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes('--dry-run');
  const FORCE = args.includes('--force');
  const LIMIT_ARG = args.find(a => a.startsWith('--limit='));
  const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 0;
  const BATCH_ARG = args.find(a => a.startsWith('--batch='));
  const BATCH_SIZE = BATCH_ARG ? parseInt(BATCH_ARG.split('=')[1]) : CONFIG.BATCH_SIZE;

  console.log('═══════════════════════════════════════════');
  console.log('  LokFeel HD Avatar Generator (Turso Storage)');
  console.log(`  Style: ${CONFIG.STYLE} (DiceBear 9.x)`);
  console.log(`  Output: ${CONFIG.OUTPUT_SIZE}×${CONFIG.OUTPUT_SIZE} WebP → base64 → Turso`);
  console.log(`  Batch: ${BATCH_SIZE} | Limit: ${LIMIT || 'all'} | Force: ${FORCE}`);
  console.log(`  Dry Run: ${DRY_RUN}`);
  console.log('═══════════════════════════════════════════\n');

  // 查询 bot 用户
  const where: any = { isBot: true };
  const botUsers = await prisma.user.findMany({
    where,
    include: {
      profile: {
        select: { id: true, avatar: true, avatarType: true, gender: true, displayName: true },
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT > 0 ? { take: LIMIT } : {}),
  });

  // 过滤需要处理的
  const toProcess = botUsers.filter(user => {
    if (!user.profile) return false;
    if (FORCE) return true;
    const avatar = user.profile.avatar || '';
    // 跳过已有 base64 WebP 的
    if (avatar.startsWith('data:image/webp')) return false;
    return true;
  });

  console.log(`Bot users total: ${botUsers.length}`);
  console.log(`To process: ${toProcess.length} (skipping ${botUsers.length - toProcess.length} already HD)\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Would process:');
    for (const u of toProcess.slice(0, 10)) {
      console.log(`  ${u.profile!.displayName} | ${u.profile!.gender} | ${u.profile!.avatar?.slice(0, 60) || 'none'}`);
    }
    if (toProcess.length > 10) console.log(`  ... and ${toProcess.length - 10} more`);
    return;
  }

  const startTime = Date.now();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const sharp = (await import('sharp')).default;

  const batches = Math.ceil(toProcess.length / BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < batches; batchIdx++) {
    const batch = toProcess.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);

    if (batchIdx % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = ((updated / toProcess.length) * 100).toFixed(1);
      console.log(`📊 Batch ${batchIdx + 1}/${batches} | ${updated}/${toProcess.length} (${pct}%) | ${elapsed}s`);
    }

    for (const user of batch) {
      try {
        const profile = user.profile!;
        const seed = `${profile.displayName}-${profile.gender}-lorelei`;
        const url = getDiceBearUrl(seed, profile.gender, CONFIG.SVG_SIZE);

        // 下载 SVG
        let svgBuffer: Buffer | null = null;
        for (let retry = 0; retry < CONFIG.MAX_RETRIES; retry++) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`DiceBear ${resp.status}`);
            svgBuffer = Buffer.from(await resp.arrayBuffer());
            break;
          } catch (e) {
            if (retry === CONFIG.MAX_RETRIES - 1) throw e;
            await delay(CONFIG.RETRY_DELAY);
          }
        }

        if (!svgBuffer) throw new Error('No SVG data');

        // Sharp: SVG → WebP
        const webpBuffer = await sharp(svgBuffer)
          .resize(CONFIG.OUTPUT_SIZE, CONFIG.OUTPUT_SIZE, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .webp({ quality: CONFIG.WEBP_QUALITY })
          .toBuffer();

        const dataUrl = `data:image/webp;base64,${webpBuffer.toString('base64')}`;

        // 写入 Turso
        await prisma.profile.update({
          where: { id: profile.id },
          data: {
            avatar: dataUrl,
            avatarType: 'photo',
          },
        });

        updated++;
      } catch (error) {
        failed++;
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${user.profile?.displayName || user.id}: ${msg}`);
        if (failed <= 5) console.error(`  ✗ ${user.profile?.displayName}: ${msg}`);
      }
    }

    // 批间延时
    if (batchIdx < batches - 1) {
      await delay(CONFIG.DELAY_BETWEEN_BATCHES);
    }
  }

  const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (updated / (Date.now() - startTime) * 60000).toFixed(1);

  console.log(`\n═══ HD Avatar Generation Complete ═══`);
  console.log(`  Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`  Time: ${totalSeconds}s | Rate: ${rate}/min`);
  if (errors.length > 0) {
    console.log(`  Errors (first 10):`);
    errors.slice(0, 10).forEach(e => console.log(`    ${e}`));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
