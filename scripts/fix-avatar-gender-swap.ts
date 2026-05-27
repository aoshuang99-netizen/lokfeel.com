/**
 * fix-avatar-gender-swap.ts
 * 
 * Fixes gender-mismatched randomuser.me avatar URLs.
 * Problem: cleanup-avatars script had reversed gender logic causing:
 *   - MALE profiles → women/ photos
 *   - FEMALE profiles → men/ photos
 * 
 * Usage: npx tsx scripts/fix-avatar-gender-swap.ts [--dry-run]
 */

import 'dotenv/config'
import { createClient } from '@libsql/client'

const DATABASE_URL = process.env.DATABASE_URL || ''
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || ''

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set')
  process.exit(1)
}

const db = createClient({
  url: DATABASE_URL.replace('libsql://', 'https://'),
  authToken: TURSO_AUTH_TOKEN,
})

function fixGenderUrl(url: string, correctGender: string): string {
  // Swap men↔women in the URL based on correct gender
  const genderFolder = correctGender?.toUpperCase() === 'MALE' ? 'men' : 'women'
  const wrongFolder = genderFolder === 'men' ? 'women' : 'men'
  return url.replace(`/${wrongFolder}/`, `/${genderFolder}/`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(dryRun ? '🔍 DRY RUN\n' : '🔧 LIVE MODE\n')

  // Count mismatched: MALE with women/ photos
  const r1 = await db.execute(`
    SELECT COUNT(*) as cnt FROM "Profile" p 
    JOIN "User" u ON p."userId" = u.id 
    WHERE u."isBot" = 1 
    AND p.avatar LIKE '%randomuser.me/api/portraits/%'
    AND (
      (p.gender = 'MALE' AND p.avatar LIKE '%/women/%')
      OR (p.gender = 'FEMALE' AND p.avatar LIKE '%/men/%')
    )
  `)
  const mismatchedCount = Number(r1.rows[0]?.cnt || 0)
  
  if (mismatchedCount === 0) {
    console.log('✅ No mismatched avatars found!')
    await db.close()
    return
  }
  
  console.log(`Found ${mismatchedCount} gender-mismatched avatars\n`)

  if (dryRun) {
    const samples = await db.execute(`
      SELECT p."displayName", p.gender, p.avatar FROM "Profile" p 
      JOIN "User" u ON p."userId" = u.id 
      WHERE u."isBot" = 1 
      AND p.avatar LIKE '%randomuser.me/api/portraits/%'
      AND (
        (p.gender = 'MALE' AND p.avatar LIKE '%/women/%')
        OR (p.gender = 'FEMALE' AND p.avatar LIKE '%/men/%')
      )
      LIMIT 5
    `)
    console.log('Sample:')
    samples.rows.forEach(r => {
      const url = r.avatar as string
      const fixed = fixGenderUrl(url, r.gender as string)
      console.log(`  ${r.displayName} (${r.gender})`)
      console.log(`    OLD: ${url.substring(0, 60)}...`)
      console.log(`    NEW: ${fixed.substring(0, 60)}...`)
    })
    console.log(`\nWould fix ${mismatchedCount} profiles`)
    await db.close()
    return
  }

  // Fix in batches
  console.log(`Fixing ${mismatchedCount} mismatched avatars...`)
  const batchSize = 50
  let fixed = 0
  let errors = 0
  let offset = 0

  while (offset < mismatchedCount) {
    const batch = await db.execute({
      sql: `
        SELECT p.id, p.gender, p.avatar FROM "Profile" p 
        JOIN "User" u ON p."userId" = u.id 
        WHERE u."isBot" = 1 
        AND p.avatar LIKE '%randomuser.me/api/portraits/%'
        AND (
          (p.gender = 'MALE' AND p.avatar LIKE '%/women/%')
          OR (p.gender = 'FEMALE' AND p.avatar LIKE '%/men/%')
        )
        LIMIT ? OFFSET ?
      `,
      args: [batchSize, offset],
    })

    if (batch.rows.length === 0) break

    const updates = batch.rows.map(async (row) => {
      try {
        const newUrl = fixGenderUrl(row.avatar as string, row.gender as string)
        await db.execute({
          sql: `UPDATE "Profile" SET avatar = ? WHERE id = ?`,
          args: [newUrl, row.id as string],
        })
        fixed++
      } catch (err) {
        errors++
        console.error(`  ❌ ${row.id}: ${err instanceof Error ? err.message : err}`)
      }
    })

    await Promise.all(updates)
    offset += batchSize
    
    if (offset % 200 === 0 || offset >= mismatchedCount) {
      console.log(`  Progress: ${Math.min(offset, mismatchedCount)}/${mismatchedCount} (fixed=${fixed} errors=${errors})`)
    }
  }

  // Verify
  const remaining = await db.execute(`
    SELECT COUNT(*) as cnt FROM "Profile" p 
    JOIN "User" u ON p."userId" = u.id 
    WHERE u."isBot" = 1 
    AND p.avatar LIKE '%randomuser.me/api/portraits/%'
    AND (
      (p.gender = 'MALE' AND p.avatar LIKE '%/women/%')
      OR (p.gender = 'FEMALE' AND p.avatar LIKE '%/men/%')
    )
  `)
  
  console.log(`\n✅ Done! Fixed: ${fixed}, Errors: ${errors}, Remaining mismatched: ${remaining.rows[0]?.cnt || 0}`)
  await db.close()
}

main().catch(e => {
  console.error('❌ Fatal:', e.message)
  process.exit(1)
})
