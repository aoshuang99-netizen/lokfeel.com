/**
 * fix-bot-avatars-v6-concat.js
 * 用字符串拼接构造完整 SQL（避免 ? 和 & 被误解析）
 */

const { createClient } = require('@libsql/client')

const TURSO_URL = 'libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io'
const TURSO_TOKEN = process.env.TURSO_TOKEN

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
})

const BASE = 'https://api.dicebear.com/9.x/avataaars/svg'

async function main() {
  console.log('[fix-v6] Connecting to Turso...')
  const start = Date.now()

  try {
    // ============================================
    // 1. 批量修复 Profile.avatar (女性)
    // ============================================
    console.log('\n[fix-v6] Step 1: Fixing female profiles...')
    const femaleSQL = `
      UPDATE "Profile"
      SET "avatar" = '${BASE}?seed=' || replace("id", ' ', '-') || '&backgroundColor=f3a8f9,ec4899,f472b6&radius=50'
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND "gender" IN ('FEMALE', 'WOMAN')
      AND (
        "avatar" IS NULL
        OR "avatar" = ''
        OR "avatar" LIKE '%unsplash%'
        OR "avatar" LIKE '%randomuser%'
        OR "avatar" LIKE '%pravatar%'
        OR "avatar" LIKE '%thispersondoesnotexist%'
      )
    `
    const femaleResult = await client.execute(femaleSQL)
    console.log(`[fix-v6] ✅ Fixed ${femaleResult.rowsAffected || '?'} female profiles`)

    // ============================================
    // 2. 批量修复 Profile.avatar (男性)
    // ============================================
    console.log('\n[fix-v6] Step 2: Fixing male profiles...')
    const maleSQL = `
      UPDATE "Profile"
      SET "avatar" = '${BASE}?seed=' || replace("id", ' ', '-') || '&backgroundColor=3b82f6,6366f1,06b6d4&radius=50'
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND "gender" IN ('MALE', 'MAN')
      AND (
        "avatar" IS NULL
        OR "avatar" = ''
        OR "avatar" LIKE '%unsplash%'
        OR "avatar" LIKE '%randomuser%'
      )
    `
    const maleResult = await client.execute(maleSQL)
    console.log(`[fix-v6] ✅ Fixed ${maleResult.rowsAffected || '?'} male profiles`)

    // ============================================
    // 3. 批量修复 Profile.avatar (未知性别)
    // ============================================
    console.log('\n[fix-v6] Step 3: Fixing unknown-gender profiles...')
    const unknownSQL = `
      UPDATE "Profile"
      SET "avatar" = '${BASE}?seed=' || replace("id", ' ', '-') || '&backgroundColor=a78bfa,7c3aed,5b21b6&radius=50'
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND ("gender" IS NULL OR ("gender" NOT IN ('FEMALE', 'WOMAN', 'MALE', 'MAN')))
      AND (
        "avatar" IS NULL
        OR "avatar" = ''
        OR "avatar" LIKE '%unsplash%'
        OR "avatar" LIKE '%randomuser%'
      )
    `
    const unknownResult = await client.execute(unknownSQL)
    console.log(`[fix-v6] ✅ Fixed ${unknownResult.rowsAffected || '?'} unknown-gender profiles`)

    // ============================================
    // 4. 批量修复 User.image (bot 用户)
    // ============================================
    console.log('\n[fix-v6] Step 4: Fixing User.image...')
    const userSQL = `
      UPDATE "User"
      SET "image" = '${BASE}?seed=bot-' || replace("id", ' ', '-') || '&backgroundColor=a78bfa,7c3aed,5b21b6&radius=50'
      WHERE "isBot" = 1
      AND (
        "image" IS NULL
        OR "image" = ''
        OR "image" LIKE '%unsplash%'
        OR "image" LIKE '%randomuser%'
        OR "image" LIKE '%pravatar%'
      )
    `
    const userResult = await client.execute(userSQL)
    console.log(`[fix-v6] ✅ Fixed ${userResult.rowsAffected || '?'} User.images`)

    // ============================================
    // 5. 验证
    // ============================================
    console.log('\n[fix-v6] Step 5: Verification...')

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

    const userRemainingResult = await client.execute(`
      SELECT COUNT(*) as count FROM "User"
      WHERE "isBot" = 1
      AND (
        "image" IS NULL
        OR "image" = ''
        OR "image" LIKE '%unsplash%'
        OR "image" LIKE '%randomuser%'
      )
    `)
    const userRemaining = Number(userRemainingResult.rows[0].count)

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log('\n' + '='.repeat(50))
    console.log('[fix-v6] ✅ All done!')
    console.log(`[fix-v6] Remaining broken profiles: ${remaining}`)
    console.log(`[fix-v6] Remaining broken User.images: ${userRemaining}`)
    console.log(`[fix-v6] Time elapsed: ${elapsed}s`)
    console.log('='.repeat(50))

    if (remaining > 0) {
      console.log('\n[fix-v6] ⚠️  Some profiles still have broken avatars:')
      const samples = await client.execute(`
        SELECT "id", "avatar" FROM "Profile"
        WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
        AND (
          "avatar" IS NULL
          OR "avatar" LIKE '%unsplash%'
          OR "avatar" LIKE '%randomuser%'
        )
        LIMIT 5
      `)
      samples.rows.forEach(r => {
        console.log(`  - ${r.id}: ${String(r.avatar).substring(0, 80)}...`)
      })
    }

  } catch (e) {
    console.error('\n[fix-v6] Fatal error:', e)
    process.exit(1)
  } finally {
    await client.close()
  }
}

main()
