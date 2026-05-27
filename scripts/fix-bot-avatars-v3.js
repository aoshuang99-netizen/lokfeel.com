/**
 * fix-bot-avatars-v3.js
 * 正确版本：只修复 Profile.avatar 中的 broken CDN URL
 * User.image 存储的是 Google/Twitter 头像，不应动
 */

const { createClient } = require('@libsql/client')
const crypto = require('crypto')

const TURSO_URL = 'libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io'
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Nzc1NTEzMTcsImlkIjoiMDE5ZGRkMDMtZGQwMS03Y2VmLWI5NjQtNzg4OThmMjljNTgwIiwicmlkIjoiNTNmMGQ0MjYtNjgzNC00ZjJkLTg1YjAtZTY3MTk4MmI2YTg1In0.ELXcqcJUSGKZpS6HPc8hjY2KZL7ZsKeGYmCr9UdwhfyYrTM57-4_mC5h8b8OrjUgjrcN_DO_xwWGGC1ajs7pCw'

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

function needsFix(url) {
  if (!url) return true
  return BROKEN_PATTERNS.some(p => url.includes(p))
}

async function main() {
  console.log('[fix-avatars] Connecting to Turso...')

  try {
    // 1. 统计需要修复的 Profile.avatar 数量
    const countResult = await client.execute(`
      SELECT COUNT(*) as count FROM "Profile"
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND (
        "avatar" IS NULL
        OR "avatar" = ''
        OR "avatar" LIKE '%unsplash%'
        OR "avatar" LIKE '%randomuser%'
        OR "avatar" LIKE '%pravatar%'
        OR "avatar" LIKE '%thispersondoesnotexist%'
      )
    `)
    const totalToFix = Number(countResult.rows[0].count)
    console.log(`[fix-avatars] Found ${totalToFix} bot profiles with broken/missing avatars`)

    if (totalToFix === 0) {
      console.log('[fix-avatars] ✅ No profiles need fixing!')
      await client.close()
      return
    }

    // 2. 分批修复
    const BATCH_SIZE = 500
    let fixed = 0

    for (let offset = 0; offset < totalToFix; offset += BATCH_SIZE) {
      const profilesResult = await client.execute({
        sql: `
          SELECT p."id", p."userId", p."avatar", p."gender", p."displayName" FROM "Profile" p
          WHERE p."userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
          AND (
            p."avatar" IS NULL
            OR p."avatar" = ''
            OR p."avatar" LIKE '%unsplash%'
            OR p."avatar" LIKE '%randomuser%'
            OR p."avatar" LIKE '%pravatar%'
            OR p."avatar" LIKE '%thispersondoesnotexist%'
          )
          LIMIT ? OFFSET ?
        `,
        args: [BATCH_SIZE, offset],
      })

      for (const p of profilesResult.rows) {
        try {
          const seed = hashSeed(`bot-profile-${p.id}-${p.displayName || 'bot'}`)
          const newAvatar = getDiceBearUrl(seed, p.gender)

          await client.execute({
            sql: `UPDATE "Profile" SET "avatar" = ? WHERE "id" = ?`,
            args: [newAvatar, p.id],
          })

          fixed++
          if (fixed % 500 === 0) {
            console.log(`[fix-avatars] Progress: ${fixed}/${totalToFix}...`)
          }
        } catch (e) {
          console.error(`[fix-avatars] Error fixing profile ${p.id}:`, e.message)
        }
      }
    }

    console.log(`[fix-avatars] ✅ Fixed ${fixed} Profile avatars`)

    // 3. 也修复 User.image（如果是 broken URL）
    const userCountResult = await client.execute(`
      SELECT COUNT(*) as count FROM "User"
      WHERE "isBot" = 1
      AND (
        "image" IS NULL
        OR "image" = ''
        OR "image" LIKE '%unsplash%'
        OR "image" LIKE '%randomuser%'
        OR "image" LIKE '%pravatar%'
      )
    `)
    const totalUsersToFix = Number(userCountResult.rows[0].count)
    console.log(`[fix-avatars] Found ${totalUsersToFix} bot users with broken/missing User.image`)

    if (totalUsersToFix > 0) {
      let fixedUsers = 0

      for (let offset = 0; offset < totalUsersToFix; offset += BATCH_SIZE) {
        const usersResult = await client.execute({
          sql: `
            SELECT u."id", u."displayName", u."image" FROM "User" u
            WHERE u."isBot" = 1
            AND (
              u."image" IS NULL
              OR u."image" = ''
              OR u."image" LIKE '%unsplash%'
              OR u."image" LIKE '%randomuser%'
              OR u."image" LIKE '%pravatar%'
            )
            LIMIT ? OFFSET ?
          `,
          args: [BATCH_SIZE, offset],
        })

        for (const u of usersResult.rows) {
          try {
            const seed = hashSeed(`bot-user-${u.id}-${u.displayName || 'bot'}`)
            // User.image 不需要 gender（用默认颜色）
            const newImage = getDiceBearUrl(seed, null)

            await client.execute({
              sql: `UPDATE "User" SET "image" = ? WHERE "id" = ?`,
              args: [newImage, u.id],
            })

            fixedUsers++
            if (fixedUsers % 500 === 0) {
              console.log(`[fix-avatars] User progress: ${fixedUsers}/${totalUsersToFix}...`)
            }
          } catch (e) {
            console.error(`[fix-avatars] Error fixing user ${u.id}:`, e.message)
          }
        }
      }

      console.log(`[fix-avatars] ✅ Fixed ${fixedUsers} User images`)
    }

    // 4. 最终验证
    const remainingResult = await client.execute(`
      SELECT COUNT(*) as count FROM "Profile"
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND (
        "avatar" IS NULL
        OR "avatar" = ''
        OR "avatar" LIKE '%unsplash%'
        OR "avatar" LIKE '%randomuser%'
      )
    `)
    console.log(`[fix-avatars] Remaining broken profiles: ${remainingResult.rows[0].count}`)

    console.log('\n[fix-avatars] ✅ All done!')
  } catch (e) {
    console.error('[fix-avatars] Fatal error:', e)
    process.exit(1)
  } finally {
    await client.close()
  }
}

main()
