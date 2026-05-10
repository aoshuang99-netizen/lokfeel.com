import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// 任务奖励配置
const EARNING_CONFIG: Record<string, { points: number; once: boolean }> = {
  'PROFILE_COMPLETE': { points: 100, once: true },
  'VERIFY_EMAIL': { points: 50, once: true },
  'VERIFY_PHOTO': { points: 50, once: true },
  'DAILY_LOGIN': { points: 10, once: false },
  'FIRST_MATCH': { points: 25, once: true },
  'MATCH_ACCEPTED': { points: 50, once: false },
  'SEND_PITCH': { points: 15, once: false },
  'INVITE_FRIEND': { points: 100, once: false },
  'CHAT_RATING_GOOD': { points: 30, once: false },
  'LINKEDIN_VERIFIED': { points: 150, once: true },
};

/**
 * POST /api/sincerity/earn
 *
 * 赚取诚意值
 * - 完成任务获得积分
 * - 支持一次性任务和重复任务
 */
export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const userId = user.id;
    const body = await request.json();
    const { source, metadata } = body;

    if (!source || !EARNING_CONFIG[source]) {
      return NextResponse.json(
        { error: 'Invalid earning source' },
        { status: 400 }
      );
    }

    const config = EARNING_CONFIG[source];

    // 获取或创建钱包
    let wallet = await db.sincerityWallet.findUnique({
      where: { userId }
    });

    if (!wallet) {
      wallet = await db.sincerityWallet.create({
        data: {
          userId,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
          totalGifted: 0,
          totalReceived: 0,
          tier: 'BRONZE',
          tierProgress: 0,
        }
      });
    }

    // 检查一次性任务是否已完成
    if (config.once) {
      const existingTransaction = await db.sincerityTransaction.findFirst({
        where: {
          walletId: wallet.id,
          source,
          type: 'EARN',
        }
      });

      if (existingTransaction) {
        return NextResponse.json({
          success: false,
          error: 'Task already completed',
          alreadyEarned: true,
        });
      }
    }

    // 特殊处理：每日登录检查
    if (source === 'DAILY_LOGIN') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayTransaction = await db.sincerityTransaction.findFirst({
        where: {
          walletId: wallet.id,
          source: 'DAILY_LOGIN',
          createdAt: {
            gte: today,
          },
        },
      });

      if (todayTransaction) {
        return NextResponse.json({
          success: false,
          error: 'Daily bonus already claimed today',
          nextClaim: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        });
      }
    }

    // 更新钱包
    const updatedWallet = await db.sincerityWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: config.points },
        totalEarned: { increment: config.points },
        lastEarnedAt: new Date(),
      }
    });

    // 创建交易记录
    const transaction = await db.sincerityTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'EARN',
        amount: config.points,
        source,
        description: getTaskDescription(source),
        metadata: metadata ? JSON.stringify(metadata) : null,
      }
    });

    // 检查并更新等级
    const newTier = calculateTier(updatedWallet.totalEarned);
    if (newTier !== updatedWallet.tier) {
      await db.sincerityWallet.update({
        where: { id: wallet.id },
        data: { tier: newTier as any }
      });
    }

    return NextResponse.json({
      success: true,
      earned: config.points,
      newBalance: updatedWallet.balance,
      totalEarned: updatedWallet.totalEarned,
      tier: newTier,
      tierChanged: newTier !== wallet.tier,
      transaction: {
        id: transaction.id,
        type: transaction.type,
        amount: transaction.amount,
        source: transaction.source,
        createdAt: transaction.createdAt,
      }
    });
  });
}

/**
 * 计算用户等级
 */
function calculateTier(totalEarned: number): string {
  if (totalEarned >= 5000) return 'PLATINUM';
  if (totalEarned >= 2000) return 'GOLD';
  if (totalEarned >= 500) return 'SILVER';
  return 'BRONZE';
}

/**
 * 获取任务描述
 */
function getTaskDescription(source: string): string {
  const descriptions: Record<string, string> = {
    'PROFILE_COMPLETE': 'Completed profile setup',
    'VERIFY_EMAIL': 'Email verified',
    'VERIFY_PHOTO': 'Photo verification completed',
    'DAILY_LOGIN': 'Daily login bonus',
    'FIRST_MATCH': 'Received first match',
    'MATCH_ACCEPTED': 'Match accepted by someone',
    'SEND_PITCH': 'Sent a pitch message',
    'INVITE_FRIEND': 'Invited a friend to LokFee!',
    'CHAT_RATING_GOOD': 'Received positive chat rating',
    'LINKEDIN_VERIFIED': 'LinkedIn profile verified',
  };

  return descriptions[source] || 'Task completed';
}

/**
 * GET /api/sincerity/earn/history
 *
 * 获取赚取历史
 */
export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const userId = user.id;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const wallet = await db.sincerityWallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          where: { type: 'EARN' },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }
      }
    });

    if (!wallet) {
      return NextResponse.json({
        transactions: [],
        total: 0,
      });
    }

    const total = await db.sincerityTransaction.count({
      where: {
        walletId: wallet.id,
        type: 'EARN',
      }
    });

    return NextResponse.json({
      transactions: wallet.transactions.map((t: any) => ({
        id: t.id,
        amount: t.amount,
        source: t.source,
        description: t.description,
        createdAt: t.createdAt,
      })),
      total,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < total,
      }
    });
  });
}
