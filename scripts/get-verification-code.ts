import { db } from '@/lib/db'

async function main() {
  const email = process.argv[2] || 'testuser12345@example.com'
  
  const tokens = await db.verificationToken.findMany({
    where: {
      identifier: email.toLowerCase(),
      used: false,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 5,
  })
  
  console.log(`\nVerification tokens for: ${email}`)
  console.log('='.repeat(50))
  
  if (tokens.length === 0) {
    console.log('No active tokens found')
  } else {
    tokens.forEach((token, i) => {
      console.log(`\n[${i + 1}] Code: ${token.token}`)
      console.log(`    Expires: ${token.expires.toISOString()}`)
      console.log(`    Used: ${token.used}`)
      console.log(`    UseCount: ${token.useCount}`)
    })
  }
  
  console.log('')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
