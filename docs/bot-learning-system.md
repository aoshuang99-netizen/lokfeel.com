# LokFeel Bot 自学习与进化系统设计文档

**版本**: 1.0  
**日期**: 2026-04-12  
**作者**: ML Engineer  
**状态**: 设计阶段

---

## 1. 系统概述

### 1.1 设计目标

Bot自学习系统旨在让数字用户能够从与真实用户的交互中持续学习，优化匹配效果，提升用户体验。系统采用轻量级ML方案，无需重训练，支持实时反馈更新，并保持决策逻辑的可解释性。

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **轻量级** | 不使用重型深度学习模型，采用在线学习算法 |
| **实时性** | 反馈即时生效，延迟 < 100ms |
| **可解释** | 每个决策都有明确的权重和原因 |
| **隐私优先** | 不存储敏感对话内容，仅使用行为信号 |
| **渐进进化** | 学习率随时间衰减，避免剧烈波动 |

### 1.3 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Bot Learning System                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Feedback   │───▶│   Learning   │───▶│   Profile    │                  │
│  │   Loop       │    │   Engine     │    │   Update     │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│         │                   │                   │                          │
│         ▼                   ▼                   ▼                          │
│  ┌─────────────────────────────────────────────────────┐                  │
│  │              Preference Vector Store                 │                  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │                  │
│  │  │ Explicit │ │ Implicit │ │ Temporal │ │ Social │  │                  │
│  │  │  prefs   │ │  prefs   │ │  prefs   │ │  prefs │  │                  │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │                  │
│  └─────────────────────────────────────────────────────┘                  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────┐                  │
│  │              Collective Intelligence                 │                  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │                  │
│  │  │ Success  │ │  Trend   │ │ Seasonal │            │                  │
│  │  │ Sharing  │ │ Learning │ │ Adjustment│            │                  │
│  │  └──────────┘ └──────────┘ └──────────┘            │                  │
│  └─────────────────────────────────────────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 反馈循环设计

### 2.1 反馈类型与信号

#### 2.1.1 匹配接受率反馈 (Match Acceptance Feedback)

| 信号 | 权重 | 说明 |
|------|------|------|
| `INTERESTED` | +1.0 | 用户明确表达兴趣 |
| `PASS` | -0.5 | 用户拒绝匹配 |
| `MAYBE` | +0.3 | 用户持观望态度 |
| `BLOCK` | -1.0 | 用户屏蔽对方 |
| 超时无响应 | -0.2 | 7天内无动作 |

**信号处理流程**:

```typescript
interface MatchFeedback {
  botId: string;
  userId: string;
  matchId: string;
  action: MatchAction;
  timestamp: Date;
  context: {
    matchScore: number;
    userProfile: UserProfileSnapshot;
    botProfile: BotProfileSnapshot;
  };
}

function calculateMatchAcceptanceSignal(feedback: MatchFeedback): number {
  const actionWeights: Record<MatchAction, number> = {
    INTERESTED: 1.0,
    MAYBE: 0.3,
    PASS: -0.5,
    BLOCK: -1.0,
  };
  
  let signal = actionWeights[feedback.action] ?? 0;
  
  // 基于匹配分数调整信号强度
  // 高匹配分数下的拒绝信号更强
  if (feedback.action === 'PASS' && feedback.context.matchScore > 80) {
    signal *= 1.5; // 强负面信号
  }
  
  // 低匹配分数下的接受信号更强
  if (feedback.action === 'INTERESTED' && feedback.context.matchScore < 60) {
    signal *= 1.3; // 强正面信号 - Bot超越了预期
  }
  
  return signal;
}
```

#### 2.1.2 聊天响应率反馈 (Chat Response Feedback)

| 指标 | 计算方式 | 说明 |
|------|----------|------|
| 响应率 | 用户回复次数 / Bot消息数 | 衡量对话吸引力 |
| 平均响应时间 | 用户首次回复耗时 | 衡量初始吸引力 |
| 对话深度 | 消息轮数 | 衡量对话质量 |
| 对话持续时间 | 最后消息 - 首消息 | 衡量长期兴趣 |
| 用户主动发起 | 用户首条消息占比 | 衡量用户主动性 |

**聊天质量评分算法**:

```typescript
interface ChatFeedback {
  botId: string;
  userId: string;
  chatRoomId: string;
  metrics: {
    botMessageCount: number;
    userMessageCount: number;
    userFirstResponseTime: number; // seconds
    totalDuration: number; // seconds
    userInitiated: boolean;
  };
}

function calculateChatQualityScore(feedback: ChatFeedback): number {
  const { metrics } = feedback;
  
  // 响应率 (0-1)
  const responseRate = Math.min(1, metrics.userMessageCount / Math.max(1, metrics.botMessageCount));
  
  // 响应时间评分 (越快越好，指数衰减)
  const responseTimeScore = Math.exp(-metrics.userFirstResponseTime / 3600); // 1小时衰减
  
  // 对话深度评分 (轮数越多越好，但有上限)
  const depthScore = Math.min(1, metrics.userMessageCount / 10);
  
  // 持续时间评分 (持续越久越好)
  const durationScore = Math.min(1, metrics.totalDuration / (7 * 24 * 3600)); // 1周上限
  
  // 主动性奖励
  const initiativeBonus = metrics.userInitiated ? 0.2 : 0;
  
  // 加权综合
  const score = 
    responseRate * 0.35 +
    responseTimeScore * 0.20 +
    depthScore * 0.25 +
    durationScore * 0.15 +
    initiativeBonus;
  
  return Math.min(1, Math.max(-1, score));
}
```

#### 2.1.3 用户评分反馈 (User Rating Feedback)

```typescript
interface UserRatingFeedback {
  botId: string;
  userId: string;
  rating: number; // 1-5 stars
  category: 'personality' | 'conversation' | 'authenticity' | 'overall';
  tags: string[]; // 用户选择的标签
  comment?: string; // 可选文字评论
}

function calculateRatingSignal(feedback: UserRatingFeedback): number {
  // 将1-5评分映射到-1到+1
  const normalizedRating = (feedback.rating - 3) / 2;
  
  // 类别权重
  const categoryWeights: Record<string, number> = {
    personality: 1.2,
    conversation: 1.0,
    authenticity: 1.5,
    overall: 1.0,
  };
  
  const weight = categoryWeights[feedback.category] ?? 1.0;
  
  // 标签情感分析
  const positiveTags = ['funny', 'kind', 'interesting', 'genuine', 'smart'];
  const negativeTags = ['boring', 'rude', 'fake', 'aggressive'];
  
  let tagScore = 0;
  feedback.tags.forEach(tag => {
    if (positiveTags.includes(tag)) tagScore += 0.1;
    if (negativeTags.includes(tag)) tagScore -= 0.1;
  });
  
  return normalizedRating * weight + tagScore;
}
```

### 2.2 反馈聚合与衰减

#### 2.2.1 时间衰减函数

```typescript
/**
 * 指数时间衰减 - 近期反馈权重更高
 * @param ageHours 反馈距今小时数
 * @param halfLife 半衰期（小时）
 */
function timeDecay(ageHours: number, halfLife: number = 168): number {
  return Math.exp(-ageHours * Math.log(2) / halfLife);
}

// 使用示例：
// - 1周内的反馈: 权重 1.0
// - 2周前的反馈: 权重 0.5
// - 4周前的反馈: 权重 0.25
```

#### 2.2.2 反馈聚合算法

```typescript
interface AggregatedFeedback {
  botId: string;
  dimension: FeedbackDimension;
  weightedSum: number;
  totalWeight: number;
  count: number;
  lastUpdated: Date;
}

type FeedbackDimension = 
  | 'match_acceptance' 
  | 'chat_quality' 
  | 'user_rating' 
  | 'combined';

function aggregateFeedback(
  feedbacks: MatchFeedback[],
  dimension: FeedbackDimension
): AggregatedFeedback {
  let weightedSum = 0;
  let totalWeight = 0;
  
  const now = Date.now();
  
  feedbacks.forEach(feedback => {
    const ageHours = (now - feedback.timestamp.getTime()) / (1000 * 3600);
    const timeWeight = timeDecay(ageHours);
    
    const signal = calculateMatchAcceptanceSignal(feedback);
    
    weightedSum += signal * timeWeight;
    totalWeight += timeWeight;
  });
  
  return {
    botId: feedbacks[0]?.botId,
    dimension,
    weightedSum,
    totalWeight,
    count: feedbacks.length,
    lastUpdated: new Date(),
  };
}
```

### 2.3 反馈数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                     Feedback Data Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Action                                                    │
│      │                                                          │
│      ▼                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Event     │───▶│   Signal    │───▶│   Queue     │         │
│  │   Capture   │    │   Compute   │    │   (Redis)   │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                               │                 │
│                                               ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Profile   │◀───│   Learning  │◀───│   Batch     │         │
│  │   Update    │    │   Engine    │    │   Process   │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                               │                 │
│                                               ▼                 │
│                                        ┌─────────────┐         │
│                                        │   Model     │         │
│                                        │   Update    │         │
│                                        └─────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 偏好学习算法

### 3.1 用户画像向量表示

每个Bot维护一个偏好向量，表示其对不同用户特征的偏好程度。

```typescript
interface BotPreferenceVector {
  botId: string;
  version: number;
  updatedAt: Date;
  
  // 显式偏好 (来自用户设置)
  explicit: {
    ageRange: { min: number; max: number; weight: number };
    genderPreference: Record<string, number>;
    locationPreference: Record<string, number>;
    relationshipGoal: Record<string, number>;
  };
  
  // 隐式偏好 (从交互中学习)
  implicit: {
    // 依恋风格偏好 (-1 to 1)
    attachmentStyle: {
      secure: number;
      anxious: number;
      avoidant: number;
      disorganized: number;
    };
    
    // 沟通风格偏好
    communicationStyle: {
      direct: number;
      indirect: number;
      analytical: number;
      emotional: number;
    };
    
    // 冲突解决偏好
    conflictResolution: {
      collaborative: number;
      compromising: number;
      accommodating: number;
      competing: number;
    };
    
    // 爱的语言偏好
    loveLanguage: {
      words_of_affirmation: number;
      acts_of_service: number;
      receiving_gifts: number;
      quality_time: number;
      physical_touch: number;
    };
    
    // 生活优先级偏好
    lifePriorities: Record<string, number>;
    
    // 情感可用性偏好
    emotionalAvailability: {
      fully_available: number;
      building_trust: number;
      processing_past: number;
      needs_space: number;
    };
  };
  
  // 学习状态
  learning: {
    totalInteractions: number;
    positiveInteractions: number;
    negativeInteractions: number;
    confidenceScore: number; // 0-1, 表示学习成熟度
  };
}
```

### 3.2 协同过滤偏好学习

基于相似Bot的成功匹配模式进行推荐。

```typescript
interface CollaborativeFilterModel {
  // Bot-用户交互矩阵 (稀疏存储)
  interactions: Map<string, Map<string, number>>; // botId -> userId -> score
  
  // Bot相似度缓存
  botSimilarities: Map<string, Map<string, number>>;
  
  // 用户特征索引
  userFeatures: Map<string, UserFeatureVector>;
}

/**
 * 基于用户的协同过滤 - 找到与当前Bot相似的Bot
 */
function findSimilarBots(
  botId: string,
  model: CollaborativeFilterModel,
  k: number = 10
): Array<{ botId: string; similarity: number }> {
  const botInteractions = model.interactions.get(botId);
  if (!botInteractions) return [];
  
  const similarities: Array<{ botId: string; similarity: number }> = [];
  
  model.interactions.forEach((otherInteractions, otherBotId) => {
    if (otherBotId === botId) return;
    
    // 计算余弦相似度
    const similarity = calculateCosineSimilarity(
      botInteractions,
      otherInteractions
    );
    
    if (similarity > 0.3) { // 阈值过滤
      similarities.push({ botId: otherBotId, similarity });
    }
  });
  
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/**
 * 基于协同过滤的推荐
 */
function collaborativeRecommendations(
  botId: string,
  candidateUsers: UserProfile[],
  model: CollaborativeFilterModel,
  topN: number = 5
): Array<{ userId: string; score: number; reason: string }> {
  const similarBots = findSimilarBots(botId, model, 10);
  const scores = new Map<string, number>();
  
  candidateUsers.forEach(user => {
    let weightedSum = 0;
    let totalWeight = 0;
    
    similarBots.forEach(({ botId: similarBotId, similarity }) => {
      const similarBotInteractions = model.interactions.get(similarBotId);
      const interactionScore = similarBotInteractions?.get(user.id) ?? 0;
      
      weightedSum += interactionScore * similarity;
      totalWeight += similarity;
    });
    
    if (totalWeight > 0) {
      scores.set(user.id, weightedSum / totalWeight);
    }
  });
  
  return Array.from(scores.entries())
    .map(([userId, score]) => ({
      userId,
      score,
      reason: `Recommended based on similar bots' success`,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/**
 * 余弦相似度计算
 */
function calculateCosineSimilarity(
  vectorA: Map<string, number>,
  vectorB: Map<string, number>
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  vectorA.forEach((valueA, key) => {
    const valueB = vectorB.get(key) ?? 0;
    dotProduct += valueA * valueB;
    normA += valueA * valueA;
  });
  
  vectorB.forEach(valueB => {
    normB += valueB * valueB;
  });
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 3.3 强化学习匹配策略优化

使用多臂老虎机(MAB)算法优化匹配策略选择。

```typescript
/**
 * 上下文多臂老虎机 (Contextual Bandit)
 * 用于动态选择匹配策略参数
 */
interface ContextualBandit {
  // 臂的定义 - 不同的匹配策略变体
  arms: Array<{
    id: string;
    name: string;
    params: MatchingStrategyParams;
  }>;
  
  // 每个臂的奖励历史
  armStats: Map<string, {
    pulls: number;
    rewards: number[];
    averageReward: number;
    upperConfidenceBound: number;
  }>;
  
  // 上下文特征权重
  contextWeights: Map<string, number[]>;
}

/**
 * UCB1算法选择臂
 */
function selectArmUCB1(bandit: ContextualBandit): string {
  const totalPulls = Array.from(bandit.armStats.values())
    .reduce((sum, stat) => sum + stat.pulls, 0);
  
  let bestArm = bandit.arms[0].id;
  let bestUCB = -Infinity;
  
  bandit.arms.forEach(arm => {
    const stats = bandit.armStats.get(arm.id);
    if (!stats || stats.pulls === 0) {
      // 未探索的臂优先
      return arm.id;
    }
    
    // UCB1公式: average + sqrt(2 * ln(total) / pulls)
    const ucb = stats.averageReward + 
      Math.sqrt(2 * Math.log(totalPulls) / stats.pulls);
    
    if (ucb > bestUCB) {
      bestUCB = ucb;
      bestArm = arm.id;
    }
  });
  
  return bestArm;
}

/**
 * Thompson采样 (Beta分布)
 * 更适合二值奖励场景
 */
function selectArmThompson(bandit: ContextualBandit): string {
  let bestArm = bandit.arms[0].id;
  let bestSample = -1;
  
  bandit.arms.forEach(arm => {
    const stats = bandit.armStats.get(arm.id);
    if (!stats) return;
    
    // Beta分布采样
    // alpha = successes + 1, beta = failures + 1
    const successes = stats.rewards.filter(r => r > 0.5).length;
    const failures = stats.rewards.filter(r => r <= 0.5).length;
    
    const sample = betaRandom(successes + 1, failures + 1);
    
    if (sample > bestSample) {
      bestSample = sample;
      bestArm = arm.id;
    }
  });
  
  return bestArm;
}

/**
 * 更新臂的统计信息
 */
function updateArmReward(
  bandit: ContextualBandit,
  armId: string,
  reward: number
): void {
  const stats = bandit.armStats.get(armId);
  if (!stats) return;
  
  stats.pulls++;
  stats.rewards.push(reward);
  
  // 增量更新平均值
  stats.averageReward = 
    (stats.averageReward * (stats.pulls - 1) + reward) / stats.pulls;
  
  // 限制历史长度
  if (stats.rewards.length > 100) {
    stats.rewards = stats.rewards.slice(-100);
  }
}

/**
 * Beta分布随机采样
 */
function betaRandom(alpha: number, beta: number): number {
  // 使用Gamma分布近似
  const x = gammaRandom(alpha, 1);
  const y = gammaRandom(beta, 1);
  return x / (x + y);
}

function gammaRandom(shape: number, scale: number): number {
  // Marsaglia-Tsang方法
  if (shape < 1) {
    return gammaRandom(1 + shape, scale) * Math.pow(Math.random(), 1 / shape);
  }
  
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  
  while (true) {
    let x = normalRandom();
    let v = Math.pow(1 + c * x, 3);
    
    if (v > 0) {
      let u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) {
        return d * v * scale;
      }
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v * scale;
      }
    }
  }
}

function normalRandom(): number {
  // Box-Muller变换
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
```

### 3.4 用户画像动态更新

```typescript
interface ProfileUpdateRule {
  feature: string;
  learningRate: number; // 学习率
  minValue: number;
  maxValue: number;
  decayFactor: number; // 遗忘因子
}

const PROFILE_UPDATE_RULES: ProfileUpdateRule[] = [
  { feature: 'attachmentStyle', learningRate: 0.05, minValue: -1, maxValue: 1, decayFactor: 0.99 },
  { feature: 'communicationStyle', learningRate: 0.05, minValue: -1, maxValue: 1, decayFactor: 0.99 },
  { feature: 'conflictResolution', learningRate: 0.05, minValue: -1, maxValue: 1, decayFactor: 0.99 },
  { feature: 'loveLanguage', learningRate: 0.03, minValue: -1, maxValue: 1, decayFactor: 0.995 },
  { feature: 'lifePriorities', learningRate: 0.04, minValue: -1, maxValue: 1, decayFactor: 0.99 },
];

/**
 * 基于反馈更新Bot偏好向量
 */
function updateBotPreferences(
  botPrefs: BotPreferenceVector,
  feedback: AggregatedFeedback,
  successfulUserFeatures: UserFeatureVector,
  failedUserFeatures: UserFeatureVector
): BotPreferenceVector {
  const updated = { ...botPrefs };
  
  PROFILE_UPDATE_RULES.forEach(rule => {
    const feature = rule.feature as keyof typeof botPrefs.implicit;
    const currentValues = botPrefs.implicit[feature] as Record<string, number>;
    
    // 正向强化 - 成功匹配的特征
    Object.entries(successfulUserFeatures[feature] || {}).forEach(([key, value]) => {
      if (currentValues[key] !== undefined) {
        const gradient = value * feedback.weightedSum * rule.learningRate;
        currentValues[key] = clamp(
          currentValues[key] + gradient,
          rule.minValue,
          rule.maxValue
        );
      }
    });
    
    // 负向强化 - 失败匹配的特征
    Object.entries(failedUserFeatures[feature] || {}).forEach(([key, value]) => {
      if (currentValues[key] !== undefined) {
        const gradient = -value * Math.abs(feedback.weightedSum) * rule.learningRate * 0.5;
        currentValues[key] = clamp(
          currentValues[key] + gradient,
          rule.minValue,
          rule.maxValue
        );
      }
    });
    
    // 应用遗忘因子 (所有值向0衰减)
    Object.keys(currentValues).forEach(key => {
      currentValues[key] *= rule.decayFactor;
    });
  });
  
  // 更新学习状态
  updated.learning.totalInteractions++;
  if (feedback.weightedSum > 0) {
    updated.learning.positiveInteractions++;
  } else {
    updated.learning.negativeInteractions++;
  }
  
  // 置信度计算 - 基于交互数量
  updated.learning.confidenceScore = Math.min(
    1,
    updated.learning.totalInteractions / 100
  );
  
  updated.version++;
  updated.updatedAt = new Date();
  
  return updated;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
```

---

## 4. 群体智慧机制

### 4.1 Bot间匹配成功率共享

```typescript
interface CollectiveIntelligenceStore {
  // 全局成功率统计
  globalStats: {
    totalMatches: number;
    successfulMatches: number;
    averageAcceptanceRate: number;
    lastUpdated: Date;
  };
  
  // 特征组合成功率
  featureCombinationStats: Map<string, {
    attempts: number;
    successes: number;
    score: number;
  }>;
  
  // 热门趋势
  trendingPreferences: Array<{
    feature: string;
    value: string;
    trend: 'rising' | 'falling' | 'stable';
    confidence: number;
  }>;
}

/**
 * 特征组合键生成
 */
function generateFeatureKey(features: Record<string, string>): string {
  const sorted = Object.entries(features).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}:${v}`).join('|');
}

/**
 * 更新群体智慧数据
 */
function updateCollectiveIntelligence(
  store: CollectiveIntelligenceStore,
  matchResult: {
    botFeatures: Record<string, string>;
    userFeatures: Record<string, string>;
    success: boolean;
  }
): void {
  // 生成特征组合键
  const featureKey = generateFeatureKey({
    ...matchResult.botFeatures,
    ...matchResult.userFeatures,
  });
  
  // 更新统计
  let stats = store.featureCombinationStats.get(featureKey);
  if (!stats) {
    stats = { attempts: 0, successes: 0, score: 0 };
    store.featureCombinationStats.set(featureKey, stats);
  }
  
  stats.attempts++;
  if (matchResult.success) {
    stats.successes++;
  }
  stats.score = stats.successes / stats.attempts;
  
  // 更新全局统计
  store.globalStats.totalMatches++;
  if (matchResult.success) {
    store.globalStats.successfulMatches++;
  }
  store.globalStats.averageAcceptanceRate = 
    store.globalStats.successfulMatches / store.globalStats.totalMatches;
  store.globalStats.lastUpdated = new Date();
}

/**
 * 获取特征组合成功率
 */
function getFeatureCombinationScore(
  store: CollectiveIntelligenceStore,
  botFeatures: Record<string, string>,
  userFeatures: Record<string, string>
): number {
  const featureKey = generateFeatureKey({ ...botFeatures, ...userFeatures });
  const stats = store.featureCombinationStats.get(featureKey);
  
  if (!stats || stats.attempts < 5) {
    // 数据不足，返回全局平均值
    return store.globalStats.averageAcceptanceRate;
  }
  
  return stats.score;
}
```

### 4.2 热门偏好趋势学习

```typescript
interface TrendAnalyzer {
  // 时间窗口数据
  windows: Array<{
    startTime: Date;
    endTime: Date;
    preferenceDistribution: Map<string, Map<string, number>>;
  }>;
  
  // 检测到的趋势
  detectedTrends: Array<{
    feature: string;
    value: string;
    direction: 'increasing' | 'decreasing';
    magnitude: number;
    startTime: Date;
  }>;
}

/**
 * 检测偏好趋势
 */
function detectTrends(analyzer: TrendAnalyzer): void {
  if (analyzer.windows.length < 2) return;
  
  const currentWindow = analyzer.windows[analyzer.windows.length - 1];
  const previousWindow = analyzer.windows[analyzer.windows.length - 2];
  
  currentWindow.preferenceDistribution.forEach((currentDist, feature) => {
    const previousDist = previousWindow.preferenceDistribution.get(feature);
    if (!previousDist) return;
    
    currentDist.forEach((currentCount, value) => {
      const previousCount = previousDist.get(value) ?? 0;
      
      // 计算变化率
      const changeRate = previousCount > 0 
        ? (currentCount - previousCount) / previousCount 
        : 0;
      
      // 显著变化阈值
      if (Math.abs(changeRate) > 0.2) {
        analyzer.detectedTrends.push({
          feature,
          value,
          direction: changeRate > 0 ? 'increasing' : 'decreasing',
          magnitude: Math.abs(changeRate),
          startTime: currentWindow.startTime,
        });
      }
    });
  });
  
  // 只保留最近30天的趋势
  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  analyzer.detectedTrends = analyzer.detectedTrends.filter(
    t => t.startTime > cutoffDate
  );
}

/**
 * 应用趋势调整
 */
function applyTrendAdjustment(
  botPrefs: BotPreferenceVector,
  trends: TrendAnalyzer['detectedTrends']
): BotPreferenceVector {
  const updated = { ...botPrefs };
  
  trends.forEach(trend => {
    const feature = trend.feature as keyof typeof updated.implicit;
    const featureValues = updated.implicit[feature] as Record<string, number>;
    
    if (featureValues && featureValues[trend.value] !== undefined) {
      const adjustment = trend.direction === 'increasing' ? 0.1 : -0.1;
      featureValues[trend.value] = clamp(
        featureValues[trend.value] + adjustment * trend.magnitude,
        -1,
        1
      );
    }
  });
  
  return updated;
}
```

### 4.3 季节性/趋势性偏好调整

```typescript
interface SeasonalAdjustment {
  // 季节性模式 (基于历史数据)
  seasonalPatterns: Map<string, Array<{
    month: number; // 1-12
    averagePreference: number;
    stdDev: number;
  }>>;
  
  // 当前季节调整因子
  currentAdjustments: Map<string, number>;
}

/**
 * 计算季节性调整
 */
function calculateSeasonalAdjustment(
  seasonal: SeasonalAdjustment,
  feature: string,
  currentMonth: number
): number {
  const pattern = seasonal.seasonalPatterns.get(feature);
  if (!pattern) return 1.0;
  
  const current = pattern.find(p => p.month === currentMonth);
  const yearly = pattern.reduce((sum, p) => sum + p.averagePreference, 0) / 12;
  
  if (!current || yearly === 0) return 1.0;
  
  // 返回相对于年均值的调整因子
  return current.averagePreference / yearly;
}

/**
 * 季节性偏好调整示例
 * 
 * 1月: 新年决心效应 - 对"长期关系"偏好上升
 * 2月: 情人节效应 - 对"情感可用性"偏好上升
 * 6-8月: 夏季 - 对"冒险"类型偏好上升
 * 11-12月: 假日季 - 对"家庭导向"偏好上升
 */
const SEASONAL_PATTERNS: Record<string, Record<number, number>> = {
  'relationshipGoal.long_term': {
    1: 1.3, // 新年决心
    2: 1.2, // 情人节
    12: 1.1, // 年末反思
  },
  'emotionalAvailability.fully_available': {
    2: 1.25, // 情人节
    5: 1.15, // 春季恋爱
  },
  'lifePriorities.adventure': {
    6: 1.2, 7: 1.3, 8: 1.2, // 夏季
  },
  'lifePriorities.family': {
    11: 1.2, 12: 1.25, // 假日季
  },
};
```

---

## 5. A/B测试框架

### 5.1 测试配置模型

```typescript
interface ABTestConfig {
  testId: string;
  name: string;
  description: string;
  
  // 测试参数
  variants: Array<{
    id: string;
    name: string;
    config: BotBehaviorConfig;
    trafficAllocation: number; // 0-1
  }>;
  
  // 目标指标
  goals: Array<{
    metric: string;
    target: number;
    direction: 'increase' | 'decrease';
  }>;
  
  // 测试设置
  settings: {
    startDate: Date;
    endDate?: Date;
    minSampleSize: number;
    confidenceLevel: number; // 0.95 = 95%
  };
  
  // 状态
  status: 'draft' | 'running' | 'paused' | 'completed';
}

interface BotBehaviorConfig {
  // 匹配策略参数
  matchingStrategy: {
    explorationRate: number; // 探索vs利用比例
    minCompatibilityScore: number;
    maxDailyMatches: number;
  };
  
  // 聊天行为参数
  chatBehavior: {
    responseDelay: { min: number; max: number }; // seconds
    messageLength: { min: number; max: number };
    emojiUsage: number; // 0-1
    questionFrequency: number; // 问题占比
  };
  
  // 个性化参数
  personalization: {
    useLearnedPreferences: boolean;
    useCollectiveIntelligence: boolean;
    useSeasonalAdjustment: boolean;
  };
}
```

### 5.2 测试分配与追踪

```typescript
interface ABTestAssignment {
  testId: string;
  botId: string;
  variantId: string;
  assignedAt: Date;
  // 一致性哈希确保同一Bot始终分配到同一变体
  consistencyHash: string;
}

/**
 * 分配Bot到测试变体
 */
function assignBotToVariant(
  botId: string,
  test: ABTestConfig
): string {
  // 使用一致性哈希确保分配稳定性
  const hash = hashString(`${test.testId}:${botId}`);
  const normalizedHash = hash / 0xFFFFFFFF;
  
  let cumulativeAllocation = 0;
  for (const variant of test.variants) {
    cumulativeAllocation += variant.trafficAllocation;
    if (normalizedHash <= cumulativeAllocation) {
      return variant.id;
    }
  }
  
  return test.variants[test.variants.length - 1].id;
}

/**
 * 简单的字符串哈希函数
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
```

### 5.3 统计显著性检验

```typescript
interface ABTestResults {
  testId: string;
  variantResults: Array<{
    variantId: string;
    sampleSize: number;
    metrics: Record<string, {
      mean: number;
      stdDev: number;
      confidenceInterval: [number, number];
    }>;
  }>;
  
  // 统计检验结果
  statisticalTests: Array<{
    metric: string;
    baselineVariant: string;
    treatmentVariant: string;
    pValue: number;
    isSignificant: boolean;
    effectSize: number;
  }>;
}

/**
 * 双样本t检验
 */
function twoSampleTTest(
  sample1: number[],
  sample2: number[]
): { tStatistic: number; pValue: number; degreesOfFreedom: number } {
  const n1 = sample1.length;
  const n2 = sample2.length;
  
  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;
  
  const variance1 = sample1.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1);
  const variance2 = sample2.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1);
  
  // 合并方差 (假设方差相等)
  const pooledVariance = ((n1 - 1) * variance1 + (n2 - 1) * variance2) / (n1 + n2 - 2);
  const standardError = Math.sqrt(pooledVariance * (1 / n1 + 1 / n2));
  
  const tStatistic = (mean1 - mean2) / standardError;
  const degreesOfFreedom = n1 + n2 - 2;
  
  // 使用t分布计算p值 (简化版，实际应使用统计库)
  const pValue = approximatePValue(Math.abs(tStatistic), degreesOfFreedom);
  
  return { tStatistic, pValue, degreesOfFreedom };
}

/**
 * 近似p值计算 (简化版)
 */
function approximatePValue(tStatistic: number, df: number): number {
  // 使用正态分布近似 (大样本)
  if (df > 30) {
    // 标准正态分布尾部概率近似
    const z = tStatistic;
    return 2 * (1 - normalCDF(z));
  }
  
  // 小样本使用t分布近似 (简化)
  return Math.exp(-0.717 * tStatistic - 0.416 * tStatistic * tStatistic);
}

function normalCDF(x: number): number {
  // 误差函数近似
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return 0.5 * (1 + sign * y);
}
```

### 5.4 自动参数优化

```typescript
interface AutoOptimizer {
  // 贝叶斯优化配置
  bayesianConfig: {
    explorationIterations: number;
    exploitationIterations: number;
    parameterBounds: Record<string, [number, number]>;
  };
  
  // 当前最佳参数
  bestParams: Record<string, number>;
  bestScore: number;
  
  // 观测历史
  observations: Array<{
    params: Record<string, number>;
    score: number;
    timestamp: Date;
  }>;
}

/**
 * 简单的网格搜索优化
 */
function gridSearchOptimization(
  paramRanges: Record<string, number[]>,
  evaluateFunction: (params: Record<string, number>) => number,
  maxIterations: number = 100
): { bestParams: Record<string, number>; bestScore: number } {
  const paramNames = Object.keys(paramRanges);
  const paramValues = paramNames.map(name => paramRanges[name]);
  
  let bestParams: Record<string, number> = {};
  let bestScore = -Infinity;
  
  // 生成所有组合 (对于小参数空间)
  function* generateCombinations(
    arrays: number[][],
    current: number[] = [],
    index: number = 0
  ): Generator<number[]> {
    if (index === arrays.length) {
      yield current;
      return;
    }
    
    for (const value of arrays[index]) {
      yield* generateCombinations(arrays, [...current, value], index + 1);
    }
  }
  
  let iteration = 0;
  for (const combination of generateCombinations(paramValues)) {
    if (iteration >= maxIterations) break;
    
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = combination[i];
    });
    
    const score = evaluateFunction(params);
    
    if (score > bestScore) {
      bestScore = score;
      bestParams = { ...params };
    }
    
    iteration++;
  }
  
  return { bestParams, bestScore };
}
```

---

## 6. 与现有匹配引擎集成

### 6.1 集成架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Matching Engine Integration                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Existing Matching Engine                    │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │Attachment│ │Communication│ │ Conflict │ │ Values   │   │   │
│  │  │  25%     │ │    20%      │ │  20%     │ │  20%     │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │   │
│  │  ┌──────────┐ ┌──────────┐                             │   │
│  │  │Lifestyle │ │Dealbreaker│                             │   │
│  │  │  15%     │ │  Override │                             │   │
│  │  └──────────┘ └──────────┘                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Learning Layer Enhancement                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │Bot Pref  │ │Collab    │ │Collective│ │Seasonal  │   │   │
│  │  │Boost     │ │Filter    │ │Intel     │ │Adjust    │   │   │
│  │  │  ±10%    │ │  ±5%     │ │  ±5%     │ │  ±3%     │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Final Score Calculation                     │   │
│  │  finalScore = baseScore * (1 + learningAdjustment)      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 集成代码实现

```typescript
// lib/matching/enhanced-engine.ts

import { calculateMatchScore, UserProfile, MatchScore } from './engine';
import { BotPreferenceVector, CollectiveIntelligenceStore } from './learning';

interface EnhancedMatchParams {
  userA: UserProfile;
  userB: UserProfile;
  botPrefs?: BotPreferenceVector;
  collectiveIntel?: CollectiveIntelligenceStore;
  abTestVariant?: string;
}

interface EnhancedMatchScore extends MatchScore {
  learningAdjustments: {
    botPreferenceBoost: number;
    collaborativeFilterBoost: number;
    collectiveIntelBoost: number;
    seasonalBoost: number;
  };
  finalScore: number;
}

/**
 * 增强版匹配评分 - 集成学习系统
 */
export function calculateEnhancedMatchScore(
  params: EnhancedMatchParams
): EnhancedMatchScore {
  // 1. 计算基础匹配分数
  const baseScore = calculateMatchScore(params.userA, params.userB);
  
  // 2. 应用学习系统增强
  let learningAdjustment = 0;
  const adjustments = {
    botPreferenceBoost: 0,
    collaborativeFilterBoost: 0,
    collectiveIntelBoost: 0,
    seasonalBoost: 0,
  };
  
  // 2.1 Bot偏好增强
  if (params.botPrefs) {
    adjustments.botPreferenceBoost = calculateBotPreferenceBoost(
      params.botPrefs,
      params.userB
    );
    learningAdjustment += adjustments.botPreferenceBoost;
  }
  
  // 2.2 协同过滤增强
  adjustments.collaborativeFilterBoost = calculateCollaborativeBoost(
    params.userA.id,
    params.userB.id
  );
  learningAdjustment += adjustments.collaborativeFilterBoost;
  
  // 2.3 群体智慧增强
  if (params.collectiveIntel) {
    adjustments.collectiveIntelBoost = calculateCollectiveIntelBoost(
      params.collectiveIntel,
      params.userA,
      params.userB
    );
    learningAdjustment += adjustments.collectiveIntelBoost;
  }
  
  // 2.4 季节性调整
  adjustments.seasonalBoost = calculateSeasonalBoost(
    params.userA,
    params.userB
  );
  learningAdjustment += adjustments.seasonalBoost;
  
  // 3. 计算最终分数 (限制调整幅度在 ±20%)
  const clampedAdjustment = Math.max(-0.2, Math.min(0.2, learningAdjustment));
  const finalScore = Math.round(baseScore.total * (1 + clampedAdjustment));
  
  return {
    ...baseScore,
    total: finalScore,
    learningAdjustments: adjustments,
    finalScore,
  };
}

/**
 * 计算Bot偏好增强
 */
function calculateBotPreferenceBoost(
  botPrefs: BotPreferenceVector,
  targetUser: UserProfile
): number {
  let boost = 0;
  let featureCount = 0;
  
  // 依恋风格匹配
  if (targetUser.attachmentStyle && botPrefs.implicit.attachmentStyle) {
    const pref = botPrefs.implicit.attachmentStyle[targetUser.attachmentStyle.toLowerCase()];
    if (pref !== undefined) {
      boost += pref * 0.05; // 最大 ±0.05
      featureCount++;
    }
  }
  
  // 沟通风格匹配
  if (targetUser.communicationStyle && botPrefs.implicit.communicationStyle) {
    const pref = botPrefs.implicit.communicationStyle[targetUser.communicationStyle.toLowerCase()];
    if (pref !== undefined) {
      boost += pref * 0.04;
      featureCount++;
    }
  }
  
  // 冲突解决风格匹配
  if (targetUser.conflictResolution && botPrefs.implicit.conflictResolution) {
    const pref = botPrefs.implicit.conflictResolution[targetUser.conflictResolution.toLowerCase()];
    if (pref !== undefined) {
      boost += pref * 0.04;
      featureCount++;
    }
  }
  
  // 根据学习置信度调整boost强度
  const confidenceFactor = botPrefs.learning.confidenceScore;
  return boost * confidenceFactor / Math.max(1, featureCount);
}

/**
 * 计算协同过滤增强
 */
function calculateCollaborativeBoost(
  userAId: string,
  userBId: string
): number {
  // 从协同过滤模型获取推荐分数
  // 简化实现，实际应从Redis/DB查询
  const recommendationScore = getCollaborativeFilterScore(userAId, userBId);
  
  // 映射到 ±0.05 范围
  return (recommendationScore - 0.5) * 0.1;
}

function getCollaborativeFilterScore(userAId: string, userBId: string): number {
  // 占位实现 - 实际应从模型查询
  return 0.5;
}

/**
 * 计算群体智慧增强
 */
function calculateCollectiveIntelBoost(
  store: CollectiveIntelligenceStore,
  userA: UserProfile,
  userB: UserProfile
): number {
  const features: Record<string, string> = {};
  
  if (userA.attachmentStyle) features['a_attach'] = userA.attachmentStyle;
  if (userB.attachmentStyle) features['b_attach'] = userB.attachmentStyle;
  if (userA.relationshipGoal) features['a_goal'] = userA.relationshipGoal;
  if (userB.relationshipGoal) features['b_goal'] = userB.relationshipGoal;
  
  const successRate = getFeatureCombinationScore(store, features, {});
  
  // 如果成功率高于全局平均，给予正向boost
  const globalAvg = store.globalStats.averageAcceptanceRate;
  const relativePerformance = (successRate - globalAvg) / globalAvg;
  
  return Math.max(-0.05, Math.min(0.05, relativePerformance * 0.05));
}

/**
 * 计算季节性增强
 */
function calculateSeasonalBoost(
  userA: UserProfile,
  userB: UserProfile
): number {
  const currentMonth = new Date().getMonth() + 1;
  let boost = 0;
  
  // 检查关系目标的季节性模式
  if (userA.relationshipGoal && userB.relationshipGoal) {
    const pattern = SEASONAL_PATTERNS[`relationshipGoal.${userA.relationshipGoal.toLowerCase()}`];
    if (pattern && pattern[currentMonth]) {
      boost += (pattern[currentMonth] - 1) * 0.03;
    }
  }
  
  return boost;
}
```

### 6.3 数据库Schema扩展

```prisma
// 添加到 schema.prisma

// Bot学习偏好向量存储
model BotPreferenceVector {
  id          String   @id @default(cuid())
  botId       String   @unique
  bot         User     @relation(fields: [botId], references: [id], onDelete: Cascade)
  
  version     Int      @default(1)
  
  // 显式偏好 (JSON)
  explicitPrefs   String   @db.Text
  
  // 隐式偏好 (JSON)
  implicitPrefs   String   @db.Text
  
  // 学习状态
  totalInteractions     Int     @default(0)
  positiveInteractions  Int     @default(0)
  negativeInteractions  Int     @default(0)
  confidenceScore       Float   @default(0)
  
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())
  
  @@index([botId])
  @@index([confidenceScore])
}

// Bot反馈历史
model BotFeedback {
  id          String   @id @default(cuid())
  botId       String
  userId      String
  matchId     String?
  
  feedbackType    String   // 'match_acceptance', 'chat_quality', 'user_rating'
  signal          Float    // -1 to 1
  rawData         String   @db.Text // JSON
  
  // 上下文
  matchScore      Float?
  userFeatures    String?  @db.Text // JSON snapshot
  
  createdAt   DateTime @default(now())
  
  @@index([botId, feedbackType, createdAt])
  @@index([userId])
  @@index([createdAt])
}

// A/B测试配置
model ABTest {
  id          String   @id @default(cuid())
  name        String
  description String?
  
  variants    String   @db.Text // JSON
  goals       String   @db.Text // JSON
  settings    String   @db.Text // JSON
  
  status      String   @default("draft") // draft, running, paused, completed
  
  startDate   DateTime?
  endDate     DateTime?
  
  results     String?  @db.Text // JSON - 测试结果
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([status])
  @@index([startDate, endDate])
}

// Bot测试分配
model BotTestAssignment {
  id          String   @id @default(cuid())
  botId       String
  testId      String
  variantId   String
  
  assignedAt  DateTime @default(now())
  
  @@unique([botId, testId])
  @@index([testId, variantId])
}

// 群体智慧统计
model CollectiveIntelligence {
  id          String   @id @default(cuid())
  
  featureKey  String   @unique
  attempts    Int      @default(0)
  successes   Int      @default(0)
  score       Float    @default(0)
  
  updatedAt   DateTime @updatedAt
  
  @@index([score])
}
```

---

## 7. 部署与监控

### 7.1 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Learning System Deployment                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Application Layer                      │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │   │
│  │  │   Feedback  │ │   Learning  │ │   Enhanced  │       │   │
│  │  │   Capture   │ │   Engine    │ │   Matching  │       │   │
│  │  │   API       │ │   API       │ │   API       │       │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Data Layer                            │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │   │
│  │  │   PostgreSQL│ │    Redis    │ │   In-Memory │       │   │
│  │  │   (Prisma)  │ │   (Cache)   │ │   (Models)  │       │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Background Jobs                        │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │   │
│  │  │   Feedback  │ │   Model     │ │   Trend     │       │   │
│  │  │   Aggregation│ │   Update    │ │   Analysis  │       │   │
│  │  │   (Cron)    │ │   (Queue)   │ │   (Daily)   │       │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 关键监控指标

```typescript
interface LearningSystemMetrics {
  // 反馈指标
  feedback: {
    totalFeedbackCount: number;
    feedbackByType: Record<string, number>;
    averageSignalStrength: number;
    feedbackLatency: number; // ms
  };
  
  // 学习指标
  learning: {
    botsWithLearnedPrefs: number;
    averageConfidenceScore: number;
    preferenceUpdateRate: number; // updates/minute
    convergenceRate: number; // bots with confidence > 0.8
  };
  
  // 匹配质量指标
  matching: {
    averageMatchAcceptanceRate: number;
    averageChatQualityScore: number;
    learningBoostImpact: number; // % improvement from learning
  };
  
  // 系统性能指标
  performance: {
    matchCalculationLatency: number; // ms
    feedbackProcessingLatency: number; // ms
    cacheHitRate: number;
  };
}
```

### 7.3 关键API端点

```typescript
// app/api/bot-learning/feedback/route.ts
export async function POST(request: Request) {
  const feedback = await request.json();
  
  // 1. 验证反馈
  const validated = validateFeedback(feedback);
  
  // 2. 计算信号
  const signal = calculateSignal(validated);
  
  // 3. 存储反馈
  await storeFeedback(validated, signal);
  
  // 4. 异步触发学习更新
  await queueLearningUpdate(validated.botId);
  
  return Response.json({ success: true, signal });
}

// app/api/bot-learning/preferences/[botId]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { botId: string } }
) {
  const prefs = await getBotPreferences(params.botId);
  return Response.json(prefs);
}

export async function PUT(
  request: Request,
  { params }: { params: { botId: string } }
) {
  const update = await request.json();
  const updated = await updateBotPreferences(params.botId, update);
  return Response.json(updated);
}

// app/api/bot-learning/collective/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const featureKey = searchParams.get('featureKey');
  
  const stats = await getCollectiveIntelligence(featureKey);
  return Response.json(stats);
}

// app/api/bot-learning/ab-test/route.ts
export async function POST(request: Request) {
  const config = await request.json();
  const test = await createABTest(config);
  return Response.json(test);
}
```

---

## 8. 实施路线图

### Phase 1: 基础反馈系统 (Week 1-2)

- [ ] 实现反馈捕获API
- [ ] 设计反馈数据表
- [ ] 实现基础信号计算
- [ ] 集成现有匹配引擎

### Phase 2: 偏好学习 (Week 3-4)

- [ ] 实现偏好向量存储
- [ ] 实现在线学习算法
- [ ] 实现偏好更新逻辑
- [ ] 添加学习监控

### Phase 3: 群体智慧 (Week 5-6)

- [ ] 实现成功率共享
- [ ] 实现趋势检测
- [ ] 实现季节性调整
- [ ] 集成到匹配引擎

### Phase 4: A/B测试 (Week 7-8)

- [ ] 实现测试配置管理
- [ ] 实现Bot分配逻辑
- [ ] 实现统计检验
- [ ] 实现自动优化

### Phase 5: 优化与监控 (Week 9-10)

- [ ] 性能优化
- [ ] 监控仪表板
- [ ] 告警系统
- [ ] 文档完善

---

## 9. 风险评估与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 学习过拟合 | 高 | 中 | 正则化、早停、交叉验证 |
| 冷启动问题 | 中 | 高 | 使用默认偏好、群体智慧回退 |
| 反馈稀疏 | 中 | 中 | 批量更新、迁移学习 |
| 性能下降 | 高 | 低 | 缓存、异步处理、限流 |
| 偏见放大 | 高 | 中 | 公平性约束、多样性奖励 |

---

## 10. 附录

### 10.1 术语表

| 术语 | 定义 |
|------|------|
| Bot | 数字用户，模拟真实用户行为的AI实体 |
| 偏好向量 | 表示Bot对不同特征偏好程度的数值向量 |
| 信号 | 从用户行为中提取的数值反馈 |
| UCB | Upper Confidence Bound，上置信界算法 |
| Thompson采样 | 基于Beta分布的贝叶斯探索算法 |
| 协同过滤 | 基于相似用户/物品行为的推荐算法 |

### 10.2 参考资料

1. "Contextual Bandits for Online Learning" - Li et al., 2010
2. "Collaborative Filtering for Implicit Feedback Datasets" - Hu et al., 2008
3. "Thompson Sampling for Contextual Bandits" - Agrawal & Goyal, 2013
4. "Fairness in Recommendation Systems" - Burke et al., 2018

---

*文档结束*
