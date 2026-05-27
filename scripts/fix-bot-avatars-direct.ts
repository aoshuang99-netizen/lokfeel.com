/**
 * fix-bot-avatars-direct.ts
 * 直接连接数据库，批量将 bot 头像从 broken CDN 迁移到 DiceBear
 * 不依赖 API 认证
 */

import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x'

function hashSeed(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function getDiceBearUrl(seed: string, gender?: string | null): string {
  const isFemale =
    (gender || '').toUpperCase() === 'FEMALE' ||
    (gender || '').toUpperCase() === 'WOMAN'
  const bgColor = isFemale
    ? 'f3a8f9,ec4899,f472b6'
    : '3b82f6,6366f1,06b6d4'
  return `${DICEBEAR_BASE}/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=50`
}

const BROKEN_PATTERNS = [
  'images.unsplash.com',
  'randomuser.me',
  'i.pravatar.cc',
  'thispersondoesnotexist.com',
  'pravatar.cc',
  'ui-avatars.com',
]

function isBrokenUrl(url: string | null | undefined): boolean {
  if (!url) return true
  return BROKEN_PATTERNS.some((p) => url.includes(p))
}

async function main() {
  console.log('[fix-bot-avatars] Starting...')

  // 1. 找到所有需要修复的 bot 用户
  const bots = await prisma.user.findMany({
    where: {
      isBot: true,
      OR: [
        { avatar: null },
        { avatar: { in: [''] } },
        // 注意：Prisma 不支持直接的 StringContains 过滤，需要分批处理
      ],
    },
    include: { profile: true },
    take: 10000,
  })

  console.log(`[fix-bot-avatars] Found ${bots.length} bot users`)

  // 过滤出确实需要修复的（avatar 为 null/空/或包含 broken pattern）
  const needsFix = bots.filter((b) => isBrokenUrl(b.avatar))
  console.log(`[fix-bot-avatars] ${needsFix.length} need avatar fix`)

  // 也检查 Profile.avatar
  const profiles = await prisma.$queryRaw<Array<{ id: string; avatar: string | null }>>(`
    SELECT id, avatar FROM "Profile"
    WHERE "userId" IN (SELECT id FROM "User" WHERE "isBot" = true)
    AND (avatar IS NULL OR avatar = '' OR avatar LIKE '%unsplash%' OR avatar LIKE '%randomuser%' OR avatar LIKE '%pravatar%' OR avatar LIKE '%thispersondoesnotexist%')
    LIMIT 10000
  `)
  console.log(`[fix-bot-avatars] ${profiles.length} profiles need avatar fix`)

  // 2. 批量更新 User.avatar
  let fixedUsers = 0
  for (const bot of needsFix) {
    try {
      const seed = hashSeed(`bot-${bot.id}-${bot.displayName || 'bot'}`)
      const url = getDiceBearUrl(seed, bot.profile?.gender)
      await prisma.user.update({
        where: { id: bot.id },
        data: { avatar: url },
      })
      fixedUsers++
      if (fixedUsers % 500 === 0) {
        console.log(`[fix-bot-avatars] Fixed ${fixedUsers}/${needsFix.length} users...`)
      }
    } catch (e: any) {
      console.error(`[fix-bot-avatars] Error fixing user ${bot.id}:`, e.message)
    }
  }
  console.log(`[fix-bot-avatars] ✅ Fixed ${fixedUsers} User avatars`)

  // 3. 批量更新 Profile.avatar
  let fixedProfiles = 0
  for (const p of profiles) {
    try {
      // 获取用户信息
      const user = await prisma.user.findFirst({
        where: { profile: { id: p.id } },
        include: { profile: true },
      })
      const seed = hashSeed(`bot-profile-${p.id}`)
      const url = getDiceBearUrl(seed, user?.profile?.gender)
      await prisma.$executeRaw`UPDATE "Profile" SET avatar = ${url} WHERE id = ${p.id}`
      fixedProfiles++
      if (fixedProfiles % 500 === 0) {
        console.log(`[fix-bot-avatars] Fixed ${fixedProfiles}/${profiles.length} profiles...`)
      }
    } catch (e: any) {
      console.error(`[fix-bot-avatars] Error fixing profile ${p.id}:`, e.message)
    }
  }
  console.log(`[fix-bot-avatars] ✅ Fixed ${fixedProfiles} Profile avatars`)

  // 4. 验证
  const剩余 = await prisma.$queryRaw<Array<{ count: bigint }>>(`
    SELECT COUNT(*) as count FROM "Profile"
    WHERE "userId" IN (SELECT id FROM "User" WHERE "isBot" = true)
    AND (avatar IS NULL OR avatar = '' OR avatar LIKE '%unsplash%' OR avatar LIKE '%randomuser%')
  `)
  console.log(`[fix-bot-avatars] Remaining broken profiles: ${剩余[0]?.count || 0}`)

  console.log('\n[fix-bot-avatars] ✅ Done!')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('Fatal error:', e)
  await prisma.$disconnect()
  process.exit(1)
})
