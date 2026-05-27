/**
 * fix-null-avatars-direct.ts
 * 
 * Direct Turso DB fix for BotAvatar → Profile.avatar broken link.
 * Runs outside Vercel, connects directly to Turso via @libsql/client.
 * 
 * Problem: ~7,000 bot profiles have avatar=null, but BotAvatar table
 * has active records with valid avatar URLs.
 * 
 * Usage: npx tsx scripts/fix-null-avatars-direct.ts [--dry-run]
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
  url: DATABASE_URL.replace('libsql://', 'https://') ,
  authToken: TURSO_AUTH_TOKEN,
})

const RANDOMUSER_BASE = 'https://randomuser.me/api/portraits'

// CDNs known to be broken or unreliable
const BROKEN_CDN_PATTERNS = [
  'i.pravatar.cc',
  'thispersondoesnotexist.com',
  'api.dicebear.com',
  'ui-avatars.com',
]

function isBrokenUrl(url: string | null | undefined): boolean {
  if (!url) return true
  return BROKEN_CDN_PATTERNS.some(p => url.includes(p))
}

function generatePortraitUrl(gender: string | null, index: number): string {
  const genderFolder = gender?.toUpperCase() === 'MALE' ? 'men' : 'women'
  const imgId = (index % 99) + 1
  return `${RANDOMUSER_BASE}/${genderFolder}/${imgId}.jpg`
}

// Deterministic hash from userId string to numeric index
function hashUserId(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(dryRun ? '🔍 DRY RUN mode — no changes will be made\n' : '🔧 LIVE mode — will update database\n')

  // ── Step 1: Count null avatars ──
  console.log('Step 1: Counting bot profiles with null avatar...')
  const countResult = await db.execute(`
    SELECT COUNT(*) as cnt FROM "Profile" p
    JOIN "User" u ON p."userId" = u.id
    WHERE u."isBot" = 1 AND (p.avatar IS NULL OR p.avatar = '')
  `)
  const nullCount = Number(countResult.rows[0]?.cnt || 0)
  console.log(`   Found ${nullCount} bot profiles with null avatar\n`)

  if (nullCount === 0) {
    console.log('✅ No null avatars to fix!')
    await db.close()
    return
  }

  // ── Step 2: Load BotAvatar records ──
  console.log('Step 2: Loading BotAvatar records...')
  const baResult = await db.execute(`
    SELECT "botId", "originalUrl", "processedUrl" FROM "BotAvatar"
    WHERE status = 'active'
  `)
  
  const avatarMap = new Map<string, string>()
  let brokenCount = 0
  for (const row of baResult.rows) {
    const botId = row.botId as string
    const url = (row.processedUrl || row.originalUrl) as string
    if (!botId || avatarMap.has(botId)) continue
    if (url && !isBrokenUrl(url)) {
      avatarMap.set(botId, url)
    } else {
      brokenCount++
    }
  }
  console.log(`   Mapped ${avatarMap.size} botIds to working URLs (filtered ${brokenCount} broken)\n`)

  // ── Step 3: Get profiles to fix ──
  console.log('Step 3: Loading profiles to fix...')
  const profilesResult = await db.execute(`
    SELECT p.id, p."userId", p."displayName", p.gender, p."avatarType"
    FROM "Profile" p
    JOIN "User" u ON p."userId" = u.id
    WHERE u."isBot" = 1 AND (p.avatar IS NULL OR p.avatar = '')
    ORDER BY p.id ASC
    LIMIT 500
  `)

  const profiles = profilesResult.rows.map(r => ({
    id: r.id as string,
    userId: r.userId as string,
    displayName: (r.displayName || 'User') as string,
    gender: r.gender as string | null,
    avatarType: (r.avatarType || 'photo') as string,
  }))

  console.log(`   Loaded ${profiles.length} profiles to process`)

  // Dry run: show sample
  if (dryRun) {
    const fromBotAvatar = profiles.filter(p => p.userId && avatarMap.has(p.userId)).length
    const needGenerate = profiles.length - fromBotAvatar
    const samples = profiles.slice(0, 5).map((p, i) => ({
      name: p.displayName,
      gender: p.gender,
      source: (p.userId && avatarMap.has(p.userId)) ? 'BotAvatar' : 'randomuser.me',
      url: (p.userId && avatarMap.has(p.userId)) 
        ? avatarMap.get(p.userId)!.substring(0, 60) + '...'
        : generatePortraitUrl(p.gender, i).substring(0, 60) + '...'
    }))
    
    console.log(`\n📊 Dry Run Summary:`)
    console.log(`   Total null avatars in DB: ${nullCount}`)
    console.log(`   Profiles to fix (this batch): ${profiles.length}`)
    console.log(`   From BotAvatar: ${fromBotAvatar}`)
    console.log(`   From randomuser.me: ${needGenerate}`)
    console.log(`\n   Sample:`)
    samples.forEach(s => console.log(`   - ${s.name} (${s.gender}) → ${s.source}: ${s.url}`))
    
    await db.close()
    return
  }

  // ── Step 4: Fix avatars ──
  console.log(`\nStep 4: Writing avatar URLs to ${profiles.length} profiles...`)

  let fixed = 0, generated = 0, errors = 0
  const batchSize = 25

  for (let i = 0; i < profiles.length; i += batchSize) {
    const batch = profiles.slice(i, i + batchSize)
    
    // Execute updates in parallel within each batch
    const updatePromises = batch.map(async (profile) => {
      try {
        let avatarUrl: string
        
        if (profile.userId && avatarMap.has(profile.userId)) {
          avatarUrl = avatarMap.get(profile.userId)!
          fixed++
        } else {
          const idx = hashUserId(profile.userId || profile.id)
          avatarUrl = generatePortraitUrl(profile.gender, idx)
          generated++
        }

        await db.execute({
          sql: `UPDATE "Profile" SET avatar = ?, "avatarType" = ? WHERE id = ?`,
          args: [avatarUrl, 'photo', profile.id],
        })
      } catch (err) {
        errors++
        console.error(`   ❌ Failed: ${profile.id}: ${err instanceof Error ? err.message : err}`)
      }
    })

    await Promise.all(updatePromises)

    if ((i + batchSize) % 100 === 0 || i + batchSize >= profiles.length) {
      console.log(`   Progress: ${Math.min(i + batchSize, profiles.length)}/${profiles.length} (fixed=${fixed} generated=${generated} errors=${errors})`)
    }
  }

  // ── Step 5: Verify ──
  console.log('\nStep 5: Verifying...')
  const remainingResult = await db.execute(`
    SELECT COUNT(*) as cnt FROM "Profile" p
    JOIN "User" u ON p."userId" = u.id
    WHERE u."isBot" = 1 AND (p.avatar IS NULL OR p.avatar = '')
  `)
  const remaining = Number(remainingResult.rows[0]?.cnt || 0)

  console.log(`\n✅ Done!`)
  console.log(`   Fixed from BotAvatar: ${fixed}`)
  console.log(`   Generated from randomuser.me: ${generated}`)
  console.log(`   Errors: ${errors}`)
  console.log(`   Remaining null: ${remaining}`)

  if (remaining > 0) {
    console.log(`\n⚠️  ${remaining} profiles still have null avatar. Run again to process next batch.`)
  }

  await db.close()
}

main().catch(e => {
  console.error('❌ Fatal error:', e.message)
  process.exit(1)
})
