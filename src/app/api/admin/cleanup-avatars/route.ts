import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, serverError } from '@/lib/api-response'

/**
 * POST /api/admin/cleanup-avatars
 * 
 * 清理大体积头像（data URL），替换为外部URL
 * 释放Neon PostgreSQL存储空间
 * 
 * Body:
 *   { batch?: number, dryRun?: boolean }
 */

const RANDOMUSER_BASE = 'https://randomuser.me/api/portraits'

export async function POST(request: NextRequest) {
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

        const gender = user.profile?.gender === 'MALE' ? 'men' : 'women'
        const imgId = (cleaned % 99) + 1
        const avatarUrl = `${RANDOMUSER_BASE}/${gender}/${imgId}.jpg`

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
    }, 200)

  } catch (error) {
    console.error('Cleanup avatars error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return serverError(`Avatar cleanup failed: ${message}`)
  }
}
