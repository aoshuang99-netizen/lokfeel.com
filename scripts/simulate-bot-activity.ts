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
 */

import { PrismaClient, MatchStatus, NotificationType } from '../src/generated';

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

      // Create chat room
      const chatRoom = await prisma.chatRoom.create({
        data: {
          matchId: match.id,
          members: {
            create: [
              { userId: match.senderId },
              { userId: botUserId },
            ],
          },
        },
      });

      // Send welcome message
      await prisma.message.create({
        data: {
          roomId: chatRoom.id,
          senderId: botUserId,
          content: generateWelcomeMessage(match.sender.profile!),
        },
      });

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
  // Get unread messages
  const unreadMessages = await prisma.message.findMany({
    where: {
      room: {
        members: {
          some: { userId: botUserId },
        },
      },
      senderId: { not: botUserId },
      isRead: false,
    },
    include: {
      sender: { include: { profile: true } },
      room: true,
    },
    take: 5,
  });

  for (const message of unreadMessages) {
    // Simulate reading delay
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Mark as read
    await prisma.message.update({
      where: { id: message.id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // Decide whether to reply
    if (Math.random() < CONFIG.MESSAGE_REPLY_RATE) {
      // Simulate typing delay
      const responseTime = getResponseTime();
      await new Promise(resolve => setTimeout(resolve, responseTime * 100));

      // Generate reply
      const replyContent = generateReply(message.content, message.sender.profile!);

      // Send reply
      await prisma.message.create({
        data: {
          roomId: message.roomId,
          senderId: botUserId,
          content: replyContent,
        },
      });

      // Create notification
      await prisma.notification.create({
        data: {
          userId: message.senderId,
          type: 'NEW_MESSAGE' as any,
          title: 'New Message',
          body: `You have a new message`,
          data: JSON.stringify({ roomId: message.roomId }),
        },
      });

      console.log(`  💬 Replied to ${message.sender.profile?.displayName}: "${replyContent.substring(0, 50)}..."`);
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
