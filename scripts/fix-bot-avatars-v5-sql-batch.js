/**
 * fix-bot-avatars-v5-sql-batch.js
 * 单条 SQL 批量更新（用 id 作为 seed）
 * 效率：1 条 SQL = 10482 条逐条 UPDATE
 */

const { createClient } = require('@libsql/client')

const TURSO_URL = 'libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io'
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Nzc1NTEzMTcsImlkIjoiMDE5ZGRkMDMtZGQwMS03Y2VmLWI5NjQtNzg4OThmMjljNTgwIiwicmlkIjoiNTNmMGQ0MjYtNjgzNC00ZjJkLTg1YjAtZTY3MTk4MmI2YTg1In0.ELXcqcJUSGKZpS6HPc8hjY2KZL7ZsKeGYmCr9UdwhfyYrTM57-4_mC5h8b8OrjUgjrcN_DO_xwWGGC1ajs7pCw'

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
})

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x'

async function main() {
  console.log('[fix-v5] Connecting to Turso...')
  const start = Date.now()

  try {
    // ============================================
    // 1. 批量修复 Profile.avatar (女性 + 男性)
    // ============================================
    console.log('\n[fix-v5] Step 1: Fixing Profile.avatar...')

    // 女性：用 profile id 作为 seed
    const femaleResult = await client.execute(`
      UPDATE "Profile"
      SET "avatar" = ${DICEBEAR_BASE}/avataaars/svg?seed=' || replace("id", ' ', '-') || '&backgroundColor=f3a8f9,ec4899,f472b6&radius=50'
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
    `)
    console.log(`[fix-v5] ✅ Fixed ${femaleResult.rowsAffected || '?'} female profiles`)

    // 男性
    const maleResult = await client.execute(`
      UPDATE "Profile"
      SET "avatar" = ${DICEBEAR_BASE}/avataaars/svg?seed=' || replace("id", ' ', '-') || '&backgroundColor=3b82f6,6366f1,06b6d4&radius=50'
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND "gender" IN ('MALE', 'MAN')
      AND (
        "avatar" IS NULL
        OR "avatar" = ''
        OR "avatar" LIKE '%unsplash%'
        OR "avatar" LIKE '%randomuser%'
        OR "avatar" LIKE '%pravatar%'
        OR "avatar" LIKE '%thispersondoesnotexist%'
      )
    `)
    console.log(`[fix-v5] ✅ Fixed ${maleResult.rowsAffected || '?'} male profiles`)

    // 未知性别（用紫色）
    const unknownResult = await client.execute(`
      UPDATE "Profile"
      SET "avatar" = ${DICEBEAR_BASE}/avataaars/svg?seed=' || replace("id", ' ', '-') || '&backgroundColor=a78bfa,7c3aed,5b21b6&radius=50'
      WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isBot" = 1)
      AND ("gender" IS NULL OR ("gender" NOT IN ('FEMALE', 'WOMAN', 'MALE', 'MAN')))
      AND (
        "avatar" IS NULL
        OR "avatar" = ''
        OR "avatar" LIKE '%unsplash%'
        OR "avatar" LIKE '%randomuser%'
      )
    `)
    console.log(`[fix-v5] ✅ Fixed ${unknownResult.rowsAffected || '?'} unknown-gender profiles`)

    // ============================================
    // 2. 批量修复 User.image (bot 用户)
    // ============================================
    console.log('\n[fix-v5] Step 2: Fixing User.image...')

    const userResult = await client.execute(`
      UPDATE "User"
      SET "image" = ${DICEBEAR_BASE}/avataaars/svg?seed=bot-' || replace("id", ' ', '-') || '&backgroundColor=a78bfa,7c3aed,5b21b6&radius=50'
      WHERE "isBot" = 1
      AND (
        "image" IS NULL
        OR "image" = ''
        OR "image" LIKE '%unsplash%'
        OR "image" LIKE '%randomuser%'
        OR "image" LIKE '%pravatar%'
      )
    `)
    console.log(`[fix-v5] ✅ Fixed ${userResult.rowsAffected || '?'} User.images`)

    // ============================================
    // 3. 验证
    // ============================================
    console.log('\n[fix-v5] Step 3: Verification...')

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
    console.log('[fix-v5] ✅ Done!')
    console.log(`[fix-v5] Remaining broken profiles: ${remaining}`)
    console.log(`[fix-v5] Remaining broken User.images: ${userRemaining}`)
    console.log(`[fix-v5] Time elapsed: ${elapsed}s`)
    console.log('='.repeat(50))

    if (remaining > 0) {
      console.log('\n[fix-v5] ⚠️  Some profiles still have broken avatars:')
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
    console.error('\n[fix-v5] Fatal error:', e)
    process.exit(1)
  } finally {
    await client.close()
  }
}

main()
