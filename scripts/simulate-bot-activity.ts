/**
 * LokFeel Bot Activity Simulation Script
 * 
 * 模拟数字用户的真实行为：
 * - 随机在线/离线状态
 * - 自动浏览推荐用户
 * - 智能匹配响应（like/pass）
 * - 模拟聊天回复
 * 
 * Usage: npx ts-node scripts/simulate-bot-activity.ts
 *
 * ── P1-6 阶段 5 迁移说明（2026-09-28）────────────────────────────────────
 * 本脚本原先只读写 Legacy 三表（`ChatRoom` / `ChatRoomMember` / `Message`）。
 * 阶段 4 前端换源后聊天页只读 IM，因此它模拟出来的活动**用户在界面上看不到**。
 * 现改为走生产路径（`createConversation` / `createMessage` / `markMessagesAsRead`），
 * 与 `/api/matches/*`、`/api/im/send` 行为一致。
 */

import { PrismaClient, MatchStatus, NotificationType } from '../src/generated';
import {
  createConversation,
  createMessage,
  markMessagesAsRead,
} from '../src/lib/im/queries';

const prisma = new PrismaClient();

// Simulation configuration
const CONFIG = {
  // Activity patterns
  ACTIVE_HOURS_START: 18, // 6 PM
  ACTIVE_HOURS_END: 23,   // 11 PM
  
  // Interaction probabilities
  MATCH_ACCEPT_RATE: 0.65,      // 65% 接受匹配
  MATCH_INITIATE_RATE: 0.15,    // 15% 主动发起匹配
  MESSAGE_REPLY_RATE: 0.80,     // 80% 回复消息
  BROWSE_PROFILE_RATE: 0.40,    // 40% 浏览推荐
  
  // Timing (minutes)
  MIN_RESPONSE_TIME: 5,
  MAX_RESPONSE_TIME: 120,
  
  // Daily limits
  MAX_DAILY_MATCHES: 5,
  MAX_DAILY_MESSAGES: 20,
};

/**
 * Check if current time is within active hours
 */
function isActiveHours(): boolean {
  const hour = new Date().getHours();
  return hour >= CONFIG.ACTIVE_HOURS_START && hour <= CONFIG.ACTIVE_HOURS_END;
}

/**
 * Get random response time in minutes
 */
function getResponseTime(): number {
  return Math.floor(
    Math.random() * (CONFIG.MAX_RESPONSE_TIME - CONFIG.MIN_RESPONSE_TIME) + 
    CONFIG.MIN_RESPONSE_TIME
  );
}

/**
 * Simulate bot browsing and matching behavior
 */
async function simulateBrowsingAndMatching(botUserId: string): Promise<void> {
  // Get bot's profile for matching preferences
  const botProfile = await prisma.profile.findUnique({
    where: { userId: botUserId },
    include: { user: true },
  });

  if (!botProfile) return;

  // Get potential matches (real users or other bots)
  const potentialMatches = await prisma.profile.findMany({
    where: {
      userId: { not: botUserId },
      gender: botProfile.preferredGender === 'male' ? 'MALE' : 'FEMALE',
      age: {
        gte: botProfile.preferredAgeMin || 18,
        lte: botProfile.preferredAgeMax || 99,
      },
      profileStatus: 'APPROVED',
      // Not already matched
      user: {
        receivedMatches: {
          none: {
            senderId: botUserId,
          },
        },
      },
    },
    take: 10,
    orderBy: { compatibilityScore: 'desc' },
  });

  for (const target of potentialMatches) {
    // Simulate browsing delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Decide whether to match based on compatibility
    const botConfig = botProfile.user.botConfig as any;
    const preferredStyles = botConfig?.matchingPreferences?.preferredAttachmentStyles || [];
    
    let matchProbability = CONFIG.MATCH_INITIATE_RATE;
    
    // Increase probability if attachment style matches preference
    if (preferredStyles.includes(target.attachmentStyle)) {
      matchProbability += 0.20;
    }

    // Random decision
    if (Math.random() < matchProbability) {
      // Create match
      const matchScore = Math.floor(Math.random() * 30) + 65; // 65-95 score
      
      await prisma.match.create({
        data: {
          senderId: botUserId,
          receiverId: target.userId,
          matchScore,
          matchReason: generateMatchReason(botProfile, target),
          status: 'PENDING',
        },
      });

      // Create notification
      await prisma.notification.create({
        data: {
          userId: target.userId,
          type: 'NEW_MATCH' as any,
          title: 'New Match Request',
          body: `${botProfile.displayName} wants to connect with you!`,
          data: JSON.stringify({ fromUserId: botUserId, matchScore }),
        },
      });

      console.log(`  💝 ${botProfile.displayName} → ${target.displayName} (Score: ${matchScore})`);
    }
  }
}

/**
 * Simulate bot responding to incoming matches
 */
async function simulateMatchResponses(botUserId: string, botDisplayName: string): Promise<void> {
  const pendingMatches = await prisma.match.findMany({
    where: {
      receiverId: botUserId,
      status: 'PENDING',
    },
    include: {
      sender: { include: { profile: true } },
    },
  });

  for (const match of pendingMatches) {
    // Simulate response delay
    const responseTime = getResponseTime();
    await new Promise(resolve => setTimeout(resolve, responseTime * 100));

    // Decide to accept or reject
    const shouldAccept = Math.random() < CONFIG.MATCH_ACCEPT_RATE;

    if (shouldAccept) {
      // Accept match
      await prisma.match.update({
        where: { id: match.id },
        data: { status: 'ACCEPTED' },
      });

      // 创建会话（IM 终局模型）+ 欢迎消息，走与生产一致的两个入口。
      // 旧版这里只建 Legacy `ChatRoom` + `Message` —— 阶段 4 之后那样建出来的
      // 会话在聊天页里根本不存在（前端只读 Conversation）。
      const conv = await createConversation(match.senderId, botUserId, botUserId, {
        matchId: match.id,
      });

      // 幂等：同一匹配被反复接受时不重复发欢迎语
      const existing = await prisma.iMMessage.count({ where: { conversationId: conv.convId } });
      if (existing === 0) {
        await createMessage(
          conv.convId,
          botUserId,
          match.senderId,
          generateWelcomeMessage(match.sender.profile!),
        );
      }

      // Notify sender
      await prisma.notification.create({
        data: {
          userId: match.senderId,
          type: 'MATCH_ACCEPTED' as any,
          title: 'Match Accepted!',
          body: `${botDisplayName} accepted your match request!`,
          data: JSON.stringify({ matchId: match.id }),
        },
      });

      console.log(`  ✅ Match accepted: ${match.sender.profile?.displayName}`);
    } else {
      // Reject match
      await prisma.match.update({
        where: { id: match.id },
        data: { status: 'REJECTED' },
      });

      console.log(`  ❌ Match rejected: ${match.sender.profile?.displayName}`);
    }
  }
}

/**
 * Simulate bot chat responses
 */
async function simulateChatResponses(botUserId: string): Promise<void> {
  // 找出 bot 参与、且有未读的会话。
  // 未读数由 `Conversation.unreadCountA/B` 维护（与 UI 徽章同源），
  // 而不是像旧版那样去筛 Legacy `Message.isRead` —— 后者在阶段 4 之后
  // 与用户实际看到的状态已经脱节。
  const botConversations = await prisma.conversation.findMany({
    where: {
      state: { in: ['ACTIVE', 'PAUSED'] },
      OR: [{ userAId: botUserId }, { userBId: botUserId }],
    },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      unreadCountA: true,
      unreadCountB: true,
    },
  });

  const pending = botConversations
    .filter((c) => (c.userAId === botUserId ? c.unreadCountA : c.unreadCountB) > 0)
    .slice(0, 5);

  for (const conv of pending) {
    // Simulate reading delay
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 取该会话中"对方发给 bot 的"最新一条。选它（而非盲发）的原因：
    // 回复需要有上下文，且 `markMessagesAsRead` 需要一个 upToSeq 边界。
    const lastIncoming = await prisma.iMMessage.findFirst({
      where: {
        conversationId: conv.id,
        senderId: { not: botUserId },
        isDeleted: false,
      },
      orderBy: { seq: 'desc' },
      include: {
        sender: { include: { profile: true } },
      },
    });

    if (!lastIncoming) continue;

    // Mark as read（回执 + 未读计数归零，与 /api/im/read 同一实现）
    await markMessagesAsRead(conv.id, botUserId, lastIncoming.seq);

    // Decide whether to reply
    if (Math.random() < CONFIG.MESSAGE_REPLY_RATE) {
      // Simulate typing delay
      const responseTime = getResponseTime();
      await new Promise(resolve => setTimeout(resolve, responseTime * 100));

      // Generate reply
      const replyContent = generateReply(lastIncoming.payload, lastIncoming.sender.profile!);

      // Send reply（走 createMessage，保证 seq 与未读自增）
      await createMessage(conv.id, botUserId, lastIncoming.senderId, replyContent);

      // Create notification
      await prisma.notification.create({
        data: {
          userId: lastIncoming.senderId,
          type: 'NEW_MESSAGE' as any,
          title: 'New Message',
          body: `You have a new message`,
          // Deep link 用终局模型 id：/dashboard/chats/[roomId] 同时接受
          // Conversation.id 与历史 ChatRoom.id（见 lib/im/resolve.ts）。
          data: JSON.stringify({ conversationId: conv.id }),
          actionUrl: `/dashboard/chats/${conv.id}`,
        },
      });

      console.log(`  💬 Replied to ${lastIncoming.sender.profile?.displayName}: "${replyContent.substring(0, 50)}..."`);
    }
  }
}

/**
 * Generate match reason based on compatibility
 */
function generateMatchReason(botProfile: any, targetProfile: any): string {
  const reasons = [
    `You both value ${botProfile.lifePriorities?.[0] || 'meaningful connections'}`,
    `Your ${botProfile.attachmentStyle} attachment complements their style`,
    `Shared interest in ${targetProfile.city || 'exploring new places'}`,
    `Compatible communication styles: ${botProfile.communicationStyle} meets ${targetProfile.communicationStyle}`,
    `Both seeking ${botProfile.relationshipGoal?.toLowerCase().replace('_', ' ')}`,
  ];
  
  return reasons[Math.floor(Math.random() * reasons.length)];
}

/**
 * Generate welcome message
 */
function generateWelcomeMessage(senderProfile: any): string {
  const messages = [
    `Hi ${senderProfile.displayName}! 👋 I noticed we matched. What brings you to LokFeel?`,
    `Hey there! 😊 Your profile caught my attention. Love that you're into ${senderProfile.lifePriorities?.[0] || 'interesting things'}!`,
    `Hello! Great to connect. I'm curious - what's your ideal weekend like?`,
    `Hi! 👋 The compatibility score says we might click. Want to find out if it's true?`,
    `Hey ${senderProfile.displayName.split(' ')[0]}! Excited to match with you. Tell me something interesting about yourself!`,
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Generate reply based on message content
 */
function generateReply(incomingMessage: string, senderProfile: any): string {
  const lowerMsg = incomingMessage.toLowerCase();
  
  // Simple keyword-based responses
  if (lowerMsg.includes('hi') || lowerMsg.includes('hello') || lowerMsg.includes('hey')) {
    return `Hey! Nice to hear from you. How's your day going?`;
  }
  
  if (lowerMsg.includes('?')) {
    return `That's a great question! I'd love to share more about that. What about you?`;
  }
  
  if (lowerMsg.includes('work') || lowerMsg.includes('job')) {
    return `Work keeps me busy, but I try to maintain balance. What do you do for fun outside of work?`;
  }
  
  if (lowerMsg.includes('weekend') || lowerMsg.includes('plan')) {
    return `I love having a mix of relaxation and adventure on weekends. Do you prefer quiet time or being out and about?`;
  }
  
  // Default responses
  const defaults = [
    `That's interesting! Tell me more about that.`,
    `I can relate to that. What else do you enjoy doing?`,
    `Thanks for sharing! I'd love to learn more about your perspective.`,
    `Hmm, that's given me something to think about. What made you interested in that?`,
    `I appreciate you sharing that with me. How long have you been into that?`,
  ];
  
  return defaults[Math.floor(Math.random() * defaults.length)];
}

/**
 * Main simulation function
 */
async function simulateBotActivity() {
  console.log('🤖 LokFeel Bot Activity Simulation');
  console.log('===================================\n');

  try {
    // Check active hours
    if (!isActiveHours()) {
      console.log(`⏰ Outside active hours (${CONFIG.ACTIVE_HOURS_START}:00 - ${CONFIG.ACTIVE_HOURS_END}:00)`);
      console.log('Bots are currently "sleeping". Run again during active hours.');
      return;
    }

    // Get all active bot users
    const botUsers = await prisma.user.findMany({
      where: { 
        isBot: true,
        profile: { profileStatus: 'APPROVED' },
      },
      include: { profile: true },
    });

    console.log(`📊 Found ${botUsers.length} active bot users`);
    console.log(`🕐 Active hours: ${CONFIG.ACTIVE_HOURS_START}:00 - ${CONFIG.ACTIVE_HOURS_END}:00\n`);

    let totalMatches = 0;
    let totalResponses = 0;
    let totalMessages = 0;

    // Process each bot user
    for (const botUser of botUsers.slice(0, 50)) { // Limit to 50 bots per run
      console.log(`\n👤 ${botUser.profile?.displayName || botUser.email}`);

      // 1. Browse and potentially match
      if (Math.random() < CONFIG.BROWSE_PROFILE_RATE) {
        await simulateBrowsingAndMatching(botUser.id);
        totalMatches++;
      }

      // 2. Respond to incoming matches
      await simulateMatchResponses(botUser.id, botUser.profile?.displayName || 'Bot');
      totalResponses++;

      // 3. Reply to messages
      await simulateChatResponses(botUser.id);
      totalMessages++;

      // Small delay between bots
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n\n✅ Simulation Complete!');
    console.log('======================');
    console.log(`  🤖 Bots Active: ${Math.min(botUsers.length, 50)}`);
    console.log(`  💝 Matches Initiated: ${totalMatches}`);
    console.log(`  ✅ Match Responses: ${totalResponses}`);
    console.log(`  💬 Chat Replies: ${totalMessages}`);

  } catch (error) {
    console.error('\n❌ Simulation failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run simulation
simulateBotActivity();
