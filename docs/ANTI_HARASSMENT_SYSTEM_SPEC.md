# 反骚扰与动态风控体系规范

## 概述

本文档定义 LokFeel IM 模块的反骚扰与动态风控系统，通过行为级节律控制、内容审核三层联动、尊重指数体系，构建女性友好的安全通信环境。

## 设计原则

### 1. 主动防御优于被动举报

```
传统模式                    LokFeel 模式
─────────                   ───────────
用户被骚扰 → 举报 → 处理    风险行为 → 实时拦截 → 预防
     ↑                              ↓
   事后补救                      事前预防
```

### 2. 女性主权控制

- **节奏控制**：女性设定消息频率上限
- **边界前置**：聊天前即加载规则
- **同意门控**：敏感内容需女性确认
- **一键阻断**：随时终止对话

### 3. 渐进式干预

```
干预强度梯度
─────────────
Level 1: 提示建议（软提醒）
Level 2: 冷却延迟（输入框置灰）
Level 3: 功能限制（降低曝光）
Level 4: 临时封禁（24小时）
Level 5: 永久封禁（人工审核）
```

---

## 行为级节律控制

### 2.1 女性设置界面

```typescript
// 女性消息控制设置
interface MessagePaceControl {
  // 每小时消息上限
  maxMessagesPerHour: number;      // 默认: 5, 范围: 1-20
  
  // 响应时间窗口（小时）
  responseWindow: number;          // 默认: 4, 范围: 1-48
  
  // 连续消息冷却时间（秒）
  consecutiveCooldown: number;     // 默认: 60, 范围: 0-300
  
  // 夜间免打扰
  quietHours: {
    enabled: boolean;
    startTime: string;             // "22:00"
    endTime: string;               // "08:00"
    allowUrgent: boolean;          // 允许标记为紧急的消息
  };
  
  // 首次回复等待期
  firstReplyDelay: number;         // 默认: 0, 范围: 0-24（小时）
}

// 设置界面组件
function PaceControlSettings() {
  const [settings, setSettings] = useState<MessagePaceControl>({
    maxMessagesPerHour: 5,
    responseWindow: 4,
    consecutiveCooldown: 60,
    quietHours: { enabled: true, startTime: '22:00', endTime: '08:00', allowUrgent: false },
    firstReplyDelay: 0
  });
  
  return (
    <div className="pace-settings">
      <h3>Message Rhythm Control</h3>
      
      <SettingSlider
        label="Max messages per hour"
        value={settings.maxMessagesPerHour}
        min={1}
        max={20}
        onChange={(v) => setSettings({ ...settings, maxMessagesPerHour: v })}
        description="He can only send this many messages in an hour"
      />
      
      <SettingSlider
        label="Response window"
        value={settings.responseWindow}
        min={1}
        max={48}
        unit="hours"
        onChange={(v) => setSettings({ ...settings, responseWindow: v })}
        description="Expected time for you to respond"
      />
      
      <QuietHoursToggle
        enabled={settings.quietHours.enabled}
        onToggle={(enabled) => setSettings({ ...settings, quietHours: { ...settings.quietHours, enabled } })}
      />
    </div>
  );
}
```

### 2.2 服务端节律执行

```typescript
// 消息节律服务
interface PaceControlService {
  // 检查消息是否允许发送
  async checkMessageAllowed(
    senderId: string,
    recipientId: string,
    conversationId: string
  ): Promise<PaceCheckResult> {
    // 获取女性用户的节律设置
    const recipientSettings = await this.getUserPaceSettings(recipientId);
    
    // 获取当前统计
    const stats = await this.getMessageStats(senderId, recipientId);
    
    // 检查每小时限制
    if (stats.messagesThisHour >= recipientSettings.maxMessagesPerHour) {
      return {
        allowed: false,
        reason: 'HOURLY_LIMIT_EXCEEDED',
        cooldownUntil: this.calculateHourlyReset(),
        suggestion: `You've reached the hourly limit. Try again in ${this.formatCooldown(this.calculateHourlyReset())}.`
      };
    }
    
    // 检查连续消息冷却
    if (stats.lastMessageTime) {
      const timeSinceLastMessage = Date.now() - stats.lastMessageTime;
      if (timeSinceLastMessage < recipientSettings.consecutiveCooldown * 1000) {
        const remainingCooldown = recipientSettings.consecutiveCooldown * 1000 - timeSinceLastMessage;
        return {
          allowed: false,
          reason: 'CONSECUTIVE_COOLDOWN',
          cooldownUntil: Date.now() + remainingCooldown,
          suggestion: 'Please wait a moment before sending another message.'
        };
      }
    }
    
    // 检查夜间免打扰
    if (recipientSettings.quietHours.enabled && this.isInQuietHours(recipientSettings.quietHours)) {
      return {
        allowed: false,
        reason: 'QUIET_HOURS',
        cooldownUntil: this.calculateQuietHoursEnd(recipientSettings.quietHours),
        suggestion: 'She has quiet hours enabled. Your message will be delivered in the morning.'
      };
    }
    
    // 检查首次回复等待期
    if (stats.isFirstMessage && recipientSettings.firstReplyDelay > 0) {
      const matchTime = await this.getMatchTime(senderId, recipientId);
      const hoursSinceMatch = (Date.now() - matchTime) / (1000 * 60 * 60);
      
      if (hoursSinceMatch < recipientSettings.firstReplyDelay) {
        return {
          allowed: false,
          reason: 'FIRST_REPLY_DELAY',
          cooldownUntil: matchTime + recipientSettings.firstReplyDelay * 60 * 60 * 1000,
          suggestion: `Please wait ${recipientSettings.firstReplyDelay} hours after matching before messaging.`
        };
      }
    }
    
    return { allowed: true };
  }
  
  // 记录消息统计
  async recordMessageSent(
    senderId: string,
    recipientId: string
  ): Promise<void> {
    const key = `pace:${senderId}:${recipientId}`;
    
    // 增加小时计数器
    await redis.hincrby(key, 'messagesThisHour', 1);
    
    // 更新最后消息时间
    await redis.hset(key, 'lastMessageTime', Date.now());
    
    // 设置过期时间（1小时）
    await redis.expire(key, 3600);
  }
}

// 节律检查结果
interface PaceCheckResult {
  allowed: boolean;
  reason?: PaceBlockReason;
  cooldownUntil?: number;
  suggestion?: string;
}

enum PaceBlockReason {
  HOURLY_LIMIT_EXCEEDED = 'hourly_limit_exceeded',
  CONSECUTIVE_COOLDOWN = 'consecutive_cooldown',
  QUIET_HOURS = 'quiet_hours',
  FIRST_REPLY_DELAY = 'first_reply_delay',
  RESPECT_SCORE_LOW = 'respect_score_low'
}
```

### 2.3 客户端冷却 UI

```typescript
// 冷却状态组件
function CooldownInput({ conversationId }: { conversationId: string }) {
  const [cooldownState, setCooldownState] = useState<CooldownState>({
    isActive: false,
    remainingSeconds: 0,
    reason: null
  });
  
  useEffect(() => {
    // 订阅冷却状态更新
    const unsubscribe = subscribeToCooldown(conversationId, (state) => {
      setCooldownState(state);
    });
    
    return unsubscribe;
  }, [conversationId]);
  
  if (!cooldownState.isActive) {
    return <MessageInput conversationId={conversationId} />;
  }
  
  return (
    <div className="cooldown-container">
      <div className="cooldown-icon">
        <ClockIcon />
      </div>
      <div className="cooldown-text">
        <p className="cooldown-title">Take a breath</p>
        <p className="cooldown-description">
          {cooldownState.reason === 'HOURLY_LIMIT_EXCEEDED' && 
            "You've sent several messages recently. Give her some time to respond."}
          {cooldownState.reason === 'CONSECUTIVE_COOLDOWN' && 
            "Please wait a moment before sending another message."}
          {cooldownState.reason === 'QUIET_HOURS' && 
            "She has quiet hours enabled. Your message will be delivered later."}
        </p>
      </div>
      <div className="cooldown-timer">
        <CountdownTimer 
          seconds={cooldownState.remainingSeconds}
          onComplete={() => setCooldownState({ isActive: false, remainingSeconds: 0, reason: null })}
        />
      </div>
    </div>
  );
}
```

---

## 尊重指数体系

### 3.1 指数计算模型

```typescript
// 尊重指数服务
interface RespectScoreService {
  // 计算用户尊重指数
  async calculateRespectScore(userId: string): Promise<RespectScore> {
    const metrics = await this.gatherMetrics(userId);
    
    // 基础分：50
    let score = 50;
    
    // 正向行为加分
    score += metrics.responseRate * 10;           // 回复率（0-10分）
    score += metrics.conversationCompletion * 5;  // 对话完成率（0-5分）
    score += metrics.boundaryCompliance * 15;     // 边界遵守（0-15分）
    score += metrics.positiveFeedback * 10;       // 正面反馈（0-10分）
    score += metrics.reportFreeDays * 0.5;        // 无举报天数（0-5分）
    
    // 负向行为减分
    score -= metrics.violationCount * 5;          // 违规次数（每次-5分）
    score -= metrics.spamReports * 10;            // 骚扰举报（每次-10分）
    score -= metrics.boundaryViolations * 8;      // 边界违反（每次-8分）
    score -= metrics.ignoredWarnings * 3;         // 忽视警告（每次-3分）
    
    // 限制在 0-100 范围
    score = Math.max(0, Math.min(100, score));
    
    // 确定等级
    const level = this.determineLevel(score);
    
    return {
      userId,
      score,
      level,
      metrics,
      calculatedAt: Date.now()
    };
  }
  
  // 确定等级
  private determineLevel(score: number): RespectLevel {
    if (score >= 90) return RespectLevel.EXEMPLARY;    // 模范用户
    if (score >= 75) return RespectLevel.GOOD;         // 良好用户
    if (score >= 60) return RespectLevel.STANDARD;     // 标准用户
    if (score >= 40) return RespectLevel.CAUTION;      // 需注意
    if (score >= 20) return RespectLevel.WARNING;      // 警告
    return RespectLevel.RESTRICTED;                     // 受限
  }
  
  // 获取等级特权/限制
  getLevelPrivileges(level: RespectLevel): LevelPrivileges {
    const privileges: Record<RespectLevel, LevelPrivileges> = {
      [RespectLevel.EXEMPLARY]: {
        dailyLikes: 50,
        dailyMessages: Infinity,
        canSendMedia: true,
        canInitiateVoice: true,
        priorityMatching: true,
        badge: 'Respectful'
      },
      [RespectLevel.GOOD]: {
        dailyLikes: 30,
        dailyMessages: 100,
        canSendMedia: true,
        canInitiateVoice: true,
        priorityMatching: false,
        badge: null
      },
      [RespectLevel.STANDARD]: {
        dailyLikes: 15,
        dailyMessages: 50,
        canSendMedia: true,
        canInitiateVoice: false,
        priorityMatching: false,
        badge: null
      },
      [RespectLevel.CAUTION]: {
        dailyLikes: 5,
        dailyMessages: 20,
        canSendMedia: false,
        canInitiateVoice: false,
        priorityMatching: false,
        badge: null,
        warningMessage: 'Your respect score is low. Be mindful of boundaries.'
      },
      [RespectLevel.WARNING]: {
        dailyLikes: 1,
        dailyMessages: 5,
        canSendMedia: false,
        canInitiateVoice: false,
        priorityMatching: false,
        badge: null,
        warningMessage: 'Multiple reports received. Further violations may result in suspension.'
      },
      [ResrictedLevel.RESTRICTED]: {
        dailyLikes: 0,
        dailyMessages: 0,
        canSendMedia: false,
        canInitiateVoice: false,
        priorityMatching: false,
        badge: null,
        isSuspended: true,
        suspensionReason: 'Account restricted due to repeated violations.'
      }
    };
    
    return privileges[level];
  }
}

// 尊重等级
enum RespectLevel {
  EXEMPLARY = 'exemplary',    // 90-100
  GOOD = 'good',              // 75-89
  STANDARD = 'standard',      // 60-74
  CAUTION = 'caution',        // 40-59
  WARNING = 'warning',        // 20-39
  RESTRICTED = 'restricted'   // 0-19
}

// 等级特权
interface LevelPrivileges {
  dailyLikes: number;
  dailyMessages: number;
  canSendMedia: boolean;
  canInitiateVoice: boolean;
  priorityMatching: boolean;
  badge: string | null;
  warningMessage?: string;
  isSuspended?: boolean;
  suspensionReason?: string;
}
```

### 3.2 指数展示组件

```typescript
// 尊重指数徽章
function RespectScoreBadge({ userId }: { userId: string }) {
  const { score, level } = useRespectScore(userId);
  
  const levelConfig = {
    exemplary: { color: '#10B981', icon: StarIcon, label: 'Exemplary' },
    good: { color: '#3B82F6', icon: ThumbsUpIcon, label: 'Good Standing' },
    standard: { color: '#6B7280', icon: UserIcon, label: 'Standard' },
    caution: { color: '#F59E0B', icon: AlertIcon, label: 'Caution' },
    warning: { color: '#EF4444', icon: WarningIcon, label: 'Warning' },
    restricted: { color: '#7C2D12', icon: BanIcon, label: 'Restricted' }
  };
  
  const config = levelConfig[level];
  const Icon = config.icon;
  
  return (
    <div className="respect-badge" style={{ borderColor: config.color }}>
      <Icon color={config.color} size={16} />
      <span style={{ color: config.color }}>{config.label}</span>
      <span className="score">{score}</span>
    </div>
  );
}

// 尊重指数详情面板
function RespectScorePanel({ userId }: { userId: string }) {
  const { score, level, metrics } = useRespectScore(userId);
  const privileges = useLevelPrivileges(level);
  
  return (
    <div className="respect-panel">
      <div className="score-header">
        <RespectScoreBadge userId={userId} />
        <div className="score-value">{score}/100</div>
      </div>
      
      <div className="metrics-grid">
        <MetricCard
          label="Response Rate"
          value={`${(metrics.responseRate * 100).toFixed(0)}%`}
          description="How often you respond to messages"
        />
        <MetricCard
          label="Boundary Compliance"
          value={`${(metrics.boundaryCompliance * 100).toFixed(0)}%`}
          description="Following conversation boundaries"
        />
        <MetricCard
          label="Positive Feedback"
          value={metrics.positiveFeedback}
          description="Compliments from other users"
        />
        <MetricCard
          label="Violation-free Days"
          value={metrics.reportFreeDays}
          description="Days without reports"
        />
      </div>
      
      <div className="privileges-section">
        <h4>Your Privileges</h4>
        <PrivilegeList privileges={privileges} />
      </div>
      
      {privileges.warningMessage && (
        <div className="warning-banner">
          <WarningIcon />
          <p>{privileges.warningMessage}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 内容审核三层联动

### 4.1 审核架构

```
┌─────────────────────────────────────────────────────────────┐
│                    内容审核三层架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 1: 客户端实时拦截（< 10ms）                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 本地敏感词库（10万+词条）                          │   │
│  │ • 规则引擎预检                                       │   │
│  │ • 模式匹配（骚扰模式识别）                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  Layer 2: 网关过滤（< 50ms）                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • Perspective API（毒性评分）                        │   │
│  │ • 轻量CNN（图片初筛）                                │   │
│  │ • 行为模式分析                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  Layer 3: 异步复审（< 15min）                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 多模态大模型（GPT-4V / Claude）                    │   │
│  │ • 人工审核队列                                       │   │
│  │ • 用户举报复核                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 客户端实时拦截

```typescript
// 客户端内容过滤器
class ClientContentFilter {
  private sensitiveWords: Trie;
  private harassmentPatterns: RegExp[];
  
  constructor() {
    // 初始化敏感词 Trie 树
    this.sensitiveWords = this.buildTrie(sensitiveWordList);
    
    // 骚扰模式正则
    this.harassmentPatterns = [
      /(.+)\1{4,}/,                    // 重复字符（如 "aaaaa"）
      /(?:send|give me|share)\s+(?:pics?|photos?|nudes?)/i,  // 索要照片
      /(?:where|what)\s+(?:do\s+you|are\s+you)\s+(?:live|from|located)/i,  // 打探位置
      /(?:let['']s|wanna|want\s+to)\s+(?:meet|hook\s+up|hang\s+out)/i,  // 快速邀约
    ];
  }
  
  // 实时检查消息
  checkMessage(content: string): FilterResult {
    const startTime = performance.now();
    
    // 1. 敏感词检测
    const wordMatches = this.sensitiveWords.search(content);
    if (wordMatches.length > 0) {
      return {
        passed: false,
        level: FilterLevel.HARD_BLOCK,
        reason: 'SENSITIVE_CONTENT',
        matches: wordMatches,
        processingTime: performance.now() - startTime
      };
    }
    
    // 2. 骚扰模式检测
    for (const pattern of this.harassmentPatterns) {
      if (pattern.test(content)) {
        return {
          passed: false,
          level: FilterLevel.SOFT_BLOCK,
          reason: 'HARASSMENT_PATTERN',
          suggestion: 'This message may make the recipient uncomfortable. Consider rephrasing.',
          processingTime: performance.now() - startTime
        };
      }
    }
    
    // 3. 频率检测（短时间内大量相似消息）
    const frequencyCheck = this.checkFrequency(content);
    if (frequencyCheck.isSpam) {
      return {
        passed: false,
        level: FilterLevel.SOFT_BLOCK,
        reason: 'FREQUENCY_VIOLATION',
        suggestion: 'You\'re sending messages too quickly. Please slow down.',
        processingTime: performance.now() - startTime
      };
    }
    
    return {
      passed: true,
      processingTime: performance.now() - startTime
    };
  }
  
  // 检查消息频率
  private recentMessages: { content: string; timestamp: number }[] = [];
  
  private checkFrequency(newContent: string): FrequencyCheck {
    const now = Date.now();
    const windowStart = now - 60000; // 1分钟窗口
    
    // 清理过期消息
    this.recentMessages = this.recentMessages.filter(m => m.timestamp > windowStart);
    
    // 检查相似度
    const similarMessages = this.recentMessages.filter(m => 
      this.similarity(m.content, newContent) > 0.8
    );
    
    // 如果1分钟内有3条以上相似消息，判定为刷屏
    if (similarMessages.length >= 3) {
      return { isSpam: true };
    }
    
    // 记录新消息
    this.recentMessages.push({ content: newContent, timestamp: now });
    
    return { isSpam: false };
  }
  
  // 计算字符串相似度（简化版 Levenshtein）
  private similarity(a: string, b: string): number {
    // 实现相似度计算...
    return 0;
  }
}

// 过滤结果
interface FilterResult {
  passed: boolean;
  level?: FilterLevel;
  reason?: string;
  matches?: string[];
  suggestion?: string;
  processingTime: number;
}

enum FilterLevel {
  PASS = 'pass',
  SOFT_BLOCK = 'soft_block',
  HARD_BLOCK = 'hard_block'
}
```

### 4.3 网关过滤服务

```typescript
// 网关内容过滤服务
interface GatewayFilterService {
  // 消息过滤
  async filterMessage(message: IMMessage): Promise<GatewayFilterResult> {
    // 1. Perspective API 毒性检测
    const toxicityScore = await this.checkToxicity(message.content);
    if (toxicityScore > 0.8) {
      return {
        action: FilterAction.BLOCK,
        reason: 'HIGH_TOXICITY',
        score: toxicityScore
      };
    }
    
    // 2. 图片内容检测（如果是媒体消息）
    if (message.mediaUrl) {
      const imageResult = await this.checkImageContent(message.mediaUrl);
      if (!imageResult.isSafe) {
        return {
          action: FilterAction.BLOCK,
          reason: 'INAPPROPRIATE_IMAGE',
          details: imageResult.categories
        };
      }
    }
    
    // 3. 行为模式分析
    const behaviorScore = await this.analyzeBehavior(message.senderId);
    if (behaviorScore.isSuspicious) {
      // 标记为需要异步复审
      await this.queueForReview(message);
      
      return {
        action: FilterAction.DELAY,
        reason: 'SUSPICIOUS_BEHAVIOR',
        delaySeconds: 30
      };
    }
    
    return { action: FilterAction.ALLOW };
  }
  
  // Perspective API 毒性检测
  private async checkToxicity(text: string): Promise<number> {
    const response = await fetch('https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment: { text },
        languages: ['en'],
        requestedAttributes: {
          TOXICITY: {},
          SEVERE_TOXICITY: {},
          IDENTITY_ATTACK: {},
          INSULT: {},
          THREAT: {},
          SEXUALLY_EXPLICIT: {}
        }
      })
    });
    
    const result = await response.json();
    return result.attributeScores.TOXICITY.summaryScore.value;
  }
  
  // 图片内容检测
  private async checkImageContent(imageUrl: string): Promise<ImageCheckResult> {
    // 使用 AWS Rekognition 或 Google Vision API
    const result = await this.imageModerationClient.detectLabels({
      Image: { S3Object: { Bucket: 'media-bucket', Name: imageUrl } }
    });
    
    // 检查不当内容
    const inappropriateCategories = [
      'Explicit Nudity',
      'Suggestive',
      'Violence',
      'Visually Disturbing'
    ];
    
    const detectedCategories = result.ModerationLabels
      .filter(label => inappropriateCategories.includes(label.ParentName))
      .map(label => label.Name);
    
    return {
      isSafe: detectedCategories.length === 0,
      categories: detectedCategories
    };
  }
}
```

### 4.4 异步复审队列

```typescript
// 异步复审服务
interface AsyncReviewService {
  // 加入复审队列
  async queueForReview(message: IMMessage): Promise<void> {
    await this.reviewQueue.add('message-review', {
      messageId: message.id,
      content: message.content,
      mediaUrl: message.mediaUrl,
      senderId: message.senderId,
      recipientId: message.recipientId,
      timestamp: message.timestamp,
      priority: this.calculatePriority(message)
    }, {
      delay: 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });
  }
  
  // 处理复审任务
  async processReview(job: ReviewJob): Promise<ReviewResult> {
    const { messageId, content, mediaUrl } = job.data;
    
    // 1. 多模态大模型分析
    const llmAnalysis = await this.analyzeWithLLM(content, mediaUrl);
    
    // 2. 如果置信度低，转人工审核
    if (llmAnalysis.confidence < 0.7) {
      return await this.escalateToHuman(job.data);
    }
    
    // 3. 自动处理
    if (llmAnalysis.isViolation) {
      await this.takeAction(messageId, llmAnalysis.violationType);
      
      return {
        decision: ReviewDecision.VIOLATION,
        violationType: llmAnalysis.violationType,
        confidence: llmAnalysis.confidence
      };
    }
    
    return {
      decision: ReviewDecision.CLEAR,
      confidence: llmAnalysis.confidence
    };
  }
  
  // LLM 分析
  private async analyzeWithLLM(text: string, imageUrl?: string): Promise<LLMAnalysis> {
    const prompt = `
      Analyze the following message for violations of community guidelines.
      
      Message: "${text}"
      ${imageUrl ? `Image: ${imageUrl}` : ''}
      
      Check for:
      1. Harassment or unwanted advances
      2. Hate speech or discrimination
      3. Sexual content without consent
      4. Threats or intimidation
      5. Spam or solicitation
      
      Respond in JSON format:
      {
        "isViolation": boolean,
        "violationType": string | null,
        "confidence": number (0-1),
        "explanation": string
      }
    `;
    
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    
    return JSON.parse(response.choices[0].message.content);
  }
}
```

---

## 举报与快速响应

### 5.1 举报流程

```typescript
// 举报服务
interface ReportService {
  // 提交举报
  async submitReport(
    reporterId: string,
    reportedId: string,
    report: ReportSubmission
  ): Promise<ReportResult> {
    // 1. 验证举报权限（防止恶意举报）
    const canReport = await this.verifyReportPermission(reporterId);
    if (!canReport) {
      return { success: false, reason: 'REPORT_LIMIT_EXCEEDED' };
    }
    
    // 2. 收集证据
    const evidence = await this.collectEvidence(
      reporterId,
      reportedId,
      report.conversationId
    );
    
    // 3. 创建举报记录
    const reportRecord: ReportRecord = {
      id: generateUUID(),
      reporterId,
      reportedId,
      category: report.category,
      description: report.description,
      evidence,
      status: ReportStatus.PENDING,
      priority: this.calculatePriority(report, evidence),
      createdAt: Date.now()
    };
    
    await this.saveReport(reportRecord);
    
    // 4. 高优先级立即处理
    if (reportRecord.priority === ReportPriority.HIGH) {
      await this.escalateToImmediateReview(reportRecord);
    }
    
    // 5. 更新举报者信任分
    await this.updateReporterTrustScore(reporterId, reportRecord);
    
    return {
      success: true,
      reportId: reportRecord.id,
      estimatedResponseTime: this.getEstimatedResponseTime(reportRecord.priority)
    };
  }
  
  // 收集证据
  private async collectEvidence(
    reporterId: string,
    reportedId: string,
    conversationId: string
  ): Promise<ReportEvidence> {
    // 获取最近消息
    const recentMessages = await this.fetchRecentMessages(conversationId, 20);
    
    // 获取用户行为记录
    const behaviorLog = await this.fetchBehaviorLog(reportedId, 7);
    
    // 获取尊重指数
    const respectScore = await this.getRespectScore(reportedId);
    
    // 获取规则版本
    const boundaryVersion = await this.getActiveBoundaryVersion(reporterId);
    
    return {
      messages: recentMessages.map(m => ({
        id: m.id,
        senderId: m.senderId,
        contentHash: hashContent(m.content),
        timestamp: m.timestamp,
        consentState: m.consentState
      })),
      behaviorLog,
      respectScore,
      boundaryVersion,
      collectedAt: Date.now()
    };
  }
}

// 举报类别
enum ReportCategory {
  HARASSMENT = 'harassment',
  BOUNDARY_VIOLATION = 'boundary_violation',
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  FAKE_PROFILE = 'fake_profile',
  ILLEGAL_ACTIVITY = 'illegal_activity',
  SPAM = 'spam'
}

// 举报优先级
enum ReportPriority {
  LOW = 'low',        // 24小时内处理
  MEDIUM = 'medium',  // 4小时内处理
  HIGH = 'high'       // 15分钟内处理
}
```

### 5.2 快速响应机制

```typescript
// 快速响应服务
interface RapidResponseService {
  // 高优先级举报处理
  async handleHighPriorityReport(report: ReportRecord): Promise<void> {
    // 1. 立即暂停被举报者部分功能
    await this.restrictUser(report.reportedId, {
      canSendMessages: false,
      canSendMedia: false,
      canLike: false,
      duration: 60 * 60 * 1000 // 1小时临时限制
    });
    
    // 2. 通知人工审核团队
    await this.notifyModerationTeam(report);
    
    // 3. 自动分析证据
    const autoDecision = await this.autoAnalyzeEvidence(report.evidence);
    
    if (autoDecision.confidence > 0.9) {
      // 高置信度自动处理
      await this.executeAutoDecision(report, autoDecision);
    } else {
      // 转人工审核
      await this.assignToModerator(report);
    }
  }
  
  // 自动证据分析
  private async autoAnalyzeEvidence(evidence: ReportEvidence): Promise<AutoDecision> {
    // 1. 检查消息内容
    const contentViolations = await this.checkContentViolations(evidence.messages);
    
    // 2. 检查行为模式
    const behaviorViolations = this.checkBehaviorViolations(evidence.behaviorLog);
    
    // 3. 综合评分
    const violationScore = (
      contentViolations.score * 0.6 +
      behaviorViolations.score * 0.4
    );
    
    return {
      action: violationScore > 0.8 ? 'SUSPEND' : 'WARN',
      confidence: violationScore,
      violations: [...contentViolations.items, ...behaviorViolations.items]
    };
  }
  
  // 女性专属快速通道
  async handleFemaleUserReport(report: ReportRecord): Promise<void> {
    // 女性用户举报自动提升优先级
    report.priority = ReportPriority.HIGH;
    
    // 立即通知值班审核员
    await this.notifyOnDutyModerator(report);
    
    // 15分钟内必须响应
    await this.setResponseDeadline(report.id, 15 * 60 * 1000);
  }
}
```

---

## 实施检查清单

### 客户端

- [ ] 节律控制设置界面
- [ ] 冷却状态 UI 组件
- [ ] 尊重指数展示组件
- [ ] 客户端内容过滤器
- [ ] 举报提交界面
- [ ] 快速响应通知

### 服务端

- [ ] 节律控制服务
- [ ] 尊重指数计算服务
- [ ] 网关过滤服务
- [ ] 异步复审队列
- [ ] 举报处理服务
- [ ] 快速响应机制

### 测试

- [ ] 节律控制边界测试
- [ ] 尊重指数计算准确性测试
- [ ] 内容过滤误报率测试
- [ ] 举报处理时效性测试
- [ ] 快速响应机制压力测试
