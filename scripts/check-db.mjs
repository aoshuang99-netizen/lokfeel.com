import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking database state...\n');

  // Check bot users
  const botUsers = await prisma.user.findMany({
    where: { isBot: true },
    include: { profile: true },
    take: 5,
  });
  console.log(`🤖 Bot users: ${botUsers.length}`);
  botUsers.forEach(u => {
    console.log(`  - ${u.name} (${u.email}) - Profile: ${u.profile ? '✅' : '❌'}`);
  });

  // Check real users
  const realUsers = await prisma.user.findMany({
    where: { isBot: false },
    include: { profile: true },
    take: 5,
  });
  console.log(`\n👤 Real users: ${realUsers.length}`);
  realUsers.forEach(u => {
    const p = u.profile;
    const hasTest = !!(p?.attachmentStyle && p?.communicationStyle && p?.loveLanguage && p?.relationshipGoal);
    console.log(`  - ${u.name} (${u.email})`);
    console.log(`    Onboarding: ${p?.onboardingStep}/8, Personality Test: ${hasTest ? '✅' : '❌'}`);
    console.log(`    attachmentStyle: ${p?.attachmentStyle || 'null'}`);
    console.log(`    communicationStyle: ${p?.communicationStyle || 'null'}`);
    console.log(`    loveLanguage: ${p?.loveLanguage || 'null'}`);
    console.log(`    relationshipGoal: ${p?.relationshipGoal || 'null'}`);
  });

  // Check matches
  const matches = await prisma.match.findMany({
    where: { status: 'MATCHED' },
    take: 5,
  });
  console.log(`\n💕 Matched pairs: ${matches.length}`);

  // Check chat rooms
  const rooms = await prisma.chatRoom.findMany({
    include: {
      members: {
        include: {
          user: { select: { name: true, isBot: true } },
        },
      },
    },
    take: 5,
  });
  console.log(`\n💬 Chat rooms: ${rooms.length}`);
  rooms.forEach(r => {
    const members = r.members.map(m => `${m.user.name}${m.user.isBot ? '(bot)' : ''}`).join(', ');
    console.log(`  - Room ${r.id.substring(0, 8)}...: ${members}`);
  });

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
