import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { cache } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/matches/react
 * 处理用户对目标用户的反应（LIKE/PASS/SUPER_LIKE）
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const userId = user.id;
    const body = await req.json();
    const { targetUserId, reaction } = body;

    if (!targetUserId || !reaction) {
      return NextResponse.json(
        { error: "Missing required fields: targetUserId, reaction" },
        { status: 400 }
      );
    }

    if (!["LIKE", "PASS", "SUPER_LIKE"].includes(reaction)) {
      return NextResponse.json(
        { error: "Invalid reaction. Must be LIKE, PASS, or SUPER_LIKE" },
        { status: 400 }
      );
    }

    // Normalize: "LIKE" → INTERESTED, "SUPER_LIKE" → SUPER_LIKE (new enum value)
    const actionValue = reaction === "LIKE" ? "INTERESTED" : reaction === "SUPER_LIKE" ? "SUPER_LIKE" : "PASS";

    // 不能对自己操作
    if (targetUserId === userId) {
      return NextResponse.json(
        { error: "Cannot react to yourself" },
        { status: 400 }
      );
    }

    // 获取当前用户和目标用户的信息
    const [currentUser, targetUser] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      }),
      prisma.user.findUnique({
        where: { id: targetUserId },
        include: { profile: true },
      }),
    ]);

    if (!targetUser) {
      return NextResponse.json(
        { error: "Target user not found" },
        { status: 404 }
      );
    }

    // 检查是否已存在匹配记录
    const existingMatch = await prisma.match.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: targetUserId },
          { senderId: targetUserId, receiverId: userId },
        ],
      },
    });

    // 如果已经REJECTED，不允许再操作
    if (existingMatch?.status === "REJECTED") {
      // Still invalidate discover cache for this user
      await cache.invalidate(`discover:exclude:${userId}`);
      return NextResponse.json({
        success: true,
        isMatch: false,
        message: "Already passed",
      });
    }

    // 如果已经ACCEPTED，返回匹配状态
    if (existingMatch?.status === "ACCEPTED") {
      const chatRoom = await prisma.chatRoom.findFirst({
        where: {
          matchId: existingMatch.id,
        },
      });

      return NextResponse.json({
        success: true,
        isMatch: true,
        message: "Already matched!",
        chatId: chatRoom?.id,
      });
    }

    // 计算匹配分数
    const matchScore = calculateMatchScore(currentUser?.profile, targetUser?.profile);

    // 如果是PASS
    if (reaction === "PASS") {
      if (existingMatch) {
        await prisma.match.update({
          where: { id: existingMatch.id },
          data: { 
            status: "REJECTED",
            receiverAction: "PASS",
          },
        });
      } else {
        await prisma.match.create({
          data: {
            senderId: userId,
            receiverId: targetUserId,
            status: "REJECTED",
            matchScore,
            matchReason: "User passed",
            senderAction: "PASS",
          },
        });
      }

      // Invalidate both users' discover caches
      await Promise.all([
        cache.invalidate(`discover:exclude:${userId}`),
        cache.invalidate(`discover:exclude:${targetUserId}`),
      ]);

      return NextResponse.json({
        success: true,
        isMatch: false,
        message: "Passed",
      });
    }

    // 如果是LIKE或SUPER_LIKE — actionValue 已在顶部计算
    const isSuperLike = reaction === "SUPER_LIKE";

    if (existingMatch) {
      // 如果对方已经喜欢了我（我是接收者），形成匹配
      if (existingMatch.receiverId === userId) {
        const updatedMatch = await prisma.match.update({
          where: { id: existingMatch.id },
          data: {
            status: "ACCEPTED",
            receiverAction: actionValue, // SUPER_LIKE or INTERESTED
          },
        });

        // 创建聊天室（幂等：检查是否已存在）
        let chatRoom = await prisma.chatRoom.findFirst({
          where: { matchId: existingMatch.id },
        });

        if (!chatRoom) {
          chatRoom = await prisma.chatRoom.create({
            data: {
              matchId: existingMatch.id,
              vaultExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });

          // 添加成员
          await prisma.chatRoomMember.createMany({
            data: [
              { roomId: chatRoom.id, userId: existingMatch.senderId },
              { roomId: chatRoom.id, userId: existingMatch.receiverId },
            ],
          });

          // 创建系统消息
          const matchMsg = isSuperLike
            ? `🎉 It's a match! ⭐ Super Like! You both liked each other. The Vault is open for 24 hours.`
            : `🎉 It's a match! You both liked each other. The Vault is open for 24 hours.`;
          await prisma.message.create({
            data: {
              roomId: chatRoom.id,
              senderId: existingMatch.senderId,
              content: matchMsg,
              messageType: "SYSTEM",
            },
          });
        }

        // Invalidate both users' caches after a match
        await Promise.all([
          cache.invalidate(`discover:exclude:${userId}`),
          cache.invalidate(`discover:exclude:${targetUserId}`),
          cache.invalidate(`who-liked-me:${userId}`),
          cache.invalidate(`who-liked-me:${targetUserId}`),
        ]);

        return NextResponse.json({
          success: true,
          isMatch: true,
          message: "It's a match! 🎉",
          chatId: chatRoom.id,
          match: updatedMatch,
        });
      }

      // 否则只是更新我的反应（我是发送者，对方还没回应）
      await prisma.match.update({
        where: { id: existingMatch.id },
        data: {
          senderAction: actionValue, // SUPER_LIKE or INTERESTED
        },
      });
    } else {
      // 创建新的匹配记录
      await prisma.match.create({
        data: {
          senderId: userId,
          receiverId: targetUserId,
          status: "PENDING",
          senderAction: actionValue, // SUPER_LIKE or INTERESTED
          matchScore,
          matchReason: isSuperLike ? "Super Like" : "New match",
          isUnread: true,
        },
      });
    }

    // Invalidate sender's discover cache + receiver's who-liked-me cache
    await Promise.all([
      cache.invalidate(`discover:exclude:${userId}`),
      cache.invalidate(`who-liked-me:${targetUserId}`),
    ]);

    return NextResponse.json({
      success: true,
      isMatch: false,
      message: isSuperLike ? "Super Like sent! ⭐" : "Like sent! ❤️",
    });

  } catch (error) {
    console.error("Match reaction error:", error);
    return NextResponse.json(
      { error: "Failed to process reaction" },
      { status: 500 }
    );
  }
}

/**
 * 计算两个用户资料的匹配分数
 */
function calculateMatchScore(profile1: any, profile2: any): number {
  if (!profile1 || !profile2) return 50;

  let score = 50; // 基础分
  let factors = 0;

  // 关系目标匹配 (25%)
  if (profile1.relationshipGoal && profile2.relationshipGoal) {
    if (profile1.relationshipGoal === profile2.relationshipGoal) {
      score += 25;
    } else {
      score += 10;
    }
    factors++;
  }

  // 依恋类型互补 (20%)
  if (profile1.attachmentStyle && profile2.attachmentStyle) {
    const complementary: Record<string, string[]> = {
      "Secure": ["Secure", "Anxious", "Avoidant"],
      "Anxious": ["Secure", "Anxious"],
      "Avoidant": ["Secure", "Avoidant"],
    };
    if (complementary[profile1.attachmentStyle]?.includes(profile2.attachmentStyle)) {
      score += 20;
    } else {
      score += 5;
    }
    factors++;
  }

  // 沟通风格 (15%)
  if (profile1.communicationStyle && profile2.communicationStyle) {
    if (profile1.communicationStyle === profile2.communicationStyle) {
      score += 15;
    } else {
      score += 5;
    }
    factors++;
  }

  // 爱的语言 (15%)
  if (profile1.loveLanguage && profile2.loveLanguage) {
    if (profile1.loveLanguage === profile2.loveLanguage) {
      score += 15;
    } else {
      score += 5;
    }
    factors++;
  }

  // 生活优先级 (15%)
  if (profile1.lifePriorities && profile2.lifePriorities) {
    try {
      const p1 = JSON.parse(profile1.lifePriorities);
      const p2 = JSON.parse(profile2.lifePriorities);
      const overlap = p1.filter((x: string) => p2.includes(x)).length;
      score += Math.min(15, overlap * 5);
      factors++;
    } catch {
      // 解析失败，忽略
    }
  }

  // 冲突解决方式 (10%)
  if (profile1.conflictResolution && profile2.conflictResolution) {
    if (profile1.conflictResolution === profile2.conflictResolution) {
      score += 10;
    } else {
      score += 3;
    }
    factors++;
  }

  // 如果没有足够数据，返回基础分
  if (factors === 0) return 50;

  // 归一化到0-100
  return Math.min(100, Math.max(0, Math.round(score)));
}
