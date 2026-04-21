/**
 * Bot Auto-Reply System for IM
 * 
 * Handles automatic responses from bot users when they receive messages.
 * IMPORTANT: Vercel Serverless kills the process after response is sent,
 * so we CANNOT use setTimeout. Bot replies are written synchronously to DB,
 * and the frontend polling mechanism will pick them up.
 */

import { prisma } from "@/lib/prisma";

// Pusher is optional - only push if available
let pusherServer: any = null;
try {
  const mod = require("@/lib/pusher");
  pusherServer = mod.pusherServer;
} catch {
  console.warn("[Bot Reply] Pusher not available, bot replies will be stored in DB only");
}

// Bot response templates by category
const BOT_RESPONSES: Record<string, string[]> = {
  greeting: [
    "Hey! 👋 Nice to hear from you!",
    "Hi there! How's your day going?",
    "Hello! 😊 Thanks for reaching out!",
    "Hey! Great to match with you!",
    "Hi! I was hoping you'd message me!",
  ],
  question: [
    "That's a great question! Let me think...",
    "Hmm, interesting! I'd say...",
    "Good point! I think...",
    "Oh, I love that question! ",
    "You know, I've been wondering about that too!",
  ],
  interest: [
    "That sounds amazing! Tell me more! ✨",
    "Wow, I'm really interested in that too!",
    "No way! I love that as well!",
    "We should definitely talk more about this!",
    "You're speaking my language! 😄",
  ],
  casual: [
    "Haha, totally! 😄",
    "I know what you mean!",
    "Right? I was just thinking that!",
    "Exactly! Couldn't agree more.",
    "For sure! 💯",
  ],
  weekend: [
    "I'm thinking of checking out some local spots. You?",
    "Probably going to relax and maybe grab coffee with friends. How about you?",
    "I might go hiking if the weather's nice! 🥾",
    "There's a new restaurant I've been wanting to try!",
    "Just taking it easy, maybe some Netflix and wine. 🍷",
  ],
  food: [
    "I love trying new cuisines! Any recommendations? 🍜",
    "Italian is my weakness, especially pasta!",
    "I'm always down for good sushi! 🍣",
    "Have you tried that new place downtown?",
    "I'm a bit of a foodie, always hunting for hidden gems!",
  ],
  travel: [
    "I just got back from a trip actually! ✈️",
    "Japan is at the top of my bucket list!",
    "I love spontaneous weekend getaways!",
    "Beach or mountains? I'm a beach person! 🏖️",
    "Traveling is my favorite thing to do when I have time off!",
  ],
  fallback: [
    "That's interesting! Tell me more about yourself?",
    "I'd love to hear more about what you're into!",
    "So what brings you to this app? 😊",
    "I'm curious, what's your ideal weekend like?",
    "What kind of things are you passionate about?",
  ],
};

// Keywords to categorize incoming messages
const KEYWORDS: Record<string, string[]> = {
  greeting: ["hi", "hello", "hey", "howdy", "good morning", "good evening", "what's up", "sup"],
  question: ["?", "what", "how", "why", "when", "where", "who", "which", "can you", "do you"],
  interest: ["love", "like", "enjoy", "favorite", "into", "passion", "hobby", "hobbies"],
  weekend: ["weekend", "saturday", "sunday", "plans", "doing this weekend", "free time"],
  food: ["food", "eat", "restaurant", "cooking", "dinner", "lunch", "breakfast", "cuisine", "sushi", "pizza"],
  travel: ["travel", "trip", "vacation", "country", "place", "visited", "going to", "flying"],
};

/**
 * Categorize an incoming message
 */
function categorizeMessage(content: string): string {
  const lower = content.toLowerCase();
  
  for (const [category, words] of Object.entries(KEYWORDS)) {
    if (words.some(word => lower.includes(word))) {
      return category;
    }
  }
  
  return "fallback";
}

/**
 * Get a random response from a category
 */
function getRandomResponse(category: string): string {
  const responses = BOT_RESPONSES[category] || BOT_RESPONSES.fallback;
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Check if a user is a bot and should auto-reply.
 * Simplified: only checks User.isBot flag.
 * BotProfile is optional — many bots (DEMO, imported) don't have one.
 */
export async function shouldBotReply(userId: string): Promise<{
  shouldReply: boolean;
  botType: string | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBot: true, botType: true },
  });

  if (!user?.isBot) {
    return { shouldReply: false, botType: null };
  }

  // Optionally check BotProfile if it exists (for fine-grained control)
  try {
    const botProfile = await prisma.botProfile.findFirst({
      where: { profile: { userId } },
      select: { sleepUntil: true, isActive: true },
    });

    if (botProfile?.sleepUntil && botProfile.sleepUntil > new Date()) {
      console.log(`[Bot Reply] Bot ${userId} is sleeping until ${botProfile.sleepUntil}`);
      return { shouldReply: false, botType: user.botType };
    }

    if (botProfile?.isActive === false) {
      console.log(`[Bot Reply] Bot ${userId} is inactive`);
      return { shouldReply: false, botType: user.botType };
    }
  } catch {
    // BotProfile doesn't exist for this user — that's fine, proceed with reply
  }

  return {
    shouldReply: true,
    botType: user.botType,
  };
}

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
    // Categorize and generate response
    const category = categorizeMessage(incomingMessage);
    const responseContent = getRandomResponse(category);

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

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        // Increment the real sender's unread count (they received the bot's reply)
        unreadCountA: { increment: 1 },
      },
    });

    // Send real-time notification (if Pusher is available)
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
 */
export async function handleBotReply(
  conversationId: string,
  senderId: string,
  receiverId: string,
  messageContent: string
): Promise<void> {
  const { shouldReply, botType } = await shouldBotReply(receiverId);
  
  if (!shouldReply) {
    console.log(`[Bot Reply] Receiver ${receiverId} is not a bot or is inactive. Skipping.`);
    return;
  }

  console.log(`[Bot Reply] Bot ${receiverId} (type: ${botType}) will reply immediately (no delay - serverless compatible)`);

  // Execute reply directly — no setTimeout
  await sendBotReply(receiverId, conversationId, senderId, messageContent);
}
