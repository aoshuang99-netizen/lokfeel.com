# LokFeel 用户端产品优化方案

> **分析来源**: Elite Power PRD (精英社交产品原型)  
> **目标**: 借鉴Elite Power核心机制，结合LokFeel现有架构，提升用户体验和女性友好度  
> **版本**: v1.0  
> **日期**: 2026-04-13

---

## 一、核心洞察对比分析

### 1.1 Elite Power 核心机制

| 阶段 | 核心设计 | 目标 |
|------|----------|------|
| **入场验证** | LinkedIn OAuth + 活体检测 + 审核费 | 精英门槛筛选 |
| **非对称接触** | 女性设门槛($20-$2000)，男性付费申请 | 女性绝对主导 |
| **批阅权力** | 女性按致敬金排序，一键获利/开启对话 | 消除骚扰 |
| **限时聊天** | 24小时倒计时 + 女性可随时终止 | 保护隐私 |
| **收益提现** | 70%分账 + Stripe Connect | 女性变现 |

### 1.2 LokFeel 现有优势

| 维度 | LokFeel | Elite Power |
|------|---------|-------------|
| **匹配逻辑** | 关系结构匹配(五维评分) | 职业标签 + 金钱门槛 |
| **用户验证** | 邮箱/短信 + 头像审核 | LinkedIn + 活体检测 |
| **女性友好** | 男士真实头像门禁 + 女士卡通可选 | 付费申请机制 |
| **匹配解释** | AI生成匹配原因 + 冲突预警 | 职业标签展示 |
| **数字用户** | 3,500 Bot用户冷启动 | 无 |
| **成本** | 免费基础功能 | 付费申请($20+) |

### 1.3 可借鉴的核心亮点

```
┌─────────────────────────────────────────────────────────────────┐
│                    借鉴价值评估矩阵                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  高价值 + 易实现                                                │
│  ├── 女性收件箱(Inbox)设计 - 按匹配分排序 + 批量操作            │
│  ├── 限时聊天(24h Vault) - 增加紧迫感 + 隐私保护                │
│  ├── 匹配申请信(50字Pitch) - 增加诚意表达                       │
│  └── 隐私水印(Signed Cookies) - 防截图追踪                      │
│                                                                 │
│  高价值 + 需改造                                                │
│  ├── 致敬金机制 → 转化为"诚意值"(非现金)                        │
│  ├── 职业验证 → 可选LinkedIn连接增强信任                        │
│  └── 收益中心 → 转化为"影响力积分"系统                          │
│                                                                 │
│  低价值 / 不适用                                                │
│  ├── 纯付费申请机制(与LokFeel定位冲突)                          │
│  ├── 活体检测(成本过高)                                         │
│  └── 直接分账(合规复杂)                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、产品优化方案

### 2.1 优化模块总览

| 优先级 | 模块 | 改动范围 | 预期效果 |
|--------|------|----------|----------|
| P0 | **女性收件箱重构** | Matches页面 | 提升女性用户体验 |
| P0 | **限时聊天室** | Chat页面 | 增加互动紧迫感 |
| P1 | **匹配申请信** | Match详情页 | 增加诚意表达 |
| P1 | **诚意值系统** | 新模块 | 替代现金致敬金 |
| P2 | **隐私保护增强** | 全局 | 截图追踪+水印 |
| P2 | **职业认证** | Profile页 | 可选LinkedIn连接 |

---

## 三、详细设计方案

### 3.1 女性收件箱重构 (P0)

#### 现状问题
- 匹配列表平铺展示，无优先级排序
- 缺乏批量操作能力
- 无"已读/未读"状态区分

#### 优化设计

```typescript
// 新数据结构
interface InboxMatch {
  id: string;
  otherUser: {
    id: string;
    name: string;
    age: number;
    avatar: string;
    city: string;
    occupation?: string; // 新增职业标签
    isVerified: boolean; // 新增验证状态
  };
  matchScore: number;
  matchReason: string;
  
  // 新增字段
  pitchMessage?: string;      // 申请信(如果男方发送了)
  hasGift?: boolean;          // 是否附赠诚意值
  giftAmount?: number;        // 诚意值数量
  isUnread: boolean;          // 未读状态
  receivedAt: Date;           // 收到时间
  expiresAt: Date;            // 过期时间(72小时)
  
  // 快捷操作
  actions: {
    canAccept: boolean;
    canPass: boolean;
    canMaybe: boolean;
    canReport: boolean;
  };
}
```

#### UI设计

```
┌─────────────────────────────────────────────────────────────────┐
│  📬 Inbox                                    [Filter ▼] [Batch] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [🔥 High Priority]  [⭐ Verified]  [🎁 With Gift]  [⏰ Expiring]│
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ●  Alex, 32  [✓ Verified]                    94% Match  │ │
│  │  💼 Software Engineer at Google                🔥 High   │ │
│  │  📍 San Francisco                           2h ago      │ │
│  │                                                            │ │
│  │  "Hi! I noticed we both value deep conversations..."     │ │
│  │  🎁 +50 Sincerity Points                                   │ │
│  │                                                            │ │
│  │  [💚 Accept]  [💛 Maybe]  [❌ Pass]  [⏰ 70h left]        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ○  Michael, 29                               87% Match  │ │
│  │  💼 Product Manager                          ⭐ Medium  │ │
│  │  📍 New York                                 5h ago      │ │
│  │                                                            │ │
│  │  [💚 Accept]  [💛 Maybe]  [❌ Pass]  [⏰ 67h left]        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 排序算法

```typescript
// 女性收件箱排序权重
function calculateInboxPriority(match: InboxMatch): number {
  let score = 0;
  
  // 匹配分数权重 (40%)
  score += match.matchScore * 0.4;
  
  // 验证状态权重 (20%)
  if (match.otherUser.isVerified) score += 20;
  
  // 诚意值权重 (20%)
  score += (match.giftAmount || 0) * 0.2;
  
  // 时效性权重 (15%) - 越新越优先
  const hoursSinceReceived = (Date.now() - match.receivedAt.getTime()) / 3600000;
  score += Math.max(0, 15 - hoursSinceReceived * 0.5);
  
  // 过期紧迫性 (5%) - 即将过期的优先
  const hoursUntilExpiry = (match.expiresAt.getTime() - Date.now()) / 3600000;
  if (hoursUntilExpiry < 24) score += 5;
  
  return score;
}
```

---

### 3.2 限时聊天室 - The 24h Vault (P0)

#### 核心机制

```typescript
interface ChatRoomConfig {
  // 倒计时设置
  durationHours: number;        // 默认24小时
  extensionEnabled: boolean;    // 是否允许延长
  maxExtensions: number;        // 最大延长次数
  extensionHours: number;       // 每次延长时长
  
  // 权限控制
  permissions: {
    femaleCanRevoke: boolean;   // 女方可随时终止
    femaleFirstMessage: boolean; // 女方先发消息
    canScreenshot: boolean;     // 是否允许截图
  };
  
  // 隐私保护
  privacy: {
    dynamicWatermark: boolean;  // 动态水印
    screenshotDetection: boolean; // 截图检测
    autoDeleteOnExpiry: boolean; // 过期自动删除
  };
}
```

#### UI设计

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                    🔒 The Vault                ⏰ 14:32 │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ⏳ This conversation will expire in 14 hours 32 minutes  │ │
│  │  💡 Tip: Exchange contact info before time runs out!      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  👤 Alex joined the vault                                 │ │
│  │  2:30 PM                                                  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│       ┌─────────────────────────┐                              │
│       │  Hey! Thanks for        │                              │
│       │  accepting my match 😊  │                              │
│       │                    2:31 │                              │
│       └─────────────────────────┘                              │
│                                                                 │
│                              ┌─────────────────────────┐       │
│                              │  Hi Alex! I liked your  │       │
│                              │  pitch message. Tell me │       │
│                              │  more about your        │       │
│                              │  interest in hiking!    │       │
│                              │  2:35 PM                │       │
│                              └─────────────────────────┘       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [📎]  [Type a message...]                    [⏰ Extend +6h]  │
└─────────────────────────────────────────────────────────────────┘
```

#### 女性特权操作

```typescript
// 女性专属操作
interface FemaleChatControls {
  // 随时终止对话
  revokeChat: () => Promise<void>;
  
  // 延长对话时间
  extendChat: (hours: number) => Promise<void>;
  
  // 举报并终止
  reportAndBlock: (reason: string) => Promise<void>;
  
  // 查看对方诚意值历史
  viewSincerityHistory: () => Promise<SincerityRecord[]>;
}

// 终止对话后的处理
async function revokeChat(chatRoomId: string, userId: string) {
  // 1. 立即关闭WebSocket连接
  await closeWebSocket(chatRoomId);
  
  // 2. 标记聊天室状态为 REVOKED
  await prisma.chatRoom.update({
    where: { id: chatRoomId },
    data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: userId }
  });
  
  // 3. 从前端抹除聊天记录(软删除)
  await prisma.message.updateMany({
    where: { chatRoomId },
    data: { isDeleted: true }
  });
  
  // 4. 通知对方
  await sendPushNotification(otherUserId, {
    title: 'Conversation Ended',
    body: 'The other person has ended the conversation'
  });
  
  // 5. 记录行为(用于后续匹配算法)
  await recordInteraction(userId, 'CHAT_REVOKED', { chatRoomId });
}
```

---

### 3.3 匹配申请信 - Pitch Message (P1)

#### 功能设计

```typescript
interface PitchMessageConfig {
  enabled: boolean;
  minLength: number;      // 最少字数 (20)
  maxLength: number;      // 最多字数 (200)
  required: boolean;      // 是否必填
  templates: string[];    // 可选模板
}

// 申请信数据结构
interface PitchMessage {
  id: string;
  matchId: string;
  senderId: string;
  content: string;        // 申请信内容
  tone: 'casual' | 'sincere' | 'playful' | 'direct';
  createdAt: Date;
  
  // AI辅助生成
  aiAssisted: boolean;    // 是否使用AI辅助
  aiSuggestions: string[]; // AI建议的改进点
}
```

#### UI设计 - 男方发送申请

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                                          Step 2 of 2    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  💌 Write Your Pitch Message                                    │
│                                                                 │
│  This is your chance to make a great first impression.         │
│  Tell Sarah why you'd be a good match!                         │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Hey Sarah! 👋                                            │ │
│  │                                                           │ │
│  │  I noticed we both value deep conversations and           │ │
│  │  have a secure attachment style. I'd love to chat         │ │
│  │  about our shared interest in hiking and maybe            │ │
│  │  plan a trail adventure together!                         │ │
│  │                                                           │ │
│  │                                      142/200 characters   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  🎁 Attach Sincerity Points (Optional)                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  [○] None  [○] 10 pts  [●] 25 pts  [○] 50 pts  [○] 100   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  💡 AI Suggestions:                                             │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  • Mention a specific detail from her profile             │ │
│  │  • Ask an open-ended question                             │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│              [💡 Get AI Help]  [🚀 Send Application]            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### AI辅助写作功能

```typescript
// AI辅助生成申请信
async function generatePitchWithAI(
  senderProfile: Profile,
  receiverProfile: Profile,
  matchReason: string,
  tone: string
): Promise<string> {
  const prompt = `
    Help write a personalized pitch message for a dating app match.
    
    Sender: ${senderProfile.displayName}, ${senderProfile.age}
    Sender interests: ${senderProfile.interests?.join(', ')}
    
    Receiver: ${receiverProfile.displayName}, ${receiverProfile.age}
    Receiver bio: ${receiverProfile.bio}
    Receiver interests: ${receiverProfile.interests?.join(', ')}
    
    Match reason: ${matchReason}
    Desired tone: ${tone}
    
    Requirements:
    - 50-150 characters
    - Genuine and specific
    - Include one question
    - No generic compliments
    
    Generate 3 options:
  `;
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8
  });
  
  return parseAIResponse(response.choices[0].message.content);
}
```

---

### 3.4 诚意值系统 - Sincerity Points (P1)

#### 核心概念

将Elite Power的"现金致敬金"转化为平台内"诚意值"系统：
- **非现金**: 避免合规和支付复杂度
- **可赚取**: 通过完善资料、活跃互动获得
- **可消费**: 用于提升匹配优先级、解锁特权
- **不可提现**: 仅限平台内使用

```typescript
// 诚意值系统配置
interface SinceritySystem {
  // 赚取途径
  earning: {
    completeProfile: number;      // 完善资料: 100 pts
    verifyEmail: number;          // 验证邮箱: 50 pts
    verifyPhoto: number;          // 照片验证: 100 pts
    dailyLogin: number;           // 每日登录: 10 pts
    receiveMatch: number;         // 被匹配: 20 pts
    receiveAccept: number;        // 被接受: 50 pts
    goodChatRating: number;       // 聊天好评: 30 pts
    inviteFriend: number;         // 邀请好友: 100 pts
  };
  
  // 消费途径
  spending: {
    sendPitch: number;            // 发送申请信: 免费
    attachGift: {                 // 附赠诚意值
      min: 10;
      max: 100;
      multiplier: 1.0;            // 女方获得 = 男方送出 × multiplier
    };
    boostProfile: number;         // 提升曝光: 50 pts/天
    extendChat: number;           // 延长聊天: 25 pts/6h
    seeWhoLiked: number;          // 查看谁喜欢你: 100 pts
    prioritySupport: number;      // 优先客服: 50 pts
  };
  
  // 等级系统
  tiers: {
    bronze: { min: 0, max: 499, benefits: ['Basic matching'] };
    silver: { min: 500, max: 1999, benefits: ['Priority matching', 'Read receipts'] };
    gold: { min: 2000, max: 4999, benefits: ['Profile boost', 'Extended chat'] };
    platinum: { min: 5000, benefits: ['VIP badge', 'Unlimited extensions'] };
  };
}
```

#### 数据库模型

```prisma
// 新增模型
model SincerityWallet {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  balance     Int      @default(0)     // 当前余额
  totalEarned Int      @default(0)     // 累计获得
  totalSpent  Int      @default(0)     // 累计消费
  tier        String   @default("bronze") // 当前等级
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model SincerityTransaction {
  id          String   @id @default(cuid())
  walletId    String
  wallet      SincerityWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)
  
  type        String   // EARN, SPEND, RECEIVE_GIFT, SEND_GIFT
  amount      Int
  
  // 关联信息
  source      String   // 来源: PROFILE_COMPLETE, MATCH_ACCEPTED, etc.
  matchId     String?  // 关联的匹配(如果是礼物)
  
  // 礼物特有
  fromUserId  String?  // 送礼人
  toUserId    String?  // 收礼人
  message     String?  // 附言
  
  createdAt   DateTime @default(now())
  
  @@index([walletId])
  @@index([createdAt])
}
```

#### UI设计 - 诚意值中心

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                                           Sincerity     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │                    💎 1,250 pts                           │ │
│  │                                                           │ │
│  │              🥇 Gold Member (2,750 to Platinum)          │ │
│  │                                                           │ │
│  │         [▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░] 31%               │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  📈 Earn Points                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  ✅ Complete profile (+100)        [Done]                 │ │
│  │  ✅ Verify email (+50)             [Done]                 │ │
│  │  📸 Verify photo (+100)            [Start]                │ │
│  │  👥 Invite a friend (+100)         [Invite]               │ │
│  │  📅 Daily login (+10)              [Claim]                │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  💝 Recent Activity                                             │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  +50  Match accepted by Sarah              2h ago         │ │
│  │  -25  Extended chat with Alex              5h ago         │ │
│  │  +10  Daily login bonus                    1d ago         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3.5 隐私保护增强 (P2)

#### 截图检测与追踪

```typescript
// 截图检测实现
interface ScreenshotProtection {
  // 检测方法
  detectScreenshot(): void;
  
  // 响应处理
  onScreenshotDetected: (context: ScreenshotContext) => Promise<void>;
  
  // 水印生成
  generateWatermark: (userId: string, timestamp: Date) => string;
}

// 实现代码
function initScreenshotProtection() {
  // 方法1: 监听 visibilitychange + keydown
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // 用户切换到其他应用，可能是截图
      reportPotentialScreenshot('APP_SWITCH');
    }
  });
  
  // 方法2: 监听特定按键组合
  document.addEventListener('keydown', (e) => {
    // Mac: Cmd+Shift+3/4, Win: PrintScreen
    if ((e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4')) ||
        e.key === 'PrintScreen') {
      e.preventDefault();
      reportPotentialScreenshot('KEYBOARD_SHORTCUT');
    }
  });
  
  // 方法3: 动态水印
  injectDynamicWatermark();
}

// 动态水印
function injectDynamicWatermark() {
  const watermark = document.createElement('div');
  watermark.className = 'dynamic-watermark';
  watermark.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 9999;
    opacity: 0.03;
    font-size: 14px;
    color: white;
    transform: rotate(-30deg);
    user-select: none;
  `;
  
  // 每30秒更新一次水印位置和用户信息
  setInterval(() => {
    const userId = getCurrentUserId();
    const timestamp = new Date().toISOString();
    const randomPos = generateRandomPosition();
    
    watermark.textContent = `${userId} | ${timestamp}`;
    watermark.style.left = randomPos.x + 'px';
    watermark.style.top = randomPos.y + 'px';
  }, 30000);
  
  document.body.appendChild(watermark);
}
```

#### 图片安全策略

```typescript
// Signed URL策略
interface SecureImageConfig {
  // 图片访问控制
  signedUrlExpiry: number;      // URL过期时间(秒): 300
  maxRequestsPerUrl: number;    // 每个URL最大请求数: 10
  
  // 防盗链
  refererCheck: boolean;        // 检查Referer
  allowedDomains: string[];     // 允许的域名列表
  
  // 内容保护
  blurOnScreenshot: boolean;    // 检测截图时模糊
  degradeQuality: boolean;      // 降低图片质量防保存
}

// 生成安全图片URL
async function generateSecureImageUrl(
  imageKey: string,
  userId: string,
  sessionId: string
): Promise<string> {
  const timestamp = Date.now();
  const expiry = timestamp + 5 * 60 * 1000; // 5分钟过期
  
  // 生成签名
  const signature = crypto
    .createHmac('sha256', process.env.IMAGE_SIGNING_SECRET!)
    .update(`${imageKey}:${userId}:${sessionId}:${expiry}`)
    .digest('hex');
  
  // 记录访问日志
  await prisma.imageAccessLog.create({
    data: {
      imageKey,
      userId,
      sessionId,
      createdAt: new Date()
    }
  });
  
  return `/api/images/${imageKey}?s=${signature}&e=${expiry}&u=${userId}`;
}
```

---

### 3.6 职业认证 (P2)

#### 可选LinkedIn连接

```typescript
interface LinkedInVerification {
  enabled: boolean;
  required: boolean;            // 是否强制
  
  // 获取的数据
  data: {
    companyName: string;
    jobTitle: string;
    industry: string;
    connectionCount: number;     // 好友数(验证真实性)
    profileUrl: string;          // 加密存储
  };
  
  // 验证徽章
  badge: {
    type: 'VERIFIED_PROFESSIONAL' | 'ELITE_NETWORK';
    icon: string;
    tooltip: string;
  };
}

// 验证流程
async function verifyLinkedInProfile(code: string): Promise<VerificationResult> {
  // 1. 用code换取access token
  const token = await linkedInOAuth.exchangeCode(code);
  
  // 2. 获取用户资料
  const profile = await linkedInAPI.getProfile(token);
  
  // 3. 验证好友数(>100视为真实账号)
  if (profile.connections < 100) {
    return { success: false, reason: 'INSUFFICIENT_CONNECTIONS' };
  }
  
  // 4. 加密存储(不存明文URL)
  const encryptedUrl = encrypt(profile.profileUrl);
  
  // 5. 更新用户资料
  await prisma.profile.update({
    where: { userId },
    data: {
      occupation: profile.jobTitle,
      company: profile.companyName,
      industry: profile.industry,
      linkedInVerified: true,
      linkedInUrlEncrypted: encryptedUrl,
      verificationBadge: profile.connections > 500 ? 'ELITE' : 'VERIFIED'
    }
  });
  
  // 6. 奖励诚意值
  await addSincerityPoints(userId, 150, 'LINKEDIN_VERIFIED');
  
  return { success: true };
}
```

---

## 四、实施路线图

### Phase 1: 基础功能 (Week 1-2)

| 任务 | 负责人 | 工期 | 依赖 |
|------|--------|------|------|
| 女性收件箱重构 | Frontend | 3d | - |
| 匹配申请信功能 | Fullstack | 4d | - |
| 诚意值数据库设计 | Backend | 2d | - |
| 诚意值基础API | Backend | 3d | DB设计 |

### Phase 2: 核心体验 (Week 3-4)

| 任务 | 负责人 | 工期 | 依赖 |
|------|--------|------|------|
| 限时聊天室(24h Vault) | Fullstack | 5d | - |
| 诚意值赚取/消费流程 | Fullstack | 4d | 基础API |
| AI辅助Pitch生成 | Backend | 3d | - |
| 女性特权控制面板 | Frontend | 3d | 限时聊天 |

### Phase 3: 增强功能 (Week 5-6)

| 任务 | 负责人 | 工期 | 依赖 |
|------|--------|------|------|
| 截图检测与水印 | Frontend | 3d | - |
| 图片Signed URL | Backend | 2d | - |
| LinkedIn OAuth集成 | Backend | 3d | - |
| 职业认证徽章 | Frontend | 2d | OAuth |

### Phase 4: 优化迭代 (Week 7-8)

| 任务 | 负责人 | 工期 | 依赖 |
|------|--------|------|------|
| A/B测试配置 | Data | 2d | - |
| 数据分析仪表板 | Frontend | 3d | - |
| 用户反馈收集 | Fullstack | 2d | - |
| 性能优化 | Fullstack | 3d | - |

---

## 五、技术实现要点

### 5.1 数据库迁移

```sql
-- 新增表
CREATE TABLE "SincerityWallet" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT UNIQUE NOT NULL,
  "balance" INTEGER DEFAULT 0,
  "totalEarned" INTEGER DEFAULT 0,
  "totalSpent" INTEGER DEFAULT 0,
  "tier" TEXT DEFAULT 'bronze',
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "updatedAt" TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE "SincerityTransaction" (
  "id" TEXT PRIMARY KEY,
  "walletId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "matchId" TEXT,
  "fromUserId" TEXT,
  "toUserId" TEXT,
  "message" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- 扩展Match表
ALTER TABLE "Match" ADD COLUMN "pitchMessage" TEXT;
ALTER TABLE "Match" ADD COLUMN "giftAmount" INTEGER DEFAULT 0;
ALTER TABLE "Match" ADD COLUMN "isUnread" BOOLEAN DEFAULT true;
ALTER TABLE "Match" ADD COLUMN "expiresAt" TIMESTAMPTZ;

-- 扩展ChatRoom表
ALTER TABLE "ChatRoom" ADD COLUMN "vaultExpiry" TIMESTAMPTZ;
ALTER TABLE "ChatRoom" ADD COLUMN "status" TEXT DEFAULT 'ACTIVE';
ALTER TABLE "ChatRoom" ADD COLUMN "revokedAt" TIMESTAMPTZ;
ALTER TABLE "ChatRoom" ADD COLUMN "revokedBy" TEXT;

-- 扩展Profile表
ALTER TABLE "Profile" ADD COLUMN "occupation" TEXT;
ALTER TABLE "Profile" ADD COLUMN "company" TEXT;
ALTER TABLE "Profile" ADD COLUMN "industry" TEXT;
ALTER TABLE "Profile" ADD COLUMN "linkedInVerified" BOOLEAN DEFAULT false;
ALTER TABLE "Profile" ADD COLUMN "verificationBadge" TEXT;
```

### 5.2 API设计

```typescript
// 新增API路由

// 诚意值系统
POST   /api/sincerity/earn          // 赚取积分
POST   /api/sincerity/spend          // 消费积分
GET    /api/sincerity/balance        // 查询余额
GET    /api/sincerity/history        // 交易历史
GET    /api/sincerity/leaderboard    // 排行榜

// 匹配申请
POST   /api/matches/:id/pitch        // 发送申请信
POST   /api/matches/:id/gift         // 附赠诚意值
GET    /api/matches/inbox            // 女性收件箱(排序后)
POST   /api/matches/:id/batch-action // 批量操作

// 限时聊天
POST   /api/chat/:id/extend          // 延长聊天
POST   /api/chat/:id/revoke          // 终止聊天
GET    /api/chat/:id/time-left       // 查询剩余时间

// 职业认证
GET    /api/auth/linkedin            // LinkedIn OAuth
POST   /api/auth/linkedin/callback   // OAuth回调
```

### 5.3 Cron任务

```typescript
// 新增定时任务

// 每小时：检查即将过期的匹配
'0 * * * *': async () => {
  const expiringMatches = await prisma.match.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
    }
  });
  
  // 发送提醒通知
  for (const match of expiringMatches) {
    await sendExpiryReminder(match);
  }
}

// 每天凌晨：清理过期数据
'0 3 * * *': async () => {
  // 过期匹配自动标记为EXPIRED
  await prisma.match.updateMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: new Date() }
    },
    data: { status: 'EXPIRED' }
  });
  
  // 过期聊天室自动关闭
  await prisma.chatRoom.updateMany({
    where: {
      status: 'ACTIVE',
      vaultExpiry: { lt: new Date() }
    },
    data: { status: 'EXPIRED' }
  });
}
```

---

## 六、成功指标

### 6.1 核心KPI

| 指标 | 基准值 | 目标值 | 测量方式 |
|------|--------|--------|----------|
| 女性匹配响应率 | 35% | 55% | 匹配接受数/总匹配数 |
| 平均聊天时长 | 12h | 20h | 聊天持续时间中位数 |
| 申请信使用率 | 0% | 60% | 发送Pitch的匹配数/总匹配数 |
| 诚意值活跃度 | 0% | 40% | 有交易的用户数/总用户数 |
| 女性满意度 | N/A | 4.2/5 | 应用内调研 |

### 6.2 监控指标

```typescript
interface ProductOptimizationMetrics {
  // 功能使用
  inboxViewsPerDay: number;
  batchActionsUsed: number;
  pitchMessagesSent: number;
  aiPitchGenerated: number;
  vaultChatsCreated: number;
  vaultExtensionsUsed: number;
  vaultRevokes: number;
  
  // 转化漏斗
  matchToPitchRate: number;      // 匹配→发送申请信
  pitchToAcceptRate: number;     // 申请信→被接受
  acceptToChatRate: number;      // 接受→开启聊天
  chatToExchangeRate: number;    // 聊天→交换联系方式
  
  // 留存
  day1Retention: number;
  day7Retention: number;
  day30Retention: number;
}
```

---

## 七、风险评估与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 诚意值系统被滥用 | 中 | 高 | 设置每日上限，异常检测 |
| 限时聊天引起焦虑 | 中 | 中 | 提供延长选项，明确提示 |
| 截图检测误报 | 高 | 低 | 多次确认后才警告 |
| 女性用户感到压力 | 低 | 高 | 所有功能可选，不强制 |
| 技术实现复杂度高 | 中 | 中 | 分阶段实施，MVP优先 |

---

## 八、总结

本优化方案借鉴Elite Power的核心设计理念，将其"女性主导"和"诚意表达"机制转化为适合LokFeel的产品功能：

1. **非现金化**: 将现金致敬金转化为平台内"诚意值"，降低合规风险
2. **可选增强**: 所有新功能均为可选，不破坏现有用户体验
3. **技术可行**: 基于现有架构扩展，无需大规模重构
4. **数据驱动**: 每个功能都有明确的KPI和监控指标

**建议实施顺序**:
1. Week 1-2: 女性收件箱 + 匹配申请信 (快速见效)
2. Week 3-4: 诚意值系统 + 限时聊天 (核心体验)
3. Week 5-6: 隐私保护 + 职业认证 (差异化)
4. Week 7-8: 数据分析 + 优化迭代 (持续改进)

---

*文档结束*
