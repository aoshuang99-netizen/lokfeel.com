#!/usr/bin/env npx tsx
/**
 * db-fix-bot-photos.ts
 * 为 bot 用户批量分配 randomuser.me 真实高清照片
 * 
 * 使用：npx tsx scripts/db-fix-bot-photos.ts
 */

import { db } from '../src/lib/db.js'

const RANDOMUSER_BASE = 'https://randomuser.me/api/portraits'

function generateRealPhotoUrl(seed: string, gender?: string | null): string {
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN'
  const hash = Math.abs(seed.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0))
  const index = (hash % 99) + 1  // 1-99
  const folder = isFemale ? 'women' : 'men'
  return `${RANDOMUSER_BASE}/${folder}/${index}.jpg`
}

async function main() {
  console.log('🔧 Bot 用户真实照片修复脚本')
  console.log('='.repeat(50))

  // 统计需要修复的数量
  const needFixCount = await db.profile.count({
    where: {
      user: { isBot: true },
      OR: [
        { avatar: null },
        { avatar: '' },
        { avatar: { startsWith: 'emoji:' } },
        { avatar: { contains: 'dicebear.com' } },
      ],
    },
  })

  console.log(`📊 需要修复的 bot profile 数量: ${needFixCount}`)

  if (needFixCount === 0) {
    console.log('✅ 所有 bot 用户已有真实照片！')
    await db.$disconnect()
    process.exit(0)
  }

  // 加载需要修复的 profiles
  const profiles = await db.profile.findMany({
    where: {
      user: { isBot: true },
      OR: [
        { avatar: null },
        { avatar: '' },
        { avatar: { startsWith: 'emoji:' } },
        { avatar: { contains: 'dicebear.com' } },
      ],
    },
    select: {
      id: true,
      displayName: true,
      gender: true,
      avatar: true,
    },
    take: 2000,
    orderBy: { id: 'asc' },
  })

  console.log(`🔨 开始修复 ${profiles.length} 个 profiles...`)

  let updated = 0
  let skipped = 0
  const errors: string[] = []

  // 分批处理
  const batchSize = 50  // 减小批次大小以适应 Turso 延迟
  for (let i = 0; i < profiles.length; i += batchSize) {
    const batch = profiles.slice(i, i + batchSize)

    // 顺序处理（避免 Turso 并发问题）
    for (const profile of batch) {
      try {
        const photoUrl = generateRealPhotoUrl(
          profile.displayName || profile.id,
          profile.gender
        )

        await db.profile.update({
          where: { id: profile.id },
          data: {
            avatar: photoUrl,
            avatarType: 'photo',
          },
        })

        updated++
      } catch (err) {
        skipped++
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`  Profile ${profile.id}: ${msg}`)
      }
    }

    console.log(`  进度: ${Math.min(i + batchSize, profiles.length)}/${profiles.length}`)
  }

  console.log('='.repeat(50))
  console.log(`✅ 修复完成！`)
  console.log(`  更新: ${updated}`)
  console.log(`  跳过: ${skipped}`)
  if (errors.length > 0) {
    console.log(`  错误: ${errors.length}`)
    errors.slice(0, 5).forEach(e => console.error(e))
  }

  // 验证剩余数量
  const remaining = await db.profile.count({
    where: {
      user: { isBot: true },
      OR: [
        { avatar: null },
        { avatar: '' },
        { avatar: { startsWith: 'emoji:' } },
        { avatar: { contains: 'dicebear.com' } },
      ],
    },
  })

  console.log(`  剩余未修复: ${remaining}`)

  await db.$disconnect()
}

main().catch(async (err) => {
  console.error('❌ 脚本执行失败:', err)
  await db.$disconnect()
  process.exit(1)
})
