/**
 * Script: Assign LADY_FREE subscriptions to all existing female users
 * Usage: npx tsx scripts/assign-lady-free.ts
 */
import { db } from '../src/lib/db';

async function main() {
  console.log('🔍 Finding female profiles...');
  
  const femaleProfiles = await db.profile.findMany({
    where: { gender: 'FEMALE' },
    select: { userId: true, displayName: true }
  });
  
  console.log(`Found ${femaleProfiles.length} female profiles`);

  let created = 0;
  let skipped = 0;
  
  for (const p of femaleProfiles) {
    const existing = await db.subscription.findFirst({
      where: { userId: p.userId, planId: 'LADY_FREE', status: 'ACTIVE' }
    });
    
    if (existing) {
      skipped++;
      continue;
    }
    
    await db.subscription.create({
      data: {
        userId: p.userId,
        planId: 'LADY_FREE',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date('2099-12-31'),
      }
    });
    created++;
  }
  
  console.log(`✅ Created: ${created} | ⏭️ Skipped (already exists): ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
