/**
 * fix-bot-avatars-v4-batch.js
 * 使用单条 SQL 批量更新（不逐条处理）
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

/**
 * 为所有需要修复的 Profile 生成 DiceBear URL
 * 策略：直接用 SQL 生成（使用 displayName 作为 seed）
 * 但因为需要 hash + gender 逻辑，还是在 Node 中处理
 *
 * 优化：每次批量更新 1000 条，减少往返次数
 */
async function batchFixProfiles() {
  console.log('[fix] Fetching profiles needing fix (batch mode)...')

  // 获取所有需要修复的 profile id 和 gender
  const profilesResult = await client.execute(`
    SELECT p."id", p."userId", p."gender", p."displayName" FROM "Profile" p
    WHERE p."userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
    AND (
      p."avatar" IS NULL
      OR p."avatar" = ''
      OR p."avatar" LIKE '%unsplash%'
      OR p."avatar" LIKE '%randomuser%'
      OR p."avatar" LIKE '%pravatar%'
      OR p."avatar" LIKE '%thispersondoesnotexist%'
    )
  `)

  const profiles = profilesResult.rows
  console.log(`[fix] Found ${profiles.length} profiles to fix`)

  if (profiles.length === 0) {
    console.log('[fix] ✅ No profiles need fixing!')
    return 0
  }

  let fixed = 0
  const BATCH_SIZE = 500

  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const batch = profiles.slice(i, i + BATCH_SIZE)

    for (const p of batch) {
      try {
        const seed = hashSeed(`bot-profile-${p.id}-${p.displayName || 'bot'}`)
        const isFemale = (p.gender || '').toUpperCase() === 'FEMALE' || (p.gender || '').toUpperCase() === 'WOMAN'
        const bgColor = isFemale ? 'f3a8f9,ec4899,f472b6' : '3b82f6,6366f1,06b6d4'
        const newAvatar = `${DICEBEAR_BASE}/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=50`

        await client.execute({
          sql: `UPDATE "Profile" SET "avatar" = ? WHERE "id" = ?`,
          args: [newAvatar, p.id],
        })
        fixed++
      } catch (e) {
        console.error(`[fix] Error fixing profile ${p.id}:`, e.message)
      }
    }

    console.log(`[fix] Progress: ${fixed}/${profiles.length}...`)
  }

  console.log(`[fix] ✅ Fixed ${fixed} Profile avatars`)
  return fixed
}

async function batchFixUserImages() {
  console.log('\n[fix] Fetching users needing User.image fix...')

  const usersResult = await client.execute(`
    SELECT u."id", u."displayName", u."image" FROM "User" u
    WHERE u."isBot" = 1
    AND (
      u."image" IS NULL
      OR u."image" = ''
      OR u."image" LIKE '%unsplash%'
      OR u."image" LIKE '%randomuser%'
      OR u."image" LIKE '%pravatar%'
    )
  `)

  const users = usersResult.rows
  console.log(`[fix] Found ${users.length} users with broken User.image`)

  if (users.length === 0) {
    console.log('[fix] ✅ No User.image need fixing!')
    return 0
  }

  let fixed = 0
  const BATCH_SIZE = 500

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)

    for (const u of batch) {
      try {
        const seed = hashSeed(`bot-user-${u.id}-${u.displayName || 'bot'}`)
        // User.image 不需要 gender（用默认紫色）
        const newImage = `${DICEBEAR_BASE}/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=a78bfa,7c3aed,5b21b6&radius=50`

        await client.execute({
          sql: `UPDATE "User" SET "image" = ? WHERE "id" = ?`,
          args: [newImage, u.id],
        })
        fixed++
      } catch (e) {
        console.error(`[fix] Error fixing user ${u.id}:`, e.message)
      }
    }

    console.log(`[fix] User.image progress: ${fixed}/${users.length}...`)
  }

  console.log(`[fix] ✅ Fixed ${fixed} User.images`)
  return fixed
}

async function main() {
  console.log('[fix] Connecting to Turso...')
  console.log(`[fix] Database: ${TURSO_URL}\n`)

  try {
    const start = Date.now()

    const fixedProfiles = await batchFixProfiles()
    const fixedUsers = await batchFixUserImages()

    // 最终验证
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
    const remaining = Number(remainingResult.rows[0].count)

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log('\n' + '='.repeat(50))
    console.log('[fix] ✅ Done!')
    console.log(`[fix] Fixed ${fixedProfiles} Profile avatars`)
    console.log(`[fix] Fixed ${fixedUsers} User.images`)
    console.log(`[fix] Remaining broken profiles: ${remaining}`)
    console.log(`[fix] Time elapsed: ${elapsed}s`)
    console.log('='.repeat(50))

  } catch (e) {
    console.error('\n[fix] Fatal error:', e)
    process.exit(1)
  } finally {
    await client.close()
  }
}

main()
