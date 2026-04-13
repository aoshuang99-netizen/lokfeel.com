import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/matches/[id]/pitch
 * 
 * 发送匹配申请信 (Pitch Message)
 * - 仅限男方发送
 * - 可选附赠诚意值
 * - 支持AI辅助生成标记
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params;
    const { user } = await requireAuth();
    const userId = user.id;
    const body = await request.json();
    const { 
      content, 
      tone = 'sincere', 
      aiAssisted = false,
      giftAmount = 0 
    } = body;

    // 验证输入
    if (!content || content.trim().length < 20) {
      return NextResponse.json(
        { error: 'Pitch message must be at least 20 characters' },
        { status: 400 }
      );
    }

    if (content.length > 500) {
      return NextResponse.json(
        { error: 'Pitch message must be less than 500 characters' },
        { status: 400 }
      );
    }

    // 验证匹配存在且属于当前用户
    const match = await db.match.findFirst({
      where: {
        id: matchId,
        senderId: userId,
        status: 'PENDING',
      },
      include: {
        receiver: {
          include: { profile: true }
        }
      }
    });

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found or already processed' },
        { status: 404 }
      );
    }

    // 检查是否已发送过申请信
    if (match.pitchMessage) {
      return NextResponse.json(
        { error: 'Pitch message already sent for this match' },
        { status: 400 }
      );
    }

    // 处理诚意值礼物
    if (giftAmount > 0) {
      const wallet = await db.sincerityWallet.findUnique({
        where: { userId }
      });

      if (!wallet || wallet.balance < giftAmount) {
        return NextResponse.json(
          { error: 'Insufficient sincerity points' },
          { status: 400 }
        );
      }

      // 扣除诚意值
      await db.sincerityWallet.update({
        where: { userId },
        data: {
          balance: { decrement: giftAmount },
          totalSpent: { increment: giftAmount },
          totalGifted: { increment: giftAmount },
          lastSpentAt: new Date(),
        }
      });

      // 创建交易记录
      await db.sincerityTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'SEND_GIFT',
          amount: -giftAmount,
          source: 'MATCH_GIFT',
          matchId: matchId,
          fromUserId: userId,
          toUserId: match.receiverId,
          message: `Gift attached to pitch for ${match.receiver.profile?.displayName || 'Anonymous'}`,
        }
      });
    }

    // 计算inboxPriority
    const inboxPriority = calculateInboxPriority({
      matchScore: match.matchScore,
      giftAmount,
      hasVerification: false, // 可以扩展
      createdAt: match.createdAt,
      expiresAt: match.expiresAt,
    });

    // 更新匹配
    const updatedMatch = await db.match.update({
      where: { id: matchId },
      data: {
        pitchMessage: content.trim(),
        pitchTone: tone,
        aiAssisted,
        giftAmount,
        inboxPriority,
        isUnread: true, // 标记为未读，让女方看到
      }
    });

    // 创建通知给女方
    await db.notification.create({
      data: {
        userId: match.receiverId,
        type: 'NEW_MATCH',
        title: 'New Match with Pitch Message!',
        body: `${user.name || 'Someone'} sent you a personalized message`,
        data: JSON.stringify({
          matchId,
          hasGift: giftAmount > 0,
          giftAmount,
        }),
        actionUrl: `/dashboard/matches/${matchId}`,
      }
    });

    return NextResponse.json({
      success: true,
      match: {
        id: updatedMatch.id,
        pitchMessage: updatedMatch.pitchMessage,
        pitchTone: updatedMatch.pitchTone,
        aiAssisted: updatedMatch.aiAssisted,
        giftAmount: updatedMatch.giftAmount,
        inboxPriority: updatedMatch.inboxPriority,
      }
    });

  } catch (error) {
    console.error('Pitch message error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/matches/[id]/pitch
 * 
 * 获取申请信详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params;
    const { user } = await requireAuth();
    const userId = user.id;

    const match = await db.match.findFirst({
      where: {
        id: matchId,
        OR: [
          { senderId: userId },
          { receiverId: userId }
        ]
      },
      select: {
        id: true,
        pitchMessage: true,
        pitchTone: true,
        aiAssisted: true,
        giftAmount: true,
        senderId: true,
        receiverId: true,
      }
    });

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      pitch: {
        content: match.pitchMessage,
        tone: match.pitchTone,
        aiAssisted: match.aiAssisted,
        giftAmount: match.giftAmount,
        isSender: match.senderId === userId,
      }
    });

  } catch (error) {
    console.error('Get pitch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 计算收件箱优先级
 */
function calculateInboxPriority(params: {
  matchScore: number;
  giftAmount: number;
  hasVerification: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}): number {
  let score = 0;
  
  // 匹配分数权重 (40%)
  score += params.matchScore * 0.4;
  
  // 验证状态权重 (15%)
  if (params.hasVerification) {
    score += 15;
  }
  
  // 诚意值权重 (25%)
  score += params.giftAmount * 0.25;
  
  // 时效性权重 (10%) - 越新越优先
  const hoursSinceReceived = (Date.now() - new Date(params.createdAt).getTime()) / 3600000;
  score += Math.max(0, 10 - hoursSinceReceived * 0.3);
  
  // 过期紧迫性 (10%) - 即将过期的优先
  if (params.expiresAt) {
    const hoursUntilExpiry = (new Date(params.expiresAt).getTime() - Date.now()) / 3600000;
    if (hoursUntilExpiry < 24) {
      score += 10;
    }
  }
  
  return Math.round(score * 100) / 100;
}
