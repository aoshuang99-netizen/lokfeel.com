import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, unauthorized, serverError } from '@/lib/api-response'
import { withPermission } from '@/lib/with-permission'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/upgrade-avatars
 *
 * 为 bot 用户分配可靠的 DiceBear 头像 URL
 * 替代不可靠的 pravatar.cc / thispersondoesnotexist.com
 *
 * Body:
 *   { mode?: 'url' | 'hd', batch?: number, force?: boolean, dryRun?: boolean }
 *
 * 注：DiceBear 返回 SVG（分辨率无关），url 和 hd 模式行为一致。
 */

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x'

const STYLES = ['avataaars', 'adventurer', 'lorelei']

function generateDiceBearUrl(seed: string, gender?: string): string {
  const style = STYLES[Math.abs(hashCode(seed)) % STYLES.length]
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN'
  const bgColor = isFemale
    ? 'f3a8f9,ec4899,f472b6'
    : '3b82f6,6366f1,06b6d4'
  return `${DICEBEAR_BASE}/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=50`
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash
}

export const POST = withPermission('user.edit')(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const mode = body.mode || 'url'
    const batchSize = Math.min(body.batch || 200, 500)
    const force = body.force || false
    const dryRun = body.dryRun || false

    // 查询需要升级的 bot 用户
    const botUsers = await db.user.findMany({
      where: {
        isBot: true,
        ...(force ? {} : {
          profile: {
            OR: [
              { avatar: { startsWith: 'emoji:' } },
              { avatar: { contains: 'randomuser.me' } },
              { avatar: { contains: 'pravatar.cc' } },
              { avatar: { contains: 'thispersondoesnotexist.com' } },
              { avatar: { contains: 'images.unsplash.com' } },
              { avatar: null },
            ],
          },
        }),
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
      return success({
        mode,
        totalEligible: botUsers.length,
        sample: botUsers.slice(0, 5).map(u => ({
          id: u.id,
          name: u.profile?.displayName,
          currentAvatar: u.profile?.avatar?.substring(0, 80) || 'none',
          type: u.profile?.avatarType || 'unknown',
        })),
        message: 'Dry run — no changes made',
      })
    }

    const results: Array<{
      userId: string
      displayName: string
      status: 'upgraded' | 'skipped' | 'failed'
      newAvatar?: string
      error?: string
    }> = []

    let upgraded = 0
    let failed = 0
    let skipped = 0

    for (const user of botUsers) {
      try {
        if (!user.profile?.id) {
          skipped++
          results.push({
            userId: user.id,
            displayName: 'Unknown',
            status: 'skipped',
          })
          continue
        }

        const displayName = user.profile?.displayName || user.name || user.id
        const gender = user.profile?.gender || 'FEMALE'
        const avatarUrl = generateDiceBearUrl(displayName, gender)

        await db.profile.update({
          where: { id: user.profile.id },
          data: {
            avatar: avatarUrl,
            avatarType: 'photo',
          },
        })

        upgraded++
        results.push({
          userId: user.id,
          displayName,
          status: 'upgraded',
          newAvatar: avatarUrl,
        })
      } catch (error) {
        failed++
        const errMsg = error instanceof Error ? error.message : String(error)
        results.push({
          userId: user.id,
          displayName: user.profile?.displayName || 'Unknown',
          status: 'failed',
          error: errMsg,
        })
      }
    }

    return success({
      mode,
      total: botUsers.length,
      upgraded,
      failed,
      skipped,
      results: results.slice(0, 10),
      message: `Upgraded ${upgraded} avatars to DiceBear URLs`,
    })
  } catch (error) {
    console.error('Upgrade avatars error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return serverError(`Avatar upgrade failed: ${message}`)
  }
})
