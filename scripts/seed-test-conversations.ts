#!/usr/bin/env tsx
/**
 * 为 icebreaker（破冰）功能播种测试会话。
 *
 * 用法：
 *   npx tsx scripts/seed-test-conversations.ts
 *
 * ── P1-6 阶段 5 迁移说明（2026-09-28）────────────────────────────────────
 *
 * 本脚本原先只写 Legacy 三表（`ChatRoom` / `ChatRoomMember` / `Message`）。
 * 阶段 4 前端换源之后，**聊天页读的是 IM（`Conversation` / `IMMessage`）**，
 * 于是本脚本播出来的数据在界面上一条都看不见 —— 也就是说它早已失效，
 * 只是没人发现（接口不报错、Legacy 侧数据齐全）。
 *
 * 现改为**只播种 IM**，并直接复用生产路径的两个函数：
 *   · `createConversation` —— 保证 participants / matchId 接线与线上一致
 *   · `createMessage`      —— 保证 seq 分配与未读计数与线上一致
 * 手写 `prisma.iMMessage.create` 会漏掉 seq 递增和 unreadCount 自增，
 * 得到的是"看起来有消息但徽章永远是 0"的假数据。
 *
 * ⚠️ 与旧版的一处**有意修正**：旧版给第二条消息（Sarah → Michael）标了
 *    `isRead: true`，但同一脚本打印的预期却是「Michael has 1 unread reply
 *    from Sarah」—— 两者互相矛盾。以脚本自己声明的预期为准（见文末 summary）。
 *
 * @module scripts/seed-test-conversations
 */

import { db as prisma } from "@/lib/db";
import { createConversation, createMessage } from "@/lib/im/queries";

/** 从「今天 + n 天」得到一个 Vault 过期时间 */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/** 播种一条消息（走生产路径，自动处理 seq 与未读计数） */
async function seedMessage(
  conversationId: string,
  senderId: string,
  receiverId: string,
  payload: string,
): Promise<void> {
  await createMessage(conversationId, senderId, receiverId, payload, { msgType: "TEXT" });
}

async function seedTestConversations() {
  console.log("🌱 Seeding test conversations...\n");

  try {
    // ── 获取测试用户 ──
    const [sarah, michael, emma] = await Promise.all([
      prisma.user.findUnique({ where: { email: "sarah@example.com" }, include: { profile: true } }),
      prisma.user.findUnique({ where: { email: "michael@example.com" }, include: { profile: true } }),
      prisma.user.findUnique({ where: { email: "emma@example.com" }, include: { profile: true } }),
    ]);

    if (!sarah || !michael || !emma) {
      console.error("❌ Test users not found. Please run seed-users first.");
      return;
    }

    console.log("Found test users:");
    console.log(`  - Sarah: ${sarah.id}`);
    console.log(`  - Michael: ${michael.id}`);
    console.log(`  - Emma: ${emma.id}`);

    // ═══════════════════════════════════════════════════════════════════
    // 会话 1：Sarah <> Michael（活跃会话，Vault 还剩 7 天）
    // ═══════════════════════════════════════════════════════════════════
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
    } else if (sarahMichaelMatch.status !== "ACCEPTED") {
      await prisma.match.update({
        where: { id: sarahMichaelMatch.id },
        data: { status: "ACCEPTED" },
      });
      console.log("\n✅ Updated match: Sarah <> Michael (status: ACCEPTED)");
    } else {
      console.log("\n✅ Match already ACCEPTED: Sarah <> Michael");
    }

    const vault7d = daysFromNow(7);
    const conv1 = await createConversation(sarah.id, michael.id, michael.id, {
      matchId: sarahMichaelMatch.id,
      vaultExpiresAt: vault7d,
      vaultStatus: "ACTIVE",
    });

    // `createConversation` 的 upsert 分支刻意**不**重置 Vault（防止复活已 REVOKED 的会话），
    // 所以重复播种时必须显式把测试场景复位 —— 否则第二次跑会保留上次的过期时间。
    await prisma.conversation.update({
      where: { id: conv1.convId },
      data: { vaultExpiresAt: vault7d, vaultStatus: "ACTIVE" },
    });

    // 幂等：本次会话已有消息就不再重复播（createMessage 没有 upsert 语义）
    const conv1MsgCount = await prisma.iMMessage.count({ where: { conversationId: conv1.convId } });
    if (conv1MsgCount === 0) {
      await seedMessage(
        conv1.convId,
        michael.id,
        sarah.id,
        "Hey Sarah! 👋 I noticed we both value deep conversations. What's something you're really passionate about?",
      );
      await seedMessage(
        conv1.convId,
        sarah.id,
        michael.id,
        "Hi Michael! That's a great question. I'm really passionate about photography - capturing genuine moments between people. What about you?",
      );
      await seedMessage(
        conv1.convId,
        michael.id,
        sarah.id,
        "Photography is amazing! I love hiking and finding those perfect sunrise spots. Do you prefer urban or nature photography?",
      );
      console.log("✅ Created 3 messages in Sarah <> Michael conversation");
    } else {
      console.log(`✅ Sarah <> Michael conversation already has ${conv1MsgCount} messages, skipped`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 会话 2：Sarah <> Emma（Vault 即将到期 —— 用于测倒计时 UI）
    // ═══════════════════════════════════════════════════════════════════
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
    } else if (sarahEmmaMatch.status !== "ACCEPTED") {
      await prisma.match.update({
        where: { id: sarahEmmaMatch.id },
        data: { status: "ACCEPTED" },
      });
      console.log("✅ Updated match: Sarah <> Emma (status: ACCEPTED)");
    } else {
      console.log("✅ Match already ACCEPTED: Sarah <> Emma");
    }

    const vault3d = daysFromNow(3);
    const conv2 = await createConversation(emma.id, sarah.id, emma.id, {
      matchId: sarahEmmaMatch.id,
      vaultExpiresAt: vault3d,
      vaultStatus: "ACTIVE",
    });
    await prisma.conversation.update({
      where: { id: conv2.convId },
      data: { vaultExpiresAt: vault3d, vaultStatus: "ACTIVE" },
    });

    const conv2MsgCount = await prisma.iMMessage.count({ where: { conversationId: conv2.convId } });
    if (conv2MsgCount === 0) {
      await seedMessage(
        conv2.convId,
        emma.id,
        sarah.id,
        "Hi Sarah! 😊 I saw you love cooking too! What's your favorite cuisine to experiment with?",
      );
      console.log("✅ Created 1 message in Sarah <> Emma conversation (Vault expiring soon)");
    } else {
      console.log(`✅ Sarah <> Emma conversation already has ${conv2MsgCount} messages, skipped`);
    }

    // ── 复核：把实际未读数打印出来 ──
    // 未读数由 `createMessage` 维护在 `Conversation.unreadCountA/B` 上，
    // 打印它可以在播种失败时立刻暴露（而不是等 UI 测试报"徽章是 0"）。
    const [c1, c2] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: conv1.convId },
        select: { userAId: true, unreadCountA: true, unreadCountB: true },
      }),
      prisma.conversation.findUnique({
        where: { id: conv2.convId },
        select: { userAId: true, unreadCountA: true, unreadCountB: true },
      }),
    ]);

    /** 取某个会话对某个用户的未读数 */
    const unreadFor = (
      conv: { userAId: string; unreadCountA: number; unreadCountB: number } | null,
      userId: string,
    ): number => (conv ? (conv.userAId === userId ? conv.unreadCountA : conv.unreadCountB) : 0);

    const sarahFromMichael = unreadFor(c1, sarah.id);
    const sarahFromEmma = unreadFor(c2, sarah.id);
    const michaelFromSarah = unreadFor(c1, michael.id);

    console.log("\n🎉 Test conversations seeded successfully!");
    console.log("\nTest scenarios（实际值在括号里，必须与预期一致）:");
    console.log(`  1. Sarah has 2 unread from Michael   → 实际 ${sarahFromMichael}`);
    console.log(`  2. Sarah has 1 unread from Emma      → 实际 ${sarahFromEmma}（Vault 3 天后到期）`);
    console.log(`  3. Michael has 1 unread from Sarah   → 实际 ${michaelFromSarah}`);
    console.log("\nLogin with sarah@example.com / demo123456 to test icebreaker!");
  } catch (error) {
    console.error("\n❌ Error seeding conversations:", error);
    process.exit(1);
  } finally {
    // Prisma connection managed by lib/db
  }
}

seedTestConversations();
