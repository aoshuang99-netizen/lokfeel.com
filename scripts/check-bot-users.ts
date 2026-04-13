/**
 * Check Bot Users in Database
 */

import 'dotenv/config'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('../src/generated/index.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg')

const connectionString = (process.env.DATABASE_URL || "").trim();
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function check() {
  console.log('🔍 Checking Bot Users in Database\n')
  
  try {
    const botUsers = await prisma.user.count({ where: { isBot: true } })
    const totalUsers = await prisma.user.count()
    const profiles = await prisma.profile.count()
    
    console.log('📊 Statistics:')
    console.log('  Bot users:', botUsers)
    console.log('  Total users:', totalUsers)
    console.log('  Total profiles:', profiles)
    
    if (botUsers > 0) {
      const sample = await prisma.user.findFirst({ 
        where: { isBot: true },
        include: { profile: true }
      })
      console.log('\n📝 Sample bot user:')
      console.log('  Email:', sample?.email)
      console.log('  Name:', sample?.name)
      console.log('  Has profile:', !!sample?.profile)
      if (sample?.profile) {
        console.log('  Profile displayName:', sample.profile.displayName)
        console.log('  Profile gender:', sample.profile.gender)
        console.log('  Profile avatar:', sample.profile.avatar ? 'Yes' : 'No')
      }
    } else {
      console.log('\n⚠️ No bot users found in database!')
      console.log('   Run: npx ts-node scripts/import-bot-users.ts')
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

check()
