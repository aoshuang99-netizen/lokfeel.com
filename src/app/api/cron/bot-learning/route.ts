/**
 * Bot Learning Cron API - 定时触发学习任务的API端点
 *
 * 可以通过以下方式触发:
 * 1. Vercel Cron (配置在vercel.json)
 * 2. 外部定时服务 (如GitHub Actions)
 * 3. 手动触发
 *
 * Auth: Bearer CRON_SECRET header (same pattern as bot-chat, bot-online, bot-tick)
 */

import { NextRequest, NextResponse } from 'next/server';
import { processLearningBatch, getLearningStats } from '@/lib/bot-learning/engine';
import { simulateMatchBehavior, simulateChatBehavior, updateBotProfiles } from '@/lib/bot-learning/scheduler';

export const dynamic = 'force-dynamic';

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
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const task = searchParams.get('task') || 'all';
    const results: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      task,
    };

    // 执行指定任务
    switch (task) {
      case 'learning':
        results.learning = await processLearningBatch();
        break;

      case 'match':
        await simulateMatchBehavior();
        results.match = { status: 'completed' };
        break;

      case 'chat':
        await simulateChatBehavior();
        results.chat = { status: 'completed' };
        break;

      case 'profile':
        await updateBotProfiles();
        results.profile = { status: 'completed' };
        break;

      case 'all':
      default:
        // 执行所有任务
        const [learning, stats] = await Promise.all([
          processLearningBatch(),
          getLearningStats(),
        ]);

        results.learning = learning;
        results.stats = stats;

        // 串行执行模拟行为 (避免冲突)
        await simulateMatchBehavior();
        results.match = { status: 'completed' };

        await simulateChatBehavior();
        results.chat = { status: 'completed' };
        break;
    }

    return NextResponse.json({
      success: true,
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
    const { task = 'all' } = body;

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
