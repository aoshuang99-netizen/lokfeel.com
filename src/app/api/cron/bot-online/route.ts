/**
 * Vercel Cron Job — Bot Online Status Updates (Batch Mode)
 *
 * This endpoint is called by WorkBuddy automation (every 15 min).
 * Processes online status in batches to avoid Vercel Hobby 10s timeout.
 *
 * Batch strategy:
 *   - Processes MAX_BOTS_PER_BATCH bots per invocation
 *   - Returns hasMore: true when more bots remain
 *   - Caller should re-invoke with ?cursor=<lastUserId> until hasMore = false
 *
 * Schedule: Every 15 minutes via WorkBuddy automation
 * Purpose: Update bot online/offline states based on time and personality
 *
 * Environment Variables Required:
 * - CRON_SECRET: Secret key for authenticating cron requests
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evaluateOnlineTransition, createOnlineState } from '@/lib/bot-engine/modules/online-status';
import { deserializeBotConfig } from '@/lib/bot-engine/config';

export const dynamic = 'force-dynamic';
// maxDuration is ignored on Vercel Hobby (hard limit: 10s)
export const maxDuration = 30;

const MAX_BOTS_PER_BATCH = 100; // ~100 bots per 10s budget

interface BotState {
  userId: string;
  config: any;
  timezone: string;
  isOnline: boolean;
  currentSessionStart: Date | null;
}

// In-memory state for online status tracking (survives warm starts)
const botStates = new Map<string, BotState>();

function getBotConfig(botConfig: string | null) {
  if (botConfig) {
    try {
      const parsed = deserializeBotConfig(botConfig);
      // Defensive: ensure required nested structures exist
      if (parsed?.online?.avgSessionsPerDay) {
        return parsed;
      }
    } catch { /* ignore */ }
  }
  // Return a default passive config
  return {
    personalityType: 'passive',
    seed: 42,
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
  const now = new Date();

  // Verify cron secret (REQUIRED - not optional)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const requestUrl = new URL(request.url);
    const cursor = requestUrl.searchParams.get('cursor') || undefined;

    let onlineCount = 0;
    let offlineCount = 0;
    let transitions = 0;
    let hasMore = false;
    let lastUserId: string | undefined = undefined;

    // Fetch bots in batches, using cursor-based pagination
    const bots = await db.user.findMany({
      where: {
        isBot: { not: false },  // BUG-01 FIX: 兼容 SQLite Boolean
        role: 'USER',
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: MAX_BOTS_PER_BATCH + 1, // +1 to detect hasMore
      select: {
        id: true,
        botConfig: true,
        profile: { select: { country: true, city: true } },
      },
    });

    // Determine if more bots remain
    if (bots.length > MAX_BOTS_PER_BATCH) {
      hasMore = true;
      bots.pop(); // Remove the +1 extra
    }

    if (bots.length === 0) {
      return NextResponse.json({
        status: 'ok',
        timestamp: now.toISOString(),
        executionMs: Date.now() - startTime,
        hasMore: false,
        stats: { totalBots: 0, online: 0, offline: 0, transitions: 0 },
      });
    }

    lastUserId = bots[bots.length - 1].id;

    // Process each bot in batch
    for (const bot of bots) {
      // Timeout guard: stop at 9s
      if (Date.now() - startTime > 9000) {
        hasMore = true;
        break;
      }

      let state = botStates.get(bot.id);

      if (!state) {
        // Initialize state
        const config = getBotConfig(bot.botConfig);
        // Ensure seed exists (evaluateOnlineTransition requires it)
        if (!config.seed) {
          config.seed = bot.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        }
        state = {
          userId: bot.id,
          config,
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
      timestamp: now.toISOString(),
      executionMs: duration,
      hasMore,
      ...(hasMore && lastUserId ? { nextCursor: lastUserId } : {}),
      stats: {
        batchSize: bots.length,
        online: onlineCount,
        offline: offlineCount,
        transitions,
      },
      // Hint for caller
      ...(hasMore ? {
        nextUrl: `/api/cron/bot-online?cursor=${lastUserId}`,
      } : {}),
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
