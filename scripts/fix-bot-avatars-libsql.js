/**
 * fix-bot-avatars-libsql.js (v2 - fixed SQL quoting)
 * 使用 @libsql/client 直接连接 Turso，批量修复 bot 头像
 */

const { createClient } = require('@libsql/client')
const crypto = require('crypto')

const TURSO_URL = 'libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io'
const TURSO_TOKEN = process.env.TURSO_TOKEN

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
})

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x'

function hashSeed(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function getDiceBearUrl(seed, gender) {
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

function isBroken(url) {
  if (!url) return true
  return BROKEN_PATTERNS.some(p => url.includes(p))
}

async function main() {
  console.log('[fix-bot-avatars] Connecting to Turso...')

  try {
    // 1. 统计需要修复的 User.avatar 数量
    const countResult = await client.execute(`
      SELECT COUNT(*) as count FROM "User"
      WHERE "isBot" = 1
      AND ("avatar" IS NULL OR "avatar" = '' OR "avatar" LIKE '%unsplash%' OR "avatar" LIKE '%randomuser%' OR "avatar" LIKE '%pravatar%')
    `)
    const totalToFix = Number(countResult.rows[0].count)
    console.log(`[fix-bot-avatars] Found ${totalToFix} bot users with broken/missing avatars`)

    if (totalToFix === 0) {
      console.log('[fix-bot-avatars] ✅ No User avatars need fixing!')
    } else {
      // 2. 分批修复 User.avatar
      const BATCH_SIZE = 500
      let fixed = 0

      for (let offset = 0; offset < totalToFix; offset += BATCH_SIZE) {
        const usersResult = await client.execute({
          sql: `
            SELECT u."id", u."displayName", u."avatar" FROM "User" u
            WHERE u."isBot" = 1
            AND (u."avatar" IS NULL OR u."avatar" = '' OR u."avatar" LIKE '%unsplash%' OR u."avatar" LIKE '%randomuser%' OR u."avatar" LIKE '%pravatar%')
            LIMIT ? OFFSET ?
          `,
          args: [BATCH_SIZE, offset],
        })

        for (const user of usersResult.rows) {
          try {
            const seed = hashSeed(`bot-${user.id}-${user.displayName || 'bot'}`)
            const newAvatar = getDiceBearUrl(seed, null) // gender 需要从 Profile 获取

            await client.execute({
              sql: `UPDATE "User" SET "avatar" = ? WHERE "id" = ?`,
              args: [newAvatar, user.id],
            })

            fixed++
            if (fixed % 500 === 0) {
              console.log(`[fix-bot-avatars] Progress: ${fixed}/${totalToFix}...`)
            }
          } catch (e) {
            console.error(`[fix-bot-avatars] Error fixing user ${user.id}:`, e.message)
          }
        }
      }

      console.log(`[fix-bot-avatars] ✅ Fixed ${fixed} User avatars`)
    }

    // 3. 修复 Profile.avatar
    const profileCountResult = await client.execute(`
      SELECT COUNT(*) as count FROM "Profile"
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND ("avatar" IS NULL OR "avatar" = '' OR "avatar" LIKE '%unsplash%' OR "avatar" LIKE '%randomuser%')
    `)
    const totalProfilesToFix = Number(profileCountResult.rows[0].count)
    console.log(`[fix-bot-avatars] Found ${totalProfilesToFix} profiles with broken/missing avatars`)

    if (totalProfilesToFix > 0) {
      let fixedProfiles = 0

      for (let offset = 0; offset < totalProfilesToFix; offset += 500) {
        const profilesResult = await client.execute({
          sql: `
            SELECT p."id", p."userId", p."avatar", u."displayName" FROM "Profile" p
            LEFT JOIN "User" u ON u."id" = p."userId"
            WHERE u."isBot" = 1
            AND (p."avatar" IS NULL OR p."avatar" = '' OR p."avatar" LIKE '%unsplash%' OR p."avatar" LIKE '%randomuser%')
            LIMIT ? OFFSET ?
          `,
          args: [500, offset],
        })

        for (const p of profilesResult.rows) {
          try {
            const seed = hashSeed(`bot-profile-${p.id}`)
            // 获取 gender
            const genderResult = await client.execute({
              sql: `SELECT "gender" FROM "Profile" WHERE "id" = ?`,
              args: [p.id],
            })
            const gender = genderResult.rows[0]?.gender || null
            const newAvatar = getDiceBearUrl(seed, gender)

            await client.execute({
              sql: `UPDATE "Profile" SET "avatar" = ? WHERE "id" = ?`,
              args: [newAvatar, p.id],
            })

            fixedProfiles++
            if (fixedProfiles % 500 === 0) {
              console.log(`[fix-bot-avatars] Profile progress: ${fixedProfiles}/${totalProfilesToFix}...`)
            }
          } catch (e) {
            console.error(`[fix-bot-avatars] Error fixing profile ${p.id}:`, e.message)
          }
        }
      }

      console.log(`[fix-bot-avatars] ✅ Fixed ${fixedProfiles} Profile avatars`)
    }

    // 4. 最终验证
    const remainingResult = await client.execute(`
      SELECT COUNT(*) as count FROM "Profile"
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND ("avatar" IS NULL OR "avatar" = '' OR "avatar" LIKE '%unsplash%' OR "avatar" LIKE '%randomuser%')
    `)
    console.log(`[fix-bot-avatars] Remaining broken profiles: ${remainingResult.rows[0].count}`)

    console.log('\n[fix-bot-avatars] ✅ Done!')
  } catch (e) {
    console.error('[fix-bot-avatars] Fatal error:', e)
    process.exit(1)
  } finally {
    await client.close()
  }
}

main()
