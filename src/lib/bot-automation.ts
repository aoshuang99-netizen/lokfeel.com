/**
 * AI数字人自动化系统
 * 
 * 功能：
 * 1. 自动标签分发 - 为3500个用户分配关系标签
 * 2. 智能匹配引擎 - 基于标签和算法自动匹配
 * 3. 自动化聊天 - AI破冰、持续对话
 * 4. 反馈循环 - 收集数据自我进化
 * 5. 自循环神经网络 - 匹配→聊天→反馈→进化
 */

import { db as prisma } from "./db";

// ═══════════════════════════════════════════════════════════════
// 1. 自动标签分发系统
// ═══════════════════════════════════════════════════════════════

export const RELATIONSHIP_TAGS = {
  // 关系类型标签 - 匹配数据库枚举
  RELATIONSHIP_TYPE: [
    { id: "LONG_TERM", label: "Serious Relationship", emoji: "💍", weight: 0.40 },
    { id: "DATING", label: "Casual Dating", emoji: "☕", weight: 0.30 },
    { id: "FRIENDSHIP", label: "Friendship First", emoji: "🤝", weight: 0.20 },
    { id: "NOT_SURE", label: "Exploring", emoji: "🌟", weight: 0.10 },
  ],
  
  // 依恋风格标签
  ATTACHMENT_STYLE: [
    { id: "secure", label: "Secure", emoji: "🛡️", weight: 0.35 },
    { id: "anxious", label: "Anxious", emoji: "💝", weight: 0.25 },
    { id: "avoidant", label: "Avoidant", emoji: "🦋", weight: 0.25 },
    { id: "fearful", label: "Fearful", emoji: "🌙", weight: 0.15 },
  ],
  
  // 沟通风格标签
  COMMUNICATION_STYLE: [
    { id: "direct", label: "Direct", emoji: "🎯", weight: 0.30 },
    { id: "emotional", label: "Emotional", emoji: "🌊", weight: 0.25 },
    { id: "analytical", label: "Analytical", emoji: "🔍", weight: 0.25 },
    { id: "playful", label: "Playful", emoji: "🎭", weight: 0.20 },
  ],
  
  // 兴趣标签池
  INTERESTS: [
    "hiking", "cooking", "photography", "gaming", "yoga", "reading",
    "travel", "music", "movies", "art", "fitness", "meditation",
    "technology", "fashion", "foodie", "pets", "nature", "writing",
    "dancing", "sports", "volunteering", "entrepreneurship", "politics",
    "spirituality", "science", "history", "languages", "investing"
  ],
  
  // 价值观标签
  VALUES: [
    { id: "family", label: "Family-oriented", emoji: "👨‍👩‍👧‍👦" },
    { id: "career", label: "Career-focused", emoji: "💼" },
    { id: "adventure", label: "Adventure-seeking", emoji: "🎒" },
    { id: "growth", label: "Personal Growth", emoji: "🌱" },
    { id: "creativity", label: "Creativity", emoji: "🎨" },
    { id: "community", label: "Community", emoji: "🤲" },
    { id: "health", label: "Health & Wellness", emoji: "🧘" },
    { id: "intellect", label: "Intellectual", emoji: "📚" },
  ],
};

/**
 * 为数字用户分配随机标签组合
 */
export async function assignTagsToBot(userId: string) {
  // 随机选择关系类型
  const relationshipType = weightedRandom(RELATIONSHIP_TAGS.RELATIONSHIP_TYPE);
  
  // 随机选择依恋风格
  const attachmentStyle = weightedRandom(RELATIONSHIP_TAGS.ATTACHMENT_STYLE);
  
  // 随机选择沟通风格
  const communicationStyle = weightedRandom(RELATIONSHIP_TAGS.COMMUNICATION_STYLE);
  
  // 随机选择3-5个兴趣
  const interests = getRandomItems(RELATIONSHIP_TAGS.INTERESTS, 3 + Math.floor(Math.random() * 3));
  
  // 随机选择2-3个价值观
  const values = getRandomItems(RELATIONSHIP_TAGS.VALUES, 2 + Math.floor(Math.random() * 2));
  
    // 更新用户profile - 只更新存在的字段
  await prisma.profile.update({
    where: { userId },
    data: {
      relationshipGoal: relationshipType.id as any,
      attachmentStyle: attachmentStyle.id,
      communicationStyle: communicationStyle.id,
      // interests 和 values 字段不存在，存储在 personalityData 中
      personalityData: JSON.stringify({
        interests,
        values: values.map(v => v.id),
        assignedAt: new Date().toISOString(),
      }),
    },
  });
  
  return {
    userId,
    tags: {
      relationshipType,
      attachmentStyle,
      communicationStyle,
      interests,
      values,
    },
  };
}

/**
 * 为所有数字用户批量分配标签
 */
export async function batchAssignTagsToAllBots() {
  console.log("[Bot Automation] Starting batch tag assignment...");
  
  // 获取所有数字用户
  const botProfiles = await prisma.botProfile.findMany({
    where: { isActive: true },
    include: { profile: true },
  });
  
  console.log(`[Bot Automation] Found ${botProfiles.length} bot profiles`);
  
  const results = [];
  for (const bot of botProfiles) {
    try {
      const result = await assignTagsToBot(bot.profile.userId);
      results.push(result);
    } catch (error) {
      console.error(`[Bot Automation] Failed to assign tags to ${bot.profile.userId}:`, error);
    }
  }
  
  console.log(`[Bot Automation] Successfully assigned tags to ${results.length} bots`);
  return results;
}

// ═══════════════════════════════════════════════════════════════
// 2. 智能匹配引擎
// ═══════════════════════════════════════════════════════════════

interface MatchCandidate {
  userId: string;
  targetId: string;
  matchScore: number;
  matchReason: string;
  compatibility: {
    attachment: number;
    communication: number;
    values: number;
    interests: number;
  };
}

/**
 * 基于标签计算匹配分数
 */
export function calculateTagBasedMatchScore(user1: any, user2: any): MatchCandidate {
  let score = 50; // 基础分
  const compatibility = {
    attachment: 0,
    communication: 0,
    values: 0,
    interests: 0,
  };
  
  // 依恋风格兼容性
  if (user1.attachmentStyle && user2.attachmentStyle) {
    compatibility.attachment = getAttachmentCompatibility(
      user1.attachmentStyle,
      user2.attachmentStyle
    );
    score += compatibility.attachment * 0.25;
  }
  
  // 沟通风格兼容性
  if (user1.communicationStyle && user2.communicationStyle) {
    if (user1.communicationStyle === user2.communicationStyle) {
      compatibility.communication = 90;
      score += 15;
    } else {
      compatibility.communication = 60;
      score += 8;
    }
  }
  
  // 价值观兼容性
  if (user1.values && user2.values) {
    const sharedValues = user1.values.filter((v: string) => user2.values.includes(v));
    compatibility.values = Math.min(100, sharedValues.length * 25);
    score += compatibility.values * 0.20;
  }
  
  // 兴趣兼容性
  if (user1.interests && user2.interests) {
    const sharedInterests = user1.interests.filter((i: string) => user2.interests.includes(i));
    compatibility.interests = Math.min(100, sharedInterests.length * 20);
    score += compatibility.interests * 0.15;
  }
  
  const normalizedScore = Math.min(99, Math.max(40, Math.round(score)));
  
  return {
    userId: user1.userId,
    targetId: user2.userId,
    matchScore: normalizedScore,
    matchReason: generateMatchReason(user1, user2, normalizedScore, compatibility),
    compatibility,
  };
}

/**
 * 为数字用户自动寻找匹配
 */
export async function findMatchesForBot(botUserId: string, maxMatches: number = 5): Promise<MatchCandidate[]> {
  const botProfile = await prisma.profile.findUnique({
    where: { userId: botUserId },
  });
  
  if (!botProfile) return [];
  
  // 获取所有其他活跃用户
  const otherUsers = await prisma.profile.findMany({
    where: {
      userId: { not: botUserId },
      profileStatus: "APPROVED",
    },
    take: 100, // 限制候选池大小
  });
  
  // 计算匹配分数
  const candidates = otherUsers.map(user => 
    calculateTagBasedMatchScore(botProfile, user)
  );
  
  // 按分数排序并返回前N个
  return candidates
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, maxMatches);
}

// ═══════════════════════════════════════════════════════════════
// 3. 自动化聊天系统
// ═══════════════════════════════════════════════════════════════

const ICEBREAKER_TEMPLATES = {
  casual: [
    "Hey! I noticed we both enjoy {interest}. What's your favorite spot in the city?",
    "Hi there! Your profile caught my eye. What are you usually up to on weekends?",
    "Hello! I see you're into {interest} too. Any recommendations?",
  ],
  serious: [
    "Hi! I was drawn to your profile. What are you looking for in a meaningful connection?",
    "Hello! I appreciate how thoughtful your profile seems. What matters most to you in relationships?",
    "Hey there. I noticed we share similar values around {value}. I'd love to hear more about that.",
  ],
  friendship: [
    "Hey! Looking to expand my social circle. What kind of adventures do you enjoy?",
    "Hi! Always happy to meet new people. What's something you're passionate about lately?",
    "Hello! Would love to connect. Do you have any favorite local spots?",
  ],
  explore: [
    "Hi! I'm exploring different connections. What brought you here?",
    "Hey! Love your energy. What are you curious about these days?",
    "Hello! I'm open to seeing where things go. What's your ideal way to spend a free day?",
  ],
};

const RESPONSE_TEMPLATES = {
  positive: [
    "That's really interesting! Tell me more about that.",
    "I love that perspective. What else are you into?",
    "Sounds amazing! I'd love to experience that sometime.",
  ],
  question: [
    "What do you think about {topic}?",
    "Have you ever tried {activity}?",
    "What's your take on {topic}?",
  ],
  share: [
    "I feel the same way! I recently {experience}.",
    "That reminds me of when I {experience}.",
    "I can relate! I've been {experience} lately.",
  ],
};

/**
 * 生成AI破冰消息
 */
export function generateIcebreaker(botProfile: any, targetProfile: any): string {
  const relationshipType = botProfile.relationshipGoal?.toLowerCase() || "casual";
  const templates = ICEBREAKER_TEMPLATES[relationshipType as keyof typeof ICEBREAKER_TEMPLATES] || ICEBREAKER_TEMPLATES.casual;
  
  let message = templates[Math.floor(Math.random() * templates.length)];
  
  // 替换变量
  const sharedInterests = botProfile.interests?.filter((i: string) => targetProfile.interests?.includes(i)) || [];
  const interest = sharedInterests[0] || botProfile.interests?.[0] || "exploring new things";
  const value = botProfile.values?.[0] || "authentic connections";
  
  message = message.replace("{interest}", interest);
  message = message.replace("{value}", value);
  
  return message;
}

/**
 * 生成AI回复
 */
export function generateResponse(botProfile: any, lastMessage: string, conversationHistory: string[]): string {
  // 分析最后一条消息
  const isQuestion = lastMessage.includes("?");
  const isPositive = /great|awesome|love|like|enjoy|good/i.test(lastMessage);
  
  let templates: string[];
  if (isQuestion) {
    templates = RESPONSE_TEMPLATES.question;
  } else if (isPositive) {
    templates = RESPONSE_TEMPLATES.positive;
  } else {
    templates = RESPONSE_TEMPLATES.share;
  }
  
  let message = templates[Math.floor(Math.random() * templates.length)];
  
  // 替换变量
  const topics = ["travel", "food", "music", "movies", "hobbies", "weekend plans"];
  const activities = ["hiking", "cooking together", "live music", "art galleries", "trying new restaurants"];
  const experiences = [
    "went on an amazing hike",
    "tried a new recipe that turned out great",
    "discovered a fantastic local band",
    "started learning something new",
    "had a really meaningful conversation",
  ];
  
  message = message.replace("{topic}", topics[Math.floor(Math.random() * topics.length)]);
  message = message.replace("{activity}", activities[Math.floor(Math.random() * activities.length)]);
  message = message.replace("{experience}", experiences[Math.floor(Math.random() * experiences.length)]);
  
  return message;
}

/**
 * 发送AI消息
 */
export async function sendBotMessage(botUserId: string, chatRoomId: string, content: string) {
  const message = await prisma.message.create({
    data: {
      roomId: chatRoomId,
      senderId: botUserId,
      content,
      isRead: false,
    },
  });
  
  // 记录交互日志
  await prisma.botInteractionLog.create({
    data: {
      botUserId,
      interactionType: "message_sent",
      action: "initiate",
      context: JSON.stringify({ chatRoomId, messageId: message.id }),
    },
  });
  
  return message;
}

// ═══════════════════════════════════════════════════════════════
// 4. 反馈循环与自我进化
// ═══════════════════════════════════════════════════════════════

interface InteractionFeedback {
  botId: string;
  userId: string;
  interactionType: string;
  outcome: "positive" | "neutral" | "negative";
  engagementScore: number;
  context: any;
}

/**
 * 记录交互反馈
 */
export async function recordInteractionFeedback(feedback: InteractionFeedback) {
  // 创建学习记录
  await prisma.botLearningRecord.create({
    data: {
      botId: feedback.botId,
      userId: feedback.userId,
      interactionType: feedback.interactionType,
      outcome: feedback.outcome.toUpperCase(),
      context: feedback.context,
    },
  });
  
  // 更新bot统计
  const bot = await prisma.botProfile.findFirst({
    where: { profile: { userId: feedback.botId } },
  });
  
  if (bot) {
    await prisma.botProfile.update({
      where: { id: bot.id },
      data: {
        totalInteractions: { increment: 1 },
        successfulMatches: feedback.outcome === "positive" ? { increment: 1 } : undefined,
        avgEngagementScore: {
          set: (bot.avgEngagementScore * bot.totalInteractions + feedback.engagementScore) / (bot.totalInteractions + 1),
        },
      },
    });
  }
}

/**
 * 分析学习数据并优化标签
 */
export async function evolveBotPreferences(botId: string) {
  // 获取最近的学习记录
  const records = await prisma.botLearningRecord.findMany({
    where: { botId, processed: false },
    take: 100,
  });
  
  if (records.length === 0) return;
  
  // 分析成功模式
  const positiveRecords = records.filter(r => r.outcome === "POSITIVE");
  const negativeRecords = records.filter(r => r.outcome === "NEGATIVE");
  
  // 提取成功特征
  const successPatterns = extractPatterns(positiveRecords);
  const failurePatterns = extractPatterns(negativeRecords);
  
  // 更新bot偏好
  const bot = await prisma.botProfile.findFirst({
    where: { profile: { userId: botId } },
  });
  
  if (bot) {
    const currentLearningData = bot.learningData ? JSON.parse(bot.learningData) : {};
    
    await prisma.botProfile.update({
      where: { id: bot.id },
      data: {
        learningData: JSON.stringify({
          ...currentLearningData,
          successPatterns,
          failurePatterns,
          lastEvolvedAt: new Date().toISOString(),
        }),
      },
    });
  }
  
  // 标记记录为已处理
  await prisma.botLearningRecord.updateMany({
    where: { id: { in: records.map(r => r.id) } },
    data: { processed: true },
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. 自循环神经网络主控
// ═══════════════════════════════════════════════════════════════

export class BotNeuralNetwork {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  
  /**
   * 启动自循环
   */
  async start() {
    if (this.isRunning) return;
    
    console.log("[Bot Neural Network] Starting self-loop...");
    this.isRunning = true;
    
    // 立即执行一次
    await this.executeCycle();
    
    // 每5分钟执行一次
    this.intervalId = setInterval(() => {
      this.executeCycle();
    }, 5 * 60 * 1000);
  }
  
  /**
   * 停止自循环
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[Bot Neural Network] Stopped");
  }
  
  /**
   * 执行一个完整周期
   */
  private async executeCycle() {
    console.log("[Bot Neural Network] Executing cycle...", new Date().toISOString());
    
    try {
      // 1. 为未分配标签的bot分配标签
      await this.step1_AssignTags();
      
      // 2. 为活跃的bot寻找匹配
      await this.step2_FindMatches();
      
      // 3. 发送破冰消息
      await this.step3_SendIcebreakers();
      
      // 4. 继续对话
      await this.step4_ContinueConversations();
      
      // 5. 收集反馈并进化
      await this.step5_Evolve();
      
      console.log("[Bot Neural Network] Cycle completed successfully");
    } catch (error) {
      console.error("[Bot Neural Network] Cycle failed:", error);
    }
  }
  
  private async step1_AssignTags() {
    const botsWithoutTags = await prisma.botProfile.findMany({
      where: {
        isActive: true,
      },
      take: 50,
    });
    
    for (const bot of botsWithoutTags) {
      await assignTagsToBot(bot.profileId);
    }
    
    console.log(`[Bot Neural Network] Assigned tags to ${botsWithoutTags.length} bots`);
  }
  
  private async step2_FindMatches() {
    const activeBots = await prisma.botProfile.findMany({
      where: {
        isActive: true,
        activityLevel: { in: ["MEDIUM", "HIGH", "FULL"] },
      },
      take: 20,
    });
    
    for (const bot of activeBots) {
      const profile = await prisma.profile.findUnique({
        where: { id: bot.profileId },
      });
      
      if (profile) {
        const matches = await findMatchesForBot(profile.userId, 3);
        
        // 创建匹配请求
        for (const match of matches) {
          if (match.matchScore >= 70) {
            await prisma.match.create({
              data: {
                senderId: profile.userId,
                receiverId: match.targetId,
                matchScore: match.matchScore,
                matchReason: match.matchReason,
                status: "PENDING",
              },
            });
          }
        }
      }
    }
    
    console.log(`[Bot Neural Network] Found matches for ${activeBots.length} bots`);
  }
  
  private async step3_SendIcebreakers() {
    // 找到已匹配但未开始聊天的对话
    const pendingMatches = await prisma.match.findMany({
      where: {
        status: "PENDING",
      },
      include: {
        sender: { include: { profile: true } },
        receiver: { include: { profile: true } },
      },
      take: 10,
    });
    
    for (const match of pendingMatches) {
      // 简化处理：假设sender是bot
      const botProfile = match.sender.profile;
      const targetProfile = match.receiver.profile;
      
      // 创建聊天室
      const chatRoom = await prisma.chatRoom.create({
        data: {
          matchId: match.id,
          vaultExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时
          members: {
            create: [
              { userId: match.senderId },
              { userId: match.receiverId },
            ],
          },
        },
      });
      
      // 发送破冰消息
      if (!botProfile) continue;
      const icebreaker = generateIcebreaker(botProfile, targetProfile);
      await sendBotMessage(botProfile.userId, chatRoom.id, icebreaker);
      
      // 更新匹配状态
      await prisma.match.update({
        where: { id: match.id },
        data: { status: "ACCEPTED" },
      });
    }
    
    console.log(`[Bot Neural Network] Sent ${pendingMatches.length} icebreakers`);
  }
  
  private async step4_ContinueConversations() {
    // 找到有未读消息的聊天室
    const activeChats = await prisma.chatRoom.findMany({
      where: {
        messages: {
          some: {
            isRead: false,
          },
        },
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        members: {
          include: {
            user: { include: { profile: true } },
          },
        },
      },
      take: 10,
    });
    
    for (const chat of activeChats) {
      // 简化处理
      const botParticipant = chat.members[0]?.user;
      const humanParticipant = chat.members[1]?.user;
      
      if (!botParticipant?.profile) continue;
      
      const lastMessage = chat.messages[0];
      const history = chat.messages.map(m => m.content).reverse();
      
      const response = generateResponse(botParticipant.profile, lastMessage.content, history);
      
      // 模拟打字延迟
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
      
      await sendBotMessage(botParticipant.id, chat.id, response);
      
      // 记录反馈
      await recordInteractionFeedback({
        botId: botParticipant.id,
        userId: humanParticipant.id,
        interactionType: "chat_response",
        outcome: "positive",
        engagementScore: 75,
        context: { chatRoomId: chat.id, messageLength: response.length },
      });
    }
    
    console.log(`[Bot Neural Network] Continued ${activeChats.length} conversations`);
  }
  
  private async step5_Evolve() {
    const bots = await prisma.botProfile.findMany({
      where: { isActive: true },
      take: 20,
    });
    
    for (const bot of bots) {
      const profile = await prisma.profile.findUnique({
        where: { id: bot.profileId },
      });
      
      if (profile) {
        await evolveBotPreferences(profile.userId);
      }
    }
    
    console.log(`[Bot Neural Network] Evolved ${bots.length} bots`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  
  return items[items.length - 1];
}

function getRandomItems<T>(items: T[], count: number): T[] {
  const shuffled = [...items].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function getAttachmentCompatibility(style1: string, style2: string): number {
  const compatibilityMap: Record<string, Record<string, number>> = {
    Secure: { Secure: 95, Anxious: 85, Avoidant: 80, Fearful: 75 },
    Anxious: { Secure: 90, Anxious: 70, Avoidant: 50, Fearful: 60 },
    Avoidant: { Secure: 85, Anxious: 45, Avoidant: 65, Fearful: 55 },
    Fearful: { Secure: 80, Anxious: 60, Avoidant: 55, Fearful: 50 },
  };
  
  const s1 = style1.charAt(0).toUpperCase() + style1.slice(1);
  const s2 = style2.charAt(0).toUpperCase() + style2.slice(1);
  
  return compatibilityMap[s1]?.[s2] || 60;
}

function generateMatchReason(user1: any, user2: any, score: number, compatibility: any): string {
  const reasons: string[] = [];
  
  if (score >= 85) reasons.push("Exceptional compatibility");
  else if (score >= 75) reasons.push("Strong compatibility");
  else if (score >= 65) reasons.push("Good match");
  else reasons.push("Interesting connection");
  
  if (compatibility.attachment >= 80) reasons.push("complementary attachment styles");
  if (compatibility.values >= 60) reasons.push("shared values");
  if (compatibility.interests >= 40) reasons.push("common interests");
  
  if (reasons.length > 1) {
    return `${reasons[0]} with ${reasons.slice(1).join(" and ")}`;
  }
  
  return reasons[0];
}

function extractPatterns(records: any[]): any {
  // 简化版模式提取
  const patterns: Record<string, number> = {};
  
  for (const record of records) {
    const context = record.context as any;
    if (context?.matchScore) {
      const scoreRange = Math.floor(context.matchScore / 10) * 10;
      patterns[`score_${scoreRange}`] = (patterns[`score_${scoreRange}`] || 0) + 1;
    }
  }
  
  return patterns;
}

// 导出单例
export const botNeuralNetwork = new BotNeuralNetwork();
