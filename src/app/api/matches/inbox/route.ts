import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/matches/inbox
 * 
 * 女性用户的智能收件箱
 * - 只返回接收到的匹配 (receiverId = current user)
 * - 按inboxPriority排序 (高优先级在前)
 * - 支持筛选: unread, verified, withGift, expiring
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const userId = user.id;

    // 获取用户资料以确认性别
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { gender: true }
    });

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // 解析查询参数
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter'); // 'unread' | 'verified' | 'withGift' | 'expiring'
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // 构建查询条件
    const where: any = {
      receiverId: userId,
      status: 'PENDING',
    };

    // 应用筛选
    switch (filter) {
      case 'unread':
        where.isUnread = true;
        break;
      case 'verified':
        // 需要在include中筛选
        break;
      case 'withGift':
        where.giftAmount = { gt: 0 };
        break;
      case 'expiring':
        where.expiresAt = {
          lte: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时内过期
          gt: new Date()
        };
        break;
    }

    // 获取匹配列表
    const matches = await db.match.findMany({
      where,
      include: {
        sender: {
          include: {
            profile: {
              select: {
                id: true,
                displayName: true,
                age: true,
                avatar: true,
                city: true,
                occupation: true,
                company: true,
                linkedInVerified: true,
                verificationBadge: true,
              }
            }
          }
        }
      },
      orderBy: [
        { inboxPriority: 'desc' },
        { createdAt: 'desc' }
      ],
      take: limit,
      skip: offset,
    });

    // 计算inboxPriority (如果为null)
    const matchesWithPriority = matches.map((match: any) => {
      const priority = match.inboxPriority ?? calculateInboxPriority(match);
      return {
        ...match,
        inboxPriority: priority,
      };
    });

    // 如果需要筛选verified，在后端筛选
    let filteredMatches = matchesWithPriority;
    if (filter === 'verified') {
      filteredMatches = matchesWithPriority.filter((m: any) => 
        m.sender.profile?.linkedInVerified
      );
    }

    // 格式化响应
    const formattedMatches = filteredMatches.map((match: any) => ({
      id: match.id,
      matchScore: match.matchScore,
      matchReason: match.matchReason,
      pitchMessage: match.pitchMessage,
      pitchTone: match.pitchTone,
      aiAssisted: match.aiAssisted,
      giftAmount: match.giftAmount,
      isUnread: match.isUnread,
      inboxPriority: match.inboxPriority,
      createdAt: match.createdAt,
      expiresAt: match.expiresAt,
      sender: {
        id: match.sender.id,
        name: match.sender.profile?.displayName || 'Anonymous',
        age: match.sender.profile?.age,
        avatar: match.sender.profile?.avatar,
        city: match.sender.profile?.city,
        occupation: match.sender.profile?.occupation,
        company: match.sender.profile?.company,
        isVerified: match.sender.profile?.linkedInVerified || false,
        verificationBadge: match.sender.profile?.verificationBadge,
      }
    }));

    // 获取统计信息
    const stats = await db.match.groupBy({
      by: ['status'],
      where: { receiverId: userId },
      _count: { id: true }
    });

    const unreadCount = await db.match.count({
      where: { receiverId: userId, isUnread: true, status: 'PENDING' }
    });

    return NextResponse.json({
      matches: formattedMatches,
      stats: {
        total: stats.reduce((sum: number, s: any) => sum + s._count.id, 0),
        pending: stats.find((s: any) => s.status === 'PENDING')?._count.id || 0,
        accepted: stats.find((s: any) => s.status === 'ACCEPTED')?._count.id || 0,
        unread: unreadCount,
      },
      pagination: {
        limit,
        offset,
        hasMore: matches.length === limit,
      }
    });

  } catch (error) {
    console.error('Inbox API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 计算收件箱优先级分数
 * 用于新匹配或更新优先级时
 */
function calculateInboxPriority(match: any): number {
  let score = 0;
  
  // 匹配分数权重 (40%)
  score += (match.matchScore || 0) * 0.4;
  
  // 验证状态权重 (15%)
  if (match.sender?.profile?.linkedInVerified) {
    score += 15;
  }
  
  // 诚意值权重 (20%)
  score += (match.giftAmount || 0) * 0.2;
  
  // 时效性权重 (15%) - 越新越优先
  const hoursSinceReceived = (Date.now() - new Date(match.createdAt).getTime()) / 3600000;
  score += Math.max(0, 15 - hoursSinceReceived * 0.5);
  
  // 过期紧迫性 (10%) - 即将过期的优先
  if (match.expiresAt) {
    const hoursUntilExpiry = (new Date(match.expiresAt).getTime() - Date.now()) / 3600000;
    if (hoursUntilExpiry < 24) {
      score += 10;
    }
  }
  
  return Math.round(score * 100) / 100;
}

/**
 * POST /api/matches/inbox/batch-action
 * 
 * 批量操作收件箱匹配
 * - accept: 接受多个匹配
 * - pass: 忽略多个匹配
 * - markRead: 标记为已读
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const userId = user.id;
    const body = await request.json();
    const { action, matchIds } = body;

    if (!action || !matchIds || !Array.isArray(matchIds)) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // 验证这些匹配属于当前用户
    const matches = await db.match.findMany({
      where: {
        id: { in: matchIds },
        receiverId: userId,
      },
      include: {
        sender: {
          include: { profile: true }
        }
      }
    });

    if (matches.length !== matchIds.length) {
      return NextResponse.json(
        { error: 'Some matches not found or not authorized' },
        { status: 403 }
      );
    }

    const results = [];

    switch (action) {
      case 'accept':
        for (const match of matches) {
          // 创建聊天室
          const chatRoom = await db.chatRoom.create({
            data: {
              matchId: match.id,
              vaultExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时
              vaultStatus: 'ACTIVE',
              members: {
                create: [
                  { userId: match.senderId },
                  { userId: match.receiverId },
                ]
              }
            }
          });

          // 更新匹配状态
          await db.match.update({
            where: { id: match.id },
            data: { 
              status: 'ACCEPTED',
              isUnread: false,
            }
          });

          // 处理诚意值礼物
          if (match.giftAmount > 0) {
            await processGiftTransaction(match, userId);
          }

          results.push({ matchId: match.id, status: 'accepted', chatRoomId: chatRoom.id });
        }
        break;

      case 'pass':
        for (const match of matches) {
          await db.match.update({
            where: { id: match.id },
            data: { 
              status: 'REJECTED',
              isUnread: false,
            }
          });

          // 退还诚意值
          if (match.giftAmount > 0) {
            await refundGift(match);
          }

          results.push({ matchId: match.id, status: 'passed' });
        }
        break;

      case 'markRead':
        await db.match.updateMany({
          where: { id: { in: matchIds } },
          data: { isUnread: false }
        });
        results.push({ count: matchIds.length, status: 'marked_read' });
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, results });

  } catch (error) {
    console.error('Batch action error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 处理礼物交易 - 女方接收诚意值
 */
async function processGiftTransaction(match: any, receiverId: string) {
  try {
    // 获取或创建女方的钱包
    let wallet = await db.sincerityWallet.findUnique({
      where: { userId: receiverId }
    });

    if (!wallet) {
      wallet = await db.sincerityWallet.create({
        data: {
          userId: receiverId,
          balance: 0,
          totalEarned: 0,
          totalReceived: 0,
        }
      });
    }

    // 更新钱包余额
    await db.sincerityWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: match.giftAmount },
        totalEarned: { increment: match.giftAmount },
        totalReceived: { increment: match.giftAmount },
        lastEarnedAt: new Date(),
      }
    });

    // 创建交易记录
    await db.sincerityTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'RECEIVE_GIFT',
        amount: match.giftAmount,
        source: 'MATCH_GIFT',
        matchId: match.id,
        fromUserId: match.senderId,
        toUserId: receiverId,
        message: `Gift from ${match.sender.profile?.displayName || 'Anonymous'}`,
      }
    });

  } catch (error) {
    console.error('Gift transaction error:', error);
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 退还礼物 - 女方忽略匹配时退还男方
 */
async function refundGift(match: any) {
  try {
    // 获取男方的钱包
    let wallet = await db.sincerityWallet.findUnique({
      where: { userId: match.senderId }
    });

    if (!wallet) {
      wallet = await db.sincerityWallet.create({
        data: {
          userId: match.senderId,
          balance: 0,
          totalEarned: 0,
        }
      });
    }

    // 退还诚意值
    await db.sincerityWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: match.giftAmount },
        lastEarnedAt: new Date(),
      }
    });

    // 创建退款记录
    await db.sincerityTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'REFUND',
        amount: match.giftAmount,
        source: 'GIFT_REFUND',
        matchId: match.id,
        toUserId: match.senderId,
        message: 'Gift refunded - match passed',
      }
    });

  } catch (error) {
    console.error('Gift refund error:', error);
  }
}
