# LokFeel 数字用户(Bot User)系统架构设计

> **版本**: 1.0  
> **日期**: 2026-04-12  
> **作者**: bot-architect

---

## 目录

1. [概述](#1-概述)
2. [数据模型扩展](#2-数据模型扩展)
3. [自学习机制设计](#3-自学习机制设计)
4. [匹配推荐集成](#4-匹配推荐集成)
5. [头像生成策略](#5-头像生成策略)
6. [实现路线图](#6-实现路线图)
7. [附录：伪代码参考](#7-附录伪代码参考)

---

## 1. 概述

### 1.1 目标

为 2,271 名数字用户构建完整的模拟系统，使其能够：
- 模拟真实用户行为模式
- 根据交互反馈自主调整偏好
- 在新用户冷启动阶段提供有意义的匹配体验

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **渐进式** | 从简单规则开始，逐步引入机器学习 |
| **可观测** | 所有行为可追踪和审计 |
| **隔离性** | 数字用户与真实用户数据完全隔离 |
| **可回滚** | 随时可禁用/删除数字用户及其影响 |

### 1.3 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      Bot User System Architecture               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Avatar     │    │   Behavior   │    │     ML       │      │
│  │   Engine     │    │   Simulator  │    │   Engine     │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │              │
│         └───────────────────┼───────────────────┘              │
│                             ▼                                  │
│                   ┌─────────────────┐                         │
│                   │  Bot Controller │                         │
│                   │  (Orchestrator) │                         │
│                   └────────┬────────┘                         │
│                            │                                   │
│         ┌──────────────────┼──────────────────┐                │
│         ▼                  ▼                  ▼                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐         │
│  │   Matching  │   │    Chat     │   │   Online    │         │
│  │   Engine    │   │   Generator │   │   Status    │         │
│  └─────────────┘   └─────────────┘   └─────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据模型扩展

### 2.1 新增枚举类型

```prisma
// 在 schema.prisma 的 ENUMS 部分添加

enum BotType {
  SEED          // 种子用户，冷启动用
  SIMULATION    // 行为模拟用户
  TRAINING      // 训练数据生成
  ACTIVE        // 活跃参与匹配
}

enum BotActivityLevel {
  GHOST         // 隐身，仅匹配不可见
  LOW           // 低活跃度 (10% 在线时间)
  MEDIUM        // 中活跃度 (30% 在线时间)
  HIGH          // 高活跃度 (60% 在线时间)
  FULL          // 全天候在线
}

enum Ethnicity {
  CAUCASIAN
  AFRICAN_AMERICAN
  HISPANIC_LATINO
  ASIAN
  SOUTH_ASIAN
  MIDDLE_EASTERN
  MIXED
  OTHER
}

enum OnlinePattern {
  MORNING        // 6AM-12PM
  AFTERNOON      // 12PM-6PM
  EVENING        // 6PM-12AM
  NIGHT          // 12AM-6AM
  RANDOM
  WORK_HOURS     // 9AM-5PM
  AFTER_WORK     // 5PM-10PM
}
```

### 2.2 BotProfile 模型（新增）

```prisma
// 在 Profile 模型之后添加

model BotProfile {
  id              String   @id @default(cuid())
  profileId       String   @unique
  profile         Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  
  // ─────────────────────────────────────────────────────────────
  // 基础配置
  // ─────────────────────────────────────────────────────────────
  botType         BotType        @default(SEED)
  activityLevel   BotActivityLevel @default(LOW)
  
  // ─────────────────────────────────────────────────────────────
  // 人口统计扩展
  // ─────────────────────────────────────────────────────────────
  ethnicity       Ethnicity?
  occupation      String?        // "Software Engineer", "Teacher", etc.
  industry        String?        // "Tech", "Healthcare", "Finance", etc.
  educationLevel  String?        // "High School", "Bachelor's", "Master's", "PhD"
  incomeRange     String?        // "$30k-50k", "$50k-100k", etc.
  
  // ─────────────────────────────────────────────────────────────
  // 兴趣与偏好
  // ─────────────────────────────────────────────────────────────
  interests       String[]       // ["hiking", "cooking", "photography"]
  hobbies         String[]       // ["gaming", "yoga", "reading"]
  musicGenres     String[]       // ["rock", "jazz", "electronic"]
  movieGenres     String[]       // ["thriller", "romance", "sci-fi"]
  
  // ─────────────────────────────────────────────────────────────
  // 行为模拟配置
  // ─────────────────────────────────────────────────────────────
  onlinePattern   OnlinePattern  @default(EVENING)
  avgResponseTime Int           @default(30)  // 平均响应时间（分钟）
  maxDailyMatches Int           @default(3)   // 每日最大匹配数
  
  // 行为概率配置（JSON）
  behaviorConfig String?        @db.Text
  
  // ─────────────────────────────────────────────────────────────
  // 匹配偏好（扩展 Profile 的 preferred* 字段）
  // ─────────────────────────────────────────────────────────────
  preferredEthnicities  Ethnicity[]
  preferredOccupations  String[]
  preferredEducation   String[]
  
  // ─────────────────────────────────────────────────────────────
  // 学习状态
  // ─────────────────────────────────────────────────────────────
  totalInteractions   Int       @default(0)
  successfulMatches   Int       @default(0)
  avgEngagementScore  Float     @default(0)   // 0-100
  
  // 学习数据（JSON）
  learningData String?          @db.Text
  
  // ─────────────────────────────────────────────────────────────
  // 头像配置
  // ─────────────────────────────────────────────────────────────
  avatarStyle    String?         // "professional", "casual", "artistic"
  avatarSource  String?          // "generated", "stock", "ai_avatar"
  
  // ─────────────────────────────────────────────────────────────
  // 状态
  // ─────────────────────────────────────────────────────────────
  isActive      Boolean         @default(true)
  lastActiveAt  DateTime?
  sleepUntil    DateTime?       // 暂停到指定时间
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([botType])
  @@index([activityLevel])
  @@index([isActive])
}
```

### 2.3 BotInteractionLog 模型（新增）

```prisma
model BotInteractionLog {
  id              String   @id @default(cuid())
  botUserId       String
  targetUserId    String?
  matchId         String?
  
  // 交互类型
  interactionType String   // "match_received", "match_reacted", "message_sent", "message_received", "profile_viewed"
  
  // 行为详情
  action          String   // "accept", "pass", "respond", "initiate"
  responseDelay   Int?     // 响应延迟（秒）
  
  // 结果
  outcome         String?  // "success", "rejected", "no_response", "blocked"
  engagementScore Int?     // 0-100 参与度评分
  
  // 上下文
  context         String?  @db.Text  // JSON: {matchScore, matchReason, etc.}
  
  createdAt DateTime @default(now())
  
  @@index([botUserId, createdAt])
  @@index([interactionType])
  @@index([outcome])
}
```

### 2.4 BotLearningBatch 模型（新增）

```prisma
model BotLearningBatch {
  id              String   @id @default(cuid())
  
  // 批次信息
  batchNumber     Int
  status          String   @default("pending")  // pending, running, completed, failed
  
  // 数据范围
  startDate       DateTime
  endDate         DateTime
  
  // 统计数据
  totalInteractions Int   @default(0)
  avgEngagement   Float     @default(0)
  successRate     Float     @default(0)
  
  // 更新的偏好配置
  preferenceUpdates String? @db.Text  // JSON array of changes
  
  // 执行日志
  executionLog    String?   @db.Text
  
  createdAt DateTime @default(now())
  completedAt DateTime?
  
  @@index([status])
  @@index([batchNumber])
}
```

### 2.5 迁移 SQL

```sql
-- BotProfile 表
CREATE TABLE "BotProfile" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT cuid(),
  "profileId" TEXT NOT NULL UNIQUE,
  "botType" TEXT DEFAULT 'SEED',
  "activityLevel" TEXT DEFAULT 'LOW',
  "ethnicity" TEXT,
  "occupation" TEXT,
  "industry" TEXT,
  "educationLevel" TEXT,
  "incomeRange" TEXT,
  "interests" TEXT[],
  "hobbies" TEXT[],
  "musicGenres" TEXT[],
  "movieGenres" TEXT[],
  "onlinePattern" TEXT DEFAULT 'EVENING',
  "avgResponseTime" INTEGER DEFAULT 30,
  "maxDailyMatches" INTEGER DEFAULT 3,
  "behaviorConfig" TEXT,
  "preferredEthnicities" TEXT[],
  "preferredOccupations" TEXT[],
  "preferredEducation" TEXT[],
  "totalInteractions" INTEGER DEFAULT 0,
  "successfulMatches" INTEGER DEFAULT 0,
  "avgEngagementScore" REAL DEFAULT 0,
  "learningData" TEXT,
  "avatarStyle" TEXT,
  "avatarSource" TEXT,
  "isActive" BOOLEAN DEFAULT true,
  "lastActiveAt" TIMESTAMPTZ,
  "sleepUntil" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "updatedAt" TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT "BotProfile_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- BotInteractionLog 表
CREATE TABLE "BotInteractionLog" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT cuid(),
  "botUserId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "matchId" TEXT,
  "interactionType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "responseDelay" INTEGER,
  "outcome" TEXT,
  "engagementScore" INTEGER,
  "context" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- BotLearningBatch 表
CREATE TABLE "BotLearningBatch" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT cuid(),
  "batchNumber" INTEGER NOT NULL,
  "status" TEXT DEFAULT 'pending',
  "startDate" TIMESTAMPTZ NOT NULL,
  "endDate" TIMESTAMPTZ NOT NULL,
  "totalInteractions" INTEGER DEFAULT 0,
  "avgEngagement" REAL DEFAULT 0,
  "successRate" REAL DEFAULT 0,
  "preferenceUpdates" TEXT,
  "executionLog" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "completedAt" TIMESTAMPTZ
);

-- 索引
CREATE INDEX "BotProfile_botType_idx" ON "BotProfile"("botType");
CREATE INDEX "BotProfile_activityLevel_idx" ON "BotProfile"("activityLevel");
CREATE INDEX "BotProfile_isActive_idx" ON "BotProfile"("isActive");
CREATE INDEX "BotInteractionLog_botUserId_createdAt_idx" ON "BotInteractionLog"("botUserId", "createdAt");
CREATE INDEX "BotInteractionLog_interactionType_idx" ON "BotInteractionLog"("interactionType");
CREATE INDEX "BotInteractionLog_outcome_idx" ON "BotInteractionLog"("outcome");
CREATE INDEX "BotLearningBatch_status_idx" ON "BotLearningBatch"("status");
CREATE INDEX "BotLearningBatch_batchNumber_idx" ON "BotLearningBatch"("batchNumber");
```

---

## 3. 自学习机制设计

### 3.1 学习循环架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Bot Self-Learning Loop                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐     ┌──────────┐     ┌───────────┐                │
│  │ Observe │────▶│ Analyze  │────▶│  Decide   │                │
│  └────┬────┘     └────┬─────┘     └─────┬─────┘                │
│       │                │                 │                      │
│       ▼                ▼                 ▼                      │
│  ┌─────────┐     ┌──────────┐     ┌───────────┐                │
│  │  Log    │◀────│ Calculate│◀────│  Update   │                │
│  │ Results │     │  Metrics │     │  Profile  │                │
│  └─────────┘     └──────────┘     └───────────┘                │
│                                                                 │
│  循环周期: 每小时小更新 / 每日大更新 / 每周深度学习              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 学习指标体系

```typescript
interface BotLearningMetrics {
  // 匹配指标
  matchAcceptRate: number;        // 接受率
  matchRejectRate: number;        // 拒绝率
  avgMatchScore: number;          // 平均匹配分
  
  // 互动指标
  messageResponseRate: number;    // 消息回复率
  avgResponseTime: number;        // 平均响应时间
  conversationLength: number;      // 对话平均长度
  messagePerDay: number;          // 日均消息数
  
  // 留存指标
  matchRetentionRate: number;     // 匹配后留存率
  chatRoomActiveRate: number;     // 聊天室活跃率
  
  // 质量指标
  userSatisfactionScore: number; // 用户满意度
  reportRate: number;            // 被举报率
  unmatchRate: number;            // 取消匹配率
}
```

### 3.3 学习算法

```typescript
// ============================================================
// Bot Preference Learning Algorithm
// ============================================================

class BotPreferenceLearner {
  
  /**
   * 核心学习函数：根据反馈调整偏好权重
   */
  learnFromInteraction(
    botUserId: string,
    interaction: BotInteractionLog,
    learningRate: number = 0.1
  ): PreferenceUpdate {
    const bot = await this.getBotProfile(botUserId);
    const currentWeights = this.parseBehaviorConfig(bot.behaviorConfig);
    
    // 1. 解析交互结果
    const feedback = this.analyzeFeedback(interaction);
    
    // 2. 计算新的权重调整
    const adjustments = this.calculateWeightChanges(
      currentWeights,
      feedback,
      learningRate
    );
    
    // 3. 应用约束（保持合理性边界）
    const constrainedWeights = this.applyConstraints(adjustments);
    
    // 4. 生成更新
    return {
      botUserId,
      newWeights: constrainedWeights,
      confidence: this.calculateConfidence(feedback),
      reasoning: this.generateReasoning(adjustments)
    };
  }
  
  /**
   * 批量学习：每日运行
   */
  async batchLearn(batchSize: number = 100): Promise<LearningResult> {
    const interactions = await this.getRecentInteractions(batchSize);
    const groupedByBot = this.groupByBot(interactions);
    
    const updates: PreferenceUpdate[] = [];
    
    for (const [botId, botInteractions] of groupedByBot) {
      // 加权平均所有交互的反馈
      const aggregatedFeedback = this.aggregateFeedback(botInteractions);
      
      // 学习
      const update = await this.learnFromInteraction(
        botId,
        aggregatedFeedback,
        0.05  // 批量学习用较低学习率
      );
      
      updates.push(update);
    }
    
    // 应用所有更新
    await this.applyUpdates(updates);
    
    return {
      totalBots: updates.length,
      avgConfidence: this.avg(updates.map(u => u.confidence)),
      significantChanges: updates.filter(u => u.confidence > 0.8).length
    };
  }
  
  /**
   * 分析反馈类型和强度
   */
  private analyzeFeedback(interaction: BotInteractionLog): FeedbackSignal {
    switch (interaction.outcome) {
      case 'success':
        return { 
          type: 'positive', 
          strength: interaction.engagementScore / 100 
        };
      case 'rejected':
        return { 
          type: 'negative', 
          strength: 0.7 
        };
      case 'no_response':
        return { 
          type: 'neutral', 
          strength: 0.5 
        };
      case 'blocked':
        return { 
          type: 'strongly_negative', 
          strength: 1.0 
        };
      default:
        return { type: 'neutral', strength: 0 };
    }
  }
  
  /**
   * 计算权重变化
   */
  private calculateWeightChanges(
    current: BehaviorWeights,
    feedback: FeedbackSignal,
    rate: number
  ): WeightDelta {
    const delta = {};
    const factor = feedback.strength * rate * (feedback.type === 'positive' ? 1 : -1);
    
    for (const dimension of Object.keys(current)) {
      // 基于交互类型调整对应维度
      const dimensionFactor = this.getDimensionRelevance(
        dimension, 
        feedback.interactionType
      );
      
      delta[dimension] = current[dimension] * factor * dimensionFactor;
    }
    
    return delta;
  }
  
  /**
   * 约束检查：防止权重偏离合理范围
   */
  private applyConstraints(weights: BehaviorWeights): BehaviorWeights {
    const MIN_WEIGHT = 0.05;
    const MAX_WEIGHT = 0.95;
    
    const normalized: BehaviorWeights = {};
    let total = 0;
    
    // 限制每个权重在有效范围内
    for (const [key, value] of Object.entries(weights)) {
      const clamped = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, value));
      normalized[key] = clamped;
      total += clamped;
    }
    
    // 归一化使总和为1
    for (const key of Object.keys(normalized)) {
      normalized[key] = normalized[key] / total;
    }
    
    return normalized;
  }
}
```

### 3.4 行为调整策略

```typescript
// ============================================================
// Bot Behavior Adjustment Engine
// ============================================================

interface BehaviorAdjustment {
  dimension: 'responseRate' | 'initiationRate' | 'verbosity' | 'mood';
  currentValue: number;
  targetValue: number;
  reason: string;
}

class BotBehaviorAdjuster {
  
  /**
   * 根据活跃度级别调整行为参数
   */
  adjustForActivityLevel(
    bot: BotProfile,
    targetLevel: BotActivityLevel
  ): BehaviorAdjustment[] {
    const adjustments: BehaviorAdjustment[] = [];
    
    const targets = {
      GHOST: { responseRate: 0, initiationRate: 0, verbosity: 0, mood: 0.5 },
      LOW: { responseRate: 0.3, initiationRate: 0.1, verbosity: 0.3, mood: 0.6 },
      MEDIUM: { responseRate: 0.5, initiationRate: 0.2, verbosity: 0.5, mood: 0.7 },
      HIGH: { responseRate: 0.7, initiationRate: 0.3, verbosity: 0.7, mood: 0.8 },
      FULL: { responseRate: 0.9, initiationRate: 0.5, verbosity: 0.9, mood: 0.9 }
    };
    
    const target = targets[targetLevel];
    const current = this.parseBehaviorConfig(bot.behaviorConfig);
    
    for (const [dimension, targetValue] of Object.entries(target)) {
      const currentValue = current[dimension] ?? 0.5;
      
      if (Math.abs(currentValue - targetValue) > 0.05) {
        adjustments.push({
          dimension,
          currentValue,
          targetValue,
          reason: `调整到 ${targetLevel} 级别`
        });
      }
    }
    
    return adjustments;
  }
  
  /**
   * 模拟在线/离线状态
   */
  calculateOnlineStatus(
    bot: BotProfile,
    currentTime: Date
  ): { isOnline: boolean; until: Date | null } {
    const pattern = bot.onlinePattern;
    const hour = currentTime.getHours();
    
    switch (pattern) {
      case 'MORNING':
        return { isOnline: hour >= 6 && hour < 12, until: null };
      case 'EVENING':
        return { isOnline: hour >= 18 && hour < 24, until: null };
      case 'AFTER_WORK':
        return { isOnline: hour >= 17 && hour < 22, until: null };
      case 'RANDOM':
        // 伪随机：基于 botId 的哈希
        return { 
          isOnline: this.hash(bot.profileId + currentTime.toISOString()) % 2 === 0,
          until: null 
        };
      case 'FULL':
        return { isOnline: true, until: null };
      default:
        return { isOnline: false, until: null };
    }
  }
}
```

---

## 4. 匹配推荐集成

### 4.1 新用户冷启动策略

```typescript
// ============================================================
// Bot-Enhanced Matching System
// ============================================================

interface BotMatchingConfig {
  // 冷启动阶段配置
  coldStart: {
    botMatchRatio: number;      // 前20个匹配中，bot占比 (0.3 = 30%)
    botMatchProbability: number; // 单个匹配是bot的概率
    minRealMatches: number;     // 最少保留真实用户匹配数
  };
  
  // 成长阶段配置
  growth: {
    botMatchRatio: number;      // 20-50个匹配中，bot占比 (0.15 = 15%)
    botMatchProbability: number;
  };
  
  // 稳定阶段配置  
  stable: {
    botMatchRatio: number;      // 50+个匹配，bot占比 (0.05 = 5%)
    maxDailyBotMatches: number;
  };
}

class BotMatchingEngine {
  
  /**
   * 为新用户生成初始匹配池
   */
  async generateInitialMatchPool(
    userId: string,
    profile: Profile,
    limit: number = 20
  ): Promise<MatchCandidate[]> {
    const config = this.getConfigForUser(userId);
    const existingMatches = await this.countExistingMatches(userId);
    
    // 确定bot和真实用户的比例
    const { botRatio, realRatio } = this.getRatios(
      existingMatches, 
      config
    );
    
    const botCount = Math.floor(limit * botRatio);
    const realCount = limit - botCount;
    
    // 并行获取两类候选
    const [botCandidates, realCandidates] = await Promise.all([
      this.getBotCandidates(userId, profile, botCount),
      this.getRealCandidates(userId, profile, realCount)
    ]);
    
    // 合并并打乱顺序
    const candidates = this.shuffle([...botCandidates, ...realCandidates]);
    
    // 标记来源用于分析
    return candidates.map(c => ({
      ...c,
      _isBot: c.source === 'bot',
      _matchOrder: candidates.indexOf(c)
    }));
  }
  
  /**
   * 获取bot候选（考虑响应延迟和活跃度）
   */
  async getBotCandidates(
    userId: string,
    userProfile: Profile,
    limit: number
  ): Promise<MatchCandidate[]> {
    // 1. 获取当前在线的活跃bot
    const onlineBots = await prisma.botProfile.findMany({
      where: {
        isActive: true,
        OR: [
          { sleepUntil: null },
          { sleepUntil: { lt: new Date() } }
        ]
      },
      include: {
        profile: {
          include: { user: true }
        }
      },
      take: limit * 3  // 获取更多用于筛选
    });
    
    // 2. 计算每个bot的匹配度
    const scored = await Promise.all(
      onlineBots.map(async (bot) => {
        const score = await this.calculateMatchScore(userProfile, bot.profile);
        const responseDelay = this.simulateResponseDelay(bot);
        
        return {
          ...bot.profile,
          matchScore: score,
          responseDelay,
          source: 'bot' as const
        };
      })
    );
    
    // 3. 按匹配分排序，取前limit个
    return scored
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
  }
  
  /**
   * 模拟bot响应延迟
   */
  private simulateResponseDelay(bot: BotProfile): number {
    // 基于 avgResponseTime 和活动级别计算
    const baseDelay = bot.avgResponseTime * 60 * 1000; // 转为毫秒
    
    // 添加随机波动 (±50%)
    const variance = 0.5;
    const randomFactor = 1 + (Math.random() - 0.5) * variance;
    
    return Math.round(baseDelay * randomFactor);
  }
}
```

### 4.2 Bot 匹配响应逻辑

```typescript
// ============================================================
// Bot Match Reaction Engine
// ============================================================

class BotMatchReactionEngine {
  
  /**
   * Bot如何响应收到的匹配请求
   */
  async decideReaction(
    botId: string,
    match: Match,
    userProfile: Profile
  ): Promise<MatchAction> {
    const bot = await this.getBotWithConfig(botId);
    
    // 1. 基础接受概率（基于匹配分）
    const baseAcceptProb = this.matchScoreToProbability(match.matchScore);
    
    // 2. 调整因子
    let adjustedProb = baseAcceptProb;
    
    // 2.1 根据偏好调整
    if (bot.preferredEthnicities?.length) {
      if (!bot.preferredEthnicities.includes(userProfile.ethnicity)) {
        adjustedProb *= 0.7;  // 降低非首选种族接受率
      }
    }
    
    // 2.2 根据dealbreakers调整
    if (userProfile.dealbreakers) {
      const dealbreakers = JSON.parse(userProfile.dealbreakers);
      for (const breaker of dealbreakers) {
        if (this.hasDealbreaker(bot, breaker)) {
          return 'PASS';  // 直接拒绝
        }
      }
    }
    
    // 2.3 根据学习状态调整
    const learningData = bot.learningData 
      ? JSON.parse(bot.learningData) 
      : {};
    if (learningData.acceptRate < 0.3) {
      adjustedProb *= 0.8;  // 接受率过低时保守
    }
    
    // 3. 随机决策
    const decision = Math.random();
    
    if (decision < adjustedProb * 0.7) {
      return 'INTERESTED';
    } else if (decision < adjustedProb) {
      return 'MAYBE';
    } else {
      return 'PASS';
    }
  }
  
  /**
   * 匹配分转接受概率
   */
  private matchScoreToProbability(score: number): number {
    // 非线性映射：高匹配分显著提高接受率
    if (score >= 80) return 0.85;
    if (score >= 70) return 0.70;
    if (score >= 60) return 0.50;
    if (score >= 50) return 0.30;
    return 0.15;
  }
}
```

### 4.3 Bot 聊天行为模拟

```typescript
// ============================================================
// Bot Chat Behavior Simulator
// ============================================================

interface ChatMessage {
  content: string;
  type: 'greeting' | 'question' | 'answer' | 'comment' | 'closing';
  sentiment: 'positive' | 'neutral' | 'negative';
  delay: number;  // 发送延迟（秒）
}

class BotChatSimulator {
  
  private responseTemplates: Record<string, string[]> = {
    greeting: [
      "Hey! I saw we matched. How's your day going?",
      "Hi there! Nice to connect with you.",
      "Hey! What brought you to LokFeel?"
    ],
    question: [
      "That's interesting! What do you do for fun?",
      "I'd love to hear more about that.",
      "What are you looking for on here?"
    ],
    comment: [
      "Haha, that's great!",
      "I totally agree with you.",
      "That's really cool."
    ]
  };
  
  /**
   * 生成bot回复
   */
  async generateResponse(
    botId: string,
    context: ChatContext
  ): Promise<ChatMessage> {
    const bot = await this.getBotConfig(botId);
    const lastMessage = context.messages[context.messages.length - 1];
    
    // 1. 确定回复类型
    const type = this.classifyMessageType(lastMessage.content);
    
    // 2. 生成内容
    const content = this.generateContent(bot, type, context);
    
    // 3. 计算发送延迟
    const delay = this.calculateDelay(bot, context);
    
    // 4. 评估情感
    const sentiment = this.analyzeSentiment(content);
    
    return {
      content,
      type,
      sentiment,
      delay
    };
  }
  
  /**
   * 计算发送延迟（模拟真实用户）
   */
  private calculateDelay(bot: BotProfile, context: ChatContext): number {
    const baseDelay = bot.avgResponseTime * 60; // 分钟转秒
    
    // 根据对话阶段调整
    const stage = this.getConversationStage(context.messages.length);
    const stageMultiplier = {
      opening: 1.5,      // 开场回复慢一点
      developing: 1.0,   // 发展中正常
      engaging: 0.7,     // 投入后快一点
      closing: 1.2       // 结尾可能冷淡
    };
    
    // 随机波动
    const randomFactor = 0.5 + Math.random();
    
    return Math.round(baseDelay * stageMultiplier[stage] * randomFactor);
  }
  
  /**
   * 生成回复内容
   */
  private generateContent(
    bot: BotProfile,
    type: string,
    context: ChatContext
  ): string {
    const templates = this.responseTemplates[type] || this.responseTemplates.comment;
    
    // 随机选择模板
    let content = templates[Math.floor(Math.random() * templates.length)];
    
    // 根据bot特征个性化
    if (bot.interests?.length) {
      const randomInterest = bot.interests[Math.floor(Math.random() * bot.interests.length)];
      content = content.replace('{interest}', randomInterest);
    }
    
    return content;
  }
}
```

---

## 5. 头像生成策略

### 5.1 方案对比

| 方案 | 优点 | 缺点 | 成本 | 推荐场景 |
|------|------|------|------|----------|
| **AI生成** | 高质量、多样化、可控 | 需API调用、有版权风险 | $0.01-0.05/张 | 首选方案 |
| **Stock照片** | 免费、即用 | 可能被识别、缺乏多样性 | $0 | 备用 |
| **AI Avatar工具** | 逼真、专业感 | 成本较高 | $0.10-0.50/张 | 高端用户 |
| **手绘/卡通** | 友好、隐私保护 | 缺乏真实感 | $0-5/张 | 女性可选 |

### 5.2 推荐方案：AI头像管道

```typescript
// ============================================================
// AI Avatar Generation Pipeline
// ============================================================

type AvatarStyle = 'professional' | 'casual' | 'artistic' | 'natural';
type Ethnicity = 'caucasian' | 'african' | 'asian' | 'hispanic' | 'south_asian';

interface AvatarConfig {
  style: AvatarStyle;
  ethnicity: Ethnicity;
  age: number;
  gender: 'male' | 'female';
  mood: 'happy' | 'friendly' | 'serious' | 'playful';
}

class BotAvatarGenerator {
  
  // 可用的AI头像生成服务
  private services = {
    thispersondoesnotexist: 'https://thispersondoesnotexist.com/image',
    randomuser: 'https://randomuser.me/api/portraits',
   UI avatars: 'https://ui-avatars.com/api'
  };
  
  /**
   * 策略1：This Person Does Not Exist (推荐)
   * - 优点：完全AI生成，无法被反向搜索
   * - 限制：需要处理NSFW过滤
   */
  async generateFromTPDNE(
    config: AvatarConfig
  ): Promise<string> {
    const seed = this.hashConfig(config);
    
    try {
      // 生成随机种子URL
      const imageUrl = `${this.services.thispersondoesnotexist}?t=${seed}`;
      
      // 下载并验证
      const imageBuffer = await this.downloadImage(imageUrl);
      const isValid = await this.validateImage(imageBuffer);
      
      if (isValid) {
        // 上传到我们的存储
        return await this.uploadToStorage(imageBuffer, `bot_${seed}.jpg`);
      }
      
      // 失败则回退到其他方案
      return await this.generateFromRandomUser(config);
    } catch {
      return await this.generateFromRandomUser(config);
    }
  }
  
  /**
   * 策略2：RandomUser.me API
   * - 优点：完全免费、多样化
   * - 缺点：可能被识别为stock照片
   */
  async generateFromRandomUser(
    config: AvatarConfig
  ): Promise<string> {
    const gender = config.gender === 'male' ? 'men' : 'women';
    const ethnicityMap = {
      caucasian: 'us',
      african: 'za',
      asian: 'jp',
      hispanic: 'mx',
      south_asian: 'in'
    };
    
    const nationality = ethnicityMap[config.ethnicity] || 'us';
    
    // 随机选择1-99的头像编号
    const imgId = Math.floor(Math.random() * 99) + 1;
    
    return `https://randomuser.me/api/portraits/${gender}/${imgId}.jpg`;
  }
  
  /**
   * 策略3：UI Avatars（最后备选）
   * - 优点：永不失败、基于名字生成
   * - 缺点：非真实照片
   */
  generateFromUIAvatars(name: string): string {
    const encodedName = encodeURIComponent(name);
    return `https://ui-avatars.com/api/?name=${encodedName}&size=200&background=random&color=fff`;
  }
  
  /**
   * 批量生成头像
   */
  async batchGenerate(
    bots: BotProfile[],
    options: { parallel: number; retryFailed: boolean }
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const failed: BotProfile[] = [];
    
    // 并行控制
    const chunks = this.chunk(bots, options.parallel);
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (bot) => {
        try {
          const config: AvatarConfig = {
            style: bot.avatarStyle as AvatarStyle || 'natural',
            ethnicity: this.mapEthnicity(bot.ethnicity),
            age: bot.profile.age,
            gender: bot.profile.gender === 'MALE' ? 'male' : 'female',
            mood: 'friendly'
          };
          
          const avatarUrl = await this.generateAvatar(config);
          results.set(bot.id, avatarUrl);
        } catch (error) {
          failed.push(bot);
        }
      });
      
      await Promise.all(promises);
    }
    
    // 重试失败项
    if (options.retryFailed && failed.length > 0) {
      for (const bot of failed) {
        const avatarUrl = this.generateFromUIAvatars(bot.profile.displayName);
        results.set(bot.id, avatarUrl);
      }
    }
    
    return results;
  }
  
  /**
   * 图片验证
   */
  private async validateImage(buffer: Buffer): Promise<boolean> {
    // 1. 检查文件类型
    const fileType = await detectFileType(buffer);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(fileType)) {
      return false;
    }
    
    // 2. 检查文件大小 (50KB - 5MB)
    const sizeKB = buffer.length / 1024;
    if (sizeKB < 50 || sizeKB > 5000) {
      return false;
    }
    
    // 3. 可选：使用AI进行NSFW检测
    // const isNSFW = await this.checkNSFW(buffer);
    // if (isNSFW) return false;
    
    return true;
  }
}
```

### 5.3 头像管理表

```prisma
// 添加到 schema.prisma

model BotAvatar {
  id          String   @id @default(cuid())
  botId       String   @unique
  originalUrl String?
  processedUrl String? // 处理后（压缩、优化）的URL
  
  style       String   // 原始风格
  ethnicity   String   // 原始种族标签
  
  status      String   @default("pending") // pending, active, failed, retired
  useCount    Int      @default(0)    // 使用次数
  
  generatedAt DateTime @default(now())
  lastUsedAt DateTime?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

## 6. 实现路线图

### Phase 1: 数据模型部署 (Day 1-2)

| 任务 | 负责人 | 预计时间 |
|------|--------|----------|
| 创建迁移文件 | bot-architect | 2h |
| 添加新枚举类型 | bot-architect | 1h |
| 验证迁移执行 | dev-ops | 1h |
| 创建BotProfile | ml-engineer | 2h |
| 导入2,271名bot用户数据 | data-ops | 3h |

### Phase 2: 头像生成 (Day 3-4)

| 任务 | 负责人 | 预计时间 |
|------|--------|----------|
| 实现AvatarGenerator | avatar-engineer | 4h |
| 批量生成头像 | avatar-engineer | 2h |
| 头像质量审核 | human-reviewer | 2h |
| 上传到存储并更新DB | dev-ops | 2h |

### Phase 3: 行为模拟引擎 (Day 5-7)

| 任务 | 负责人 | 预计时间 |
|------|--------|----------|
| 实现OnlineStatus计算 | behavior-engineer | 3h |
| 实现MatchReactionEngine | behavior-engineer | 4h |
| 实现BotChatSimulator | behavior-engineer | 6h |
| 集成到Matching Engine | ml-engineer | 4h |
| 端到端测试 | qa | 4h |

### Phase 4: 自学习系统 (Day 8-10)

| 任务 | 负责人 | 预计时间 |
|------|--------|----------|
| 实现PreferenceLearner | ml-engineer | 6h |
| 实现BatchLearningJob | ml-engineer | 4h |
| 配置Cron任务 | dev-ops | 2h |
| 监控仪表板 | ml-engineer | 3h |

### Phase 5: 生产部署 (Day 11-12)

| 任务 | 负责人 | 预计时间 |
|------|--------|----------|
| 灰度发布（10%流量） | dev-ops | 2h |
| 监控关键指标 | ml-engineer | 2h |
| 逐步放大到100% | dev-ops | 2h |
| 性能优化 | dev-ops | 4h |

---

## 7. 附录：伪代码参考

### 7.1 Bot初始化脚本

```typescript
// scripts/initBotUsers.ts

async function initializeBotUsers() {
  console.log('🚀 开始初始化 2,271 名数字用户...');
  
  // 1. 读取已有用户数据
  const existingUsers = await prisma.user.findMany({
    where: { isBot: true },
    include: { profile: true }
  });
  
  console.log(`📊 已有 ${existingUsers.length} 名 bot 用户`);
  
  // 2. 为每个用户创建BotProfile
  const botProfiles = [];
  
  for (const user of existingUsers) {
    const config = generateRandomBotConfig(user.profile);
    
    botProfiles.push({
      profileId: user.profile.id,
      botType: 'SEED',
      activityLevel: weightedRandom(['LOW', 'MEDIUM', 'HIGH'], [0.4, 0.4, 0.2]),
      ethnicity: user.profile.ethnicity || randomEnum(Ethnicity),
      occupation: randomChoice(OCCUPATIONS),
      interests: randomChoices(INTERESTS, 5),
      onlinePattern: weightedRandom(OnlinePattern, [0.1, 0.1, 0.4, 0.2, 0.2]),
      behaviorConfig: JSON.stringify(generateDefaultBehaviorConfig())
    });
  }
  
  // 3. 批量插入
  await prisma.botProfile.createMany({
    data: botProfiles,
    skipDuplicates: true
  });
  
  console.log('✅ Bot用户初始化完成');
}

// 生成随机配置
function generateRandomBotConfig(profile: Profile): BotProfileConfig {
  return {
    interests: randomChoices(INTERESTS, 3 + Math.floor(Math.random() * 5)),
    hobbies: randomChoices(HOBBIES, 2 + Math.floor(Math.random() * 3)),
    musicGenres: randomChoices(MUSIC_GENRES, 1 + Math.floor(Math.random() * 3)),
    movieGenres: randomChoices(MOVIE_GENRES, 1 + Math.floor(Math.random() * 3)),
    preferredAgeMin: Math.max(18, profile.age - 10),
    preferredAgeMax: Math.min(70, profile.age + 10),
    avgResponseTime: 15 + Math.floor(Math.random() * 60), // 15-75分钟
    maxDailyMatches: 2 + Math.floor(Math.random() * 4)
  };
}
```

### 7.2 Cron任务配置

```typescript
// lib/cron/botTasks.ts

export const botCronJobs = {
  // 每小时：更新在线状态
  '0 * * * *': async () => {
    const activeBots = await prisma.botProfile.findMany({
      where: { isActive: true }
    });
    
    const now = new Date();
    
    for (const bot of activeBots) {
      const status = calculateOnlineStatus(bot, now);
      await prisma.botProfile.update({
        where: { id: bot.id },
        data: {
          lastActiveAt: status.isOnline ? now : bot.lastActiveAt
        }
      });
    }
  },
  
  // 每15分钟：处理待响应匹配
  '*/15 * * * *': async () => {
    const pendingMatches = await prisma.match.findMany({
      where: {
        status: 'PENDING',
        receiver: { isBot: true },
        receiverAction: null
      },
      include: {
        receiver: { include: { profile: true } },
        sender: { include: { profile: true } }
      }
    });
    
    for (const match of pendingMatches) {
      // 检查是否超时
      const expectedResponseTime = match.receiver.botProfile.avgResponseTime;
      const minutesSinceCreated = (Date.now() - match.createdAt.getTime()) / 60000;
      
      if (minutesSinceCreated >= expectedResponseTime) {
        const action = await decideReaction(
          match.receiver.id,
          match,
          match.sender.profile
        );
        
        await processBotReaction(match.id, action);
      }
    }
  },
  
  // 每天凌晨2点：批量学习
  '0 2 * * *': async () => {
    await runDailyLearningBatch();
  },
  
  // 每天凌晨3点：清理过期数据
  '0 3 * * *': async () => {
    await prisma.botInteractionLog.deleteMany({
      where: {
        createdAt: { lt: subDays(new Date(), 30) }
      }
    });
  }
};
```

### 7.3 监控指标

```typescript
// lib/metrics/botMetrics.ts

interface BotSystemMetrics {
  // 活跃度
  activeBots: number;
  onlineBots: number;
  offlineBots: number;
  
  // 匹配
  totalBotMatches: number;
  botMatchAcceptRate: number;
  botMatchRejectRate: number;
  
  // 聊天
  botMessagesSent: number;
  botMessagesReceived: number;
  avgBotResponseTime: number;
  
  // 学习
  learningBatchesRun: number;
  avgPreferenceChange: number;
  
  // 健康
  botReportRate: number;
  botUnmatchRate: number;
}

async function collectBotMetrics(): Promise<BotSystemMetrics> {
  const [dayStart, weekStart] = [startOfDay(new Date()), startOfWeek(new Date())];
  
  const [activeBots, botProfiles] = await Promise.all([
    prisma.botProfile.count({ where: { isActive: true } }),
    prisma.botProfile.findMany({ where: { isActive: true } })
  ]);
  
  const [todayMatches, weekMatches, todayInteractions] = await Promise.all([
    prisma.match.count({
      where: {
        OR: [
          { sender: { isBot: true } },
          { receiver: { isBot: true } }
        ],
        createdAt: { gte: dayStart }
      }
    }),
    prisma.match.findMany({
      where: {
        OR: [
          { sender: { isBot: true } },
          { receiver: { isBot: true } }
        ],
        createdAt: { gte: weekStart }
      },
      include: { matchReactions: true }
    }),
    prisma.botInteractionLog.count({
      where: { createdAt: { gte: dayStart } }
    })
  ]);
  
  // 计算接受/拒绝率
  const reactions = weekMatches.flatMap(m => m.matchReactions);
  const botReactions = reactions.filter(r => r.user.isBot);
  const acceptRate = botReactions.filter(r => r.reaction === 'INTERESTED').length / botReactions.length;
  
  return {
    activeBots,
    onlineBots: botProfiles.filter(b => isOnline(b, new Date())).length,
    offlineBots: activeBots - botProfiles.filter(b => isOnline(b, new Date())).length,
    totalBotMatches: todayMatches,
    botMatchAcceptRate: acceptRate,
    botMatchRejectRate: 1 - acceptRate,
    botMessagesSent: todayInteractions,
    botMessagesReceived: todayInteractions * 0.8, // 估算
    avgBotResponseTime: avg(botProfiles.map(b => b.avgResponseTime)),
    learningBatchesRun: 0,
    avgPreferenceChange: 0,
    botReportRate: 0,
    botUnmatchRate: 0
  };
}
```

---

## 变更历史

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|----------|
| 1.0 | 2026-04-12 | bot-architect | 初始版本 |

---

*文档结束*
