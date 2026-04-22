import { db } from '@/lib/db';

async function main() {
  const email = 'aoshuang99@gmail.com';
  
  const user = await db.user.findUnique({
    where: { email },
    include: {
      profile: true,
      accounts: true,
    }
  });
  
  if (!user) {
    console.log('User not found:', email);
    return;
  }
  
  console.log('=== User Found ===');
  console.log({
    id: user.id,
    email: user.email,
    name: user.name,
    hasPassword: !!user.password,
    passwordLength: user.password?.length,
    passwordPrefix: user.password ? user.password.slice(0, 20) + '...' : null,
    isBot: user.isBot,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    accounts: user.accounts.map(a => ({ provider: a.provider, type: a.type })),
    profile: user.profile ? {
      onboardingStep: user.profile.onboardingStep,
      displayName: user.profile.displayName,
    } : null,
  });
}

main().catch(console.error);
