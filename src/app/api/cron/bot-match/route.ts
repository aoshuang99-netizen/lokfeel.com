/**
 * Vercel Cron Job — Bot Match Response Processing (Batch Mode)
 *
 * This endpoint is called by WorkBuddy automation (every hour).
 * Processes pending matches in batches to avoid Vercel Hobby 10s timeout.
 *
 * Batch strategy:
 *   - Queries Match table directly (NOT iterating all bots — avoids N+1 queries)
 *   - Processes MAX_MATCHES_PER_BATCH matches per invocation
 *   - Uses cursor-based pagination (?continueFrom=<matchId>)
 *   - Returns hasMore: true when more matches need processing
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

/**
 * GET /api/cron/bot-match
 *
 * Query params:
 *   - continueFrom: match ID to start from (cursor pagination)
 */
export async function GET(request: Request) {
  const startTime = Date.now();

  // Verify cron secret (REQUIRED — not optional)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const requestUrl = new URL(request.url);
    const continueFrom = requestUrl.searchParams.get('continueFrom') || undefined;

    let processedCount = 0;
    let acceptCount = 0;
    let rejectCount = 0;
    let ghostCount = 0;
    let hasMore = false;
    let lastProcessedId: string | undefined = undefined;

    // DIRECT QUERY: find pending matches WITHOUT iterating all bots
    // This avoids N+1 queries (one per bot)
    const whereClause: any = {
      status: 'PENDING',
      OR: [
        { senderAction: null },
        { receiverAction: null },
      ],
    };

    // Apply cursor pagination
    if (continueFrom) {
      whereClause.id = { gt: continueFrom };
    }

    const pendingMatches = await db.match.findMany({
      where: whereClause,
      orderBy: { id: 'asc' },
      take: MAX_MATCHES_PER_BATCH + 1, // +1 to detect hasMore
      select: {
        id: true,
        matchScore: true,
        senderId: true,
        receiverId: true,
        senderAction: true,
        receiverAction: true,
      },
    });

    // Determine if more matches remain
    if (pendingMatches.length > MAX_MATCHES_PER_BATCH) {
      hasMore = true;
      pendingMatches.pop(); // Remove the +1 extra
    }

    if (pendingMatches.length === 0) {
      return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        executionMs: Date.now() - startTime,
        hasMore: false,
        stats: {
          totalPending: 0,
          processed: 0,
          accepted: 0,
          rejected: 0,
          ghosted: 0,
        },
      });
    }

    // Collect unique bot IDs from pending matches
    const botIdSet = new Set<string>();
    for (const m of pendingMatches) {
      // Only process if at least one side is a bot (optimization)
      botIdSet.add(m.senderId);
      botIdSet.add(m.receiverId);
    }

    // Preload bot configs (single query)
    const bots = await db.user.findMany({
      where: {
        id: { in: [...botIdSet] },
        isBot: { not: false },  // BUG-01 FIX: 兼容 SQLite Boolean
      },
      select: { id: true, botConfig: true },
    });

    const botConfigMap = new Map<string, ReturnType<typeof deserializeBotConfig> | null>();
    for (const bot of bots) {
      try {
        botConfigMap.set(bot.id, bot.botConfig ? deserializeBotConfig(bot.botConfig) : null);
      } catch {
        botConfigMap.set(bot.id, null);
      }
    }

    // Process each pending match in batch
    for (const match of pendingMatches) {
      // Timeout guard: stop at ~9s to avoid Hobby 10s kill
      if (Date.now() - startTime > 9000) {
        hasMore = true;
        break;
      }

      // Skip if both sides already acted
      if (match.senderAction && match.receiverAction) continue;

      // Process bot actors on both sides
      const actors: string[] = [];
      if (!match.senderAction) actors.push(match.senderId);
      if (!match.receiverAction) actors.push(match.receiverId);

      for (const actorId of actors) {
        const config = botConfigMap.get(actorId);
        // Skip if actor is not a bot (no config)
        if (!config) continue;

        const isSender = actorId === match.senderId;
        const decision = makeMatchDecision(
          config,
          actorId,
          match.id,
          match.matchScore ?? 50 // null → default 50
        );

        // Handle ghosting
        if (decision.decision === 'ghost') {
          ghostCount++;
          continue;
        }

        // Apply decision
        const action = actionMap[decision.decision] || 'PASS';

        const updateData: any = { updatedAt: new Date() };
        if (isSender) {
          updateData.senderAction = action;
        } else {
          updateData.receiverAction = action;
        }

        // Check if match is now complete (both sides acted)
        const finalSenderAction = updateData.senderAction ?? match.senderAction;
        const finalReceiverAction = updateData.receiverAction ?? match.receiverAction;

        if (finalSenderAction && finalReceiverAction) {
          const senderAccepts = ['INTERESTED', 'MAYBE'].includes(finalSenderAction);
          const receiverAccepts = ['INTERESTED', 'MAYBE'].includes(finalReceiverAction);
          if (senderAccepts && receiverAccepts) {
            updateData.status = 'ACCEPTED';
          } else {
            updateData.status = 'REJECTED';
          }
        }

        // Update match
        await db.match.update({
          where: { id: match.id },
          data: updateData,
        });

        // Create match reaction record
        await db.matchReaction.create({
          data: {
            matchId: match.id,
            userId: actorId,
            reaction: action as any,
            feedback: decision.reason,
          },
        });

        // Log analytics event
        await db.analyticsEvent.create({
          data: {
            userId: actorId,
            event: 'bot.match_reaction',
            properties: JSON.stringify({
              matchId: match.id,
              decision: decision.decision,
              matchScore: match.matchScore,
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

      lastProcessedId = match.id;
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      executionMs: duration,
      hasMore,
      continueFrom: hasMore && lastProcessedId ? lastProcessedId : undefined,
      stats: {
        totalPending: pendingMatches.length,
        processed: processedCount,
        accepted: acceptCount,
        rejected: rejectCount,
        ghosted: ghostCount,
      },
      ...(hasMore && lastProcessedId
        ? { nextUrl: `/api/cron/bot-match?continueFrom=${lastProcessedId}` }
        : {}),
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
