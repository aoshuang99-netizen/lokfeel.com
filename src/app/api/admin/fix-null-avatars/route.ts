import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, serverError, badRequest } from '@/lib/api-response'
import { withPermission } from '@/lib/with-permission'

/**
 * POST /api/admin/fix-null-avatars
 *
 * Fixes the BotAvatar → Profile.avatar broken link.
 * Problem: ~7,000 bot profiles have avatar=null, but BotAvatar table
 * has 7,500 active avatar records that were never written back to Profile.avatar.
 *
 * Also replaces broken CDN URLs (pravatar.cc, thispersondoesnotexist.com, randomuser.me)
 * with reliable DiceBear API URLs.
 *
 * Requires: bot.edit permission (RBAC)
 *
 * Body:
 *   { dryRun?: boolean, batch?: number }
 *
 * Response:
 *   { fixed, generated, skipped, total, errors[] }
 */

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x'

// CDNs known to be broken or unreliable (NOT DiceBear!)
const BROKEN_CDN_PATTERNS = [
  'i.pravatar.cc',               // Cloudflare challenge → 403 since 2026-04
  'thispersondoesnotexist.com',   // Often slow/unreliable/rate-limited
  'randomuser.me',                // Limited set of 99 images, unreliable
  'images.unsplash.com',          // BLOCKED in China (Great Firewall)
]

function isBrokenUrl(url: string | null | undefined): boolean {
  if (!url) return true
  return BROKEN_CDN_PATTERNS.some(pattern => url.includes(pattern))
}

function generateDiceBearUrl(seed: string, gender?: string | null): string {
  const isFemale = (gender || '').toUpperCase() === 'FEMALE' || (gender || '').toUpperCase() === 'WOMAN'
  const bgColor = isFemale
    ? 'f3a8f9,ec4899,f472b6'
    : '3b82f6,6366f1,06b6d4'
  return `${DICEBEAR_BASE}/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=50`
}

export const POST = withPermission('bot.edit', { dangerous: true })(
  async (request: NextRequest) => {
    try {
      const body = await request.json().catch(() => ({}))
      const dryRun = body.dryRun === true
      const batchSize = Math.min(body.batch || 200, 1000)

      // ── Step 1: Find bot profiles with null/empty avatar ──
      console.log('[fix-null-avatars] Step 1: Finding bots with null avatars...')

      const nullCount = await db.profile.count({
        where: {
          user: { isBot: true },
          OR: [{ avatar: null }, { avatar: '' }],
        },
      })

      console.log(`[fix-null-avatars] Found ${nullCount} bot profiles with null avatar`)

      if (nullCount === 0) {
        return success({ message: 'No null avatars found — all bot profiles have avatars', fixed: 0 })
      }

      // ── Step 2: Load BotAvatar links ──
      console.log('[fix-null-avatars] Step 2: Loading BotAvatar records...')

      const botAvatars = await db.botAvatar.findMany({
        where: { status: 'active' },
        select: {
          botId: true,
          originalUrl: true,
          processedUrl: true,
        },
      })

      // Build botId → best URL map (filter out broken CDNs)
      const avatarMap = new Map<string, string>()
      for (const ba of botAvatars) {
        if (!ba.botId || avatarMap.has(ba.botId)) continue
        const bestUrl = ba.processedUrl || ba.originalUrl
        if (bestUrl && !isBrokenUrl(bestUrl)) {
          avatarMap.set(ba.botId, bestUrl)
        }
      }

      console.log(`[fix-null-avatars] Mapped ${avatarMap.size} bot IDs to working avatar URLs (filtered ${botAvatars.length - avatarMap.size} broken)`)

      // ── Step 3: Get profiles to fix ──
      console.log('[fix-null-avatars] Step 3: Loading profiles to fix...')

      const profilesToFix = await db.profile.findMany({
        where: {
          user: { isBot: true },
          OR: [{ avatar: null }, { avatar: '' }],
        },
        select: {
          id: true,
          userId: true,
          displayName: true,
          gender: true,
          avatarType: true,
        },
        take: batchSize,
        orderBy: { id: 'asc' },
      })

      if (dryRun) {
        const withBotAvatar = profilesToFix.filter(p => p.userId && avatarMap.has(p.userId)).length
        const needGenerate = profilesToFix.length - withBotAvatar

        const sample = profilesToFix.slice(0, 5).map((p, i) => {
          const fromBotAvatar = p.userId && avatarMap.has(p.userId)
          const url = fromBotAvatar
            ? avatarMap.get(p.userId!)!
            : generateDiceBearUrl(p.displayName || p.id || `bot-${i}`, p.gender)
          return {
            name: p.displayName,
            userId: p.userId,
            gender: p.gender,
            source: fromBotAvatar ? 'BotAvatar' : 'dicebear',
            url: url?.substring(0, 80) + '...',
          }
        })

        return success({
          dryRun: true,
          totalNullAvatars: nullCount,
          profilesToFixThisBatch: profilesToFix.length,
          fromBotAvatar: withBotAvatar,
          needGenerate,
          botAvatarMapSize: avatarMap.size,
          sample,
          message: `Dry run — would fix ${profilesToFix.length} profiles (${withBotAvatar} from BotAvatar, ${needGenerate} from DiceBear)`,
        })
      }

      // ── Step 4: Fix avatars in batches ──
      console.log('[fix-null-avatars] Step 4: Writing avatar URLs to profiles...')

      let fixed = 0
      let generated = 0
      let skipped = 0
      const errors: Array<{ profileId: string; error: string }> = []
      const subBatchSize = 25

      for (let i = 0; i < profilesToFix.length; i += subBatchSize) {
        const subBatch = profilesToFix.slice(i, i + subBatchSize)

        await Promise.all(subBatch.map(async (profile, idx) => {
          try {
            let avatarUrl: string | null = null
            let source: string = 'unknown'

            // Try BotAvatar link first (only if URL is not from a broken CDN)
            if (profile.userId && avatarMap.has(profile.userId)) {
              avatarUrl = avatarMap.get(profile.userId)!
              source = 'BotAvatar'
              fixed++
            } else {
              // Generate DiceBear URL (deterministic from displayName)
              const seed = profile.displayName || profile.id || `bot-fix-${i + idx}`
              avatarUrl = generateDiceBearUrl(seed, profile.gender)
              source = 'dicebear'
              generated++
            }

            // Determine avatarType
            let avatarType = profile.avatarType || 'photo'
            if (!avatarType || avatarType === 'NULL') {
              avatarType = 'photo'
            }

            await db.profile.update({
              where: { id: profile.id },
              data: {
                avatar: avatarUrl,
                avatarType,
              },
            })
          } catch (err) {
            skipped++
            const msg = err instanceof Error ? err.message : 'Unknown error'
            errors.push({ profileId: profile.id, error: msg })
          }
        }))

        if ((i + subBatchSize) % 100 === 0 && i + subBatchSize < profilesToFix.length) {
          console.log(`[fix-null-avatars] Progress: ${Math.min(i + subBatchSize, profilesToFix.length)}/${profilesToFix.length}`)
        }
      }

      // ── Step 5: Verify ──
      const remaining = await db.profile.count({
        where: {
          user: { isBot: true },
          OR: [{ avatar: null }, { avatar: '' }],
        },
      })

      console.log(`[fix-null-avatars] Done! fixed=${fixed} generated=${generated} skipped=${skipped} remaining=${remaining}`)

      return success({
        fixed,
        generated,
        skipped,
        errors: errors.slice(0, 10),
        totalProcessed: fixed + generated + skipped,
        remainingNullAvatars: remaining,
        message: remaining === 0
          ? `✅ All bot avatars fixed! (${fixed} from BotAvatar, ${generated} from DiceBear)`
          : `Fixed ${fixed + generated} profiles. ${remaining} still have null avatar — run again to process next batch.`,
      })
    } catch (error) {
      console.error('[fix-null-avatars] Fatal error:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      return serverError(`Avatar fix failed: ${message}`)
    }
  }
)
