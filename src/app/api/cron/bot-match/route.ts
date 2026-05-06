/**
 * Vercel Cron Job — Bot Match Response Processing
 *
 * This endpoint is called every hour by Vercel Cron Jobs.
 * It processes pending matches and generates bot responses.
 *
 * Schedule: Every hour (0 * * * *)
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
export const maxDuration = 60;

const actionMap: Record<string, string> = {
  accept: 'INTERESTED',
  reject: 'PASS',
  maybe: 'MAYBE',
  super_like: 'INTERESTED',
};

// GET /api/cron/bot-match
export async function GET(request: Request) {
  const startTime = Date.now();

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

    // Load all bots
    const bots = await db.user.findMany({
      where: { isBot: true, role: 'USER' },
      select: {
        id: true,
        botConfig: true,
        profile: { select: { gender: true } },
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
      // Get pending matches for this bot
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
          createdAt: true,
        },
      });

      if (pendingMatches.length === 0) continue;

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

      // Process each match
      for (const match of pendingMatches) {
        const decision = makeMatchDecision(
          config,
          bot.id,
          match.id,
          match.matchScore
        );

        // Handle ghosting
        if (decision.decision === 'ghost') {
          ghostCount++;
          continue;
        }

        // Apply decision
        const action = actionMap[decision.decision] || 'PASS';
        const isSender = match.senderId === bot.id;

        const updateData: any = {
          updatedAt: new Date(),
        };

        if (isSender) {
          updateData.senderAction = action;
        } else {
          updateData.receiverAction = action;
        }

        // Check if match should be accepted/rejected based on other side
        const otherReaction = await db.match.findUnique({ 
          where: { id: match.id }, 
          select: { senderAction: true, receiverAction: true } 
        });

        const otherAction = isSender
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
          where: { id: match.id },
          data: updateData,
        });

        // Create match reaction record
        await db.matchReaction.create({
          data: {
            matchId: match.id,
            userId: bot.id,
            reaction: action as any,
            feedback: decision.reason,
          },
        });

        // Log analytics event
        await db.analyticsEvent.create({
          data: {
            userId: bot.id,
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
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      executionMs: duration,
      stats: {
        totalBots: bots.length,
        processed: processedCount,
        accepted: acceptCount,
        rejected: rejectCount,
        ghosted: ghostCount,
      },
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
