import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { cache } from "@/lib/cache";
import { createConversation } from "@/lib/im/queries";

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
      // P1-6 阶段 5：本处原为裸 `prisma.chatRoom.findFirst`（B9 阻断点）。
      // 改为「IM 为主 + Legacy 可选」——Conversation 是终局模型，且它自己
      // 保留了 `chatRoomId` 列，因此删表后仍能回填出 ChatRoom 时代的 id，
      // 老书签 URL（/dashboard/chats/<ChatRoom.id>）不会失效。
      const conversation = await prisma.conversation.findFirst({
        where: { matchId: existingMatch.id },
        select: { id: true, chatRoomId: true },
      });

      return NextResponse.json({
        success: true,
        isMatch: true,
        message: "Already matched!",
        // chatId 语义曾是「Legacy ChatRoom.id」；Legacy 删除后回退到
        // Conversation.chatRoomId（历史 id）→ Conversation.id（终局 id）。
        // 两个值 `/api/im/conversations/[id]` 都认（见 lib/im/resolve.ts）。
        chatId: conversation?.chatRoomId ?? conversation?.id ?? null,
        conversationId: conversation?.id ?? null,
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

        // 创建会话（幂等：createConversation 是幂等 upsert，重复触发不会重复建）
        // P1-6 阶段 5：原「Legacy 建房/建消息 + IM 副本」整段已随 Legacy 表删除，
        // 主链路只剩下方 createConversation 一条（功能零损失）。

        const matchMsg = isSuperLike
          ? `🎉 It's a match! ⭐ Super Like! You both liked each other. The Vault is open for 24 hours.`
          : `🎉 It's a match! You both liked each other. The Vault is open for 24 hours.`;

        // ── TWIN-CHAT FIX (P0): ensure the newer IM system (Conversation +
        // IMMessage) exists for this match. createConversation is an idempotent
        // upsert, so this runs safely on every match formation — it also
        // BACKFILLS Conversations for matches formed before this fix. The
        // mirrored system message is only seeded when the conversation has no
        // messages yet, to avoid duplicates.
        // P1-6 阶段 4 准备：把终局模型的 Conversation.id 一并返回，
        // 前端换源（阶段 4）时可直接使用，无需再改后端。
        let conversationId: string | null = null;

        try {
          const conv = await createConversation(
            existingMatch.senderId,
            existingMatch.receiverId,
            existingMatch.senderId,
            // 新建会话本就没有旧书签，不写入 `chatRoomId`
            //（G-8 的旧链接兼容只服务历史房间，由 Conversation.chatRoomId 反查）。
            { matchId: existingMatch.id }
          );
          conversationId = conv.convId;
          const existingMsg = await prisma.iMMessage.findFirst({
            where: { conversationId: conv.convId },
            select: { id: true },
          });
          if (!existingMsg) {
            const last = await prisma.iMMessage.findFirst({
              where: { conversationId: conv.convId },
              orderBy: { seq: "desc" },
              select: { seq: true },
            });
            const sysSeq = (last?.seq || 0) + 1;
            await prisma.iMMessage.create({
              data: {
                conversationId: conv.convId,
                senderId: existingMatch.senderId,
                receiverId: existingMatch.receiverId,
                seq: sysSeq,
                msgType: "SYSTEM",
                payload: matchMsg,
                encryptionMode: "SERVER",
                consentState: "CONSENT_NONE",
                mediaLevel: "L0_TEXT",
                ruleResult: "PASS",
              },
            });
            await prisma.conversation.update({
              where: { id: conv.convId },
              data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
            });
          }
        } catch (twinErr) {
          // ⚠️ P1-6 阶段 5：IM 已经是**主数据源**（前端只读 /api/im/*），所以这里
          // 不再只是"双写副本失败"。Conversation 没建成就等于用户点进匹配后
          // 看不到任何会话 —— 必须打出可告警的错误，而不是静默降级。
          // 仍不向上抛：匹配已成立这件事不该因为 IM 瞬时故障丢失，
          // 且 /api/matches/react 会被重放（幂等分支会补建 Conversation）。
          console.error(
            "[Match React] 🔴 IM 会话创建失败 —— 匹配已成立但用户可能看不到会话，请人工核对:",
            { matchId: existingMatch.id, senderId: existingMatch.senderId, error: twinErr },
          );
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
          // chatId：Legacy 时代的字段，保留字段名以兼容旧前端。
          // 阶段 5 后取 Conversation.id（`/api/im/conversations/[id]` 能解析，
          // 见 lib/im/resolve.ts 的别名解析链）。
          chatId: conversationId,
          // P1-6 阶段 4 准备：终局模型 id，前端换源后改用这个
          conversationId,
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
