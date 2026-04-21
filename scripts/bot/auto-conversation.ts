/**
 * LokFeel Bot Auto-Conversation System
 * 自动化机器人对话系统 - 用于演示和测试
 */

import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

const prisma = getDb();

// 模拟对话模板
const conversationTemplates = [
  {
    name: "初次匹配问候",
    messages: [
      { sender: "bot", content: "Hi there! 👋 I noticed we matched. Your profile caught my attention!" },
      { sender: "user", content: "Hey! Thanks, yours too. What brings you here?" },
      { sender: "bot", content: "Looking for genuine connections. I love hiking and photography. How about you?" },
      { sender: "user", content: "Same here! I'm into rock climbing and weekend road trips." },
      { sender: "bot", content: "That's awesome! Have you been to Yosemite? It's on my bucket list." },
    ]
  },
  {
    name: "兴趣分享",
    messages: [
      { sender: "bot", content: "Just got back from a amazing concert! 🎵 Do you like live music?" },
      { sender: "user", content: "Love it! What band did you see?" },
      { sender: "bot", content: "It was an indie rock band. The energy was incredible!" },
      { sender: "user", content: "Sounds fun! I'm more into jazz and blues myself." },
      { sender: "bot", content: "Jazz is so classy. Any favorite artists?" },
    ]
  },
  {
    name: "周末计划",
    messages: [
      { sender: "bot", content: "Any exciting plans for the weekend? ☀️" },
      { sender: "user", content: "Thinking about checking out that new coffee shop downtown. You?" },
      { sender: "bot", content: "That sounds cozy! I might go for a hike if the weather holds up." },
      { sender: "user", content: "Nice! Which trail are you thinking?" },
      { sender: "bot", content: "Probably the coastal trail. The ocean views are breathtaking!" },
    ]
  },
  {
    name: "美食话题",
    messages: [
      { sender: "bot", content: "Just tried the most amazing sushi place! 🍣 Are you a foodie?" },
      { sender: "user", content: "Absolutely! Love discovering new restaurants. Where was it?" },
      { sender: "bot", content: "It's called Sakura on 5th Street. The omakase was incredible!" },
      { sender: "user", content: "Oh I've heard of that place! Need to check it out." },
      { sender: "bot", content: "You definitely should! Want to go together sometime?" },
    ]
  },
  {
    name: "旅行话题",
    messages: [
      { sender: "bot", content: "Just booked a trip to Japan! 🇯🇵 Have you ever been?" },
      { sender: "user", content: "Yes! It's amazing. Which cities are you visiting?" },
      { sender: "bot", content: "Tokyo, Kyoto, and Osaka. So excited for the cherry blossoms!" },
      { sender: "user", content: "Perfect timing! Kyoto is magical during sakura season." },
      { sender: "bot", content: "Any must-see spots you'd recommend?" },
    ]
  }
];

// 获取或创建机器人用户
async function getOrCreateBotUsers() {
  const botProfiles = [
    { name: "Sarah", gender: "FEMALE", age: 28, bio: "Coffee lover ☕ | Travel enthusiast ✈️ | Dog mom 🐕" },
    { name: "Emma", gender: "FEMALE", age: 26, bio: "Yoga instructor 🧘‍♀️ | Nature lover 🌿 | Bookworm 📚" },
    { name: "Jessica", gender: "FEMALE", age: 30, bio: "Foodie 🍜 | Photographer 📸 | Hiking addict 🥾" },
    { name: "Michael", gender: "MALE", age: 29, bio: "Software engineer 💻 | Guitar player 🎸 | Coffee snob ☕" },
    { name: "David", gender: "MALE", age: 32, bio: "Chef 👨‍🍳 | Wine enthusiast 🍷 | Fitness junkie 💪" },
  ];

  const bots = [];
  for (const profile of botProfiles) {
    let user = await prisma.user.findFirst({
      where: { email: `bot.${profile.name.toLowerCase()}@lokfeel.com` }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: `bot.${profile.name.toLowerCase()}@lokfeel.com`,
          name: profile.name,
          emailVerified: new Date(),
          isBot: true,
          botType: "DEMO",
        }
      });

      await prisma.profile.create({
        data: {
          userId: user.id,
          displayName: profile.name,
          gender: profile.gender as any,
          sexuality: "STRAIGHT",
          age: profile.age,
          bio: profile.bio,
          avatar: profile.gender === "FEMALE"
            ? `/avatars/female-${Math.floor(Math.random() * 8) + 1}.png`
            : `/avatars/male-${Math.floor(Math.random() * 5) + 1}.png`,
          avatarType: profile.gender === "FEMALE" ? "CARTOON" : "REAL",
          city: "San Francisco",
          country: "USA",
          relationshipGoal: "DATING",
          profileStatus: "APPROVED",
          onboardingStep: 8,
        }
      });

      console.log(`✅ Created bot user: ${profile.name}`);
    } else {
      console.log(`ℹ️ Bot user exists: ${profile.name}`);
    }

    bots.push(user);
  }

  return bots;
}

// 创建模拟对话
async function createMockConversation(bot1: any, bot2: any, template: any) {
  // 检查是否已存在对话
  const existingConv = await prisma.conversation.findFirst({
    where: {
      OR: [
        { userAId: bot1.id, userBId: bot2.id },
        { userAId: bot2.id, userBId: bot1.id },
      ]
    }
  });

  if (existingConv) {
    console.log(`ℹ️ Conversation already exists between ${bot1.name} and ${bot2.name}`);
    return existingConv;
  }

  // 创建对话
  const conversation = await prisma.conversation.create({
    data: {
      id: randomUUID(),
      userAId: bot1.id,
      userBId: bot2.id,
      initiatorId: bot1.id,
      state: "ACTIVE",
      cachedConsentState: "CONSENT_GRANTED",
      participants: {
        create: [
          { userId: bot1.id },
          { userId: bot2.id },
        ]
      }
    }
  });

  // 创建消息
  let seq = 1;
  const now = Date.now();
  for (const msg of template.messages) {
    const senderId = msg.sender === "bot" ? bot1.id : bot2.id;
    const receiverId = msg.sender === "bot" ? bot2.id : bot1.id;

    await prisma.iMMessage.create({
      data: {
        id: randomUUID(),
        conversationId: conversation.id,
        senderId,
        receiverId,
        seq: seq++,
        msgType: "TEXT",
        payload: msg.content,
        mediaLevel: "L0_TEXT",
        consentState: "CONSENT_GRANTED",
        ruleResult: "PASS",
        encryptionMode: "SERVER",
      }
    });
  }

  // 更新对话最后消息
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      messageCount: template.messages.length,
    }
  });

  console.log(`✅ Created conversation: ${bot1.name} ↔ ${bot2.name} (${template.name})`);
  return conversation;
}

// 为用户创建模拟对话
async function createConversationsForUser(userId: string) {
  const bots = await getOrCreateBotUsers();
  const results = [];

  // 为每个模板创建一个对话
  for (let i = 0; i < Math.min(conversationTemplates.length, bots.length); i++) {
    const template = conversationTemplates[i];
    const bot = bots[i];

    // 检查是否已存在对话
    const existingConv = await prisma.conversation.findFirst({
      where: {
        OR: [
          { userAId: userId, userBId: bot.id },
          { userAId: bot.id, userBId: userId },
        ]
      }
    });

    if (existingConv) {
      console.log(`ℹ️ Conversation already exists with ${bot.name}`);
      continue;
    }

    // 创建对话
    const conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        userAId: userId,
        userBId: bot.id,
        initiatorId: userId,
        state: "ACTIVE",
        cachedConsentState: "CONSENT_GRANTED",
        participants: {
          create: [
            { userId },
            { userId: bot.id },
          ]
        }
      }
    });

    // 创建消息
    let seq = 1;
    const now = Date.now();
    for (const msg of template.messages) {
      const senderId = msg.sender === "bot" ? bot.id : userId;
      const receiverId = msg.sender === "bot" ? userId : bot.id;

      await prisma.iMMessage.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          senderId,
          receiverId,
          seq: seq++,
          msgType: "TEXT",
          payload: msg.content,
          mediaLevel: "L0_TEXT",
          consentState: "CONSENT_GRANTED",
          ruleResult: "PASS",
          encryptionMode: "SERVER",
        }
      });
    }

    // 更新对话
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        messageCount: template.messages.length,
      }
    });

    console.log(`✅ Created conversation with ${bot.name}: ${template.name}`);
    results.push({ bot: bot.name, template: template.name });
  }

  return results;
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "setup-bots") {
      // 只设置机器人用户
      const bots = await getOrCreateBotUsers();
      console.log(`\n✅ Setup complete! Created ${bots.length} bot users.`);
    } 
    else if (command === "create-for-user" && args[1]) {
      // 为指定用户创建对话
      const userId = args[1];
      const results = await createConversationsForUser(userId);
      console.log(`\n✅ Created ${results.length} conversations for user ${userId}`);
    }
    else if (command === "bot-chat") {
      // 创建机器人之间的对话
      const bots = await getOrCreateBotUsers();
      for (let i = 0; i < bots.length - 1; i++) {
        const template = conversationTemplates[i % conversationTemplates.length];
        await createMockConversation(bots[i], bots[i + 1], template);
      }
      console.log(`\n✅ Created bot-to-bot conversations`);
    }
    else {
      console.log(`
LokFeel Bot Auto-Conversation System

Usage:
  npx tsx scripts/bot/auto-conversation.ts <command> [args]

Commands:
  setup-bots              - Create bot users only
  create-for-user <id>    - Create conversations for a specific user
  bot-chat                - Create conversations between bots

Examples:
  npx tsx scripts/bot/auto-conversation.ts setup-bots
  npx tsx scripts/bot/auto-conversation.ts create-for-user user_123
  npx tsx scripts/bot/auto-conversation.ts bot-chat
      `);
    }
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
