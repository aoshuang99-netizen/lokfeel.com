import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, serverError } from '@/lib/api-response'

/**
 * POST /api/admin/upgrade-avatars
 * 
 * 升级bot用户头像到更高分辨率
 * 
 * 策略:
 * - 模式1 (默认): 用pravatar.cc 512px URL替换128px RandomUser.me URL
 * - 模式2 (hd): 用TPDNE 1024px JPEG data URL替换 (慢, 每批5个)
 * 
 * Body:
 *   { mode?: 'url' | 'hd', batch?: number, force?: boolean, dryRun?: boolean }
 */

const PRAVATAR_BASE = 'https://i.pravatar.cc'
const TPDNE_URL = 'https://thispersondoesnotexist.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const mode = body.mode || 'url' // 'url' = fast URL swap, 'hd' = TPDNE data URL
    const batchSize = Math.min(body.batch || (mode === 'hd' ? 5 : 200), mode === 'hd' ? 10 : 500)
    const force = body.force || false
    const dryRun = body.dryRun || false

    // 查询需要升级的bot用户
    const botUsers = await db.user.findMany({
      where: {
        isBot: true,
        ...(force ? {} : {
          profile: {
            OR: [
              { avatar: { startsWith: 'emoji:' } },
              { avatar: { contains: 'randomuser.me/api/portraits/' } },
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

    if (mode === 'url') {
      // ─── Fast Mode: URL swap to pravatar.cc 512px ───
      for (const user of botUsers) {
        try {
          if (!user.profile?.id) {
            skipped++
            continue
          }

          const gender = user.profile?.gender || 'FEMALE'
          // pravatar.cc: 1-70 for images, 512px size
          const imgId = (upgraded + Math.floor(Math.random() * 70) + 1)
          const avatarUrl = `${PRAVATAR_BASE}/512?img=${imgId}`

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
            displayName: user.profile?.displayName || 'Unknown',
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
    } else {
      // ─── HD Mode: TPDNE 1024px JPEG → data URL ───
      for (const user of botUsers) {
        try {
          if (!user.profile?.id) {
            skipped++
            continue
          }

          const response = await fetch(TPDNE_URL, {
            headers: { 'User-Agent': USER_AGENT },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          })

          if (!response.ok) throw new Error(`TPDNE ${response.status}`)

          const buffer = Buffer.from(await response.arrayBuffer())

          if (buffer.length < 10000) throw new Error('Image too small')

          const base64 = buffer.toString('base64')
          const dataUrl = `data:image/jpeg;base64,${base64}`

          await db.profile.update({
            where: { id: user.profile!.id },
            data: {
              avatar: dataUrl,
              avatarType: 'photo',
            },
          })

          upgraded++
          results.push({
            userId: user.id,
            displayName: user.profile?.displayName || 'Unknown',
            status: 'upgraded',
            newAvatar: `data:image/jpeg;base64,...(${(buffer.length / 1024).toFixed(1)}KB)`,
          })

          // TPDNE限流延时
          await new Promise(resolve => setTimeout(resolve, 300))

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
    }

    return success({
      mode,
      upgraded,
      failed,
      skipped,
      total: botUsers.length,
      results: results.slice(0, 20),
      message: `${mode === 'url' ? 'URL' : 'HD'} upgrade: ${upgraded}/${botUsers.length} avatars`,
    }, 200)

  } catch (error) {
    console.error('Upgrade avatars error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return serverError(`Avatar upgrade failed: ${message}`)
  }
}
