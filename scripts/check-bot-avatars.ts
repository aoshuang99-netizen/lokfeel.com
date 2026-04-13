import 'dotenv/config';
import { PrismaClient } from '../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function check() {
  console.log('🔍 Checking bot avatars...\n');
  
  const bots = await db.profile.findMany({
    where: { user: { isBot: true } },
    take: 10,
    select: { 
      id: true, 
      displayName: true, 
      avatar: true, 
      avatarType: true,
      gender: true,
    }
  });
  
  console.log('Sample bot profiles:');
  bots.forEach((bot, i) => {
    console.log(`  ${i+1}. ${bot.displayName} (${bot.gender})`);
    console.log(`     Avatar: ${bot.avatar ? bot.avatar.substring(0, 80) + '...' : 'NULL'}`);
    console.log(`     AvatarType: ${bot.avatarType || 'NULL'}`);
  });
  
  const botCount = await db.profile.count({ where: { user: { isBot: true } } });
  const botsWithAvatar = await db.profile.count({ 
    where: { user: { isBot: true }, avatar: { not: null } } 
  });
  const botsWithEmptyAvatar = await db.profile.count({ 
    where: { user: { isBot: true }, avatar: '' } 
  });
  
  console.log(`\n📊 Stats:`);
  console.log(`  Total bots: ${botCount}`);
  console.log(`  With avatar (not null): ${botsWithAvatar}`);
  console.log(`  With empty avatar: ${botsWithEmptyAvatar}`);
  console.log(`  Without avatar: ${botCount - botsWithAvatar}`);
  
  await db.$disconnect();
}

check().catch(console.error);
