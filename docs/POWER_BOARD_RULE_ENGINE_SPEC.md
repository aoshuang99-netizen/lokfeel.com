# Power Board 规则引擎技术规范

> **文档版本**：v1.0  
> **最后更新**：2026-04-19  
> **适用范围**：LokFeel IM 模块边界控制系统

---

## 一、架构概述

### 1.1 设计目标

Power Board 规则引擎是 LokFeel IM 系统的核心安全组件，实现以下目标：

1. **边界前置**：在消息发送前完成规则校验，而非事后拦截
2. **女性控制**：所有控制点默认由女性用户掌握
3. **实时响应**：规则评估延迟 < 20ms
4. **渐进式**：软拦截优先，给用户调整机会
5. **可审计**：所有规则变更和拦截行为记录审计日志

### 1.2 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端 SDK                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 本地规则缓存  │  │ 消息预检器   │  │ UI 拦截提示  │      │
│  │ (WASM/Native)│  │ (< 10ms)     │  │ (ConsentGate)│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket / HTTPS
┌────────────────────▼────────────────────────────────────────┐
│                   规则网关 (Rule Gateway)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 版本同步     │  │ 规则分发     │  │ 增量更新     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────┬────────────────────────────────────────┘
                     │ gRPC
┌────────────────────▼────────────────────────────────────────┐
│                 规则引擎服务 (Rule Engine)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 规则评估器   │  │ 频率控制器   │  │ 内容过滤器   │      │
│  │ (< 20ms)     │  │ (TokenBucket)│  │ (关键词/CNN) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                   审计与存储层                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 审计日志     │  │ 规则版本存储 │  │ 拦截统计     │      │
│  │ (Hash Chain) │  │ (PostgreSQL) │  │ (Redis)      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、核心组件详解

### 2.1 规则评估器 (Rule Evaluator)

#### 评估流程

```typescript
interface RuleEvaluationContext {
  senderId: string;
  receiverId: string;
  messageType: MessageType;
  mediaLevel: MediaAccessLevel;
  content: string;              // 脱敏后的内容预览
  conversationId: string;
  senderHistory: SenderHistory; // 发送者近期行为
  rules: PowerBoardRules;       // 接收者的规则
}

interface RuleEvaluationResult {
  result: RuleEngineResult;     // PASS / SOFT_BLOCK / HARD_BLOCK / PACE_LIMIT
  reason: string;               // 决策原因（多语言key）
  details: RuleViolation[];     // 具体违规项
  suggestions: string[];        // 改进建议
  metadata: {
    ruleVersion: string;
    evaluatedAt: number;
    processingTimeMs: number;
  };
}

async function evaluateMessage(
  context: RuleEvaluationContext
): Promise<RuleEvaluationResult> {
  const startTime = performance.now();
  
  // 1. 频率检查（最高优先级）
  const paceResult = await checkPaceLimits(context);
  if (paceResult.violated) {
    return createPaceLimitResult(paceResult);
  }
  
  // 2. 媒体级别检查
  const mediaResult = checkMediaLevel(context);
  if (mediaResult.violated) {
    return createMediaBlockResult(mediaResult);
  }
  
  // 3. 内容过滤检查
  const contentResult = await checkContentFilter(context);
  if (contentResult.violated) {
    return createContentBlockResult(contentResult);
  }
  
  // 4. 同意状态检查
  const consentResult = checkConsentState(context);
  if (consentResult.violated) {
    return createConsentBlockResult(consentResult);
  }
  
  // 5. 通过所有检查
  return {
    result: RuleEngineResult.PASS,
    reason: 'rules.passed',
    details: [],
    suggestions: [],
    metadata: {
      ruleVersion: context.rules.version,
      evaluatedAt: Date.now(),
      processingTimeMs: performance.now() - startTime
    }
  };
}
```

#### 频率控制算法

```typescript
class PaceController {
  private redis: Redis;
  
  // Token Bucket 实现
  async checkRateLimit(
    senderId: string,
    receiverId: string,
    rules: PaceControl
  ): Promise<PaceCheckResult> {
    const key = `pace:${senderId}:${receiverId}`;
    const now = Date.now();
    
    // 获取当前桶状态
    const bucket = await this.redis.hmget(key, [
      'tokens',
      'lastRefill',
      'hourlyCount',
      'dailyCount',
      'hourStart',
      'dayStart'
    ]);
    
    // 计算令牌补充
    const tokens = parseFloat(bucket[0] ?? rules.maxMessagesPerHour);
    const lastRefill = parseInt(bucket[1] ?? now);
    const timePassed = (now - lastRefill) / 1000; // 秒
    const refillRate = rules.maxMessagesPerHour / 3600; // 每秒补充
    const newTokens = Math.min(
      rules.maxMessagesPerHour,
      tokens + timePassed * refillRate
    );
    
    // 检查小时/天配额
    let hourlyCount = parseInt(bucket[2] ?? '0');
    let dailyCount = parseInt(bucket[3] ?? '0');
    let hourStart = parseInt(bucket[4] ?? now);
    let dayStart = parseInt(bucket[5] ?? now);
    
    // 重置周期计数
    if (now - hourStart > 3600000) { // 1小时
      hourlyCount = 0;
      hourStart = now;
    }
    if (now - dayStart > 86400000) { // 24小时
      dailyCount = 0;
      dayStart = now;
    }
    
    // 判断是否允许发送
    const canSend = newTokens >= 1 && 
                    hourlyCount < rules.maxMessagesPerHour &&
                    dailyCount < rules.maxMessagesPerDay;
    
    if (canSend) {
      // 消耗令牌
      await this.redis.hmset(key, {
        tokens: newTokens - 1,
        lastRefill: now,
        hourlyCount: hourlyCount + 1,
        dailyCount: dailyCount + 1,
        hourStart,
        dayStart
      });
      await this.redis.expire(key, 86400); // 24h TTL
      
      return { allowed: true, remaining: Math.floor(newTokens - 1) };
    } else {
      // 计算冷却时间
      const cooldownMs = rules.enforceCooldown 
        ? rules.cooldownMinutes * 60000
        : this.calculateDynamicCooldown(hourlyCount, rules);
      
      return {
        allowed: false,
        reason: 'pace.limit_exceeded',
        cooldownUntil: now + cooldownMs,
        remaining: 0,
        resetAfterMs: this.calculateResetTime(hourStart, dayStart, now)
      };
    }
  }
  
  // 动态冷却计算（渐进式惩罚）
  private calculateDynamicCooldown(
    hourlyCount: number,
    rules: PaceControl
  ): number {
    const baseCooldown = 5 * 60 * 1000; // 5分钟基础
    const multiplier = Math.min(4, Math.floor(hourlyCount / 5));
    return baseCooldown * (1 + multiplier);
  }
}
```

### 2.2 内容过滤器 (Content Filter)

#### 多层过滤架构

```typescript
interface ContentFilterPipeline {
  // L1: 本地快速过滤（< 1ms）
  localFilter: LocalKeywordFilter;
  
  // L2: 服务端规则过滤（< 10ms）
  ruleFilter: RuleBasedFilter;
  
  // L3: AI 模型过滤（< 50ms，异步）
  aiFilter: AIModerationFilter;
}

class LocalKeywordFilter {
  private ac: AhoCorasick; // AC自动机
  
  constructor(keywords: string[]) {
    this.ac = new AhoCorasick(keywords);
  }
  
  filter(text: string): FilterResult {
    const matches = this.ac.search(text.toLowerCase());
    return {
      hasViolation: matches.length > 0,
      matches: matches.map(m => ({
        keyword: m.keyword,
        position: m.position,
        severity: this.getSeverity(m.keyword)
      })),
      censoredText: this.censor(text, matches)
    };
  }
}

class AIModerationFilter {
  // 使用 Perspective API 或自研模型
  async analyze(content: string): Promise<AIAnalysisResult> {
    const scores = await this.perspectiveAPI.analyze({
      text: content,
      languages: ['en'],
      requestedAttributes: {
        TOXICITY: {},
        SEVERE_TOXICITY: {},
        IDENTITY_ATTACK: {},
        INSULT: {},
        PROFANITY: {},
        THREAT: {},
        SEXUALLY_EXPLICIT: {}
      }
    });
    
    return {
      toxicity: scores.TOXICITY?.summaryScore?.value ?? 0,
      sexuallyExplicit: scores.SEXUALLY_EXPLICIT?.summaryScore?.value ?? 0,
      threat: scores.THREAT?.summaryScore?.value ?? 0,
      shouldBlock: this.shouldBlock(scores)
    };
  }
}
```

### 2.3 同意状态管理器 (Consent Manager)

```typescript
class ConsentManager {
  // 检查同意状态
  async checkConsent(
    senderId: string,
    receiverId: string,
    requestedLevel: MediaAccessLevel
  ): Promise<ConsentCheckResult> {
    // 1. 查询现有授权
    const existingGrant = await this.db.consentGrant.findFirst({
      where: {
        granterId: receiverId,
        granteeId: senderId,
        consentType: this.mapLevelToType(requestedLevel),
        isRevoked: false,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });
    
    if (existingGrant) {
      return {
        state: ConsentState.GRANTED,
        grantId: existingGrant.id,
        validUntil: existingGrant.expiresAt
      };
    }
    
    // 2. 检查待处理请求
    const pendingRequest = await this.db.consentRequest.findFirst({
      where: {
        requesterId: senderId,
        targetId: receiverId,
        consentType: this.mapLevelToType(requestedLevel),
        expiresAt: { gt: new Date() }
      }
    });
    
    if (pendingRequest) {
      return {
        state: ConsentState.PENDING,
        requestId: pendingRequest.id,
        expiresAt: pendingRequest.expiresAt
      };
    }
    
    // 3. 需要发起新请求
    return { state: ConsentState.NONE };
  }
  
  // 发起同意请求
  async requestConsent(
    request: ConsentRequest
  ): Promise<ConsentRequestResult> {
    // 生成请求ID
    const requestId = generateUUID();
    
    // 保存到数据库
    await this.db.consentRequest.create({
      data: {
        id: requestId,
        requesterId: request.requesterId,
        targetId: request.targetId,
        consentType: request.consentType,
        requestedLevel: request.requestedLevel,
        contextMsgId: request.contextMsgId,
        reason: request.reason,
        expiresAt: new Date(request.expiresAt)
      }
    });
    
    // 推送给目标用户
    await this.pushService.send(request.targetId, {
      type: 'consent_request',
      payload: { ...request, requestId }
    });
    
    // 记录审计日志
    await this.auditLog.record({
      action: 'consent_requested',
      actorId: request.requesterId,
      targetId: request.targetId,
      details: { requestId, consentType: request.consentType }
    });
    
    return { requestId, expiresAt: request.expiresAt };
  }
  
  // 响应同意请求
  async respondToConsent(
    response: ConsentResponse
  ): Promise<ConsentResponseResult> {
    const request = await this.db.consentRequest.findUnique({
      where: { id: response.requestId }
    });
    
    if (!request || request.expiresAt < new Date()) {
      throw new Error('REQUEST_EXPIRED');
    }
    
    // 更新请求状态
    await this.db.consentRequest.update({
      where: { id: response.requestId },
      data: { 
        response: response.decision,
        respondedAt: new Date()
      }
    });
    
    // 如果同意，创建授权记录
    if (response.decision === ConsentState.GRANTED) {
      await this.db.consentGrant.create({
        data: {
          granterId: response.responderId,
          granteeId: request.requesterId,
          consentType: request.consentType,
          grantedLevel: request.requestedLevel,
          expiresAt: response.validUntil ? new Date(response.validUntil) : null
        }
      });
    }
    
    // 通知请求者
    await this.pushService.send(request.requesterId, {
      type: 'consent_response',
      payload: response
    });
    
    // 记录审计日志
    await this.auditLog.record({
      action: 'consent_responded',
      actorId: response.responderId,
      targetId: request.requesterId,
      details: {
        requestId: response.requestId,
        decision: response.decision,
        validUntil: response.validUntil
      }
    });
    
    return { success: true };
  }
}
```

---

## 三、规则同步机制

### 3.1 同步策略

```typescript
interface RuleSyncStrategy {
  // 初始加载：完整规则集
  initialLoad(userId: string): Promise<PowerBoardRules>;
  
  // 增量更新：仅变更字段
  deltaSync(
    userId: string,
    lastVersion: string
  ): Promise<RuleDelta>;
  
  // 实时推送：WebSocket 广播
  realtimePush(
    userId: string,
    update: RuleUpdate
  ): Promise<void>;
}

class RuleSyncManager {
  // 版本控制
  async getRulesWithVersion(
    userId: string,
    clientVersion?: string
  ): Promise<RulesResponse> {
    const currentRules = await this.db.powerBoardRules.findUnique({
      where: { userId }
    });
    
    // 客户端无版本或版本落后较多，返回完整规则
    if (!clientVersion || this.isMajorVersionDiff(clientVersion, currentRules.version)) {
      return {
        type: 'full',
        rules: currentRules,
        serverTimestamp: Date.now()
      };
    }
    
    // 版本接近，返回增量
    const delta = await this.calculateDelta(clientVersion, currentRules);
    return {
      type: 'delta',
      delta,
      baseVersion: clientVersion,
      targetVersion: currentRules.version,
      serverTimestamp: Date.now()
    };
  }
  
  // 广播规则更新
  async broadcastRuleUpdate(
    userId: string,
    update: RuleUpdate
  ): Promise<void> {
    // 获取所有活跃会话
    const activeConversations = await this.db.conversation.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        state: ConversationState.ACTIVE
      }
    });
    
    // 提取对方用户ID
    const peerIds = activeConversations.map(conv => 
      conv.userAId === userId ? conv.userBId : conv.userAId
    );
    
    // 推送规则更新
    for (const peerId of peerIds) {
      await this.wsServer.send(peerId, {
        type: 'rule_update',
        payload: {
          convId: activeConversations.find(c => 
            c.userAId === userId || c.userBId === userId
          )?.id,
          newVersion: update.newVersion,
          effectiveImmediately: update.effectiveImmediately,
          summary: update.changeSummary
        }
      });
    }
  }
}
```

### 3.2 离线规则缓存

```typescript
class OfflineRuleCache {
  private db: SQLCipherDatabase;
  
  // 缓存规则到本地
  async cacheRules(rules: PowerBoardRules): Promise<void> {
    await this.db.execute(`
      INSERT OR REPLACE INTO cached_rules (
        user_id, version, rules_json, cached_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      rules.userId,
      rules.version,
      JSON.stringify(rules),
      Date.now(),
      Date.now() + 7 * 24 * 60 * 60 * 1000 // 7天过期
    ]);
  }
  
  // 获取缓存规则（离线可用）
  async getCachedRules(userId: string): Promise<PowerBoardRules | null> {
    const row = await this.db.get(`
      SELECT rules_json, cached_at, expires_at 
      FROM cached_rules 
      WHERE user_id = ? AND expires_at > ?
    `, [userId, Date.now()]);
    
    if (!row) return null;
    
    return JSON.parse(row.rules_json);
  }
  
  // 本地规则评估（离线模式）
  async evaluateOffline(
    message: Partial<IMMessage>,
    cachedRules: PowerBoardRules
  ): Promise<OfflineEvaluationResult> {
    // 使用本地缓存的规则进行评估
    const evaluator = new LocalRuleEvaluator(cachedRules);
    const result = evaluator.evaluate(message);
    
    // 标记为离线评估，待联网后同步
    return {
      ...result,
      evaluatedOffline: true,
      pendingSync: true
    };
  }
}
```

---

## 四、API 设计

### 4.1 REST API

```yaml
openapi: 3.0.0
info:
  title: Power Board Rule Engine API
  version: 1.0.0

paths:
  /api/rules/{userId}:
    get:
      summary: 获取用户规则
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: string
        - name: version
          in: query
          description: 客户端当前版本（用于增量同步）
          schema:
            type: string
      responses:
        200:
          description: 规则数据
          content:
            application/json:
              schema:
                oneOf:
                  - $ref: '#/components/schemas/FullRulesResponse'
                  - $ref: '#/components/schemas/DeltaRulesResponse'
    
    put:
      summary: 更新用户规则（仅女性）
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PowerBoardRules'
      responses:
        200:
          description: 更新成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UpdateRulesResponse'

  /api/rules/validate:
    post:
      summary: 预检消息
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ValidateMessageRequest'
      responses:
        200:
          description: 验证结果
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ValidateMessageResponse'

  /api/rules/history:
    get:
      summary: 获取规则变更历史
      parameters:
        - name: userId
          in: query
          required: true
          schema:
            type: string
        - name: from
          in: query
          schema:
            type: string
            format: date-time
        - name: to
          in: query
          schema:
            type: string
            format: date-time
      responses:
        200:
          description: 变更历史
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/RuleChangeHistory'

components:
  schemas:
    PowerBoardRules:
      type: object
      properties:
        userId:
          type: string
        version:
          type: string
        pace:
          $ref: '#/components/schemas/PaceControl'
        media:
          $ref: '#/components/schemas/MediaPolicy'
        filter:
          $ref: '#/components/schemas/ContentFilter'
    
    ValidateMessageRequest:
      type: object
      required:
        - senderId
        - receiverId
        - messageType
      properties:
        senderId:
          type: string
        receiverId:
          type: string
        messageType:
          type: string
          enum: [text, image, voice, video]
        mediaLevel:
          type: string
        content:
          type: string
    
    ValidateMessageResponse:
      type: object
      properties:
        result:
          type: string
          enum: [PASS, SOFT_BLOCK, HARD_BLOCK, PACE_LIMIT]
        reason:
          type: string
        suggestions:
          type: array
          items:
            type: string
        cooldownSeconds:
          type: integer
```

### 4.2 WebSocket 事件

```typescript
// 服务端 → 客户端
interface ServerRuleEvents {
  // 规则更新推送
  'rules:updated': {
    userId: string;
    newVersion: string;
    changes: RuleChange[];
    effectiveAt: number;
  };
  
  // 拦截通知
  'rules:message_blocked': {
    msgId: string;
    reason: string;
    ruleViolation: RuleViolation;
    canAppeal: boolean;
  };
  
  // 频率限制警告
  'rules:pace_warning': {
    messagesRemaining: number;
    resetAfterMinutes: number;
    currentHourlyCount: number;
  };
}

// 客户端 → 服务端
interface ClientRuleEvents {
  // 请求规则同步
  'rules:sync_request': {
    lastVersion?: string;
  };
  
  // 确认规则收到
  'rules:ack': {
    version: string;
    receivedAt: number;
  };
}
```

---

## 五、性能优化

### 5.1 缓存策略

```typescript
interface CacheStrategy {
  // Redis 缓存层
  redis: {
    rules: { ttl: 300 };           // 5分钟
    paceStatus: { ttl: 60 };       // 1分钟
    consentGrants: { ttl: 600 };   // 10分钟
  };
  
  // 本地缓存
  local: {
    ruleEvaluator: { maxSize: 1000 };  // LRU 缓存
    keywordFilter: { warmup: true };   // 启动预热
  };
}

class RuleCache {
  private redis: Redis;
  private local: LRUCache<string, any>;
  
  async getRules(userId: string): Promise<PowerBoardRules> {
    const cacheKey = `rules:${userId}`;
    
    // 1. 本地缓存
    const local = this.local.get(cacheKey);
    if (local) return local;
    
    // 2. Redis 缓存
    const redis = await this.redis.get(cacheKey);
    if (redis) {
      const rules = JSON.parse(redis);
      this.local.set(cacheKey, rules);
      return rules;
    }
    
    // 3. 数据库
    const rules = await this.db.powerBoardRules.findUnique({
      where: { userId }
    });
    
    // 回填缓存
    await this.redis.setex(cacheKey, 300, JSON.stringify(rules));
    this.local.set(cacheKey, rules);
    
    return rules;
  }
}
```

### 5.2 水平扩展

```yaml
# Kubernetes 部署配置
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rule-engine
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: rule-engine
          image: lokfeel/rule-engine:v1.0
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          env:
            - name: REDIS_URL
              value: "redis://redis-cluster:6379"
            - name: DB_POOL_SIZE
              value: "20"
---
# HPA 自动扩缩容
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: rule-engine-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: rule-engine
  minReplicas: 4
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Pods
      pods:
        metric:
          name: rule_evaluation_latency_p95
        target:
          type: AverageValue
          averageValue: 25m  # 25ms
```

---

## 六、监控与告警

### 6.1 关键指标

```typescript
interface RuleEngineMetrics {
  // 性能指标
  'rule.evaluation.duration': Histogram;      // P95 < 20ms
  'rule.evaluation.throughput': Counter;      // msg/s
  
  // 业务指标
  'rule.interception.count': Counter;         // 按类型分类
  'rule.interception.rate': Gauge;            // 拦截率
  'consent.request.count': Counter;
  'consent.grant.rate': Gauge;                // 同意率
  
  // 错误指标
  'rule.evaluation.errors': Counter;
  'rule.sync.failures': Counter;
  
  // 缓存指标
  'cache.hit.rate': Gauge;
  'cache.latency': Histogram;
}
```

### 6.2 告警规则

```yaml
alerts:
  - name: RuleEvaluationLatencyHigh
    condition: histogram_quantile(0.95, rule_evaluation_duration) > 50ms
    for: 5m
    severity: warning
    
  - name: RuleEvaluationLatencyCritical
    condition: histogram_quantile(0.95, rule_evaluation_duration) > 100ms
    for: 2m
    severity: critical
    
  - name: HighInterceptionRate
    condition: rate(rule_interception_count[5m]) / rate(rule_evaluation_count[5m]) > 0.3
    for: 10m
    severity: warning
    annotations:
      summary: "异常高拦截率，可能存在误杀"
      
  - name: ConsentGrantRateLow
    condition: consent_grant_rate < 0.5
    for: 1h
    severity: info
    annotations:
      summary: "同意率偏低，需关注用户体验"
```

---

## 七、测试策略

### 7.1 单元测试

```typescript
describe('RuleEvaluator', () => {
  describe('pace control', () => {
    it('should allow message within hourly limit', async () => {
      const result = await evaluator.checkPace({
        senderId: 'user1',
        hourlyCount: 5,
        rules: { maxMessagesPerHour: 10 }
      });
      expect(result.allowed).toBe(true);
    });
    
    it('should block message exceeding hourly limit', async () => {
      const result = await evaluator.checkPace({
        senderId: 'user1',
        hourlyCount: 10,
        rules: { maxMessagesPerHour: 10, enforceCooldown: true }
      });
      expect(result.allowed).toBe(false);
      expect(result.cooldownMs).toBeGreaterThan(0);
    });
  });
  
  describe('media level', () => {
    it('should require consent for image when default is text', async () => {
      const result = await evaluator.checkMedia({
        requestedLevel: MediaAccessLevel.L1_IMAGE,
        rules: { defaultLevel: MediaAccessLevel.L0_TEXT }
      });
      expect(result.violated).toBe(true);
      expect(result.requiresConsent).toBe(true);
    });
  });
});
```

### 7.2 集成测试

```typescript
describe('Rule Engine Integration', () => {
  it('should sync rules across multiple clients', async () => {
    const userId = 'test-user';
    const client1 = createTestClient();
    const client2 = createTestClient();
    
    // 客户端1更新规则
    await client1.updateRules(userId, { maxMessagesPerHour: 5 });
    
    // 验证客户端2收到推送
    await waitFor(() => 
      client2.receivedEvents.some(e => e.type === 'rules:updated')
    );
    
    // 验证规则已同步
    const rules = await client2.getRules(userId);
    expect(rules.pace.maxMessagesPerHour).toBe(5);
  });
  
  it('should enforce pace limits across distributed instances', async () => {
    const senderId = 'sender';
    const receiverId = 'receiver';
    
    // 设置限制
    await ruleEngine.setRules(receiverId, {
      maxMessagesPerHour: 3
    });
    
    // 快速发送4条消息
    const results = await Promise.all([
      ruleEngine.evaluate({ senderId, receiverId }),
      ruleEngine.evaluate({ senderId, receiverId }),
      ruleEngine.evaluate({ senderId, receiverId }),
      ruleEngine.evaluate({ senderId, receiverId })
    ]);
    
    // 前3条通过，第4条被拦截
    expect(results[0].result).toBe(RuleEngineResult.PASS);
    expect(results[1].result).toBe(RuleEngineResult.PASS);
    expect(results[2].result).toBe(RuleEngineResult.PASS);
    expect(results[3].result).toBe(RuleEngineResult.PACE_LIMIT);
  });
});
```

### 7.3 负载测试

```yaml
# k6 负载测试脚本
config:
  stages:
    - duration: 2m
      target: 1000    # 1000 并发用户
    - duration: 5m
      target: 5000    # 5000 并发用户
    - duration: 2m
      target: 0       # 降载

scenarios:
  - name: rule_evaluation
    executor: constant-vus
    vus: 1000
    duration: 10m
    
    exec: |
      import http from 'k6/http';
      import { check } from 'k6';
      
      export default function() {
        const payload = JSON.stringify({
          senderId: `user_${__VU}`,
          receiverId: `receiver_${__VU}`,
          messageType: 'text',
          content: 'Hello, this is a test message'
        });
        
        const res = http.post(
          'http://rule-engine/api/rules/validate',
          payload,
          { headers: { 'Content-Type': 'application/json' } }
        );
        
        check(res, {
          'status is 200': (r) => r.status === 200,
          'response time < 50ms': (r) => r.timings.duration < 50,
        });
      }

thresholds:
  - http_req_duration: ['p(95)<20']  # P95 < 20ms
  - http_req_failed: ['rate<0.001']   # 错误率 < 0.1%
```

---

## 八、部署与运维

### 8.1 部署流程

```bash
# 1. 数据库迁移
npm run migrate:rules

# 2. 规则预热
npm run warmup:keyword-filter

# 3. 金丝雀发布
kubectl apply -f k8s/rule-engine-canary.yaml

# 4. 流量切换（10% → 50% → 100%）
npm run traffic:shift -- --service=rule-engine --weight=10
# 观察 5 分钟
npm run traffic:shift -- --service=rule-engine --weight=50
# 观察 10 分钟
npm run traffic:shift -- --service=rule-engine --weight=100

# 5. 全量发布
kubectl apply -f k8s/rule-engine-production.yaml
```

### 8.2 回滚策略

```yaml
# 一键回滚配置
rollback:
  triggers:
    - metric: rule_evaluation_error_rate
      threshold: 0.01
      duration: 2m
    - metric: rule_evaluation_latency_p95
      threshold: 100ms
      duration: 5m
  
  actions:
    - type: traffic_shift
      target: previous_version
      weight: 100
    - type: alert
      channel: pagerduty
      severity: critical
```

---

## 附录

### A. 错误码表

| 错误码 | 描述 | HTTP 状态 |
|--------|------|-----------|
| RULE_VIOLATION_PACE | 频率限制 | 429 |
| RULE_VIOLATION_MEDIA | 媒体级别越权 | 403 |
| RULE_VIOLATION_CONTENT | 内容违规 | 403 |
| RULE_VIOLATION_CONSENT | 缺少同意授权 | 403 |
| RULE_VERSION_MISMATCH | 规则版本不匹配 | 409 |
| RULE_SYNC_FAILED | 规则同步失败 | 503 |

### B. 配置参考

```yaml
# config/rules.yaml
engine:
  evaluation_timeout_ms: 50
  max_concurrent_evaluations: 10000
  
pace_control:
  default_max_per_hour: 20
  default_max_per_day: 100
  default_cooldown_minutes: 5
  
content_filter:
  keyword_list_url: s3://lokfeel-config/blocked-keywords-v2.txt
  perspective_api_enabled: true
  perspective_threshold: 0.7
  
consent:
  default_expiry_hours: 168  # 7天
  max_pending_requests: 5
  
cache:
  redis_ttl_seconds: 300
  local_max_size: 10000
```
