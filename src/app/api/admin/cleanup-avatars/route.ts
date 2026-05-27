import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, serverError } from '@/lib/api-response'
import { withPermission } from '@/lib/with-permission'

/**
 * POST /api/admin/cleanup-avatars
 *
 * 清理大体积头像（data URL），替换为 DiceBear 外部URL
 * 释放 Neon PostgreSQL 存储空间
 * Requires: bot.edit permission (RBAC)
 *
 * Body:
 *   { batch?: number, dryRun?: boolean }
 */

// 使用 DiceBear API（可靠、免费、不被墙）
function generateDiceBearUrl(gender: string, index: number): string {
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN'
  const bgColor = isFemale
    ? 'f3a8f9,ec4899,f472b6'
    : '3b82f6,6366f1,06b6d4'
  // 用 index 作为 seed 的一部分，确保不同用户有不同头像
  const seed = `bot-cleanup-${index}`
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=50`
}

export const POST = withPermission('bot.edit', { dangerous: true })(
  async (request: NextRequest) => {
  try {
    const body = await request.json()
    const batchSize = Math.min(body.batch || 100, 500)
    const dryRun = body.dryRun || false

    // 查找所有使用data URL头像的bot用户 (占用DB空间的元凶)
    const botUsersWithDataURL = await db.user.findMany({
      where: {
        isBot: true,
        profile: {
          avatar: { startsWith: 'data:' },
        },
      },
      include: {
        profile: {
          select: { id: true, avatar: true, avatarType: true, displayName: true, gender: true },
        },
      },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    })

    if (dryRun) {
      // 计算data URL总大小
      let totalBytes = 0
      for (const user of botUsersWithDataURL) {
        const avatar = user.profile?.avatar || ''
        // data URL 的 base64 部分约等于 3/4 的字符串长度
        const base64Part = avatar.split(',')[1] || ''
        totalBytes += base64Part.length * 3 / 4
      }
      
      return success({
        totalWithDataURL: botUsersWithDataURL.length,
        estimatedSizeMB: (totalBytes / 1024 / 1024).toFixed(2),
        sample: botUsersWithDataURL.slice(0, 3).map(u => ({
          id: u.id,
          name: u.profile?.displayName,
          avatarSize: ((u.profile?.avatar?.split(',')[1]?.length || 0) * 3 / 4 / 1024).toFixed(1) + 'KB',
        })),
        message: 'Dry run — no changes made',
      })
    }

    let cleaned = 0
    let failed = 0

    for (const user of botUsersWithDataURL) {
      try {
        if (!user.profile?.id) continue

        const profileGender = (user.profile?.gender || '').toUpperCase()
        const gender = (profileGender === 'MALE' || profileGender === 'MAN') ? 'men' : 'women'
        const imgId = (cleaned % 99) + 1
        const avatarUrl = generateDiceBearUrl(profileGender, cleaned)

        await db.profile.update({
          where: { id: user.profile.id },
          data: {
            avatar: avatarUrl,
            avatarType: 'photo',
          },
        })

        cleaned++
      } catch (error) {
        failed++
      }
    }

    return success({
      cleaned,
      failed,
      total: botUsersWithDataURL.length,
      message: `Cleaned ${cleaned} data URL avatars → external URLs`,
    })

  } catch (error) {
    console.error('Cleanup avatars error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return serverError(`Avatar cleanup failed: ${message}`)
  }
  }
);
