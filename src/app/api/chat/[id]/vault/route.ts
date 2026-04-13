import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const VAULT_DURATION_HOURS = 24;
const EXTENSION_HOURS = 6;
const MAX_EXTENSIONS = 3;
const EXTENSION_COST = 25;

/**
 * GET /api/chat/[id]/vault
 * 
 * 获取Vault状态和时间
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const { user } = await requireAuth();
    const userId = user.id;

    // 验证用户是聊天室成员
    const membership = await db.chatRoomMember.findFirst({
      where: {
        roomId,
        userId,
      },
      include: {
        room: {
          include: {
            match: {
              select: {
                receiverId: true,
              }
            }
          }
        }
      }
    });

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this chat room' },
        { status: 403 }
      );
    }

    const room = membership.room;
    const isFemale = room.match?.receiverId === userId;

    // 计算剩余时间
    let timeLeft = 0;
    let isExpired = false;
    
    if (room.vaultExpiry) {
      timeLeft = Math.max(0, new Date(room.vaultExpiry).getTime() - Date.now());
      isExpired = timeLeft === 0;
    }

    // 如果过期且状态还是ACTIVE，更新状态
    if (isExpired && room.vaultStatus === 'ACTIVE') {
      await db.chatRoom.update({
        where: { id: roomId },
        data: { vaultStatus: 'EXPIRED' }
      });
    }

    return NextResponse.json({
      vault: {
        status: isExpired ? 'EXPIRED' : room.vaultStatus,
        expiry: room.vaultExpiry,
        timeLeft,
        timeLeftFormatted: formatTimeLeft(timeLeft),
        extensionCount: room.extensionCount,
        maxExtensions: MAX_EXTENSIONS,
        canExtend: room.extensionCount < MAX_EXTENSIONS && !isExpired && room.vaultStatus !== 'REVOKED',
        extensionCost: EXTENSION_COST,
        extensionHours: EXTENSION_HOURS,
        isFemale,
        canRevoke: isFemale && room.vaultStatus === 'ACTIVE',
        revokedAt: room.revokedAt,
        revokedBy: room.revokedBy,
        revokeReason: room.revokeReason,
      }
    });

  } catch (error) {
    console.error('Vault status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chat/[id]/vault/extend
 * 
 * 延长Vault时间
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const { user } = await requireAuth();
    const userId = user.id;

    // 验证用户是聊天室成员
    const membership = await db.chatRoomMember.findFirst({
      where: {
        roomId,
        userId,
      },
      include: {
        room: true,
      }
    });

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this chat room' },
        { status: 403 }
      );
    }

    const room = membership.room;

    // 检查是否可以延长
    if (room.vaultStatus === 'REVOKED') {
      return NextResponse.json(
        { error: 'Chat has been revoked' },
        { status: 400 }
      );
    }

    if (room.vaultStatus === 'EXPIRED') {
      return NextResponse.json(
        { error: 'Chat has expired' },
        { status: 400 }
      );
    }

    if (room.extensionCount >= MAX_EXTENSIONS) {
      return NextResponse.json(
        { error: 'Maximum extensions reached' },
        { status: 400 }
      );
    }

    // 检查诚意值余额
    const wallet = await db.sincerityWallet.findUnique({
      where: { userId }
    });

    if (!wallet || wallet.balance < EXTENSION_COST) {
      return NextResponse.json(
        { error: 'Insufficient sincerity points', required: EXTENSION_COST },
        { status: 400 }
      );
    }

    // 计算新的过期时间
    const currentExpiry = room.vaultExpiry ? new Date(room.vaultExpiry) : new Date();
    const newExpiry = new Date(currentExpiry.getTime() + EXTENSION_HOURS * 60 * 60 * 1000);

    // 扣除诚意值
    await db.sincerityWallet.update({
      where: { userId },
      data: {
        balance: { decrement: EXTENSION_COST },
        totalSpent: { increment: EXTENSION_COST },
        lastSpentAt: new Date(),
      }
    });

    // 创建交易记录
    await db.sincerityTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'SPEND',
        amount: -EXTENSION_COST,
        source: 'VAULT_EXTENSION',
        description: `Extended chat vault by ${EXTENSION_HOURS} hours`,
      }
    });

    // 更新聊天室
    const updatedRoom = await db.chatRoom.update({
      where: { id: roomId },
      data: {
        vaultExpiry: newExpiry,
        vaultStatus: 'EXTENDED',
        extensionCount: { increment: 1 },
        extendedAt: new Date(),
        extendedBy: userId,
      }
    });

    return NextResponse.json({
      success: true,
      vault: {
        status: updatedRoom.vaultStatus,
        expiry: updatedRoom.vaultExpiry,
        extensionCount: updatedRoom.extensionCount,
        timeLeft: newExpiry.getTime() - Date.now(),
        timeLeftFormatted: formatTimeLeft(newExpiry.getTime() - Date.now()),
      }
    });

  } catch (error) {
    console.error('Vault extend error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chat/[id]/vault
 * 
 * 女性撤销聊天 (Revoke)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const { user } = await requireAuth();
    const userId = user.id;
    const body = await request.json().catch(() => ({}));
    const { reason } = body;

    // 验证用户是聊天室成员
    const membership = await db.chatRoomMember.findFirst({
      where: {
        roomId,
        userId,
      },
      include: {
        room: {
          include: {
            match: {
              select: {
                receiverId: true,
                senderId: true,
              }
            }
          }
        }
      }
    });

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this chat room' },
        { status: 403 }
      );
    }

    // 只有女性(接收方)可以撤销
    const isFemale = membership.room.match?.receiverId === userId;
    if (!isFemale) {
      return NextResponse.json(
        { error: 'Only the receiver can revoke the chat' },
        { status: 403 }
      );
    }

    // 检查当前状态
    if (membership.room.vaultStatus === 'REVOKED') {
      return NextResponse.json(
        { error: 'Chat already revoked' },
        { status: 400 }
      );
    }

    // 撤销聊天
    const updatedRoom = await db.chatRoom.update({
      where: { id: roomId },
      data: {
        vaultStatus: 'REVOKED',
        revokedAt: new Date(),
        revokedBy: userId,
        revokeReason: reason || 'User revoked',
        isArchived: true,
      }
    });

    // 软删除消息
    await db.message.updateMany({
      where: { roomId },
      data: { 
        content: '[Message deleted]',
        metadata: JSON.stringify({ deleted: true, revokedAt: new Date() }),
      }
    });

    // 通知对方
    const otherUserId = membership.room.match?.senderId;
    if (otherUserId) {
      await db.notification.create({
        data: {
          userId: otherUserId,
          type: 'SYSTEM_ANNOUNCEMENT',
          title: 'Conversation Ended',
          body: 'The other person has ended the conversation',
          data: JSON.stringify({ roomId, revoked: true }),
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Chat revoked successfully',
      vault: {
        status: updatedRoom.vaultStatus,
        revokedAt: updatedRoom.revokedAt,
        revokeReason: updatedRoom.revokeReason,
      }
    });

  } catch (error) {
    console.error('Vault revoke error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 格式化剩余时间
 */
function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Expired';
  
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
