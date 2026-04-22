import { db } from '@/lib/db';

async function main() {
  const users = await db.user.findMany({
    where: { isBot: false },
    select: { 
      id: true, email: true, name: true, password: true, 
      isBot: true, emailVerified: true, createdAt: true,
      profile: { select: { onboardingStep: true, displayName: true } },
      accounts: { select: { provider: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  
  console.log('=== Non-Bot Users (recent 10) ===');
  for (const u of users) {
    console.log(JSON.stringify({
      id: u.id.slice(0, 12),
      email: u.email,
      name: u.name,
      hasPassword: !!u.password,
      emailVerified: !!u.emailVerified,
      onboardingStep: u.profile?.onboardingStep,
      providers: u.accounts.map(a => a.provider),
      createdAt: u.createdAt,
    }));
  }
  
  console.log('\n=== Total counts ===');
  const total = await db.user.count({ where: { isBot: false } });
  const withPassword = await db.user.count({ where: { isBot: false, password: { not: null } } });
  const withoutPassword = await db.user.count({ where: { isBot: false, password: null } });
  console.log({ total, withPassword, withoutPassword });
  
  await db.$disconnect();
}
main().catch(console.error);
