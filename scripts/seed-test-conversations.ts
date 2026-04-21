#!/usr/bin/env tsx
/**
 * Seed test conversations for icebreaker testing
 * Creates chat rooms and messages between test users
 */

import { db as prisma } from "@/lib/db";

async function seedTestConversations() {
  console.log("🌱 Seeding test conversations...\n");

  try {
    // Get test users
    const sarah = await prisma.user.findUnique({
      where: { email: "sarah@example.com" },
      include: { profile: true },
    });

    const michael = await prisma.user.findUnique({
      where: { email: "michael@example.com" },
      include: { profile: true },
    });

    const emma = await prisma.user.findUnique({
      where: { email: "emma@example.com" },
      include: { profile: true },
    });

    if (!sarah || !michael || !emma) {
      console.error("❌ Test users not found. Please run seed-users first.");
      return;
    }

    console.log("Found test users:");
    console.log(`  - Sarah: ${sarah.id}`);
    console.log(`  - Michael: ${michael.id}`);
    console.log(`  - Emma: ${emma.id}`);

    // Create or get match between Sarah and Michael
    let sarahMichaelMatch = await prisma.match.findFirst({
      where: {
        OR: [
          { senderId: sarah.id, receiverId: michael.id },
          { senderId: michael.id, receiverId: sarah.id },
        ],
      },
    });

    if (!sarahMichaelMatch) {
      sarahMichaelMatch = await prisma.match.create({
        data: {
          senderId: sarah.id,
          receiverId: michael.id,
          status: "ACCEPTED",
          matchScore: 85,
          matchReason: "Great compatibility based on your relationship blueprint",
        },
      });
      console.log("\n✅ Created match: Sarah <> Michael");
    } else {
      // Update to ACCEPTED if not already
      if (sarahMichaelMatch.status !== "ACCEPTED") {
        await prisma.match.update({
          where: { id: sarahMichaelMatch.id },
          data: { status: "ACCEPTED" },
        });
      }
      console.log("\n✅ Updated match: Sarah <> Michael (status: ACCEPTED)");
    }

    // Create or get chat room
    let chatRoom1 = await prisma.chatRoom.findFirst({
      where: { matchId: sarahMichaelMatch.id },
    });

    if (!chatRoom1) {
      const vaultExpiry = new Date();
      vaultExpiry.setDate(vaultExpiry.getDate() + 7); // 7 days from now

      chatRoom1 = await prisma.chatRoom.create({
        data: {
          matchId: sarahMichaelMatch.id,
          vaultExpiry,
          members: {
            create: [
              { userId: sarah.id },
              { userId: michael.id },
            ],
          },
        },
      });
      console.log("✅ Created chat room for Sarah <> Michael");
    } else {
      console.log("✅ Chat room already exists: Sarah <> Michael");
    }

    // Create messages
    const messages1 = [
      {
        roomId: chatRoom1.id,
        senderId: michael.id,
        content: "Hey Sarah! 👋 I noticed we both value deep conversations. What's something you're really passionate about?",
        isRead: false,
      },
      {
        roomId: chatRoom1.id,
        senderId: sarah.id,
        content: "Hi Michael! That's a great question. I'm really passionate about photography - capturing genuine moments between people. What about you?",
        isRead: true,
      },
      {
        roomId: chatRoom1.id,
        senderId: michael.id,
        content: "Photography is amazing! I love hiking and finding those perfect sunrise spots. Do you prefer urban or nature photography?",
        isRead: false,
      },
    ];

    for (const msg of messages1) {
      await prisma.message.upsert({
        where: {
          id: `${chatRoom1.id}-${msg.senderId}-${msg.content.slice(0, 20)}`,
        },
        update: {},
        create: {
          ...msg,
          id: undefined, // Let Prisma generate
        },
      });
    }
    console.log("✅ Created 3 messages in Sarah <> Michael chat");

    // Create match between Sarah and Emma
    let sarahEmmaMatch = await prisma.match.findFirst({
      where: {
        OR: [
          { senderId: sarah.id, receiverId: emma.id },
          { senderId: emma.id, receiverId: sarah.id },
        ],
      },
    });

    if (!sarahEmmaMatch) {
      sarahEmmaMatch = await prisma.match.create({
        data: {
          senderId: emma.id,
          receiverId: sarah.id,
          status: "ACCEPTED",
          matchScore: 78,
          matchReason: "Similar values and lifestyle preferences",
        },
      });
      console.log("✅ Created match: Sarah <> Emma");
    } else {
      if (sarahEmmaMatch.status !== "ACCEPTED") {
        await prisma.match.update({
          where: { id: sarahEmmaMatch.id },
          data: { status: "ACCEPTED" },
        });
      }
      console.log("✅ Updated match: Sarah <> Emma (status: ACCEPTED)");
    }

    // Create chat room for Sarah <> Emma
    let chatRoom2 = await prisma.chatRoom.findFirst({
      where: { matchId: sarahEmmaMatch.id },
    });

    if (!chatRoom2) {
      const vaultExpiry = new Date();
      vaultExpiry.setDate(vaultExpiry.getDate() + 3); // 3 days from now (expiring soon)

      chatRoom2 = await prisma.chatRoom.create({
        data: {
          matchId: sarahEmmaMatch.id,
          vaultExpiry,
          members: {
            create: [
              { userId: sarah.id },
              { userId: emma.id },
            ],
          },
        },
      });
      console.log("✅ Created chat room for Sarah <> Emma (expiring soon)");
    } else {
      console.log("✅ Chat room already exists: Sarah <> Emma");
    }

    // Create messages for Sarah <> Emma
    const messages2 = [
      {
        roomId: chatRoom2.id,
        senderId: emma.id,
        content: "Hi Sarah! 😊 I saw you love cooking too! What's your favorite cuisine to experiment with?",
        isRead: false,
      },
    ];

    for (const msg of messages2) {
      await prisma.message.upsert({
        where: {
          id: `${chatRoom2.id}-${msg.senderId}-${msg.content.slice(0, 20)}`,
        },
        update: {},
        create: {
          ...msg,
          id: undefined,
        },
      });
    }
    console.log("✅ Created 1 message in Sarah <> Emma chat");

    console.log("\n🎉 Test conversations seeded successfully!");
    console.log("\nTest scenarios:");
    console.log("  1. Sarah has 2 unread messages from Michael (active conversation)");
    console.log("  2. Sarah has 1 unread message from Emma (Vault expiring in 3 days)");
    console.log("  3. Michael has 1 unread reply from Sarah");
    console.log("\nLogin with sarah@example.com / demo123456 to test icebreaker!");

  } catch (error) {
    console.error("\n❌ Error seeding conversations:", error);
    process.exit(1);
  } finally {
    // Prisma connection managed by lib/db
  }
}

seedTestConversations();
