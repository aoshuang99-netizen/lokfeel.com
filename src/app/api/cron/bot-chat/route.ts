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
// G-11 / G-15 修复：Bot 消息过去**只**写 Legacy `Message`，而阶段 4 之后前端读的是 IM ——
// 于是 Bot 说的话一条都没进用户实际读的表（且全程静默）。
// 上一轮引入的 `legacy-write` 桥是"Legacy 主 + 前向镜像"，方向与本路由的新读侧相反
// （读按 conversationId、写按 chatRoomId），且关掉 `CHAT_TWIN_WRITE` 会让消息彻底
// 进不了 IM。本轮统一到 `writeMessage`：**IM 为主，Legacy 为可选副本**。
import { writeMessage } from '@/lib/im/write-message';
import { generateResponse, shouldInitiateConversation, shouldEndConversation } from '@/lib/bot-engine/modules/chat';
import { deserializeBotConfig } from '@/lib/bot-engine/config';
import {
  BOT_DISABLED_HTTP_STATUS,
  botDisabledBody,
  isBotEnabled,
} from '@/config/bot-policy';

export const dynamic = 'force-dynamic';
// maxDuration is ignored on Vercel Hobby (hard limit: 10s)
export const maxDuration = 60;

// In-memory dedup (per region instance, survives warm starts < 10 min)
// 键为 **Conversation.id**（阶段 5 前曾为 ChatRoom.id）
const lastProcessedRoom = new Map<string, number>();
const MAX_ROOMS_PER_BATCH = 8; // Conservative to fit within 10s Hobby timeout

// Build conversation history from IM messages (`payload` 是终局模型的正文列)
function buildConversationHistory(messages: any[]) {
  return messages
    .slice()
    .reverse()
    .map((msg: any) => ({
      senderId: msg.senderId,
      content: msg.payload,
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
  const lastProcessed = lastProcessedRoom.get(room.conversationId);

  // Skip if recently processed (within 4 minutes)
  if (lastProcessed && now - lastProcessed < 4 * 60 * 1000) {
    return { messagesSent: 0, initiated: 0, closed: 0, skipped: true };
  }

  const minutesSinceLastMessage = lastMessage
    ? (now - new Date(lastMessage.createdAt).getTime()) / 60_000
    : Infinity;

  // 伙伴信息与匹配信息由调用方（读侧）预先算好 —— 读侧已经做过一次
  // Conversation + Match 的批量回查，这里再查一次就是多余的 N+1。
  const partnerName = room.partnerName || 'Someone';
  // 由读侧依据 `Match.receiverId` 预先判定（Conversation 与 Match 之间无 relation）
  const isReceiver = !!room.isReceiver;

  const conversationHistory = buildConversationHistory(room.messages || []);

  let messagesSent = 0;
  let initiated = 0;
  let closed = 0;

  // Check if should end conversation
  if (shouldEndConversation(config, {
    botUserId: botId,
    conversationId: room.conversationId,
    partnerId: room.partnerId,
    partnerName,
    matchScore: room.matchScore,
    conversationHistory,
    isInitiating: false,
    followUpCount: 0,
    isReceiver,
    minutesSinceLastMessage,
  }, minutesSinceLastMessage)) {
    const closingMessage = generateResponse(config, {
      botUserId: botId,
      conversationId: room.conversationId,
      partnerId: room.partnerId,
      partnerName,
      matchScore: room.matchScore,
      conversationHistory,
      isInitiating: false,
      followUpCount: 0,
      isReceiver,
      minutesSinceLastMessage,
    });

    if (closingMessage.type === 'closing' && closingMessage.content) {
      await writeMessage({
        conversationId: room.conversationId,
        senderId: botId,
        content: closingMessage.content,
        msgType: 'TEXT',
      });

      closed++;
      messagesSent++;
    }
    lastProcessedRoom.set(room.conversationId, now);
    return { messagesSent, initiated, closed, skipped: false };
  }

  // Check if should initiate conversation (new match, no messages)
  if (conversationHistory.length === 0) {
    if (shouldInitiateConversation(config, room.matchScore, isReceiver)) {
      const initMessage = generateResponse(config, {
        botUserId: botId,
        conversationId: room.conversationId,
        partnerId: room.partnerId,
        partnerName,
        matchScore: room.matchScore,
        conversationHistory: [],
        isInitiating: true,
        followUpCount: 0,
        isReceiver,
        minutesSinceLastMessage,
      });

      if (initMessage.content) {
        await writeMessage({
          conversationId: room.conversationId,
          senderId: botId,
          content: initMessage.content,
          msgType: 'TEXT',
        });

        initiated++;
        messagesSent++;
      }
    }
    lastProcessedRoom.set(room.conversationId, now);
    return { messagesSent, initiated, closed, skipped: false };
  }

  // Generate response to last message
  const responseMessage = generateResponse(config, {
    botUserId: botId,
    conversationId: room.conversationId,
    partnerId: room.partnerId,
    partnerName,
    matchScore: room.matchScore,
    conversationHistory,
    isInitiating: false,
    followUpCount: 0,
    isReceiver,
    minutesSinceLastMessage,
  });

  if (responseMessage.content) {
    await writeMessage({
      conversationId: room.conversationId,
      senderId: botId,
      content: responseMessage.content,
      msgType: 'TEXT',
    });

    // Log analytics event
    await db.analyticsEvent.create({
      data: {
        userId: botId,
        event: 'bot.chat_message_sent',
        properties: JSON.stringify({
          conversationId: room.conversationId,
          messageType: responseMessage.type,
        }),
      },
    });

    messagesSent++;
  }

  lastProcessedRoom.set(room.conversationId, now);
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

  // P0-5：Bot 模块总开关（默认关闭的可选模块）。鉴权之后判，避免匿名探测。
  if (!isBotEnabled()) {
    return NextResponse.json(botDisabledBody(), { status: BOT_DISABLED_HTTP_STATUS });
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

    // 找出最近活跃的会话（P1-6 阶段 5：读侧改终局模型 `Conversation`）。
    //
    // 判据说明（见 docs/CHAT-MERGE-AUDIT.md §16.8）：
    //   · 「归档」的等价物**不是** `Conversation.state` —— 该字段除创建时写 ACTIVE
    //     外无人写入（`updateConversationState` 导出但零调用），恒为 ACTIVE，
    //     用它等于不过滤。
    //   · 正确的等价物是 `vaultStatus !== 'REVOKED'`：全仓唯一设置 Legacy
    //     `isArchived: true` 的地方就是 Vault 撤销路径，它在同一次 update 里
    //     同时写入 `vaultStatus: 'REVOKED'`。
    //   · Bot 成员要求 `isMuted: false`（对齐 Legacy 的成员级过滤），
    //     并且至少有一名 Bot 参与 —— 否则这个会话不需要 Bot 引擎介入。
    //
    // ⚠️ 前提：`chat:vault:apply` 已执行（Vault 字段从 ChatRoom 迁入 Conversation）。
    //    否则 Conversation 侧全是默认 ACTIVE，会把已撤销的会话重新纳入处理队列。
    const recentConvs = await db.conversation.findMany({
      where: {
        lastMessageAt: { gte: tenMinutesAgo },
        NOT: { vaultStatus: 'REVOKED' },
        participants: {
          some: { isMuted: false, user: { isBot: { not: false } } },
        },
      },
      orderBy: { lastMessageAt: 'asc' }, // Process oldest first
      take: MAX_ROOMS_PER_BATCH + 1, // +1 to detect hasMore
      select: {
        id: true,
        lastMessageAt: true,
        matchId: true,
        participants: {
          where: { isMuted: false },
          select: {
            userId: true,
            user: {
              select: {
                id: true,
                isBot: true,
                botConfig: true,
                name: true,
                profile: { select: { displayName: true } },
              },
            },
          },
        },
        imMessages: {
          orderBy: { seq: 'desc' },
          take: 20,
          select: { senderId: true, payload: true, createdAt: true },
        },
      },
    });

    // `matchScore` 只存在于 `Match` 表，而 `Conversation` 与 `Match` 之间
    // **刻意没有 relation**（见 prisma/schema.prisma 的 G-10 注释），
    // 所以这里批量回查一次而不是在循环里逐个查（避免 N+1）。
    const batchMatchIds = recentConvs
      .map((c) => c.matchId)
      .filter((id): id is string => !!id);
    const batchMatches =
      batchMatchIds.length > 0
        ? await db.match.findMany({
            where: { id: { in: batchMatchIds } },
            select: { id: true, matchScore: true, senderId: true, receiverId: true },
          })
        : [];
    const matchById = new Map(batchMatches.map((m) => [m.id, m]));

    // Determine if more conversations exist beyond this batch
    if (recentConvs.length > MAX_ROOMS_PER_BATCH) {
      hasMore = true;
      recentConvs.pop(); // Remove the +1 extra
    }

    // Safe approach: query count separately (lightweight)
    const totalActiveRooms = await db.conversation.count({
      where: {
        lastMessageAt: { gte: tenMinutesAgo },
        NOT: { vaultStatus: 'REVOKED' },
      },
    });
    hasMore = hasMore || (roomsProcessed + recentConvs.length < totalActiveRooms);

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

    // Process each conversation
    for (const room of recentConvs) {
      // Timeout guard: stop at 9s to avoid Hobby 10s kill
      if (Date.now() - startTime > 9000) {
        hasMore = true;
        break;
      }

      // 找到该会话里的 Bot 参与者
      const botMember = room.participants.find((m: any) => m.user?.isBot);
      if (!botMember) continue;

      const bot = botMember.user;
      const config = getBotConfig(bot.id, bot.botConfig);
      if (!config) continue;

      // 伙伴 = 除 Bot 之外的另一方（本产品会话恒为 1:1）
      const partner = room.participants.find((m: any) => m.userId !== bot.id);
      const match = room.matchId ? matchById.get(room.matchId) : undefined;

      // Reformat conversation data for processRoom
      const roomForProcessing = {
        conversationId: room.id,
        matchScore: match?.matchScore || 50,
        isReceiver: match ? match.receiverId === bot.id : false,
        partnerId: partner?.userId || '',
        partnerName:
          partner?.user?.profile?.displayName || partner?.user?.name || 'Someone',
        messages: room.imMessages,
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
