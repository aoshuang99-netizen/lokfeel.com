/**
 * Vercel Cron Job — Bot Online Status Updates
 *
 * This endpoint is called every 15 minutes by Vercel Cron Jobs.
 * It processes online status transitions for all bots.
 *
 * Schedule: Every 15 minutes
 * Purpose: Update bot online/offline states based on time and personality
 *
 * Environment Variables Required:
 * - CRON_SECRET: Secret key for authenticating cron requests
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createPrismaAdapter } from '@/lib/bot-engine/schedulers/prisma-adapter';
import { evaluateOnlineTransition, createOnlineState } from '@/lib/bot-engine/modules/online-status';
import { deserializeBotConfig } from '@/lib/bot-engine/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface BotState {
  userId: string;
  config: any;
  timezone: string;
  isOnline: boolean;
  currentSessionStart: Date | null;
}

// In-memory state for online status tracking
const botStates = new Map<string, BotState>();

function getBotConfig(botConfig: string | null, userId: string, timezone: string) {
  if (botConfig) {
    try {
      return deserializeBotConfig(botConfig);
    } catch { /* ignore */ }
  }
  // Return a default passive config
  return {
    personalityType: 'passive',
    online: {
      avgSessionsPerDay: 1,
      avgSessionDurationMin: 10,
      peakHours: [20, 21],
      offPeakProbability: 0.1,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    },
  };
}

// GET /api/cron/bot-online
export async function GET(request: Request) {
  const startTime = Date.now();

  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    let onlineCount = 0;
    let offlineCount = 0;
    let transitions = 0;

    // Load all bots from database
    const bots = await db.user.findMany({
      where: { isBot: true, role: 'USER' },
      select: {
        id: true,
        botConfig: true,
        profile: { select: { country: true, city: true } },
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
      let state = botStates.get(bot.id);

      if (!state) {
        // Initialize state
        state = {
          userId: bot.id,
          config: getBotConfig(bot.botConfig, bot.id, 'America/New_York'),
          timezone: 'America/New_York',
          isOnline: false,
          currentSessionStart: null,
        };
        botStates.set(bot.id, state);
      }

      const currentState = createOnlineState(state.userId);
      currentState.isOnline = state.isOnline;
      currentState.currentSessionStart = state.currentSessionStart;

      // Evaluate online transition
      const { state: newState } = evaluateOnlineTransition(
        currentState,
        state.config,
        state.timezone
      );

      // Check for state change
      if (newState.isOnline !== state.isOnline) {
        transitions++;

        // Record in database
        await db.analyticsEvent.create({
          data: {
            userId: bot.id,
            event: newState.isOnline ? 'bot.online' : 'bot.offline',
            properties: JSON.stringify({
              isOnline: newState.isOnline,
              previousState: state.isOnline,
            }),
          },
        });

        // Update local state
        state.isOnline = newState.isOnline;
        state.currentSessionStart = newState.currentSessionStart;
      }

      if (state.isOnline) {
        onlineCount++;
      } else {
        offlineCount++;
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      executionMs: duration,
      stats: {
        totalBots: bots.length,
        online: onlineCount,
        offline: offlineCount,
        transitions,
      },
    });

  } catch (error) {
    console.error('[Cron] Online status error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
