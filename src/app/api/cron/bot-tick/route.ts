/**
 * Vercel Cron Job — Bot Engine Tick
 *
 * This endpoint is called every minute by Vercel Cron Jobs.
 * It processes a single tick of the bot behavior engine.
 *
 * Schedule: Every minute
 * Purpose: Process pending actions, evaluate online states, trigger bot behaviors
 *
 * Environment Variables Required:
 * - CRON_SECRET: Secret key for authenticating cron requests
 *
 * @see https://vercel.com/docs/cron-jobs
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createPrismaAdapter } from '@/lib/bot-engine/schedulers/prisma-adapter';
import { BotEngine, DEFAULT_ENGINE_CONFIG } from '@/lib/bot-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby: 10s, Pro: 60s, Enterprise: 300s

// In-memory engine instance (persists across requests in same region)
let engineInstance: BotEngine | null = null;
let lastTickTime = 0;

function getEngine(): BotEngine {
  if (!engineInstance) {
    const adapter = createPrismaAdapter(db);
    engineInstance = new BotEngine(adapter, {
      ...DEFAULT_ENGINE_CONFIG,
      tickIntervalMs: 60_000,
      speedMultiplier: 1,
      enableLogging: false, // Disable logging in production for performance
      maxActionsPerTick: 50,
      minActionIntervalMs: 30_000, // 30s minimum between actions
    });
    console.log('[Cron] BotEngine instance created');
  }
  return engineInstance;
}

// GET /api/cron/bot-tick
export async function GET(request: Request) {
  const startTime = Date.now();

  // Verify cron secret (REQUIRED - not optional)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Rate limiting: ensure minimum 50s between ticks
  const timeSinceLastTick = Date.now() - lastTickTime;
  if (lastTickTime > 0 && timeSinceLastTick < 50_000) {
    return NextResponse.json({
      status: 'skipped',
      reason: 'Too soon since last tick',
      lastTickAge: `${Math.round(timeSinceLastTick / 1000)}s`,
    });
  }

  try {
    const engine = getEngine();
    const health = engine.getHealth();

    // Check if engine has bots loaded
    if (health.botCount === 0) {
      // Try to load bots
      console.log('[Cron] No bots loaded, skipping tick');
      return NextResponse.json({
        status: 'no_bots',
        message: 'No bot users found in database',
        timestamp: new Date().toISOString(),
      });
    }

    const tickDuration = Date.now() - startTime;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      executionMs: tickDuration,
      engine: {
        botCount: health.botCount,
        tickCount: health.tickCount,
        lastTickAt: health.lastTickAt,
        scheduledActions: health.scheduledActionsPending,
        eventsProcessed: health.globalStats?.totalEventsProcessed || 0,
      },
    });

  } catch (error) {
    console.error('[Cron] Bot tick error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  } finally {
    lastTickTime = Date.now();
  }
}
