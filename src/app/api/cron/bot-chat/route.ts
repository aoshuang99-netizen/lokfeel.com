/**
 * Vercel Cron Job — Bot Chat Response Processing (Batch Mode)
 *
 * This endpoint is called by WorkBuddy automation (every 5 min).
 * Processes chat rooms in batches to avoid Vercel Hobby 10s timeout.
 *
 * Batch strategy:
 *   - Queries only recently-active rooms (lastMessageAt within 10 min window)
 *   - Processes up to MAX_ROOMS_PER_BATCH rooms per invocation
 *   - Returns hasMore: true when more rooms need processing
 *
 * Schedule: Every 5 minutes via WorkBuddy automation
 * Purpose: Generate and send chat messages based on conversation context
 *
 * Environment Variables Required:
 * - CRON_SECRET: Secret key for authenticating cron requests
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateResponse, shouldInitiateConversation, shouldEndConversation } from '@/lib/bot-engine/modules/chat';
import { deserializeBotConfig } from '@/lib/bot-engine/config';

export const dynamic = 'force-dynamic';
// maxDuration is ignored on Vercel Hobby (hard limit: 10s)
export const maxDuration = 60;

// In-memory dedup (per region instance, survives warm starts < 10 min)
const lastProcessedRoom = new Map<string, number>();
const MAX_ROOMS_PER_BATCH = 8; // Conservative to fit within 10s Hobby timeout

// Build conversation history from messages
function buildConversationHistory(messages: any[]) {
  return messages
    .slice()
    .reverse()
    .map((msg: any) => ({
      senderId: msg.senderId,
      content: msg.content,
      sentAt: new Date(msg.createdAt),
    }));
}

// Process a single chat room for a bot
async function processRoom(
  botId: string,
  config: any,
  room: any,
  now: number
) {
  const lastMessage = room.messages?.[0];
  const lastProcessed = lastProcessedRoom.get(room.id);

  // Skip if recently processed (within 4 minutes)
  if (lastProcessed && now - lastProcessed < 4 * 60 * 1000) {
    return { messagesSent: 0, initiated: 0, closed: 0, skipped: true };
  }

  const minutesSinceLastMessage = lastMessage
    ? (now - new Date(lastMessage.createdAt).getTime()) / 60_000
    : Infinity;

  const partner = room.members?.[0];
  const partnerName = partner?.user?.profile?.displayName || partner?.user?.name || 'Someone';
  const isReceiver = room.match ? room.match.receiverId === botId : false;

  const conversationHistory = buildConversationHistory(room.messages || []);

  let messagesSent = 0;
  let initiated = 0;
  let closed = 0;

  // Check if should end conversation
  if (shouldEndConversation(config, {
    botUserId: botId,
    chatRoomId: room.id,
    partnerId: partner?.userId || '',
    partnerName,
    matchScore: room.match?.matchScore || 50,
    conversationHistory,
    isInitiating: false,
    followUpCount: 0,
    isReceiver,
    minutesSinceLastMessage,
  }, minutesSinceLastMessage)) {
    const closingMessage = generateResponse(config, {
      botUserId: botId,
      chatRoomId: room.id,
      partnerId: partner?.userId || '',
      partnerName,
      matchScore: room.match?.matchScore || 50,
      conversationHistory,
      isInitiating: false,
      followUpCount: 0,
      isReceiver,
      minutesSinceLastMessage,
    });

    if (closingMessage.type === 'closing' && closingMessage.content) {
      await db.message.create({
        data: {
          roomId: room.id,
          senderId: botId,
          content: closingMessage.content,
          messageType: 'TEXT',
        },
      });

      await db.chatRoom.update({
        where: { id: room.id },
        data: { lastMessageAt: new Date(), updatedAt: new Date() },
      });

      closed++;
      messagesSent++;
    }
    lastProcessedRoom.set(room.id, now);
    return { messagesSent, initiated, closed, skipped: false };
  }

  // Check if should initiate conversation (new match, no messages)
  if (conversationHistory.length === 0) {
    if (shouldInitiateConversation(config, room.match?.matchScore || 50, isReceiver)) {
      const initMessage = generateResponse(config, {
        botUserId: botId,
        chatRoomId: room.id,
        partnerId: partner?.userId || '',
        partnerName,
        matchScore: room.match?.matchScore || 50,
        conversationHistory: [],
        isInitiating: true,
        followUpCount: 0,
        isReceiver,
        minutesSinceLastMessage,
      });

      if (initMessage.content) {
        await db.message.create({
          data: {
            roomId: room.id,
            senderId: botId,
            content: initMessage.content,
            messageType: 'TEXT',
          },
        });

        await db.chatRoom.update({
          where: { id: room.id },
          data: { lastMessageAt: new Date(), updatedAt: new Date() },
        });

        initiated++;
        messagesSent++;
      }
    }
    lastProcessedRoom.set(room.id, now);
    return { messagesSent, initiated, closed, skipped: false };
  }

  // Generate response to last message
  const responseMessage = generateResponse(config, {
    botUserId: botId,
    chatRoomId: room.id,
    partnerId: partner?.userId || '',
    partnerName,
    matchScore: room.match?.matchScore || 50,
    conversationHistory,
    isInitiating: false,
    followUpCount: 0,
    isReceiver,
    minutesSinceLastMessage,
  });

  if (responseMessage.content) {
    await db.message.create({
      data: {
        roomId: room.id,
        senderId: botId,
        content: responseMessage.content,
        messageType: 'TEXT',
      },
    });

    await db.chatRoom.update({
      where: { id: room.id },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });

    // Log analytics event
    await db.analyticsEvent.create({
      data: {
        userId: botId,
        event: 'bot.chat_message_sent',
        properties: JSON.stringify({
          chatRoomId: room.id,
          messageType: responseMessage.type,
        }),
      },
    });

    messagesSent++;
  }

  lastProcessedRoom.set(room.id, now);
  return { messagesSent, initiated, closed, skipped: false };
}

// GET /api/cron/bot-chat
export async function GET(request: Request) {
  const startTime = Date.now();
  const now = Date.now();

  // Verify cron secret (REQUIRED - not optional)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let totalMessagesSent = 0;
    let totalInitiated = 0;
    let totalClosed = 0;
    let roomsProcessed = 0;
    let hasMore = false;

    // Only fetch rooms with recent activity (last 10 minutes)
    // This dramatically reduces the dataset on large bot populations
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

    // Find chat rooms with recent messages where a bot is a member
    // Use a single query with limit to stay within batch budget
    const recentRooms = await db.chatRoom.findMany({
      where: {
        isArchived: false,
        lastMessageAt: { gte: tenMinutesAgo },
        members: {
          some: {
            userId: { not: undefined }, // has members
          },
        },
      },
      orderBy: { lastMessageAt: 'asc' }, // Process oldest first
      take: MAX_ROOMS_PER_BATCH + 1, // +1 to detect hasMore
      select: {
        id: true,
        lastMessageAt: true,
        match: {
          select: { matchScore: true, senderId: true, receiverId: true },
        },
        members: {
          where: { isMuted: false },
          include: {
            user: {
              select: { id: true, isBot: true, botConfig: true, name: true, profile: { select: { displayName: true } } },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    // Determine if more rooms exist beyond this batch
    if (recentRooms.length > MAX_ROOMS_PER_BATCH) {
      hasMore = true;
      recentRooms.pop(); // Remove the +1 extra
    }

    // Also check: if we have exactly MAX_ROOMS_PER_BATCH and the oldest
    // room's lastMessageAt equals the next room's, there might be more
    // Safe approach: query count separately (lightweight)
    const totalActiveRooms = await db.chatRoom.count({
      where: {
        isArchived: false,
        lastMessageAt: { gte: tenMinutesAgo },
      },
    });
    hasMore = hasMore || (roomsProcessed + recentRooms.length < totalActiveRooms);

    // Preload bot configs (cache)
    const botConfigCache = new Map<string, any>();
    function getBotConfig(botId: string, botConfigRaw: any) {
      if (botConfigCache.has(botId)) return botConfigCache.get(botId);
      let config = null;
      if (botConfigRaw) {
        try { config = deserializeBotConfig(botConfigRaw); } catch { config = null; }
      }
      botConfigCache.set(botId, config);
      return config;
    }

    // Process each room
    for (const room of recentRooms) {
      // Timeout guard: stop at 9s to avoid Hobby 10s kill
      if (Date.now() - startTime > 9000) {
        hasMore = true;
        break;
      }

      // Find bot member in this room
      const botMember = room.members.find((m: any) => m.user?.isBot);
      if (!botMember) continue;

      const bot = botMember.user;
      const config = getBotConfig(bot.id, bot.botConfig);
      if (!config) continue;

      // Reformat room data for processRoom
      const roomForProcessing = {
        id: room.id,
        match: room.match,
        members: room.members
          .filter((m: any) => m.userId !== bot.id)
          .map((m: any) => ({
            userId: m.userId,
            user: m.user,
          })),
        messages: room.messages,
      };

      const result = await processRoom(bot.id, config, roomForProcessing, now);
      if (!result.skipped) {
        totalMessagesSent += result.messagesSent;
        totalInitiated += result.initiated;
        totalClosed += result.closed;
        roomsProcessed++;
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      executionMs: duration,
      hasMore,
      stats: {
        roomsProcessed,
        messagesSent: totalMessagesSent,
        conversationsInitiated: totalInitiated,
        conversationsClosed: totalClosed,
      },
    });

  } catch (error) {
    console.error('[Cron] Chat response error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
