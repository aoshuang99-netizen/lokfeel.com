/**
 * Vercel Cron Job — Bot Chat Response Processing
 *
 * This endpoint is called every 5 minutes by Vercel Cron Jobs.
 * It generates chat responses for bots in active conversations.
 *
 * Schedule: Every 5 minutes
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
export const maxDuration = 60;

// Track last message time per chat room to avoid duplicate sends
const lastProcessedRoom = new Map<string, number>();

// GET /api/cron/bot-chat
export async function GET(request: Request) {
  const startTime = Date.now();

  // Verify cron secret (REQUIRED - not optional)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let messagesSent = 0;
    let conversationsInitiated = 0;
    let conversationsClosed = 0;

    // Load all bots
    const bots = await db.user.findMany({
      where: { isBot: true, role: 'USER' },
      select: {
        id: true,
        botConfig: true,
      },
    });

    if (bots.length === 0) {
      return NextResponse.json({
        status: 'no_bots',
        timestamp: new Date().toISOString(),
      });
    }

    // Process each bot
    for (const bot of bots) {
      // Get bot config
      let config;
      if (bot.botConfig) {
        try {
          config = deserializeBotConfig(bot.botConfig);
        } catch {
          config = null;
        }
      }

      if (!config) continue;

      // Get chat rooms where bot is a member
      const memberships = await db.chatRoomMember.findMany({
        where: {
          userId: bot.id,
          isMuted: false,
          room: {
            isArchived: false,
          },
        },
        include: {
          room: {
            include: {
              match: {
                select: { matchScore: true, senderId: true, receiverId: true },
              },
              members: {
                where: { userId: { not: bot.id } },
                include: {
                  user: {
                    select: { name: true, profile: { select: { displayName: true } } },
                  },
                },
              },
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 20,
              },
            },
          },
        },
      });

      // Process each chat room
      for (const membership of memberships) {
        const room = membership.room;
        const lastMessage = room.messages?.[0];
        const lastProcessed = lastProcessedRoom.get(room.id);

        // Skip if recently processed
        if (lastProcessed && Date.now() - lastProcessed < 4 * 60 * 1000) {
          continue;
        }

        // Calculate minutes since last message
        const minutesSinceLastMessage = lastMessage
          ? (Date.now() - new Date(lastMessage.createdAt).getTime()) / 60_000
          : Infinity;

        // Get partner info
        const partner = room.members?.[0];
        const partnerName = partner?.user?.profile?.displayName || partner?.user?.name || 'Someone';
        const isReceiver = room.match ? room.match.receiverId === bot.id : false;

        // Build conversation history
        const conversationHistory = (room.messages || [])
          .reverse()
          .map((msg: any) => ({
            senderId: msg.senderId,
            content: msg.content,
            sentAt: new Date(msg.createdAt),
          }));

        // Check if should end conversation
        if (shouldEndConversation(config, {
          botUserId: bot.id,
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
          // Generate closing message
          const closingMessage = generateResponse(config, {
            botUserId: bot.id,
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
                senderId: bot.id,
                content: closingMessage.content,
                messageType: 'TEXT',
              },
            });

            await db.chatRoom.update({
              where: { id: room.id },
              data: { lastMessageAt: new Date(), updatedAt: new Date() },
            });

            conversationsClosed++;
            messagesSent++;
          }
          continue;
        }

        // Check if should initiate conversation (new match, no messages)
        if (conversationHistory.length === 0) {
          if (shouldInitiateConversation(config, room.match?.matchScore || 50, isReceiver)) {
            const initMessage = generateResponse(config, {
              botUserId: bot.id,
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
                  senderId: bot.id,
                  content: initMessage.content,
                  messageType: 'TEXT',
                },
              });

              await db.chatRoom.update({
                where: { id: room.id },
                data: { lastMessageAt: new Date(), updatedAt: new Date() },
              });

              conversationsInitiated++;
              messagesSent++;
            }
          }
          continue;
        }

        // Generate response to last message
        const responseMessage = generateResponse(config, {
          botUserId: bot.id,
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
              senderId: bot.id,
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
              userId: bot.id,
              event: 'bot.chat_message_sent',
              properties: JSON.stringify({
                chatRoomId: room.id,
                messageType: responseMessage.type,
              }),
            },
          });

          messagesSent++;
        }

        // Mark room as processed
        lastProcessedRoom.set(room.id, Date.now());
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      executionMs: duration,
      stats: {
        totalBots: bots.length,
        messagesSent,
        conversationsInitiated,
        conversationsClosed,
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
