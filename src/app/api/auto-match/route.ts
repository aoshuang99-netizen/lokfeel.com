import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/auto-match
 * 
 * 自动为当前用户生成与数字用户的匹配和对话。
 * 确保首页 Today's Picks 能显示推荐用户，
 * 并且聊天页面有对话可以开始。
 * 
 * 策略：
 * 1. 找到尚未匹配的数字用户（isBot=true）
 * 2. 随机选取 3-5 个数字用户
 * 3. 创建 ACCEPTED 状态的匹配（跳过PENDING）
 * 4. 为每个匹配创建对话（Conversation）
 * 5. Bot 发送首条欢迎消息
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get current user's profile
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!currentUser?.profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Check how many matches the user already has
    const existingMatchCount = await prisma.match.count({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: { in: ["PENDING", "ACCEPTED"] },
      },
    });

    // If user already has 5+ matches, don't auto-create more
    if (existingMatchCount >= 5) {
      return NextResponse.json({
        success: true,
        message: "User already has enough matches",
        matchCount: existingMatchCount,
      });
    }

    // Get IDs of already matched users
    const existingMatches = await prisma.match.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      select: { senderId: true, receiverId: true },
    });

    const matchedUserIds = new Set([
      ...existingMatches.map((m) => m.senderId),
      ...existingMatches.map((m) => m.receiverId),
      userId, // exclude self
    ]);

    // Determine how many new matches to create (target: 5 total)
    const targetMatches = 5;
    const matchesToCreate = Math.max(0, targetMatches - existingMatchCount);

    if (matchesToCreate === 0) {
      return NextResponse.json({
        success: true,
        message: "Already at target match count",
        matchCount: existingMatchCount,
      });
    }

    // Find eligible bot users
    // Priority: users with completed profiles (onboardingStep >= 4)
    const botUsers = await prisma.user.findMany({
      where: {
        isBot: true,
        id: { notIn: Array.from(matchedUserIds) },
        profile: {
          is: {
            onboardingStep: { gte: 4 },
          },
        },
      },
      include: {
        profile: {
          select: {
            id: true,
            displayName: true,
            age: true,
            avatar: true,
            gender: true,
            city: true,
            bio: true,
            relationshipGoal: true,
            attachmentStyle: true,
            communicationStyle: true,
            loveLanguage: true,
            conflictResolution: true,
          },
        },
      },
      take: matchesToCreate * 3, // Get more than needed for random selection
    });

    if (botUsers.length === 0) {
      // Fallback: try with even more relaxed conditions (any profile)
      const fallbackBots = await prisma.user.findMany({
        where: {
          isBot: true,
          id: { notIn: Array.from(matchedUserIds) },
          profile: { isNot: null },
        },
        include: {
          profile: {
            select: {
              id: true,
              displayName: true,
              age: true,
              avatar: true,
              gender: true,
              city: true,
              bio: true,
              relationshipGoal: true,
              attachmentStyle: true,
              communicationStyle: true,
              loveLanguage: true,
              conflictResolution: true,
            },
          },
        },
        take: matchesToCreate,
      });

      if (fallbackBots.length === 0) {
        return NextResponse.json({
          success: true,
          message: "No eligible bot users available",
          matchCount: existingMatchCount,
        });
      }

      // Use fallback bots
      return await createMatchesForBots(userId, currentUser.profile, fallbackBots.slice(0, matchesToCreate), existingMatchCount);
    }

    // Randomly select from eligible bots
    const shuffled = botUsers.sort(() => Math.random() - 0.5);
    const selectedBots = shuffled.slice(0, matchesToCreate);

    return await createMatchesForBots(userId, currentUser.profile, selectedBots, existingMatchCount);

  } catch (error) {
    console.error("[Auto-Match] Error:", error);
    return NextResponse.json(
      { error: "Failed to auto-match", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function createMatchesForBots(
  userId: string,
  userProfile: any,
  botUsers: any[],
  existingMatchCount: number
) {
  const results = [];

  for (const botUser of botUsers) {
    try {
      // Calculate match score
      const matchScore = calculateMatchScore(userProfile, botUser.profile);
      const matchReason = generateMatchReason(userProfile, botUser.profile, matchScore);

      // Create ACCEPTED match (skip PENDING - user sees them immediately)
      const match = await prisma.match.create({
        data: {
          senderId: userId,
          receiverId: botUser.id,
          status: "ACCEPTED",
          senderAction: "INTERESTED",
          receiverAction: "INTERESTED",
          matchScore,
          matchReason,
          isUnread: true,
        },
      });

      // Create conversation for this match
      const existingConv = await prisma.conversation.findFirst({
        where: {
          OR: [
            { userAId: userId, userBId: botUser.id },
            { userAId: botUser.id, userBId: userId },
          ],
        },
      });

      let conversationId: string;

      if (!existingConv) {
        const conversation = await prisma.conversation.create({
          data: {
            userAId: userId,
            userBId: botUser.id,
            initiatorId: botUser.id, // Bot initiated
            controllingUserId: userId, // User controls
          },
        });
        conversationId = conversation.id;
      } else {
        conversationId = existingConv.id;
      }

      // Also create a ChatRoom (for legacy chat frontend compatibility)
      const existingChatRoom = await prisma.chatRoom.findFirst({
        where: { matchId: match.id },
      });

      let chatRoomId: string;

      if (!existingChatRoom) {
        const chatRoom = await prisma.chatRoom.create({
          data: {
            matchId: match.id,
            vaultExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
        });

        // Add both members to chat room
        await prisma.chatRoomMember.createMany({
          data: [
            { roomId: chatRoom.id, userId: userId },
            { roomId: chatRoom.id, userId: botUser.id },
          ],
        });

        chatRoomId = chatRoom.id;
      } else {
        chatRoomId = existingChatRoom.id;
      }

      // Bot sends welcome message in BOTH systems
      const welcomeMessages = [
        `Hey! 👋 I noticed we matched — your profile caught my eye!`,
        `Hi there! 😊 Great to connect with you! How's your day going?`,
        `Hey! ✨ I love that we matched! What brought you to LokFeel?`,
        `Hello! Great to meet you! I was checking out your profile and we seem to have a lot in common!`,
        `Hi! 🌟 Nice to match with you! I'm curious, what's your idea of a perfect weekend?`,
      ];

      const welcomeMsg = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
      const botName = botUser.profile?.displayName || botUser.name || "Someone";

      // 1. Create welcome message in IM system
      await prisma.iMMessage.create({
        data: {
          conversationId,
          senderId: botUser.id,
          receiverId: userId,
          seq: 1,
          msgType: "TEXT",
          payload: welcomeMsg,
          encryptionMode: "SERVER",
          consentState: "CONSENT_NONE",
          mediaLevel: "L0_TEXT",
          ruleResult: "PASS",
        },
      });

      // Update IM conversation
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          messageCount: 1,
          unreadCountA: { increment: 1 }, // User has 1 unread from bot
        },
      });

      // 2. Create welcome message in ChatRoom system (legacy)
      await prisma.message.create({
        data: {
          roomId: chatRoomId,
          senderId: botUser.id,
          content: welcomeMsg,
          messageType: "TEXT",
        },
      });

      // Update chat room
      await prisma.chatRoom.update({
        where: { id: chatRoomId },
        data: { lastMessageAt: new Date() },
      });

      results.push({
        botUserId: botUser.id,
        botName,
        matchId: match.id,
        conversationId,
        chatRoomId,
        matchScore,
      });

      console.log(`[Auto-Match] Created match ${match.id} + conversation ${conversationId} for user ${userId} with bot ${botUser.id} (${botName}), score: ${matchScore}`);

    } catch (err) {
      console.error(`[Auto-Match] Failed for bot ${botUser.id}:`, err);
    }
  }

  return NextResponse.json({
    success: true,
    message: `Auto-matched with ${results.length} users`,
    createdCount: results.length,
    totalMatchCount: existingMatchCount + results.length,
    matches: results,
  });
}

function calculateMatchScore(profile1: any, profile2: any): number {
  if (!profile1 || !profile2) return 65 + Math.floor(Math.random() * 20); // Give bots decent default score

  let score = 50;

  // Relationship goal alignment (25%)
  if (profile1.relationshipGoal && profile2.relationshipGoal) {
    if (profile1.relationshipGoal === profile2.relationshipGoal) {
      score += 25;
    } else {
      score += 10;
    }
  }

  // Attachment style (20%)
  if (profile1.attachmentStyle && profile2.attachmentStyle) {
    const compat: Record<string, string[]> = {
      Secure: ["Secure", "Anxious", "Avoidant"],
      Anxious: ["Secure", "Anxious"],
      Avoidant: ["Secure", "Avoidant"],
    };
    if (compat[profile1.attachmentStyle]?.includes(profile2.attachmentStyle)) {
      score += 20;
    } else {
      score += 5;
    }
  }

  // Communication style (15%)
  if (profile1.communicationStyle && profile2.communicationStyle) {
    score += profile1.communicationStyle === profile2.communicationStyle ? 15 : 5;
  }

  // Love language (15%)
  if (profile1.loveLanguage && profile2.loveLanguage) {
    score += profile1.loveLanguage === profile2.loveLanguage ? 15 : 5;
  }

  // Conflict resolution (10%)
  if (profile1.conflictResolution && profile2.conflictResolution) {
    score += profile1.conflictResolution === profile2.conflictResolution ? 10 : 3;
  }

  return Math.min(98, Math.max(60, Math.round(score)));
}

function generateMatchReason(profile1: any, profile2: any, score: number): string {
  const reasons: string[] = [];

  if (score >= 90) reasons.push("Exceptional compatibility");
  else if (score >= 80) reasons.push("Highly compatible");
  else if (score >= 70) reasons.push("Strong connection");
  else reasons.push("Interesting connection");

  if (profile1?.relationshipGoal === profile2?.relationshipGoal && profile1?.relationshipGoal) {
    reasons.push("aligned relationship goals");
  }
  if (profile1?.attachmentStyle === "Secure" || profile2?.attachmentStyle === "Secure") {
    reasons.push("healthy attachment dynamic");
  }
  if (profile1?.loveLanguage === profile2?.loveLanguage && profile1?.loveLanguage) {
    reasons.push("same love language");
  }

  if (reasons.length > 1) {
    return `${reasons[0]} with ${reasons.slice(1).join(" and ")}`;
  }
  return reasons[0] || "Based on your relationship blueprint";
}
