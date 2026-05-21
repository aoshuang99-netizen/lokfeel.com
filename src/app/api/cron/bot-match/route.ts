/**
 * Vercel Cron Job — Bot Match Response Processing (Batch Mode)
 *
 * This endpoint is called by WorkBuddy automation (every hour).
 * Processes pending matches in batches to avoid Vercel Hobby 10s timeout.
 *
 * Batch strategy:
 *   - maxMatchesPerBatch = 15  (designed to fit within 10s Hobby timeout)
 *   - Returns hasMore: true when pending matches remain
 *   - Caller should re-invoke until hasMore = false
 *
 * Schedule: Hourly via WorkBuddy automation (NOT Vercel Cron)
 * Purpose: Process pending match reactions, generate accept/reject decisions
 *
 * Environment Variables Required:
 * - CRON_SECRET: Secret key for authenticating cron requests
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { makeMatchDecision } from '@/lib/bot-engine/modules/match-response';
import { deserializeBotConfig } from '@/lib/bot-engine/config';

export const dynamic = 'force-dynamic';
// maxDuration is ignored on Vercel Hobby (hard limit: 10s)
// Keep declaration for documentation; upgrade to Pro to enable 60s
export const maxDuration = 60;

const actionMap: Record<string, string> = {
  accept: 'INTERESTED',
  reject: 'PASS',
  maybe: 'MAYBE',
  super_like: 'INTERESTED',
};

const MAX_MATCHES_PER_BATCH = 15; // Stay well under 10s Hobby timeout

// GET /api/cron/bot-match
export async function GET(request: Request) {
  const startTime = Date.now();
  const requestUrl = new URL(request.url);
  const continueFrom = requestUrl.searchParams.get('continueFrom') || undefined;

  // Verify cron secret (REQUIRED - not optional)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let processedCount = 0;
    let acceptCount = 0;
    let rejectCount = 0;
    let ghostCount = 0;
    let totalPending = 0;
    let hasMore = false;

    // Load all bots (lightweight query)
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

    // Collect pending matches across all bots (with limit for batching)
    // Use a flat list of { botId, match } for batch processing
    const pendingList: Array<{
      botId: string;
      matchId: string;
      matchScore: number | null;
      isSender: boolean;
    }> = [];

    for (const bot of bots) {
      const pendingMatches = await db.match.findMany({
        where: {
          OR: [
            { senderId: bot.id, senderAction: null },
            { receiverId: bot.id, receiverAction: null },
          ],
          status: 'PENDING',
        },
        select: {
          id: true,
          matchScore: true,
          senderId: true,
          receiverId: true,
        },
      });

      for (const m of pendingMatches) {
        const isSender = m.senderId === bot.id;
        // Skip if other side already acted (no decision needed)
        pendingList.push({
          botId: bot.id,
          matchId: m.id,
          matchScore: m.matchScore,
          isSender,
        });
      }
    }

    totalPending = pendingList.length;

    if (totalPending === 0) {
      return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        executionMs: Date.now() - startTime,
        hasMore: false,
        stats: {
          totalBots: bots.length,
          totalPending: 0,
          processed: 0,
          accepted: 0,
          rejected: 0,
          ghosted: 0,
        },
      });
    }

    // Apply continueFrom cursor: skip matches before this matchId
    let startIndex = 0;
    if (continueFrom) {
      const idx = pendingList.findIndex((m) => m.matchId === continueFrom);
      if (idx >= 0) startIndex = idx;
    }

    const batch = pendingList.slice(startIndex, startIndex + MAX_MATCHES_PER_BATCH);

    if (batch.length === 0) {
      return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        executionMs: Date.now() - startTime,
        hasMore: false,
        stats: {
          totalBots: bots.length,
          totalPending,
          processed: 0,
          accepted: 0,
          rejected: 0,
          ghosted: 0,
        },
      });
    }

    // Build a bot config cache to avoid re-deserializing per match
    const configCache = new Map<string, ReturnType<typeof deserializeBotConfig> | null>();
    function getBotConfig(botId: string, botConfigRaw: any) {
      if (configCache.has(botId)) return configCache.get(botId);
      let config: ReturnType<typeof deserializeBotConfig> | null = null;
      if (botConfigRaw) {
        try { config = deserializeBotConfig(botConfigRaw); } catch { config = null; }
      }
      configCache.set(botId, config);
      return config;
    }

    // Preload all bot configs
    for (const bot of bots) {
      getBotConfig(bot.id, bot.botConfig);
    }

    // Process the batch
    for (const item of batch) {
      // Timeout guard: if we're approaching 9s, stop and return hasMore
      if (Date.now() - startTime > 9000) {
        hasMore = true;
        break;
      }

      const bot = bots.find((b) => b.id === item.botId);
      if (!bot) continue;

      const config = getBotConfig(bot.id, bot.botConfig);
      if (!config) continue;

      const decision = makeMatchDecision(
        config,
        item.botId,
        item.matchId,
        item.matchScore ?? 50 // null → default 50
      );

      // Handle ghosting
      if (decision.decision === 'ghost') {
        ghostCount++;
        continue;
      }

      // Apply decision
      const action = actionMap[decision.decision] || 'PASS';

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (item.isSender) {
        updateData.senderAction = action;
      } else {
        updateData.receiverAction = action;
      }

      // Check if match should be accepted/rejected based on other side
      const otherReaction = await db.match.findUnique({
        where: { id: item.matchId },
        select: { senderAction: true, receiverAction: true },
      });

      const otherAction = item.isSender
        ? otherReaction?.receiverAction
        : otherReaction?.senderAction;

      if (otherAction) {
        const otherAccepts = ['INTERESTED', 'MAYBE'].includes(otherAction);
        const thisAccepts = ['INTERESTED', 'MAYBE'].includes(action);

        if (otherAccepts && thisAccepts) {
          updateData.status = 'ACCEPTED';
        } else if (!thisAccepts) {
          updateData.status = 'REJECTED';
        }
      }

      // Update match
      await db.match.update({
        where: { id: item.matchId },
        data: updateData,
      });

      // Create match reaction record
      await db.matchReaction.create({
        data: {
          matchId: item.matchId,
          userId: item.botId,
          reaction: action as any,
          feedback: decision.reason,
        },
      });

      // Log analytics event
      await db.analyticsEvent.create({
        data: {
          userId: item.botId,
          event: 'bot.match_reaction',
          properties: JSON.stringify({
            matchId: item.matchId,
            decision: decision.decision,
            matchScore: item.matchScore,
          }),
        },
      });

      processedCount++;
      if (decision.decision === 'accept' || decision.decision === 'super_like') {
        acceptCount++;
      } else if (decision.decision === 'reject') {
        rejectCount++;
      }
    }

    // Determine if more work remains
    const lastProcessedIndex = startIndex + batch.length;
    hasMore = hasMore || (lastProcessedIndex < totalPending);

    const duration = Date.now() - startTime;

    // Build response
    const nextContinueFrom = hasMore && batch.length > 0
      ? batch[batch.length - 1].matchId
      : undefined;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      executionMs: duration,
      hasMore,
      continueFrom: nextContinueFrom,
      stats: {
        totalBots: bots.length,
        totalPending,
        processed: processedCount,
        accepted: acceptCount,
        rejected: rejectCount,
        ghosted: ghostCount,
      },
      // Hint for caller on how to continue
      ...(hasMore ? {
        nextUrl: `/api/cron/bot-match?continueFrom=${nextContinueFrom}`,
      } : {}),
    });

  } catch (error) {
    console.error('[Cron] Match response error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
