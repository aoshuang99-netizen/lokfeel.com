import { PrismaClient } from "./src/generated";

declare global {
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const connectionString = (process.env.DATABASE_URL || "").trim();
  const adapter = new PrismaPg({
    connectionString,
    schema: process.env.DATABASE_SCHEMA || "public",
  });
  return new (PrismaClient as any)({
    adapter,
  }) as PrismaClient;
}

const prisma = createPrismaClient();

async function main() {
  try {
    const userCount = await prisma.user.count();
    console.log(`User table: OK (${userCount} rows)`);
  } catch (e) {
    console.log('User table: ERROR -', (e as Error).message);
  }
  
  try {
    const botCount = await prisma.botProfile.count();
    console.log(`BotProfile table: OK (${botCount} rows)`);
  } catch (e) {
    console.log('BotProfile table: MISSING -', (e as Error).message.substring(0, 100));
  }
  
  try {
    const logCount = await prisma.botInteractionLog.count();
    console.log(`BotInteractionLog table: OK (${logCount} rows)`);
  } catch (e) {
    console.log('BotInteractionLog table: MISSING -', (e as Error).message.substring(0, 100));
  }
  
  try {
    const batchCount = await prisma.botLearningBatch.count();
    console.log(`BotLearningBatch table: OK (${batchCount} rows)`);
  } catch (e) {
    console.log('BotLearningBatch table: MISSING -', (e as Error).message.substring(0, 100));
  }
  
  try {
    const avatarCount = await prisma.botAvatar.count();
    console.log(`BotAvatar table: OK (${avatarCount} rows)`);
  } catch (e) {
    console.log('BotAvatar table: MISSING -', (e as Error).message.substring(0, 100));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
