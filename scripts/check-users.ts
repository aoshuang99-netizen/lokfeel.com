import { getDb } from '../src/lib/db';

const prisma = getDb();

async function check() {
  const totalUsers = await prisma.user.count();
  const profiles = await prisma.profile.count();
  const activeProfiles = await prisma.profile.count({ where: { onboardingStep: { gte: 4 } } });
  
  console.log('Total users:', totalUsers);
  console.log('Total profiles:', profiles);
  console.log('Active profiles (onboardingStep >= 4):', activeProfiles);
  
  const users = await prisma.user.findMany({
    where: { profile: { onboardingStep: { gte: 4 } } },
    include: { profile: { select: { gender: true, onboardingStep: true, displayName: true } } },
    take: 5
  });
  console.log('\nSample users:', users.map(u => ({ id: u.id.slice(0,8), name: u.profile?.displayName, gender: u.profile?.gender, step: u.profile?.onboardingStep })));
  
  await prisma.$disconnect();
}

check();
