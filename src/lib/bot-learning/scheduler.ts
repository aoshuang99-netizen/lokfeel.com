/**
 * Bot Learning Scheduler - 24小时不间断学习调度器
 * 
 * 功能:
 * - 定时执行学习任务
 * - 模拟Bot行为 (匹配、聊天、互动)
 * - 生成学习数据
 * - 更新Bot画像
 */

import { db } from '@/lib/db';
import { recordInteraction, InteractionType, InteractionOutcome, getBotStrategy, getCollectiveWisdom } from './engine';

// 调度配置
const SCHEDULER_CONFIG = {
  // 行为模拟间隔
  MATCH_BEHAVIOR_INTERVAL_MS: 30 * 60 * 1000, // 30分钟模拟一次匹配行为
  CHAT_BEHAVIOR_INTERVAL_MS: 10 * 60 * 1000,  // 10分钟模拟一次聊天行为
  PROFILE_UPDATE_INTERVAL_MS: 60 * 60 * 1000, // 1小时更新一次画像
  
  // 行为概率
  MATCH_REQUEST_PROBABILITY: 0.3,    // 30%概率发起匹配请求
  MATCH_ACCEPT_PROBABILITY: 0.6,     // 60%概率接受匹配
  CHAT_REPLY_PROBABILITY: 0.7,       // 70%概率回复消息
  PROFILE_VIEW_PROBABILITY: 0.5,     // 50%概率浏览资料
};

// 活跃Bot缓存
let activeBotsCache: Array<{
  id: string;
  profileId: string;
  gender: string;
  age: number;
  displayName: string;
}> = [];
let lastBotRefresh = 0;

/**
 * 刷新活跃Bot列表
 */
async function refreshActiveBots(): Promise<void> {
  const now = Date.now();
  if (now - lastBotRefresh < 5 * 60 * 1000) return; // 5分钟缓存
  
  const bots = await db.user.findMany({
    where: { role: 'BOT' as any },
    include: { profile: true },
    take: 100, // 最多100个活跃Bot
  });
  
  activeBotsCache = bots
    .filter(b => b.profile)
    .map(b => ({
      id: b.id,
      profileId: b.profile!.id,
      gender: b.profile!.gender,
      age: b.profile!.age,
      displayName: b.profile!.displayName,
    }));
  
  lastBotRefresh = now;
  console.log(`[BotScheduler] Refreshed ${activeBotsCache.length} active bots`);
}

/**
 * 模拟匹配行为
 */
async function simulateMatchBehavior(): Promise<void> {
  await refreshActiveBots();
  
  if (activeBotsCache.length < 2) return;
  
  // 随机选择一批Bot进行匹配行为
  const numBehaviors = Math.floor(Math.random() * 5) + 3; // 3-8个行为
  
  for (let i = 0; i < numBehaviors; i++) {
    try {
      const bot1 = activeBotsCache[Math.floor(Math.random() * activeBotsCache.length)];
      const bot2 = activeBotsCache[Math.floor(Math.random() * activeBotsCache.length)];
      
      if (bot1.id === bot2.id) continue;
      
      // 获取Bot策略
      const strategy = await getBotStrategy(bot1.id);
      
      // 决定是否发起匹配请求
      if (Math.random() < SCHEDULER_CONFIG.MATCH_REQUEST_PROBABILITY) {
        // 记录匹配请求
        await recordInteraction(
          bot1.id,
          bot2.id,
          InteractionType.MATCH_REQUEST,
          InteractionOutcome.NEUTRAL,
          {
            explore: strategy.explore,
            targetGender: bot2.gender,
            targetAge: bot2.age,
          }
        );
        
        // 模拟对方接受/拒绝
        const acceptProbability = strategy.explore 
          ? 0.5 // 探索模式: 50%接受
          : SCHEDULER_CONFIG.MATCH_ACCEPT_PROBABILITY; // 利用模式: 使用配置概率
        
        const accepted = Math.random() < acceptProbability;
        
        await recordInteraction(
          bot2.id,
          bot1.id,
          accepted ? InteractionType.MATCH_ACCEPT : InteractionType.MATCH_DECLINE,
          accepted ? InteractionOutcome.POSITIVE : InteractionOutcome.NEGATIVE,
          {
            initiatorId: bot1.id,
            explore: strategy.explore,
          }
        );
        
        // 如果接受,创建匹配记录
        if (accepted) {
          await createMatchRecord(bot1.id, bot2.id);
        }
      }
    } catch (error) {
      console.error('[BotScheduler] Match behavior error:', error);
    }
  }
}

/**
 * 模拟聊天行为
 */
async function simulateChatBehavior(): Promise<void> {
  // 获取活跃的匹配
  const activeMatches = await db.match.findMany({
    where: {
      status: 'ACCEPTED',
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7天内的匹配
    },
    include: {
      sender: { include: { profile: true } },
      receiver: { include: { profile: true } },
    },
    take: 20,
  });
  
  for (const match of activeMatches) {
    try {
      // 检查是否涉及Bot
      const isSenderBot = match.sender.role === 'BOT' as any;
      const isReceiverBot = match.receiver.role === 'BOT' as any;
      
      if (!isSenderBot && !isReceiverBot) continue;
      
      // 获取或创建聊天室
      let chatRoom = await db.chatRoom.findFirst({
        where: {
          matchId: match.id,
        },
      });
      
      if (!chatRoom) {
        chatRoom = await db.chatRoom.create({
          data: {
            matchId: match.id,
            vaultStatus: 'ACTIVE',
            vaultExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        
        // 添加成员
        await db.chatRoomMember.createMany({
          data: [
            { roomId: chatRoom.id, userId: match.senderId },
            { roomId: chatRoom.id, userId: match.receiverId },
          ],
        });
      }
      
      // Bot发送消息
      if (isSenderBot && Math.random() < SCHEDULER_CONFIG.CHAT_REPLY_PROBABILITY) {
        await simulateBotMessage(match.senderId, chatRoom.id, match.receiverId);
      }
      
      if (isReceiverBot && Math.random() < SCHEDULER_CONFIG.CHAT_REPLY_PROBABILITY) {
        await simulateBotMessage(match.receiverId, chatRoom.id, match.senderId);
      }
    } catch (error) {
      console.error('[BotScheduler] Chat behavior error:', error);
    }
  }
}

/**
 * 模拟Bot发送消息
 */
async function simulateBotMessage(
  botId: string,
  chatRoomId: string,
  recipientId: string
): Promise<void> {
  // 获取Bot策略
  const strategy = await getBotStrategy(botId);
  
  // 生成消息内容 (简化版)
  const greetings = strategy.explore
    ? ['Hey!', 'Hi there!', 'Hello!', 'What\'s up?']
    : ['Hello, nice to meet you!', 'Hi, I\'m glad we matched!', 'Hey! How\'s your day going?'];
  
  const questions = [
    'What are you looking for?',
    'What do you do for fun?',
    'Tell me about yourself!',
    'What brings you here?',
  ];
  
  const content = Math.random() < 0.5
    ? greetings[Math.floor(Math.random() * greetings.length)]
    : questions[Math.floor(Math.random() * questions.length)];
  
  // 创建消息
  await db.message.create({
    data: {
      roomId: chatRoomId,
      senderId: botId,
      content,
      isRead: false,
    },
  });
  
  // 记录交互
  await recordInteraction(
    botId,
    recipientId,
    InteractionType.CHAT_MESSAGE,
    InteractionOutcome.POSITIVE,
    {
      explore: strategy.explore,
      messageLength: content.length,
    }
  );
}

/**
 * 创建匹配记录
 */
async function createMatchRecord(senderId: string, receiverId: string): Promise<void> {
  try {
    // 检查是否已存在
    const existing = await db.match.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });
    
    if (existing) return;
    
    // 计算匹配分数
    const score = Math.floor(Math.random() * 30) + 70; // 70-100分
    
    await db.match.create({
      data: {
        senderId,
        receiverId,
        matchScore: score,
        matchReason: 'AI-powered compatibility match',
        status: 'PENDING',
        pitchMessage: 'I\'d love to connect with you!',
      },
    });
  } catch (error) {
    console.error('[BotScheduler] Create match error:', error);
  }
}

/**
 * 更新Bot画像
 */
async function updateBotProfiles(): Promise<void> {
  await refreshActiveBots();
  
  for (const bot of activeBotsCache) {
    try {
      // 获取集体智慧
      const wisdom = await getCollectiveWisdom(
        bot.gender,
        { min: bot.age - 5, max: bot.age + 5 },
        5
      );
      
      if (wisdom.length === 0) continue;
      
      // 应用群体智慧 (轻微调整)
      const topPerformer = wisdom[0];
      const adjustment = 0.05; // 5%调整
      
      await db.botPreference.updateMany({
        where: { botId: bot.id },
        data: {
          relationshipStructure: {
            set: Math.min(1, Math.max(0, 
              (await getCurrentPreference(bot.id, 'relationshipStructure')) * (1 - adjustment) + 
              topPerformer.preferences.relationshipStructure * adjustment
            )),
          },
          lastUpdated: new Date(),
        },
      });
    } catch (error) {
      console.error(`[BotScheduler] Update profile error for ${bot.id}:`, error);
    }
  }
}

/**
 * 获取当前偏好值
 */
async function getCurrentPreference(botId: string, field: string): Promise<number> {
  const pref = await db.botPreference.findUnique({
    where: { botId },
    select: { [field]: true },
  });
  return (pref as any)?.[field] || 0.5;
}

/**
 * 启动调度器
 */
export function startBotScheduler(): void {
  console.log('[BotScheduler] Scheduler started');
  
  // 匹配行为模拟 (每30分钟)
  setInterval(() => simulateMatchBehavior(), SCHEDULER_CONFIG.MATCH_BEHAVIOR_INTERVAL_MS);
  
  // 聊天行为模拟 (每10分钟)
  setInterval(() => simulateChatBehavior(), SCHEDULER_CONFIG.CHAT_BEHAVIOR_INTERVAL_MS);
  
  // 画像更新 (每1小时)
  setInterval(() => updateBotProfiles(), SCHEDULER_CONFIG.PROFILE_UPDATE_INTERVAL_MS);
  
  // 立即执行一次
  setTimeout(() => {
    simulateMatchBehavior();
    simulateChatBehavior();
  }, 5000); // 5秒后启动
  
  console.log('[BotScheduler] All intervals scheduled');
}

// 导出内部函数供API使用
export { simulateMatchBehavior, simulateChatBehavior, updateBotProfiles };

/**
 * 停止调度器
 */
export function stopBotScheduler(): void {
  console.log('[BotScheduler] Scheduler stopped');
  // 在实际实现中,需要保存interval IDs以便清除
}

/**
 * 获取调度器状态
 */
export function getSchedulerStatus(): {
  activeBots: number;
  lastRefresh: Date;
  config: typeof SCHEDULER_CONFIG;
} {
  return {
    activeBots: activeBotsCache.length,
    lastRefresh: new Date(lastBotRefresh),
    config: SCHEDULER_CONFIG,
  };
}

export { SCHEDULER_CONFIG };
