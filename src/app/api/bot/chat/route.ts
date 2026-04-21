/**
 * Bot Chat API — Trigger AI Response
 *
 * This endpoint triggers an AI response for a bot in a specific chat room.
 * Used by the chat UI to get immediate bot responses.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateResponse } from '@/lib/bot-engine/modules/chat';
import { deserializeBotConfig } from '@/lib/bot-engine/config';

export const dynamic = 'force-dynamic';

// POST /api/bot/chat
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId } = body;

    if (!roomId) {
      return NextResponse.json({ error: 'Room ID required' }, { status: 400 });
    }

    // Get chat room with members
    const room = await db.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                isBot: true,
                botConfig: true,
                profile: {
                  select: { displayName: true },
                },
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        match: {
          select: { matchScore: true, senderId: true, receiverId: true },
        },
      },
    });

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Find bot member
    const botMember = room.members.find(m => m.user.isBot);
    const humanMember = room.members.find(m => !m.user.isBot);

    if (!botMember || !humanMember) {
      return NextResponse.json({ error: 'No bot in room' }, { status: 400 });
    }

    const bot = botMember.user;
    const human = humanMember.user;

    // Get bot config
    let config;
    if (bot.botConfig) {
      try {
        config = deserializeBotConfig(bot.botConfig);
      } catch {
        config = null;
      }
    }

    if (!config) {
      return NextResponse.json({ error: 'Bot config not found' }, { status: 500 });
    }

    // Build conversation history
    const conversationHistory = room.messages
      .reverse()
      .map((msg: any) => ({
        senderId: msg.senderId,
        content: msg.content,
        sentAt: new Date(msg.createdAt),
      }));

    const lastMessage = room.messages[0];
    const minutesSinceLastMessage = lastMessage
      ? (Date.now() - new Date(lastMessage.createdAt).getTime()) / 60_000
      : 0;

    const isReceiver = room.match ? room.match.receiverId === bot.id : false;
    const partnerName = human.profile?.displayName || human.name || 'Someone';

    // Generate response
    const response = generateResponse(config, {
      botUserId: bot.id,
      chatRoomId: roomId,
      partnerId: human.id,
      partnerName,
      matchScore: room.match?.matchScore || 50,
      conversationHistory,
      isInitiating: conversationHistory.length === 0,
      followUpCount: 0,
      isReceiver,
      minutesSinceLastMessage,
    });

    if (!response.content) {
      return NextResponse.json({ error: 'No response generated' }, { status: 500 });
    }

    // Save message to database
    const message = await db.message.create({
      data: {
        roomId,
        senderId: bot.id,
        content: response.content,
        messageType: 'TEXT',
      },
    });

    // Update room
    await db.chatRoom.update({
      where: { id: roomId },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        content: message.content,
        senderId: bot.id,
        createdAt: message.createdAt,
      },
    });

  } catch (error) {
    console.error('[Bot Chat API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
