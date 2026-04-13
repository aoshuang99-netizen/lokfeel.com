/**
 * Bot Learning Stats API - 获取学习系统统计信息
 */

import { NextResponse } from 'next/server';
import { getLearningStats } from '@/lib/bot-learning/engine';
import { getSchedulerStatus } from '@/lib/bot-learning/scheduler';
import { requireAdminAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bots/learning/stats - 获取学习系统统计
 */
export async function GET() {
  try {
    // 验证管理员权限
    await requireAdminAuth();
    
    const [stats, schedulerStatus] = await Promise.all([
      getLearningStats(),
      getSchedulerStatus(),
    ]);
    
    return NextResponse.json({
      success: true,
      data: {
        learning: stats,
        scheduler: schedulerStatus,
      },
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message?.includes('Admin')) {
      return NextResponse.json(
        { message: 'Admin access required' },
        { status: 403 }
      );
    }
    
    console.error('[API] Learning stats error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
