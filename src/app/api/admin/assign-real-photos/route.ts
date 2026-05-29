import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, serverError } from '@/lib/api-response'
import { withPermission } from '@/lib/with-permission'

/**
 * POST /api/admin/assign-real-photos
 *
 * 为 bot 用户分配真实高清照片（randomuser.me 静态图片）
 * 替代 DiceBear 卡通头像
 *
 * Body:
 *   { dryRun?: boolean, batch?: number, force?: boolean }
 *
 * Response:
 *   { updated, skipped, totalProcessed, remaining, results[] }
 */

const RANDOMUSER_BASE = 'https://randomuser.me/api/portraits'

function generateRealPhotoUrl(seed: string, gender?: string | null): string {
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN'
  const hash = Math.abs(seed.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0))
  const index = (hash % 99) + 1  // 1-99
  const folder = isFemale ? 'women' : 'men'
  return `${RANDOMUSER_BASE}/${folder}/${index}.jpg`
}

function isDiceBearUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return url.includes('api.dicebear.com') || url.includes('dicebear')
}

function isDataUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return url.startsWith('data:')
}

export const POST = withPermission('bot.edit', { dangerous: true })(
  async (request: NextRequest) => {
    try {
      const body = await request.json().catch(() => ({}))
      const dryRun = body.dryRun === true
      const force = body.force === true
      const batchSize = Math.min(body.batch || 500, 2000)

      // ── Step 1: 查找需要真实照片的 bot 用户 ──
      console.log('[assign-real-photos] Step 1: Finding bots needing real photos...')

      const where: any = {
        user: { isBot: true },
      }

      if (!force) {
        // 只处理 DiceBear 卡通头像或 null 的用户
        where.OR = [
          { avatar: null },
          { avatar: '' },
          { avatar: { startsWith: 'emoji:' } },
          { avatar: { contains: 'dicebear.com' } },
          { avatar: { contains: 'api.dicebear.com' } },
        ]
      }

      const totalCount = await db.profile.count({ where })

      console.log(`[assign-real-photos] Found ${totalCount} bot profiles needing real photos`)

      if (totalCount === 0) {
        return success({
          message: '✅ 所有 bot 用户已有真实照片！',
          updated: 0,
          remaining: 0,
        })
      }

      // ── Step 2: 加载需要修复的 profile ──
      const profilesToFix = await db.profile.findMany({
        where,
        select: {
          id: true,
          userId: true,
          displayName: true,
          gender: true,
          avatar: true,
          avatarType: true,
        },
        take: batchSize,
        orderBy: { id: 'asc' },
      })

      console.log(`[assign-real-photos] Processing ${profilesToFix.length} profiles...`)

      if (dryRun) {
        const sample = profilesToFix.slice(0, 5).map((p, i) => ({
          name: p.displayName,
          gender: p.gender,
          currentAvatar: (p.avatar || 'none').substring(0, 60),
          newAvatar: generateRealPhotoUrl(p.displayName || p.id, p.gender),
        }))

        return success({
          dryRun: true,
          totalEligible: totalCount,
          willProcess: profilesToFix.length,
          sample,
          message: `Dry run — 将为此 ${profilesToFix.length} 个 bot 分配真实照片`,
        })
      }

      // ── Step 3: 分配真实照片 ──
      console.log('[assign-real-photos] Step 3: Assigning real photos...')

      let updated = 0
      let skipped = 0
      const errors: Array<{ profileId: string; error: string }> = []
      const results: Array<{ name: string; gender: string; newAvatar: string }> = []

      const subBatchSize = 50
      for (let i = 0; i < profilesToFix.length; i += subBatchSize) {
        const subBatch = profilesToFix.slice(i, i + subBatchSize)

        await Promise.all(
          subBatch.map(async (profile) => {
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
              if (results.length < 10) {
                results.push({
                  name: profile.displayName || 'Unknown',
                  gender: profile.gender || 'UNKNOWN',
                  newAvatar: photoUrl,
                })
              }
            } catch (err) {
              skipped++
              const msg = err instanceof Error ? err.message : 'Unknown error'
              errors.push({ profileId: profile.id, error: msg })
            }
          })
        )

        if ((i + subBatchSize) % 200 === 0 && i + subBatchSize < profilesToFix.length) {
          console.log(`[assign-real-photos] Progress: ${Math.min(i + subBatchSize, profilesToFix.length)}/${profilesToFix.length}`)
        }
      }

      // ── Step 4: 验证剩余数量 ──
      const remaining = await db.profile.count({ where })

      console.log(`[assign-real-photos] Done! updated=${updated} skipped=${skipped} remaining=${remaining}`)

      return success({
        updated,
        skipped,
        errors: errors.slice(0, 10),
        totalProcessed: updated + skipped,
        remaining,
        results,
        message: remaining === 0
          ? `✅ 所有 bot 用户已分配真实照片！(更新: ${updated})`
          : `已更新 ${updated} 个 profile。剩余 ${remaining} 个 — 请再次运行。`,
      })
    } catch (error) {
      console.error('[assign-real-photos] Fatal error:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      return serverError(`Real photo assignment failed: ${message}`)
    }
  }
)
