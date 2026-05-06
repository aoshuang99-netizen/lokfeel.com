/**
 * Power Board Lite 规则变更历史 API
 *
 * GET /api/rules/history - 获取当前用户规则变更历史
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { getRuleEngine } from '@/lib/rules/engine';

export const dynamic = 'force-dynamic';

// ============================================================================
// GET /api/rules/history - 获取规则变更历史
// ============================================================================

export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '20', 10),
      100
    );
    const from = searchParams.get('from')
      ? new Date(searchParams.get('from')!)
      : undefined;
    const to = searchParams.get('to')
      ? new Date(searchParams.get('to')!)
      : undefined;

    const ruleEngine = getRuleEngine();
    const history = await ruleEngine.getRuleHistory(user.id, {
      limit,
      from,
      to,
    });

    return NextResponse.json({
      success: true,
      data: {
        history,
        total: history.length,
      },
    });
  });
}
