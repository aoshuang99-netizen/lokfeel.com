/**
 * Bot Learning Engine - 数字用户自主学习训练系统
 * 
 * 核心功能:
 * 1. 反馈循环收集 - 匹配接受率、聊天质量、用户评分
 * 2. 偏好学习算法 - 协同过滤 + 强化学习
 * 3. 群体智慧机制 - 成功率共享、趋势学习
 * 4. A/B测试框架
 * 5. 24小时不间断学习训练
 */

import { db } from '@/lib/db';

// 学习配置
const LEARNING_CONFIG = {
  // 学习频率
  LEARNING_INTERVAL_MS: 5 * 60 * 1000, // 5分钟一次学习循环
  BATCH_SIZE: 50, // 每批处理50个交互
  
  // 权重参数
  MATCH_ACCEPT_WEIGHT: 0.4,
  CHAT_QUALITY_WEIGHT: 0.35,
  USER_RATING_WEIGHT: 0.25,
  
  // 探索vs利用 (Epsilon-Greedy)
  EPSILON: 0.15, // 15%探索
  
  // 冷却期
  MIN_INTERACTION_GAP_MS: 60 * 1000, // 1分钟内不重复交互
};

// 交互类型
export enum InteractionType {
  MATCH_REQUEST = 'MATCH_REQUEST',
  MATCH_ACCEPT = 'MATCH_ACCEPT',
  MATCH_DECLINE = 'MATCH_DECLINE',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  CHAT_ENGAGEMENT = 'CHAT_ENGAGEMENT',
  PROFILE_VIEW = 'PROFILE_VIEW',
  RATING_GIVEN = 'RATING_GIVEN',
}

// 交互结果
export enum InteractionOutcome {
  POSITIVE = 'POSITIVE',   // 积极结果 (接受、回复、好评)
  NEUTRAL = 'NEUTRAL',     // 中性结果 (查看、浏览)
  NEGATIVE = 'NEGATIVE',   // 消极结果 (拒绝、忽略、差评)
}

// 学习记录
interface LearningRecord {
  id: string;
  botId: string;
  userId: string;
  interactionType: InteractionType;
  outcome: InteractionOutcome;
  context: Record<string, unknown> | null;
  timestamp: Date;
  processed: boolean;
}

// 偏好向量
interface PreferenceVector {
  botId: string;
  // 维度偏好 (0-1)
  relationshipStructure: number;
  communicationStyle: number;
  interests: number;
  values: number;
  lifestyle: number;
  // 元数据
  confidence: number; // 置信度
  sampleSize: number; // 样本数量
  lastUpdated: Date;
}

/**
 * 记录交互事件
 */
export async function recordInteraction(
  botId: string,
  userId: string,
  interactionType: InteractionType,
  outcome: InteractionOutcome,
  context: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.botLearningRecord.create({
      data: {
        botId,
        userId,
        interactionType,
        outcome,
        context: JSON.stringify(context),
        processed: false,
      },
    });
  } catch (error) {
    console.error('[BotLearning] Failed to record interaction:', error);
  }
}

/**
 * 批量处理学习记录
 */
export async function processLearningBatch(): Promise<{
  processed: number;
  updated: number;
  errors: number;
}> {
  const stats = { processed: 0, updated: 0, errors: 0 };
  
  try {
    // 获取未处理的记录
    const records = await db.botLearningRecord.findMany({
      where: { processed: false },
      take: LEARNING_CONFIG.BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });
    
    if (records.length === 0) {
      return stats;
    }
    
    // 按bot分组处理
    const recordsByBot = new Map<string, typeof records>();
    for (const record of records) {
      const list = recordsByBot.get(record.botId) || [];
      list.push(record);
      recordsByBot.set(record.botId, list);
    }
    
    // 处理每个bot的学习
    for (const [botId, botRecords] of recordsByBot) {
      try {
        await updateBotPreferences(botId, botRecords);
        stats.updated++;
      } catch (error) {
        console.error(`[BotLearning] Failed to update bot ${botId}:`, error);
        stats.errors++;
      }
    }
    
    // 标记为已处理
    const recordIds = records.map(r => r.id);
    await db.botLearningRecord.updateMany({
      where: { id: { in: recordIds } },
      data: { processed: true },
    });
    
    stats.processed = records.length;
    
    console.log(`[BotLearning] Processed ${stats.processed} records, updated ${stats.updated} bots`);
    
  } catch (error) {
    console.error('[BotLearning] Batch processing error:', error);
    stats.errors++;
  }
  
  return stats;
}

/**
 * 更新Bot偏好向量
 */
async function updateBotPreferences(
  botId: string,
  records: Array<{
    interactionType: string;
    outcome: string;
    context: unknown;
  }>
): Promise<void> {
  // 计算各维度得分
  const scores = {
    relationshipStructure: { sum: 0, count: 0 },
    communicationStyle: { sum: 0, count: 0 },
    interests: { sum: 0, count: 0 },
    values: { sum: 0, count: 0 },
    lifestyle: { sum: 0, count: 0 },
  };
  
  for (const record of records) {
    const weight = getOutcomeWeight(record.outcome as InteractionOutcome);
    const context = (record.context as Record<string, number>) || {};
    
    // 根据交互类型更新不同维度
    switch (record.interactionType) {
      case 'MATCH_ACCEPT':
        scores.relationshipStructure.sum += (context.structureMatch || 0.5) * weight;
        scores.relationshipStructure.count++;
        break;
      case 'CHAT_MESSAGE':
      case 'CHAT_ENGAGEMENT':
        scores.communicationStyle.sum += (context.styleMatch || 0.5) * weight;
        scores.communicationStyle.count++;
        break;
      case 'MATCH_REQUEST':
        scores.interests.sum += (context.interestOverlap || 0.5) * weight;
        scores.interests.count++;
        break;
      case 'RATING_GIVEN':
        scores.values.sum += (context.valueAlignment || 0.5) * weight;
        scores.values.count++;
        break;
    }
  }
  
  // 获取或创建偏好记录
  const existing = await db.botPreference.findUnique({
    where: { botId },
  });
  
  const newPreferences = {
    relationshipStructure: normalizeScore(scores.relationshipStructure),
    communicationStyle: normalizeScore(scores.communicationStyle),
    interests: normalizeScore(scores.interests),
    values: normalizeScore(scores.values),
    lifestyle: normalizeScore(scores.lifestyle),
  };
  
  if (existing) {
    // 指数移动平均更新
    const alpha = 0.3; // 学习率
    await db.botPreference.update({
      where: { botId },
      data: {
        relationshipStructure: existing.relationshipStructure * (1 - alpha) + newPreferences.relationshipStructure * alpha,
        communicationStyle: existing.communicationStyle * (1 - alpha) + newPreferences.communicationStyle * alpha,
        interests: existing.interests * (1 - alpha) + newPreferences.interests * alpha,
        values: existing.values * (1 - alpha) + newPreferences.values * alpha,
        lifestyle: existing.lifestyle * (1 - alpha) + newPreferences.lifestyle * alpha,
        sampleSize: existing.sampleSize + records.length,
        lastUpdated: new Date(),
      },
    });
  } else {
    await db.botPreference.create({
      data: {
        botId,
        ...newPreferences,
        sampleSize: records.length,
        confidence: Math.min(records.length / 100, 1.0), // 100个样本达到满置信度
      },
    });
  }
}

/**
 * 获取结果权重
 */
function getOutcomeWeight(outcome: InteractionOutcome): number {
  switch (outcome) {
    case InteractionOutcome.POSITIVE: return 1.0;
    case InteractionOutcome.NEUTRAL: return 0.0;
    case InteractionOutcome.NEGATIVE: return -1.0;
    default: return 0.0;
  }
}

/**
 * 归一化得分
 */
function normalizeScore(score: { sum: number; count: number }): number {
  if (score.count === 0) return 0.5;
  const avg = score.sum / score.count;
  // 映射到 0-1 范围
  return Math.max(0, Math.min(1, (avg + 1) / 2));
}

/**
 * 获取Bot的推荐策略 (Epsilon-Greedy)
 */
export async function getBotStrategy(botId: string): Promise<{
  explore: boolean;
  preferences: PreferenceVector | null;
}> {
  // 探索 vs 利用
  const explore = Math.random() < LEARNING_CONFIG.EPSILON;
  
  const preferences = await db.botPreference.findUnique({
    where: { botId },
  });
  
  return {
    explore,
    preferences: preferences ? {
      botId: preferences.botId,
      relationshipStructure: preferences.relationshipStructure,
      communicationStyle: preferences.communicationStyle,
      interests: preferences.interests,
      values: preferences.values,
      lifestyle: preferences.lifestyle,
      confidence: preferences.confidence,
      sampleSize: preferences.sampleSize,
      lastUpdated: preferences.lastUpdated,
    } : null,
  };
}

/**
 * 群体智慧: 获取同类Bot的成功策略
 */
export async function getCollectiveWisdom(
  gender: string,
  ageRange: { min: number; max: number },
  limit: number = 10
): Promise<Array<{
  botId: string;
  successRate: number;
  preferences: Record<string, number>;
}>> {
  // 获取同类Bot的统计数据
  const bots = await db.profile.findMany({
    where: {
      gender: gender as any,
      age: { gte: ageRange.min, lte: ageRange.max },
      user: { isBot: true },
    },
    include: {
      user: {
        include: {
          _count: {
            select: {
              receivedMatches: true,
            },
          },
        },
      },
    },
    take: limit,
  });
  
  // Get bot preferences separately
  const botIds = bots.map(b => b.userId);
  const preferences = await db.botPreference.findMany({
    where: { botId: { in: botIds } },
  });
  
  const prefMap = new Map(preferences.map(p => [p.botId, p]));
  
  return bots
    .filter(b => prefMap.has(b.userId))
    .map(bot => {
      const pref = prefMap.get(bot.userId)!;
      return {
        botId: bot.userId,
        successRate: calculateSuccessRate(bot.user),
        preferences: {
          relationshipStructure: pref.relationshipStructure,
          communicationStyle: pref.communicationStyle,
          interests: pref.interests,
          values: pref.values,
          lifestyle: pref.lifestyle,
        },
      };
    })
    .sort((a, b) => b.successRate - a.successRate);
}

/**
 * 计算Bot成功率
 */
function calculateSuccessRate(user: any): number {
  const totalMatches = user._count?.receivedMatches || 0;
  if (totalMatches === 0) return 0.5;
  
  // 简化计算: 实际应该查询Match表获取接受率
  return 0.5; // 默认值
}

/**
 * A/B测试: 获取Bot的测试变体
 */
export async function getABTestVariant(
  botId: string,
  testName: string
): Promise<{ variant: 'A' | 'B'; config: Record<string, unknown> }> {
  // 基于botId哈希确定变体 (确保同一bot始终获得相同变体)
  const hash = botId.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  const variant = Math.abs(hash) % 2 === 0 ? 'A' : 'B';
  
  // 测试配置
  const configs: Record<string, Record<string, Record<string, unknown>>> = {
    'greeting_style': {
      A: { style: 'casual', emoji: true },
      B: { style: 'formal', emoji: false },
    },
    'response_time': {
      A: { minDelay: 30, maxDelay: 120 }, // 秒
      B: { minDelay: 60, maxDelay: 300 },
    },
    'match_threshold': {
      A: { minScore: 0.6 },
      B: { minScore: 0.75 },
    },
  };
  
  const testConfig = configs[testName]?.[variant] || {};
  
  return { variant, config: testConfig };
}

/**
 * 启动学习引擎
 */
export function startLearningEngine(): void {
  console.log('[BotLearning] Engine started');
  
  // 立即执行一次
  processLearningBatch();
  
  // 定时执行
  setInterval(() => {
    processLearningBatch();
  }, LEARNING_CONFIG.LEARNING_INTERVAL_MS);
}

/**
 * 获取学习统计
 */
export async function getLearningStats(): Promise<{
  totalRecords: number;
  pendingRecords: number;
  processedToday: number;
  activeBots: number;
}> {
  const [total, pending, processedToday, activeBots] = await Promise.all([
    db.botLearningRecord.count(),
    db.botLearningRecord.count({ where: { processed: false } }),
    db.botLearningRecord.count({
      where: {
        processed: true,
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    db.botPreference.count(),
  ]);
  
  return { totalRecords: total, pendingRecords: pending, processedToday, activeBots };
}

// 导出配置
export { LEARNING_CONFIG };
