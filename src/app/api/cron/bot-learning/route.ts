/**
 * Bot Learning Cron API - 定时触发学习任务的API端点 (Batch Mode)
 *
 * 可以通过以下方式触发:
 * 1. WorkBuddy automation (推荐)
 * 2. 外部定时服务 (如GitHub Actions)
 * 3. 手动触发
 *
 * Auth: Bearer CRON_SECRET header (same pattern as bot-chat, bot-online, bot-tick)
 *
 * Batch strategy:
 *   - Each invocation processes ONE task only (no 'all' bulk)
 *   - Add ?task=learning|match|chat|profile to select task
 *   - Returns hasMore: true if learning batch needs continuation
 */

import { NextRequest, NextResponse } from 'next/server';
import { processLearningBatch, getLearningStats } from '@/lib/bot-learning/engine';
import { simulateMatchBehavior, simulateChatBehavior, updateBotProfiles } from '@/lib/bot-learning/scheduler';

export const dynamic = 'force-dynamic';
// maxDuration is ignored on Vercel Hobby (hard limit: 10s)
// Keep declaration for documentation; upgrade to Pro to enable 60s
export const maxDuration = 60;

/**
 * Verify cron secret from Authorization header.
 * No fallback — CRON_SECRET env var is required in production.
 */
function verifyCronAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return false;
  }
  return true;
}

/**
 * GET /api/cron/bot-learning - 执行学习批次处理
 *
 * Headers: Authorization: Bearer <CRON_SECRET>
 * Query params:
 * - task: 'learning' | 'match' | 'chat' | 'profile' | 'all'
 *   'all' processes ONE subtask per invocation (round-robin via continue param)
 * - continue: 'true' | undefined (for future batch continuation)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const TIMEOUT_MS = 9000; // 9s guard for Hobby 10s limit

  try {
    const { searchParams } = new URL(request.url);
    let task = searchParams.get('task') || 'learning';

    // 'all' picks a deterministic subtask based on minute-of-hour
    // This spreads subtasks across cron invocations
    if (task === 'all') {
      const minute = new Date().getMinutes();
      const subtasks = ['learning', 'match', 'chat', 'profile'];
      task = subtasks[minute % subtasks.length];
    }

    const results: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      task,
    };

    // Timeout guard helper
    function checkTimeout(label: string): boolean {
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.log(`[Cron:learning] Timeout guard triggered at ${label}`);
        return true;
      }
      return false;
    }

    // Execute the selected task
    switch (task) {
      case 'learning':
        if (checkTimeout('learning-start')) break;
        results.learning = await processLearningBatch();
        if (checkTimeout('learning-stats')) break;
        results.stats = await getLearningStats();
        break;

      case 'match':
        if (checkTimeout('match-start')) break;
        await simulateMatchBehavior();
        results.match = { status: 'completed' };
        break;

      case 'chat':
        if (checkTimeout('chat-start')) break;
        await simulateChatBehavior();
        results.chat = { status: 'completed' };
        break;

      case 'profile':
        if (checkTimeout('profile-start')) break;
        await updateBotProfiles();
        results.profile = { status: 'completed' };
        break;

      default:
        // Unknown task: default to learning
        if (checkTimeout('default-start')) break;
        results.learning = await processLearningBatch();
        results.stats = await getLearningStats();
        results.task = 'learning';
        break;
    }

    const timedOut = (Date.now() - startTime) > TIMEOUT_MS;

    return NextResponse.json({
      success: true,
      timedOut,
      executionMs: Date.now() - startTime,
      ...results,
    });

  } catch (error) {
    console.error('[Cron] Bot learning error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/bot-learning - 接收外部触发
 * Headers: Authorization: Bearer <CRON_SECRET>
 * Body: { "task": "learning" | "match" | "chat" | "profile" | "all" }
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { task = 'learning' } = body;

    // Reuse GET handler logic
    const url = new URL(request.url);
    url.searchParams.set('task', task);

    return GET(new NextRequest(url.toString()));

  } catch (error) {
    console.error('[Cron] POST error:', error);
    return NextResponse.json(
      { message: 'Invalid request' },
      { status: 400 }
    );
  }
}
