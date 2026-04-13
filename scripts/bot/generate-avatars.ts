#!/usr/bin/env npx tsx

/**
 * 批量生成数字用户头像脚本
 * 
 * 用法:
 *   npx tsx scripts/bot/generate-avatars.ts          # 生成所有头像
 *   npx tsx scripts/bot/generate-avatars.ts --limit 100  # 只生成100个
 *   npx tsx scripts/bot/generate-avatars.ts --dry-run    # 模拟运行
 */

import 'dotenv/config';
import { getDb } from '../../src/lib/db';
import { BotAvatarGenerator } from '../../src/lib/bot/avatar-generator';

interface GenerationResult {
  success: boolean;
  url?: string;
  error?: string;
}

const prisma = getDb();

interface CliArgs {
  limit?: number;
  dryRun?: boolean;
  botType?: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      args.limit = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--dry-run') {
      args.dryRun = true;
    } else if (argv[i] === '--bot-type' && argv[i + 1]) {
      args.botType = argv[i + 1];
      i++;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎨 LokFeel 数字用户头像批量生成脚本');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📋 配置:');
  console.log(`   - 限制数量: ${args.limit || '无限制'}`);
  console.log(`   - 模拟运行: ${args.dryRun ? '是 ⚠️' : '否'}`);
  console.log(`   - Bot类型: ${args.botType || '所有类型'}`);
  console.log('');

  // 1. 查询需要生成头像的Bot
  console.log('📊 Step 1: 查询 Bot 用户...');
  
  // 只查询还没有头像的
  const existingAvatarBotIds = await prisma.botAvatar.findMany({
    where: { status: 'active' },
    select: { botId: true }
  });

  const bots = await prisma.botProfile.findMany({
    where: existingAvatarBotIds.length > 0 ? {
      NOT: { id: { in: existingAvatarBotIds.map(a => a.botId) } }
    } : {},
    include: {
      profile: {
        include: {
          user: {
            select: { isBot: true }
          }
        }
      }
    },
    take: args.limit,
    orderBy: { createdAt: 'asc' }
  });

  console.log(`   ✓ 找到 ${bots.length} 个需要生成头像的 Bot`);
  console.log('');

  if (bots.length === 0) {
    console.log('✨ 所有 Bot 头像已生成完毕！');
    return;
  }

  // 2. 模拟运行检查
  if (args.dryRun) {
    console.log('⚠️ [DRY RUN] 以下 Bot 将被处理:');
    console.log('');
    
    for (const bot of bots.slice(0, 10)) {
      console.log(`   - ${bot.profile.displayName} (${bot.profile.gender}, ${bot.profile.age})`);
    }
    
    if (bots.length > 10) {
      console.log(`   ... 还有 ${bots.length - 10} 个`);
    }
    
    console.log('');
    console.log('💡 要实际执行，请去掉 --dry-run 参数');
    return;
  }

  // 3. 初始化头像生成器
  console.log('🚀 Step 2: 初始化头像生成器...');
  const generator = new BotAvatarGenerator('./public/avatars/bots');
  console.log('');

  // 4. 批量生成
  console.log('⚡ Step 3: 开始生成头像...');
  console.log('   策略优先级:');
  console.log('   1️⃣ ThisPersonDoesNotExist (AI生成，无法反向搜索)');
  console.log('   2️⃣ RandomUser.me (多样化真实照片)');
  console.log('   3️⃣ UI Avatars (基于名字生成，备选)');
  console.log('');

  const startTime = Date.now();
  // 转换类型以兼容
  const typedBots = bots.map(b => ({
    ...b,
    avatarStyle: b.avatarStyle || undefined
  })) as any;
  const results = await generator.batchGenerateAndSave(typedBots);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // 5. 统计结果
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📈 生成结果统计');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const successRate = ((successCount / results.length) * 100).toFixed(1);

  console.log(`   ⏱️  总耗时: ${elapsed}s`);
  console.log(`   📊 总计: ${results.length} 个`);
  console.log(`   ✅ 成功: ${successCount} (${successRate}%)`);
  console.log(`   ❌ 失败: ${failCount}`);

  if (failCount > 0) {
    console.log('');
    console.log('   失败详情:');
    const failures = results.filter(r => !r.success);
    for (const f of failures.slice(0, 5)) {
      console.log(`   - ${f.botId}: ${f.error}`);
    }
    if (failures.length > 5) {
      console.log(`   ... 还有 ${failures.length - 5} 个失败`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');

  // 6. 更新 BotAvatar 表统计
  const totalActive = await prisma.botAvatar.count({ where: { status: 'active' } });
  const totalPending = await prisma.botAvatar.count({ where: { status: 'pending' } });
  const totalFailed = await prisma.botAvatar.count({ where: { status: 'failed' } });

  console.log('📊 BotAvatar 表统计:');
  console.log(`   - active: ${totalActive}`);
  console.log(`   - pending: ${totalPending}`);
  console.log(`   - failed: ${totalFailed}`);

  await prisma.$disconnect();
  
  console.log('');
  console.log('✨ 头像生成完成！');
}

// 错误处理
main().catch((error) => {
  console.error('');
  console.error('❌ 脚本执行失败:');
  console.error(error);
  process.exit(1);
});
