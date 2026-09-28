/**
 * Bot Auto-Reply System for IM（IM 终局侧写入实现）
 *
 * ✅ [P1-6 阶段 5] 本文件已完成去重（G-3 / G-6）：
 *   · 文案模板与分类逻辑 → 抽取到 `lib/im/bot-templates.ts`（单一数据源）
 *   · 准入判定（isBot / sleepUntil / isActive） → 抽取到 `lib/im/bot-gate.ts`（单一数据源）
 *   本文件从此**只负责写入**，不再持有任何模板或判定文案。
 *
 * 改造前的问题（记录于此以免回退）：
 *   同一套模板在本文件、分发器 Legacy 分支、分发器 IM 分支各有一份逐字副本；
 *   准入判定则有"本文件有 / 分发器没有"的分歧 —— 休眠或被停用的 Bot
 *   在 Legacy 路径上仍会回复用户。
 *
 * IMPORTANT: Vercel Serverless kills the process after response is sent,
 * so we CANNOT use setTimeout. Bot replies are written synchronously to DB,
 * and the frontend polling mechanism will pick them up.
 */

import { prisma } from "@/lib/prisma";
import { generateBotResponse } from "@/lib/im/bot-templates";
import { checkBotReplyEligibility } from "@/lib/im/bot-gate";

// Pusher is optional - only push if available
import { getPusherServer } from "@/lib/pusher";

// 兼容旧调用点：`shouldBotReply` 的权威实现已迁至 `lib/im/bot-gate`。
// 这里只做转出，不再保留第二份判定逻辑。
export { shouldBotReply, checkBotReplyEligibility } from "@/lib/im/bot-gate";

/**
 * Generate and send bot reply — SYNCHRONOUSLY (no setTimeout!)
 * Vercel Serverless kills the process after response, so setTimeout never fires.
 * We write the reply directly to DB; frontend polling picks it up.
 */
export async function sendBotReply(
  botUserId: string,
  conversationId: string,
  senderId: string,
  incomingMessage: string
): Promise<void> {
  try {
    // Categorize and generate response（单一模板源）
    const { content: responseContent, category } = generateBotResponse(incomingMessage);

    // Get next sequence number
    const lastMessage = await prisma.iMMessage.findFirst({
      where: { conversationId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const nextSeq = (lastMessage?.seq || 0) + 1;

    // Create message
    const message = await prisma.iMMessage.create({
      data: {
        conversationId,
        senderId: botUserId,
        receiverId: senderId,
        seq: nextSeq,
        msgType: "TEXT",
        payload: responseContent,
        encryptionMode: "SERVER",
        consentState: "CONSENT_NONE",
        mediaLevel: "L0_TEXT",
        ruleResult: "PASS",
      },
      include: {
        sender: {
          include: {
            profile: {
              select: {
                displayName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    // Update conversation — increment unread count for the HUMAN user (the bot's reply recipient)
    // Previously hardcoded unreadCountA — P0-3 bug: human could be userA or userB
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userAId: true, userBId: true },
    });

    if (!conv) {
      console.error(`[Bot Reply] Conversation ${conversationId} not found, skipping update`);
      return;
    }

    // senderId is the human user who sent the original message (receiver of bot's reply)
    const isHumanUserA = conv.userAId === senderId;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        // Increment the REAL user's unread count (they received the bot's reply)
        ...(isHumanUserA ? { unreadCountA: { increment: 1 } } : { unreadCountB: { increment: 1 } }),
      },
    });

    // Send real-time notification (if Pusher is available)
    const pusherServer = getPusherServer();
    try {
      if (pusherServer) {
        const messagePayload = {
          msgId: message.id,
          clientMsgId: message.id,
          senderId: botUserId,
          receiverId: senderId,
          convId: conversationId,
          seq: message.seq,
          msgType: message.msgType,
          payload: message.payload,
          encryptionMode: "SERVER",
          complianceTags: [],
          consentState: "CONSENT_NONE",
          mediaLevel: "L0_TEXT",
          ruleResult: "PASS",
          isEdited: false,
          isDeleted: false,
          status: "DELIVERED",
          timestamp: new Date(message.createdAt).getTime(),
          sender: {
            id: message.sender.id,
            name: message.sender.profile?.displayName || message.sender.name || "Unknown",
            avatar: message.sender.profile?.avatar,
          },
        };

        // Broadcast to conversation channel
        await pusherServer.trigger(
          `private-im-conv-${conversationId}`,
          "im:message",
          { message: messagePayload }
        );

        // Notify sender's personal channel
        await pusherServer.trigger(
          `private-im-user-${senderId}`,
          "im:message",
          { message: messagePayload }
        );
      } else {
        console.log("[Bot Reply] Pusher not available, message stored in DB. Polling will pick it up.");
      }
    } catch (pusherErr) {
      console.warn("[Bot Reply] Pusher push failed, message still saved in DB:", pusherErr);
    }

    // Log bot interaction (non-blocking, tolerate failure)
    try {
      await prisma.botInteractionLog.create({
        data: {
          botUserId,
          targetUserId: senderId,
          interactionType: "message_received",
          action: "respond",
          responseDelay: Math.floor(Math.random() * 20 + 5),
          outcome: "success",
          context: JSON.stringify({
            conversationId,
            category,
            responseLength: responseContent.length,
          }),
        },
      });
    } catch {
      // BotInteractionLog table might not exist or have constraint issues — skip
    }

    console.log(`[Bot Reply] ${botUserId} replied to ${senderId}: "${responseContent.substring(0, 50)}..."`);
  } catch (error) {
    console.error("[Bot Reply] Error sending reply:", error);
  }
}

/**
 * Handle incoming message — check if bot should reply and send immediately.
 * NO setTimeout: Vercel Serverless terminates after response.
 * Bot reply is written to DB before API returns; frontend polls and displays it.
 *
 * 这是 IM 侧**唯一**的 Bot 回复入口。分发器的 IM 分支也应当调用本函数，
 * 而不是自己 dup 一份写入逻辑（G-6）。
 */
export async function handleBotReply(
  conversationId: string,
  senderId: string,
  receiverId: string,
  messageContent: string
): Promise<void> {
  const { shouldReply, botType, reason } = await checkBotReplyEligibility(receiverId);

  if (!shouldReply) {
    console.log(
      `[Bot Reply] Receiver ${receiverId} will not reply (reason: ${reason ?? "unknown"}). Skipping.`
    );
    return;
  }

  console.log(`[Bot Reply] Bot ${receiverId} (type: ${botType}) will reply immediately (no delay - serverless compatible)`);

  // Execute reply directly — no setTimeout
  await sendBotReply(receiverId, conversationId, senderId, messageContent);
}
