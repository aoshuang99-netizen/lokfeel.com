/**
 * BotBehaviorEngine - 数字用户行为模拟引擎
 * 模拟真实用户的在线状态、浏览行为和匹配响应
 */

import { getDb } from '@/lib/db';

const prisma = getDb();

// 行为配置类型
interface BehaviorConfig {
  matchAcceptRate: number;
  messageResponseRate: number;
  superLikeRate: number;
}

// Bot在线状态
interface BotStatus {
  profileId: string;
  isOnline: boolean;
  lastActive: Date;
  nextActionTime: Date;
  dailyMatchCount: number;
  dailyMessageCount: number;
}

export class BotBehaviorEngine {
  private activeBots: Map<string, BotStatus> = new Map();
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;

  /**
   * 启动行为引擎
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    console.log('🤖 BotBehaviorEngine 启动中...');
    
    // 加载所有活跃的Bot
    const bots = await prisma.botProfile.findMany({
      where: { isActive: true },
      include: { profile: { include: { user: true } } }
    });
    
    for (const bot of bots) {
      this.activeBots.set(bot.profileId, {
        profileId: bot.profileId,
        isOnline: false,
        lastActive: new Date(),
        nextActionTime: this.calculateNextActionTime(bot.onlinePattern),
        dailyMatchCount: 0,
        dailyMessageCount: 0
      });
    }
    
    console.log(`✅ 已加载 ${bots.length} 个活跃Bot`);
    
    // 启动主循环
    this.isRunning = true;
    this.intervalId = setInterval(() => this.tick(), 60000); // 每分钟执行一次
    
    // 立即执行一次
    await this.tick();
  }

  /**
   * 停止行为引擎
   */
  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    console.log('🛑 BotBehaviorEngine 已停止');
  }

  /**
   * 主循环 - 每分钟执行
   */
  private async tick(): Promise<void> {
    if (!this.isRunning) return;
    
    const now = new Date();
    
    for (const [profileId, status] of this.activeBots) {
      try {
        // 检查是否需要更新在线状态
        await this.updateOnlineStatus(profileId, status, now);
        
        // 检查是否需要执行动作
        if (now >= status.nextActionTime && status.isOnline) {
          await this.executeRandomAction(profileId, status);
          status.nextActionTime = this.calculateNextActionTime();
        }
      } catch (error) {
        console.error(`Bot ${profileId} 执行错误:`, error);
      }
    }
  }

  /**
   * 更新Bot在线状态
   */
  private async updateOnlineStatus(profileId: string, status: BotStatus, now: Date): Promise<void> {
    const bot = await prisma.botProfile.findUnique({
      where: { profileId },
      select: { onlinePattern: true, activityLevel: true }
    });
    
    if (!bot) return;
    
    // 基于活动模式和当前时间决定是否在线
    const shouldBeOnline = this.shouldBeOnline(bot.onlinePattern, bot.activityLevel, now);
    
    if (shouldBeOnline !== status.isOnline) {
      status.isOnline = shouldBeOnline;
      status.lastActive = now;
      
      // 记录状态变化日志
      await prisma.botInteractionLog.create({
        data: {
          botUserId: profileId,
          interactionType: 'status_change',
          action: shouldBeOnline ? 'online' : 'offline',
        }
      });
    }
  }

  /**
   * 判断Bot是否应该在线
   */
  private shouldBeOnline(pattern: string, activityLevel: string, now: Date): boolean {
    const hour = now.getHours();
    const baseProbability = this.getActivityLevelProbability(activityLevel);
    
    // 基于在线模式调整概率
    let patternMultiplier = 1;
    switch (pattern) {
      case 'MORNING': patternMultiplier = (hour >= 6 && hour <= 10) ? 2 : 0.3; break;
      case 'AFTERNOON': patternMultiplier = (hour >= 12 && hour <= 17) ? 2 : 0.5; break;
      case 'EVENING': patternMultiplier = (hour >= 18 && hour <= 23) ? 2.5 : 0.4; break;
      case 'NIGHT': patternMultiplier = (hour >= 22 || hour <= 2) ? 2 : 0.2; break;
      case 'WORK_HOURS': patternMultiplier = (hour >= 9 && hour <= 17) ? 1.5 : 0.3; break;
      case 'AFTER_WORK': patternMultiplier = (hour >= 17 && hour <= 23) ? 2 : 0.4; break;
      default: patternMultiplier = 1;
    }
    
    return Math.random() < baseProbability * patternMultiplier;
  }

  /**
   * 获取活动级别对应的基础概率
   */
  private getActivityLevelProbability(level: string): number {
    switch (level) {
      case 'GHOST': return 0.05;
      case 'LOW': return 0.2;
      case 'MEDIUM': return 0.5;
      case 'HIGH': return 0.8;
      case 'FULL': return 0.95;
      default: return 0.5;
    }
  }

  /**
   * 执行随机动作
   */
  private async executeRandomAction(profileId: string, status: BotStatus): Promise<void> {
    const actions = ['BROWSE', 'MATCH_DECISION', 'MESSAGE_RESPONSE'];
    const weights = [0.6, 0.25, 0.15]; // 浏览60%，匹配决策25%，回复消息15%
    
    const action = this.weightedRandom(actions, weights);
    
    switch (action) {
      case 'BROWSE':
        await this.simulateBrowsing(profileId);
        break;
      case 'MATCH_DECISION':
        if (status.dailyMatchCount < 10) {
          await this.simulateMatchDecision(profileId);
          status.dailyMatchCount++;
        }
        break;
      case 'MESSAGE_RESPONSE':
        if (status.dailyMessageCount < 20) {
          await this.simulateMessageResponse(profileId);
          status.dailyMessageCount++;
        }
        break;
    }
  }

  /**
   * 模拟浏览行为
   */
  private async simulateBrowsing(profileId: string): Promise<void> {
    // 随机浏览3-10个用户资料
    const browseCount = 3 + Math.floor(Math.random() * 8);
    
    const targetProfiles = await prisma.profile.findMany({
      where: {
        id: { not: profileId },
        user: { email: { not: { endsWith: '@lokfeel.bot' } } } // 优先浏览真实用户
      },
      take: browseCount,
      orderBy: { updatedAt: 'desc' }
    });
    
    for (const target of targetProfiles) {
      await prisma.botInteractionLog.create({
        data: {
          botUserId: profileId,
          targetUserId: target.userId,
          interactionType: 'profile_viewed',
          action: 'view',
        }
      });
    }
  }

  /**
   * 模拟匹配决策
   */
  private async simulateMatchDecision(profileId: string): Promise<void> {
    // 获取待处理的匹配请求
    const pendingMatch = await prisma.match.findFirst({
      where: {
        receiverId: profileId,
        status: 'PENDING'
      },
      include: { sender: true }
    });
    
    if (!pendingMatch) return;
    
    // 获取Bot的行为配置
    const bot = await prisma.botProfile.findUnique({
      where: { profileId },
      select: { behaviorConfig: true }
    });
    
    const config: BehaviorConfig = bot?.behaviorConfig 
      ? JSON.parse(bot.behaviorConfig as string)
      : { matchAcceptRate: 0.5, messageResponseRate: 0.6, superLikeRate: 0.05 };
    
    // 基于匹配分数和行为配置做决定
    const matchScore = (pendingMatch as any).matchScore || 50;
    const adjustedAcceptRate = config.matchAcceptRate * (matchScore / 100);
    
    const decision = Math.random() < adjustedAcceptRate ? 'ACCEPT' : 'REJECT';
    
    // 更新匹配状态
    await prisma.match.update({
      where: { id: pendingMatch.id },
      data: { 
        status: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        updatedAt: new Date()
      }
    });
    
    // 记录日志
    await prisma.botInteractionLog.create({
      data: {
        botUserId: profileId,
        targetUserId: pendingMatch.senderId,
        matchId: pendingMatch.id,
        interactionType: 'match_reacted',
        action: decision.toLowerCase(),
        outcome: decision === 'ACCEPT' ? 'success' : 'rejected',
      }
    });
  }

  /**
   * 模拟消息回复
   */
  private async simulateMessageResponse(profileId: string): Promise<void> {
    // 获取未读消息 - 通过ChatRoomMember找到用户参与的聊天室
    const userRooms = await prisma.chatRoomMember.findMany({
      where: { userId: profileId },
      select: { roomId: true }
    });
    const roomIds = userRooms.map(r => r.roomId);
    
    const unreadMessage = await prisma.message.findFirst({
      where: {
        roomId: { in: roomIds },
        senderId: { not: profileId },
        isRead: false
      },
      include: { room: true }
    });
    
    if (!unreadMessage) return;
    
    // 获取Bot的行为配置
    const bot = await prisma.botProfile.findUnique({
      where: { profileId },
      select: { behaviorConfig: true, avgResponseTime: true }
    });
    
    const config: BehaviorConfig = bot?.behaviorConfig 
      ? JSON.parse(bot.behaviorConfig as string)
      : { matchAcceptRate: 0.5, messageResponseRate: 0.6, superLikeRate: 0.05 };
    
    // 基于回复率决定是否回复
    if (Math.random() > config.messageResponseRate) return;
    
    // 生成回复消息
    const responses = [
      "Hey! How's your day going?",
      "That's interesting! Tell me more.",
      "I love that! 😊",
      "Haha, same here!",
      "What do you like to do for fun?",
      "That sounds amazing!",
      "I'd love to hear more about that.",
      "Nice! What else are you into?"
    ];
    
    const responseText = responses[Math.floor(Math.random() * responses.length)];
    
    // 延迟回复（模拟真实用户）
    const delayMs = (bot?.avgResponseTime || 10) * 60 * 1000; // 转换为毫秒
    await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 5000))); // 最多等待5秒
    
    // 发送回复
    await prisma.message.create({
      data: {
        roomId: unreadMessage.roomId,
        senderId: profileId,
        content: responseText,
      }
    });
    
    // 标记原消息为已读
    await prisma.message.update({
      where: { id: unreadMessage.id },
      data: { isRead: true, readAt: new Date() }
    });
    
    // 记录日志
    await prisma.botInteractionLog.create({
      data: {
        botUserId: profileId,
        targetUserId: unreadMessage.senderId,
        interactionType: 'message_sent',
        action: 'respond',
      }
    });
  }

  /**
   * 计算下次动作时间
   */
  private calculateNextActionTime(pattern?: string): Date {
    const now = new Date();
    const delayMinutes = 5 + Math.floor(Math.random() * 55); // 5-60分钟后
    return new Date(now.getTime() + delayMinutes * 60000);
  }

  /**
   * 加权随机选择
   */
  private weightedRandom<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// 单例实例
let engineInstance: BotBehaviorEngine | null = null;

export function getBotBehaviorEngine(): BotBehaviorEngine {
  if (!engineInstance) {
    engineInstance = new BotBehaviorEngine();
  }
  return engineInstance;
}
