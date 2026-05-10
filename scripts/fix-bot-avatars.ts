#!/usr/bin/env node;

/**
 * fix-bot-avatars.ts
 * 将 bot 用户的头像从 DiceBear 卡通/emoji 更新为真实照片
 * 真实照片位于 /public/bot-avatars/male/*.jpg
 */

import * as path from 'path';
import * as fs from 'fs';
import { getDb } from '../src/lib/db';

async function main() {
  const prisma = getDb();
  
  console.log('🔧 Fixing bot avatars...\n');

  // 1. 获取所有 bot 用户
  const bots = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@lokfeel.bot' } },
        { isBot: true },
      ],
    },
    include: { profile: true },
  });

  console.log(`Found ${bots.length} bot users`);

  if (bots.length === 0) {
    console.log('No bot users found. Exiting.');
    return;
  }

  // 2. 获取真实照片列表
  const botAvatarsDir = path.join(process.cwd(), 'public', 'bot-avatars', 'male');  
  let photoFiles: string[] = [];
  try {
    photoFiles = fs.readdirSync(botAvatarsDir)
      .filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'))
      .map(f => `/bot-avatars/male/${f}`);
  } catch (err: any) {
    console.error('Failed to read bot-avatars directory:', err.message);
    console.log('Will use randomuser.me API instead...');
  }

  console.log(`Found ${photoFiles.length} real photos in /bot-avatars/male/\n`);

  // 3. 更新每个 bot 的头像
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    const profile = bot.profile;

    if (!profile) {
      console.log(`  ⚠️  ${bot.email}: No profile found`);
      skipped++;
      continue;
    }

    // 检查当前头像是否已经是真实照片
    const currentAvatar = profile.avatar;
    const isRealPhoto = currentAvatar && (
      currentAvatar.startsWith('/bot-avatars/') ||
      currentAvatar.startsWith('/avatars/') ||
      (currentAvatar.includes('randomuser.me') && !currentAvatar.includes('dicebear'))
    );

    if (isRealPhoto) {
      console.log(`  ✓ ${bot.email}: Already has real photo`);
      skipped++;
      continue;
    }

    // 分配一张真实照片
    let newAvatar: string;

    if (photoFiles.length > 0) {
      // 使用真实照片
      newAvatar = photoFiles[i % photoFiles.length];
    } else {
      // fallback: 使用 randomuser.me 的真实照片 API
      const gender = profile.gender?.toLowerCase() || 'male';
      newAvatar = `https://randomuser.me/api/portraits/${gender}s/${Math.floor(Math.random() * 100)}.jpg`;
    }

    // 更新数据库
    await prisma.profile.update({
      where: { id: profile.id },
      data: {
        avatar: newAvatar,
        avatarType: 'photo',
      },
    });

    console.log(`  ✅ ${bot.email}: ${currentAvatar || '(none)'} → ${newAvatar}`);
    updated++;
  }

  console.log(`\n📊 Summary:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total: ${bots.length}`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    const prisma = getDb();
    await prisma.$disconnect();
  });
