# LokFeel 管理后台系统 — 产品规划与系统设计 v2.0

> **文档版本**: v2.0 | **日期**: 2026-04-29 | **作者**: Scout
> **状态**: Draft — 待评审
> **变更说明**: 全面展开二三四级功能树，新增AI推广图/AI客服/VIP收件箱三大模块，更新路由/API/数据库设计

---

## 一、执行摘要

### 1.1 背景与动机

LokFeel 当前管理后台 (`/admin`) 原有7个基础页面（概览/用户/用户详情/匹配/内容/分析/设置），功能停留在只读查看和数据导入阶段。v2.0在v1.0基础上进行全面深化：

- **所有模块展开到二级、三级、四级功能树**
- **数据分析模块**：用户追踪 + 流量属性细化到四级
- **新增 AI推广图生成模块**（展开到四级）
- **新增 AI客服设置模块**（展开到四级）
- **新增 VIP客户收件箱模块**（展开到四级）
- **更新路由规划、API设计、数据库变更**

### 1.2 核心目标（v2.0 新增）

| 优先级 | 目标 | 衡量指标 |
|--------|------|----------|
| P0 | 全局监控仪表盘 | 实时数据 <5s 延迟，覆盖 8 大核心指标 |
| P0 | 用户全生命周期管理 | 从注册→Onboarding→活跃→流失，全链路可干预 |
| P0 | 安全与内容审核 | 举报处理 <2h SLA，Bot 异常行为实时告警 |
| **P0（新增）** | **AI增长工具链** | **推广图自动生成、客服自动回复、VIP专属服务** |
| P1 | 匹配引擎监控 | 匹配成功率、冲突预警、算法参数可调 |
| P1 | 支付与订阅管理 | 收入追踪、退款处理、套餐配置 |
| P2 | Bot 数字用户管理 | Bot 生命周期、学习效果、行为模拟调控 |
| P2 | 系统配置与权限 | 多管理员、RBAC、操作审计 |

---

## 二、模块功能树（全部展开至二/三/四级）

---

### 2.1 全局监控仪表盘 `/admin`

#### 一级模块：全局监控仪表盘
#### 二级模块：
1. **P0 核心指标卡片（KPI Cards）**
2. **P1 实时趋势图**
3. **P1 告警面板**
4. **P2 最近活动流（Activity Feed）**

#### 三级模块（以 P0 核心指标卡片为例）：
```
P0 核心指标卡片
├── 👥 总用户卡片
│   ├── 四级：真实用户数（按日/周/月）
│   ├── 四级：Bot用户数（按SEED/SIMULATION/TRAINING/ACTIVE）
│   ├── 四级：本日新增趋势（折线图）
│   └── 四级：环比增长率（↑↓）
│
├── 💳 付费用户卡片
│   ├── 四级：Premium活跃用户数
│   ├── 四级：Lady Free用户数
│   ├── 四级：总MRR（月经常性收入）
│   └── 四级：付费转化率（%）
│
├── 💬 活跃会话卡片
│   ├── 四级：进行中Conversation数
│   ├── 四级：今日消息总数
│   └── 四级：平均会话时长
│
├── ❤️ 匹配效果卡片
│   ├── 四级：本周匹配总数
│   ├── 四级：匹配接受率（%）
│   └── 四级：平均匹配分
│
├── 🚨 待处理告警卡片
│   ├── 四级：未读举报数
│   ├── 四级：异常Bot数（>80%拒绝率）
│   └── 四级：付款失败数
│
└── 📈 增长漏斗卡片
    ├── 四级：注册→Onboarding完成率
    ├── 四级：Onboarding→首匹配转化率
    └── 四级：首匹配→付费转化率
```

#### 三级模块（P1 实时趋势图）：
```
P1 实时趋势图
├── 📈 用户注册趋势
│   ├── 四级：7天折线图
│   ├── 四级：30天折线图
│   ├── 四级：90天折线图
│   └── 四级：真实用户 vs Bot用户分层
│
├── ❤️ 匹配成功率趋势
│   ├── 四级：按天展示 accept/(accept+reject+pass+expired)
│   ├── 四级：按周展示
│   └── 四级：按月展示
│
├── 💬 消息活跃度
│   ├── 四级：日消息量柱状图
│   ├── 四级：按小时分布heatmap
│   └── 四级：消息类型分布（TEXT/IMAGE/SYSTEM）
│
└── 💰 收入趋势
    ├── 四级：MRR折线图
    ├── 四级：日收入柱状图
    └── 四级：累计收入
```

#### 三级模块（P1 告警面板）：
```
P1 告警面板
├── 🔴 CRITICAL（需立即处理）
│   ├── 四级：Bot异常行为（3h内匹配拒绝率>80%）
│   ├── 四级：支付失败（连续3次）
│   └── 四级：数据库连接异常
│
├── 🟡 WARNING（需关注）
│   ├── 四级：举报积压（>10条未处理）
│   ├── 四级：Bot响应延迟（>60min）
│   └── 四级：匹配成功率连续3天下降
│
└── 🟢 INFO（信息通知）
    ├── 四级：新版本部署成功
    └── 四级：数据备份完成
```

---

### 2.2 用户管理 `/admin/users`

#### 一级模块：用户管理
#### 二级模块：
1. **P0 用户列表页**
2. **P0 用户详情页**
3. **P1 Bot用户管理**
4. **P2 用户行为追踪**（v2.0新增）

#### 三级模块（用户列表页）：
```
P0 用户列表页
├── 🔍 筛选器
│   ├── 四级：关键词搜索（邮箱/昵称/ID，支持模糊匹配）
│   ├── 四级：角色筛选（真实用户 / Bot用户）
│   ├── 四级：性别筛选（Male / Female / Non-binary）
│   ├── 四级：状态筛选（DRAFT/PENDING_REVIEW/APPROVED/REJECTED/DEACTIVATED/BANNED）
│   ├── 四级：订阅筛选（Free / Lady Free / Premium）
│   ├── 四级：注册时间范围（日期区间选择器）
│   ├── 四级：举报状态筛选（有举报 / 无举报）
│   ├── 四级：Bot类型筛选（SEED/SIMULATION/TRAINING/ACTIVE）
│   └── 四级：Bot活跃度筛选（GHOST/LOW/MEDIUM/HIGH/FULL）
│
├── 📋 列表字段
│   ├── 四级：头像（40px缩略图）
│   ├── 四级：昵称（displayName，可排序）
│   ├── 四级：邮箱（脱敏显示，隐藏@前3位）
│   ├── 四级：性别（icon标识）
│   ├── 四级：年龄
│   ├── 四级：Profile状态badge
│   ├── 四级：订阅badge
│   ├── 四级：Bot标识tag
│   ├── 四级：匹配数（sentMatches + receivedMatches count）
│   ├── 四级：注册时间（可排序）
│   ├── 四级：最后活跃（从Presence推断，可排序）
│   └── 四级：操作列（查看/编辑/封禁/删除）
│
└── ⚡ 批量操作
    ├── 四级：导出CSV（可自定义导出字段）
    ├── 四级：批量修改状态
    ├── 四级：批量分配Lady Free
    └── 四级：批量禁用Bot
```

#### 三级模块（用户详情页）：
```
P0 用户详情页（Tab化设计）
├── Tab1 基础信息
│   ├── 四级：头像大图 + 基本信息卡片
│   ├── 四级：邮箱（解密显示）+ 注册时间 + 最后活跃
│   ├── 四级：Role标签 + 身份验证状态
│   ├── 四级：Card Verified状态
│   └── 四级：操作按钮（编辑/重置密码/切换角色/删除）
│
├── Tab2 关系蓝图（Profile）
│   ├── 四级：关系目标（RelationshipGoal）
│   ├── 四级：依恋风格（AttachmentStyle）
│   ├── 四级：沟通风格（CommunicationStyle）
│   ├── 四级：冲突解决方式（ConflictResolution）
│   ├── 四级：爱的语言（LoveLanguage）
│   ├── 四级：情绪可用性（EmotionalAvailability）
│   ├── 四级：生命优先级（JSON可视化）
│   ├── 四级：Dealbreakers列表
│   ├── 四级：偏好标签（selectedTags）
│   ├── 四级：匹配偏好（年龄/性别/距离/地点）
│   ├── 四级：职业信息（occupation/company/industry）
│   └── 四级：地理位置信息
│
├── Tab3 订阅与支付
│   ├── 四级：当前套餐 + 状态 + 到期时间
│   ├── 四级：支付历史（Payment表）
│   ├── 四级：诚意值余额 + 等级 + 交易明细
│   └── 四级：手动操作（分配/取消Lady Free，调整诚意值）
│
├── Tab4 匹配记录
│   ├── 四级：发出/收到的匹配列表
│   ├── 四级：匹配分数分布图
│   ├── 四级：反馈汇总（accept/pass/maybe/block比例）
│   └── 四级：匹配解释（matchReason）
│
├── Tab5 聊天记录
│   ├── 四级：会话列表（Conversation表）
│   ├── 四级：消息详情（IMMessage + Message）
│   ├── 四级：在线状态历史（UserPresence）
│   └── 四级：Vault状态（vaultStatus/vaultExpiry）
│
├── Tab6 安全与举报
│   ├── 四级：发出的举报（reportsMade）
│   ├── 四级：收到的举报（reportsReceived）+ 处理状态
│   ├── 四级：AuditLog相关记录
│   └── 四级：设备/IP信息
│
└── Tab7 Admin备注（v2.0新增）
    ├── 四级：adminNotes文本框
    ├── 四级：内部标签（adminTags String[]）
    └── 四级：操作历史时间线
```

#### 三级模块（用户行为追踪 - v2.0新增）：
```
P2 用户行为追踪
├── 📍 用户轨迹追踪
│   ├── 四级：页面访问路径（按时间排列）
│   ├── 四级：关键行为事件（注册/Onboarding/匹配/聊天/付费）
│   ├── 四级：停留时长分析（各页面）
│   └── 四级：设备信息（OS/Browser/分辨率）
│
├── ⏱️ 活跃度分析
│   ├── 四级：日活跃（DAU）/ 周活跃（WAU）/ 月活跃（MAU）
│   ├── 四级：平均在线时长
│   ├── 四级：活跃时段分布（heatmap）
│   └── 四级：沉默用户预警（X天未活跃）
│
└── 🎯 用户分群
    ├── 四级：高价值用户（付费 + 高活跃）
    ├── 四级：流失风险用户（活跃下降趋势）
    ├── 四级：沉睡用户（注册后未完成Onboarding）
    └── 四级：超级活跃用户（Top 10%参与度）
```

---

### 2.3 安全与内容审核 `/admin/users/reports`

#### 一级模块：安全与内容审核
#### 二级模块：
1. **P0 举报管理**
2. **P1 敏感词监控**
3. **P2 封禁/白名单管理**

#### 三级模块（举报管理）：
```
P0 举报管理
├── 📋 举报列表视图
│   ├── 四级：举报ID / 举报人 / 被举报人 / 原因 / 状态 / 创建时间 / 处理人
│   ├── 四级：状态筛选（PENDING/UNDER_REVIEW/RESOLVED_*/DISMISSED）
│   ├── 四级：原因筛选（INAPPROPRIATE_CONTENT/HARASSMENT/FAKE_PROFILE/SPAM）
│   └── 四级：SLA状态标签（正常/预警/逾期）
│
├── 🔄 处理工作流
│   ├── 四级：PENDING → UNDER_REVIEW（认领操作）
│   ├── 四级：RESOLVED_NO_ACTION（无操作）
│   ├── 四级：RESOLVED_WARNING（发送警告通知）
│   ├── 四级：RESOLVED_BANNED（封禁用户，含时长选择）
│   └── 四级：DISMISSED（误报标记）
│
├── 📊 处理面板
│   ├── 四级：举报详情 + 关联聊天记录截图
│   ├── 四级：举报人历史（举报次数统计）
│   ├── 四级：被举报人历史（被举报次数/处理历史）
│   └── 四级：处理备注（adminNotes）
│
└── 📈 SLA追踪
    ├── 四级：举报平均处理时间
    ├── 四级：逾期未处理数量（>2小时）
    └── 四级：按原因分类的举报趋势图
```

#### 三级模块（敏感词监控）：
```
P1 敏感词监控
├── ⚠️ 违规消息列表
│   ├── 四级：消息内容（已脱敏）
│   ├── 四级：发送者信息
│   ├── 四级：违规规则（PowerBoardRule名称）
│   ├── 四级：触发结果（HARD_BLOCK/SOFT_BLOCK/PACE_LIMIT）
│   └── 四级：处理状态
│
└── 📊 违规统计
    ├── 四级：按严重程度排序（CRITICAL/HIGH/MEDIUM/LOW）
    ├── 四级：按规则分类统计
    └── 四级：高频违规用户列表（Top 20）
```

---

### 2.4 匹配引擎监控 `/admin/matches/engine`

#### 一级模块：匹配引擎监控
#### 二级模块：
1. **P1 引擎健康指标**
2. **P1 五维兼容性分布**
3. **P1 匹配质量分析**
4. **P1 匹配漏斗**
5. **P2 引擎参数配置**

#### 三级模块（引擎健康指标）：
```
P1 引擎健康指标
├── 📊 基础指标
│   ├── 四级：日匹配量（每日生成总数）
│   ├── 四级：接受率（accept / 总反应数）
│   ├── 四级：平均匹配分（matchScore均值）
│   ├── 四级：冲突预警率（有conflictWarnings占比）
│   ├── 四级：过期率（expired / total）
│   └── 四级：Pitch使用率（有pitchMessage占比）
│
├── 📈 趋势图
│   ├── 四级：7天/30天/90天接受率折线图
│   ├── 四级：接受率 vs 拒绝率堆叠图
│   └── 四级：匹配量热力图（按小时/星期）
│
└── 🚨 告警阈值配置
    ├── 四级：日匹配量下限（<50告警）
    ├── 四级：接受率下限（<30%连续3天告警）
    └── 四级：过期率上限（>40%告警）
```

#### 三级模块（五维兼容性分布）：
```
P1 五维兼容性分布
├── 📊 分项兼容性直方图
│   ├── 四级：Attachment Compatibility（依恋风格兼容度）
│   ├── 四级：Communication Compatibility（沟通风格兼容度）
│   ├── 四级：Conflict Resolution Compatibility（冲突解决兼容度）
│   ├── 四级：Values Compatibility（价值观兼容度）
│   └── 四级：Lifestyle Compatibility（生活方式兼容度）
│
├── 📈 综合分布
│   ├── 四级：总分（0-100）分布直方图
│   ├── 四级：高分区（80-100）占比
│   ├── 四级：低分区（0-30）占比
│   └── 四级：五维雷达图（单个用户维度）
│
└── 🔍 异常检测
    ├── 四级：高分手对被reject案例（score>80但reject）
    ├── 四级：低分通过案例（score<40但accept）
    └── 四级：五维分数差异异常检测
```

---

### 2.5 聊天监控 `/admin/chats`

#### 一级模块：聊天监控
#### 二级模块：
1. **P1 会话列表**
2. **P1 会话详情**
3. **P2 敏感词监控**

#### 三级模块（会话详情）：
```
P1 会话详情
├── 👥 参与者摘要
│   ├── 四级：用户A基础信息（头像/昵称/订阅）
│   ├── 四级：用户B基础信息（头像/昵称/订阅）
│   └── 四级：Bot标识（若是Bot-User交互）
│
├── 💬 消息时间线
│   ├── 四级：完整消息列表（按时间排序）
│   ├── 四级：已删除消息标记（显示"[消息已删除]"）
│   ├── 四级：媒体文件列表（IMAGE类型消息）
│   └── 四级：消息发送频率分析
│
├── 🔐 Consent状态流
│   ├── 四级：ConsentRequest时间线
│   ├── 四级：ConsentGrant/Denied记录
│   └── 四级：Consent过期预警
│
├── 🔒 Vault状态
│   ├── 四级：Vault激活时间
│   ├── 四级：Vault倒计时
│   └── 四级：vaultStatus变更记录
│
└── ⚙️ PowerBoard状态
    ├── 四级：双方PowerBoardRule配置查看
    ├── 四级：Rate Limiting状态（PACE_LIMIT触发次数）
    └── 四级：AuditLog相关条目
```

---

### 2.6 支付与订阅管理 `/admin/payments`

#### 一级模块：支付与订阅管理
#### 二级模块：
1. **P1 收入仪表盘**
2. **P1 订阅管理**
3. **P1 交易记录**
4. **P2 退款管理**

#### 三级模块（收入仪表盘）：
```
P1 收入仪表盘
├── 💰 核心收入指标
│   ├── 四级：MRR（月经常性收入）
│   ├── 四级：ARR（年化经常性收入）
│   ├── 四级：日/周/月收入趋势图
│   ├── 四级：付费转化率（Premium / 总活跃用户）
│   ├── 四级：ARPU（每用户平均收入）
│   ├── 四级：月流失率（Churn Rate）
│   └── 四级：LTV（用户生命周期价值，按Cohort估算）
│
├── 📊 收入来源拆分
│   ├── 四级：Premium Monthly vs Yearly占比饼图
│   ├── 四级：各套餐ARR贡献柱状图
│   └── 四级：新增付费 vs 续费收入对比
│
└── 📈 趋势预测
    ├── 四级：MRR预测线（基于历史趋势）
    ├── 四级：下月预计流失额
    └── 四级：收入健康度评分
```

---

### 2.7 Bot系统总控 `/admin/bot-system`

#### 一级模块：Bot系统总控
#### 二级模块：
1. **P2 Bot集群概览**
2. **P2 学习效果分析**
3. **P2 行为模拟配置**
4. **P2 Bot批量操作**

#### 三级模块（学习效果分析）：
```
P2 学习效果分析
├── 📊 BotPreference分布
│   ├── 四级：五维偏好向量均值/标准差统计
│   ├── 四级：各维度分布直方图
│   └── 四级：Top偏好组合识别
│
├── 🎯 学习置信度
│   ├── 四级：按sampleSize分段的confidence分布
│   ├── 四级：置信度提升趋势图
│   └── 四级：低置信度Bot预警列表
│
├── 🔬 A/B效果对比
│   ├── 四级：学习前接受率 vs 学习后接受率对比
│   ├── 四级：不同学习批次的成功率对比
│   └── 四级：统计显著性检验结果
│
└── 🧠 群体智慧
    ├── 四级：成功模式识别（高接受率Bot的共同特征）
    ├── 四级：季节性调整建议
    └── 四级：偏好推荐（建议Bot学习哪些特征）
```

---

### 2.8 同意管理与规则引擎 `/admin/content`

#### 一级模块：同意管理与规则引擎
#### 二级模块：
1. **P2 同意请求监控**
2. **P2 规则引擎监控**

#### 三级模块（规则引擎监控）：
```
P2 规则引擎监控
├── 📊 PowerBoardRule覆盖率
│   ├── 四级：已配置规则用户占比
│   ├── 四级：未配置规则用户占比
│   └── 四级：规则配置完整度评分
│
├── ⚡ 规则触发统计
│   ├── 四级：PASS / SOFT_BLOCK / HARD_BLOCK / PACE_LIMIT分布
│   ├── 四级：各规则类型触发频率排名
│   └── 四级：HARD_BLOCK高发用户预警
│
└── 👤 高频Block用户
    ├── 四级：被Block次数最多用户Top 20
    ├── 四级：Block触发原因分布
    └── 四级：Pace Control生效统计
```

---

## 三、数据分析模块（展开至四级）`/admin/analytics`

> v2.0重点深化：用户追踪 + 流量属性细化到四级

### 一级模块：数据分析

### 二级模块：
1. **P1 转化漏斗 `/admin/analytics/funnel`**
2. **P1 留存分析 `/admin/analytics/retention`**
3. **P1 收入分析 `/admin/analytics/revenue`**
4. **P1 用户追踪 `/admin/analytics/users`** ← v2.0新增
5. **P1 流量属性 `/admin/analytics/traffic`** ← v2.0新增

---

#### 3.1 转化漏斗 `/admin/analytics/funnel`（展开至四级）

```
P1 转化漏斗
├── 🔄 漏斗步骤定义
│   ├── 一级：访问Landing
│   ├── 二级：注册账号
│   ├── 三级：邮箱验证
│   ├── 四级：开始Onboarding
│   ├── 四级：完成Onboarding（step≥5）
│   ├── 四级：首次匹配发起
│   ├── 四级：首次消息发送
│   ├── 四级：首次匹配接受
│   └── 四级：付费转化
│
├── 📊 漏斗分析
│   ├── 四级：每步绝对人数
│   ├── 四级：每步转化率（与上一步比）
│   ├── 四级：总体转化率（注册→付费）
│   ├── 四级：漏斗断点识别（最大流失步骤高亮）
│   └── 四级：漏斗耗时分析（每步平均停留时长）
│
├── 📈 时间对比
│   ├── 四级：本周 vs 上周漏斗对比
│   ├── 四级：本月 vs 上月漏斗对比
│   ├── 四级：自定义时间段对比
│   └── 四级：漏斗趋势线图
│
└── 🎯 渠道拆分
    ├── 四级：按UTM_source拆分漏斗
    ├── 四级：按UTM_medium拆分漏斗
    ├── 四级：按UTM_campaign拆分漏斗
    └── 四级：按Referrer拆分漏斗
```

#### 3.2 留存分析 `/admin/analytics/retention`（展开至四级）

```
P1 留存分析
├── 📊 留存率指标
│   ├── 四级：D1留存率（次日留存）
│   ├── 四级：D7留存率（7日留存）
│   ├── 四级：D30留存率（30日留存）
│   ├── 四级：自定义日期留存率（N日留存）
│   └── 四级：留存率置信区间
│
├── 🗓️ Cohort分析
│   ├── 四级：Cohort热力图（横轴：月份，纵轴：留存天数）
│   ├── 四级：按注册月份分组的Cohort表格
│   ├── 四级：留存率颜色梯度（绿=高，红=低）
│   └── 四级：Cohort对比（某Cohort vs 全体均值）
│
├── 🎯 用户分群留存
│   ├── 四级：按性别分群的留存率对比
│   ├── 四级：按订阅类型分群（Free vs Premium）
│   ├── 四级：按年龄区间分群（18-24/25-34/35+）
│   ├── 四级：按注册来源分群
│   └── 四级：Bot用户 vs 真实用户留存对比
│
└── ⚠️ 流失预警
    ├── 四级：高流失风险Cohort识别
    ├── 四级：流失前兆行为分析（流失前7天行为特征）
    └── 四级：留存干预建议
```

#### 3.3 收入分析 `/admin/analytics/revenue`（展开至四级）

```
P1 收入分析
├── 💰 收入总览
│   ├── 四级：MRR（月经常性收入）趋势图
│   ├── 四级：ARR（年化经常性收入）
│   ├── 四级：ARPU（月度每用户平均收入）
│   └── 四级：收入完成率（vs 月度目标）
│
├── 📊 收入来源
│   ├── 四级：Premium Monthly收入占比
│   ├── 四级：Premium Yearly收入占比（含年化折算）
│   ├── 四级：Lady Free隐性价值估算
│   ├── 四级：各套餐净新增收入明细
│   └── 四级：一次性收入 vs 经常性收入对比
│
├── 📈 LTV分析
│   ├── 四级：按Cohort估算的LTV曲线
│   ├── 四级：不同获客渠道LTV对比
│   ├── 四级：LTV预测（基于当前留存率）
│   └── 四级：LTV vs CAC比值（需接入CAC数据）
│
└── ⚠️ Churn分析
    ├── 四级：月流失率趋势
    ├── 四级：退订原因分布（cancelreason字段）
    ├── 四级：高流失风险用户预警
    └── 四级：诚意值经济系统（总发放量/总消费量/流通速度）
```

#### 3.4 用户追踪 `/admin/analytics/users` ← v2.0新增（展开至四级）

```
P1 用户追踪（User Tracking）
├── 👤 单用户追踪
│   ├── 四级：用户档案卡片（ID/昵称/邮箱/注册时间/订阅）
│   ├── 四级：事件时间线（Events Timeline）
│   │   ├── 四级：注册事件（email/注册方式/来源UTM）
│   │   ├── 四级：Onboarding步骤事件（每步完成时间）
│   │   ├── 四级：Profile完成事件（头像上传/标签选择/偏好设置）
│   │   ├── 四级：匹配事件（发起/接受/拒绝/过期）
│   │   ├── 四级：聊天事件（首次消息/会话时长/消息数）
│   │   ├── 四级：订阅事件（升级/降级/取消/到期）
│   │   └── 四级：流失事件（最后活跃时间）
│   ├── 四级：用户路径图（关键页面访问序列）
│   ├── 四级：活跃热力图（按小时的活跃分布）
│   └── 四级：用户健康度评分（0-100，综合活跃/匹配/付费）
│
├── 📊 用户群组分析
│   ├── 四级：新建群组（按注册日期/来源/行为自定义）
│   ├── 四级：预置群组（高价值/流失风险/沉睡/活跃）
│   ├── 四级：群组对比分析（群组A vs 群组B）
│   └── 四级：群组用户导出
│
├── 🔍 行为分析
│   ├── 四级：用户行为序列模式挖掘
│   ├── 四级：高价值用户行为特征分析
│   ├── 四级：流失用户行为前兆识别
│   └── 四级：Onboarding关键行为节点识别（哪些行为预示高留存）
│
└── 📈 用户指标看板
    ├── 四级：DAU / WAU / MAU 趋势
    ├── 四级：用户分层（Active / Engaged / At Risk / Churned）
    ├── 四级：新用户 vs 老用户占比趋势
    └── 四级：用户净增长（新增-流失）趋势
```

#### 3.5 流量属性 `/admin/analytics/traffic` ← v2.0新增（展开至四级）

```
P1 流量属性（Traffic Attribution）
├── 🌐 流量来源概览
│   ├── 四级：总访问量（UV/UV独立访客）
│   ├── 四级：流量来源分布（Pie chart）
│   │   ├── 四级：Direct（直接访问）
│   │   ├── 四级：Organic Search（SEO自然搜索）
│   │   ├── 四级：Paid Search（SEM付费搜索）
│   │   ├── 四级：Social（社交媒体）
│   │   ├── 四级：Referral（外链引荐）
│   │   └── 四级：Email（邮件营销）
│   ├── 四级：各来源转化率对比
│   └── 四级：流量趋势图（按来源分层）
│
├── 🔍 UTM参数分析
│   ├── 四级：utm_source分布（Google/Facebook/Twitter/Reddit/...）
│   ├── 四级：utm_medium分布（CPC/banner/email/post/...）
│   ├── 四级：utm_campaign分布（各广告活动）
│   ├── 四级：utm_content分布（A/B测试素材）
│   ├── 四级：utm_term分布（付费关键词）
│   ├── 四级：UTM组合效果分析（Source × Medium × Campaign）
│   └── 四级：无UTM流量（未标记流量占比）
│
├── 🌏 地理位置分析
│   ├── 四级：按国家分布（World map choropleth）
│   ├── 四级：按城市分布（Top 20城市）
│   ├── 四级：按语言/时区分布
│   ├── 四级：各地区用户转化率热力图
│   └── 四级：地区性偏好差异（不同地区的Top标签）
│
└── 📱 设备与行为
    ├── 四级：设备类型分布（Desktop/Mobile/Tablet）
    ├── 四级：OS分布（iOS/Android/Windows/Mac/Linux）
    ├── 四级：Browser分布（Chrome/Safari/Firefox/Edge）
    ├── 四级：屏幕分辨率分布
    ├── 四级：设备类型×转化率交叉分析
    └── 四级：Bounce Rate按设备/来源分布
```

---

## 四、AI推广图生成模块（新增至四级）`/admin/creative`

> v2.0新增模块：基于AI自动生成推广图片（A/B测试支持，适配多平台）

### 一级模块：AI推广图生成 `/admin/creative`

### 二级模块：
1. **P1 推广图模板管理**
2. **P1 批量图片生成**
3. **P1 A/B测试管理**
4. **P1 素材资产管理**

#### 4.1 推广图模板管理（展开至四级）

```
P1 推广图模板管理
├── 📐 模板类型
│   ├── 四级：横版模板（1920×1080）— 用于Landing页/Banner
│   ├── 四级：竖版模板（1080×1920）— 用于Instagram Stories/TikTok
│   ├── 四级：方形模板（1080×1080）— 用于Instagram Feed/Facebook
│   ├── 四级：故事模板（9:16）— 用于Stories/Reels
│   └── 四级：缩略图模板（1280×720）— 用于YouTube/视频封面
│
├── 🎨 模板组件库
│   ├── 四级：背景层（纯色/渐变/图片/纹理）
│   ├── 四级：文字层（标题/副标题/CTA按钮）
│   ├── 四级：头像/人物层（支持Bot头像/真实用户头像）
│   ├── 四级：徽章层（匹配成功率徽章/Premium徽章）
│   ├── 四级：品牌元素层（Logo/水印/色块）
│   └── 四级：统计数字层（动态插入数据）
│
├── 🔧 模板变量（动态占位符）
│   ├── 四级：{{user_name}} — 用户昵称
│   ├── 四级：{{match_count}} — 匹配数
│   ├── 四级：{{success_rate}} — 成功率%
│   ├── 四级：{{user_avatar}} — 用户头像
│   ├── 四级：{{cta_text}} — CTA按钮文案
│   ├── 四级：{{platform_name}} — 平台名称
│   └── 四级：{{qr_code}} — 落地页二维码
│
└── 📋 模板管理操作
    ├── 四级：模板列表（缩略图预览 + 使用次数 + 效果评分）
    ├── 四级：模板克隆（复制已有模板进行修改）
    ├── 四级：模板草稿（保存未发布模板）
    └── 四级：模板历史版本（记录每次修改）
```

#### 4.2 批量图片生成（展开至四级）

```
P1 批量图片生成
├── ⚡ 批量生成配置
│   ├── 四级：选择目标模板（支持多模板同时生成）
│   ├── 四级：数据源配置（用户列表/Cohort/CSV导入）
│   ├── 四级：变量映射（CSV列 → 模板变量）
│   ├── 四级：生成数量上限（防止滥用）
│   └── 四级：去重策略（同名文件自动编号）
│
├── 🤖 AI生成参数
│   ├── 四级：风格选择（简约/活泼/专业/情感）
│   ├── 四级：色调配置（品牌主色/辅色）
│   ├── 四级：文字AI生成（支持AI改写CTA文案）
│   ├── 四级：头像AI处理（自动裁剪/背景虚化）
│   └── 四级：质量级别（草稿/标准/高清）
│
├── 📊 生成任务管理
│   ├── 四级：任务队列（待生成/生成中/已完成/失败）
│   ├── 四级：生成进度条（已完成数/总数）
│   ├── 四级：批量下载（ZIP打包）
│   ├── 四级：单张预览 + 重新生成
│   └── 四级：生成失败重试
│
└── 📤 发布配置
    ├── 四级：一键发布到 Reddit（选子版块 + 标题）
    ├── 四级：一键发布到 Twitter/X（配文案）
    ├── 四级：一键发布到 Discord（选频道）
    ├── 四级：导出到本地（指定文件夹）
    └── 四级：复制图片URL
```

#### 4.3 A/B测试管理（展开至四级）

```
P1 A/B测试管理
├── 🧪 测试创建
│   ├── 四级：测试名称 + 测试假设描述
│   ├── 四级：添加测试变体（2-4个推广图版本）
│   ├── 四级：设置流量分配比例（50%/25%/25%）
│   ├── 四级：设置测试时长（1天/3天/7天/自定义）
│   └── 四级：设置目标指标（点击率/注册转化/付费转化）
│
├── 📈 测试结果分析
│   ├── 四级：各变体曝光量（Impressions）
│   ├── 四级：各变体点击率（CTR）
│   ├── 四级：各变体转化率（CVR）
│   ├── 四级：统计显著性检验（p-value / 置信区间）
│   ├── 四级：胜出版本自动标识
│   └── 四级：测试结论与建议
│
├── 📊 历史测试记录
│   ├── 四级：历史测试列表（名称/日期/结果/胜出版本）
│   ├── 四级：测试详情回顾
│   ├── 四级：测试复制（复用成功测试配置）
│   └── 四级：测试数据导出（CSV/JSON）
│
└── ⚙️ 测试规则
    ├── 四级：每个用户看到同一变体（会话级分配）
    ├── 四级：最小样本量要求（达到才出结论）
    ├── 四级：自动停止规则（胜出明显时提前终止）
    └── 四级：测试冲突检测（同一时间同一渠道不重复测试）
```

#### 4.4 素材资产管理（展开至四级）

```
P1 素材资产管理
├── 📁 素材库
│   ├── 四级：文件夹结构管理（按平台/类型/日期组织）
│   ├── 四级：素材列表（图/视频/文案分类）
│   ├── 四级：素材搜索（名称/标签/上传者）
│   ├── 四级：素材标签（自定义标签系统）
│   └── 四级：素材收藏（常用素材加星标）
│
├── 🖼️ 图片管理
│   ├── 四级：缩略图预览（网格/列表视图切换）
│   ├── 四级：图片元数据（尺寸/格式/大小/上传时间）
│   ├── 四级：图片使用记录（哪些帖子/测试用了这张图）
│   ├── 四级：图片效果评分（点击率排名）
│   ├── 四级：批量上传（拖拽上传）
│   └── 四级：图片删除（软删除，保留30天）
│
├── 📝 文案管理
│   ├── 四级：文案库（Reddit/Twitter/Discord分类）
│   ├── 四级：文案变体版本管理
│   ├── 四级：文案效果追踪（关联推广图的点击率）
│   ├── 四级：AI文案优化建议
│   └── 四级：品牌语调规范（正式/轻松/情感/幽默）
│
└── 📊 素材效果看板
    ├── 四级：Top 10高点击素材（图片+文案）
    ├── 四级：素材使用趋势（周/月）
    ├── 四级：素材版权状态（原创/授权/免费）
    └── 四级：素材存储用量统计（CDN成本估算）
```

---

## 五、AI客服设置模块（新增至四级）`/admin/ai-support`

> v2.0新增模块：配置AI自动回复、意图识别、客服工作流

### 一级模块：AI客服设置 `/admin/ai-support`

### 二级模块：
1. **P1 客服响应模板**
2. **P1 知识库配置**
3. **P1 路由规则**
4. **P1 情感监控与质检**

#### 5.1 客服响应模板（展开至四级）

```
P1 客服响应模板
├── 💬 模板分类
│   ├── 四级：FAQ类（常见问题标准回复）
│   ├── 四级：引导类（引导用户完成特定操作）
│   ├── 四级：安抚类（用户投诉/不满时的情绪安抚）
│   ├── 四级：转人工类（触发转人工的回复）
│   └── 四级：营销类（解答中自然植入转化）
│
├── 🔧 模板配置
│   ├── 四级：触发条件配置
│   │   ├── 四级：关键词触发（多个关键词OR/AND组合）
│   │   ├── 四级：用户问题类型识别（意图分类）
│   │   ├── 四级：用户情绪识别（正面/中性/负面/愤怒）
│   │   ├── 四级：对话轮次触发（X轮未解决自动升级）
│   │   └── 四级：时间条件触发（注册X天后/订阅到期前X天）
│   ├── 四级：回复内容编辑（富文本/Markdown）
│   ├── 四级：变量占位符（用户昵称/订单号/具体数值）
│   ├── 四级：回复语气选择（正式/友好/专业/共情）
│   └── 四级：多语言支持（英语/中文/其他）
│
├── 📋 模板管理
│   ├── 四级：模板列表（名称/类型/调用次数/满意度评分）
│   ├── 四级：模板启用/禁用开关
│   ├── 四级：模板优先级排序
│   ├── 四级：模板使用统计（本周调用/平均响应时间）
│   └── 四级：模板历史版本
│
└── 🧪 模板测试
    ├── 四级：模拟输入测试（输入问题→查看回复预览）
    ├── 四级：A/B测试（同一触发条件测试多个回复版本）
    └── 四级：模板效果对比（点击链接率/满意度/解决率）
```

#### 5.2 知识库配置（展开至四级）

```
P1 知识库配置
├── 📚 知识库内容
│   ├── 四级：文档分类（功能说明/支付问题/账号问题/安全指南/隐私政策）
│   ├── 四级：文档编辑器（富文本，含图片/视频/链接）
│   ├── 四级：文档版本管理（每次修改留版本记录）
│   ├── 四级：文档状态（草稿/审核中/已发布/已归档）
│   └── 四级：文档权限（谁可以编辑/审核/发布）
│
├── 🔍 智能检索
│   ├── 四级：全文检索配置
│   ├── 四级：同义词配置（"pay"="payment"="付款"）
│   ├── 四级：FAQ与文档关联（哪个文档回答哪个问题）
│   ├── 四级：检索权重配置（标题匹配 vs 内容匹配）
│   └── 四级：未命中问题追踪（用户问但没找到答案的问题）
│
├── 🤖 AI理解配置
│   ├── 四级：意图分类模型选择（使用哪个AI模型）
│   ├── 四级：自定义意图（创建业务特定意图标签）
│   ├── 四级：意图混淆矩阵（哪些意图容易被混淆）
│   ├── 四级：实体提取配置（提取订单号/日期/金额等）
│   └── 四级：置信度阈值（低于此值转人工）
│
└── 📊 知识库效果
    ├── 四级：知识库覆盖率（用户问题被回答的比例）
    ├── 四级：平均检索匹配率
    ├── 四级：知识库空白发现（高频未命中问题列表）
    └── 四级：知识库质量评分（用户评价/编辑质量）
```

#### 5.3 路由规则（展开至四级）

```
P1 路由规则
├── 🔀 路由策略
│   ├── 四级：基于问题的路由（什么类型问题→什么渠道）
│   ├── 四级：基于用户价值的路由（VIP用户→优先人工）
│   ├── 四级：基于情绪的路由（负面/愤怒→优先人工）
│   ├── 四级：基于语言的路由（非英语→特定客服）
│   └── 四级：基于可用性的路由（当前排队人数最少）
│
├── 👥 客服分组
│   ├── 四级：分组列表（技术组/账单组/安全组/投诉组）
│   ├── 四级：分组成员管理（添加/移除客服）
│   ├── 四级：分组技能标签（每个客服的专长）
│   ├── 四级：分组工作时段配置
│   └── 四级：分组容量配置（同时接待上限）
│
├── ⏰ 值班规则
│   ├── 四级：工作时间配置（9×5 / 24×7 / 自定义）
│   ├── 四级：节假日配置（节假日使用备用路由）
│   ├── 四级：客服排班表（周排班/月排班）
│   ├── 四级：值班状态（在线/忙碌/离线）
│   └── 四级：下班后AI接管配置
│
└── 🚨 升级规则
    ├── 四级：AI解决失败次数阈值（3次未能解决→升级）
    ├── 四级：用户明确要求转人工（关键词触发）
    ├── 四级：敏感话题自动升级（涉及安全/法律的举报）
    ├── 四级：排队等待超时升级（>10分钟未响应）
    └── 四级：VIP用户专属快速通道
```

#### 5.4 情感监控与质检（展开至四级）

```
P1 情感监控与质检
├── 😊 情感分析
│   ├── 四级：实时情感检测（每条用户消息的情感标签）
│   ├── 四级：情感趋势图（会话中情感变化）
│   ├── 四级：情感极值预警（检测到愤怒/威胁时告警）
│   ├── 四级：用户情感分布（正面/中性/负面占比）
│   └── 四级：情感与满意度相关性分析
│
├── 🔍 质检评分
│   ├── 四级：AI回复质量评分（0-100，基于多维度评估）
│   ├── 四级：评分维度（准确性/专业性/礼貌度/解决率）
│   ├── 四级：随机抽样质检任务（每周自动抽取N条对话）
│   ├── 四级：质检任务分配（分配给人工质检员）
│   └── 四级：质检结果统计（团队平均分/个人得分）
│
├── 📊 客服绩效看板
│   ├── 四级：平均响应时间（首次响应/完全解决）
│   ├── 四级：问题解决率（AI自助解决/人工介入解决）
│   ├── 四级：用户满意度（CSAT评分分布）
│   ├── 四级：客服个人绩效仪表盘
│   └── 四级：绩效排名（支持组内/跨组排名）
│
└── 📈 趋势与改进
    ├── 四级：情感趋势周报/月报
    ├── 四级：高频未解决问题汇总
    ├── 四级：AI回复优化建议（基于质检发现）
    └── 四级：客服培训建议（基于绩效短板）
```

---

## 六、VIP客户收件箱模块（新增至四级）`/admin/vip-inbox`

> v2.0新增模块：为高价值VIP用户提供专属人工客服通道

### 一级模块：VIP客户收件箱 `/admin/vip-inbox`

### 二级模块：
1. **P1 VIP收件箱**
2. **P1 VIP用户管理**
3. **P1 消息处理工作流**
4. **P1 VIP服务绩效**

#### 6.1 VIP收件箱（展开至四级）

```
P1 VIP收件箱
├── 📥 收件箱队列
│   ├── 四级：待处理消息列表（时间倒序）
│   │   ├── 四级：消息摘要预览（最多显示前100字）
│   │   ├── 四级：VIP用户标签（VIP等级颜色标识）
│   │   ├── 四级：等待时间（已等待X小时）
│   │   ├── 四级：消息类型（咨询/投诉/建议/求助）
│   │   └── 四级：优先级标记（普通/加急/紧急）
│   ├── 四级：已标记处理中的消息（当前客服认领）
│   ├── 四级：已解决消息
│   └── 四级：SLA告警（即将超时的消息高亮）
│
├── 💬 消息详情面板
│   ├── 四级：完整对话上下文（当前+历史消息，最长30天）
│   ├── 四级：用户档案侧边栏
│   │   ├── 四级：VIP等级 + 有效期
│   │   ├── 四级：订阅详情（套餐/到期时间/付费金额）
│   │   ├── 四级：历史服务记录（总服务次数/满意度）
│   │   ├── 四级：用户偏好（沟通风格/语言）
│   │   └── 四级：备注标签（可添加内部标签）
│   ├── 四级：上下文感知（显示用户当前操作页面/状态）
│   ├── 四级：快速操作（发送优惠券/延长VIP/封禁用户）
│   └── 四级：对话标记（需跟进/已解决/升级）
│
├── 🔍 高级筛选
│   ├── 四级：VIP等级筛选（金/银/铜/普通）
│   ├── 四级：问题类型筛选（咨询/投诉/建议/技术问题）
│   ├── 四级：等待时长筛选（>1h / >3h / >24h）
│   ├── 四级：历史处理状态筛选
│   └── 四级：关键词全文搜索
│
└── ⚡ 快捷操作
    ├── 四级：一键回复（预置回复模板）
    ├── 四级：批量认领（一次性认领N条消息）
    ├── 四级：批量分配（分配给指定客服）
    ├── 四级：快捷发送优惠券（选择金额/有效期的快捷操作）
    └── 四级：会话转接（转给其他客服/其他部门）
```

#### 6.2 VIP用户管理（展开至四级）

```
P1 VIP用户管理
├── 👑 VIP等级体系
│   ├── 四级：VIP等级定义
│   │   ├── 四级：Bronze（注册满30天+付费1次）
│   │   ├── 四级：Silver（付费满$100或连续订阅3个月）
│   │   ├── 四级：Gold（付费满$500或年费订阅用户）
│   │   └── 四级：Platinum（付费满$2000或推荐3人付费）
│   ├── 四级：等级权益配置（每等级对应服务权益）
│   ├── 四级：等级有效期配置（永久/年度审核）
│   └── 四级：等级升降规则（自动升级/降级条件）
│
├── 📊 VIP用户列表
│   ├── 四级：用户列表（VIP等级筛选）
│   ├── 四级：付费金额（累计付费总额）
│   ├── 四级：服务次数（发起咨询次数）
│   ├── 四级：最近活跃时间
│   ├── 四级：满意度平均分
│   ├── 四级：到期时间（VIP有效期）
│   └── 四级：操作（升级/降级/取消VIP/查看详情）
│
├── ✏️ VIP手动配置
│   ├── 四级：手动授予VIP资格（指定用户+等级）
│   ├── 四级：手动取消VIP资格
│   ├── 四级：VIP有效期调整
│   ├── 四级：VIP备注（内部记录原因）
│   └── 四级：批量授予/取消VIP
│
└── 📈 VIP价值分析
    ├── 四级：各级别用户数量分布
    ├── 四级：各级别贡献收入占比
    ├── 四级：各级别留存率对比
    ├── 四级：VIP用户生命周期价值（LTV）
    ├── 四级：VIP用户获客成本分析
    └── 四级：VIP ROI报告
```

#### 6.3 消息处理工作流（展开至四级）

```
P1 消息处理工作流
├── 🔄 标准处理流程
│   ├── 四级：接收消息 → 自动分类 → 匹配最佳客服 → 认领处理
│   ├── 四级：处理中（进行对话） → 解决 → 用户确认 → 关闭
│   ├── 四级：超时未认领 → 自动升级告警
│   └── 四级：SLA超时 → 自动升级 + 触发补偿
│
├── 📋 工单系统
│   ├── 四级：从消息创建工单（会话→工单）
│   ├── 四级：工单状态（PENDING/IN_PROGRESS/RESOLVED/CLOSED）
│   ├── 四级：工单优先级（P0/P1/P2/P3）
│   ├── 四级：工单指派（分配给指定客服/组）
│   ├── 四级：工单评论（内部沟通，用户不可见）
│   ├── 四级：工单关联（关联同一用户的历史工单）
│   └── 四级：工单字段（类型/产品/原因/解决方案）
│
├── 🤝 协作处理
│   ├── 四级：消息转发（转给其他客服查看）
│   ├── 四级：三方会话（客服+用户+第三方）
│   ├── 四级：内部备注（仅客服可见，用户不可见）
│   ├── 四级：交接记录（转交客服时自动附带上下文摘要）
│   └── 四级：协助模式（资深客服可查看初级客服的会话）
│
└── ✅ 满意度管理
    ├── 四级：会话结束时自动发送满意度评分
    ├── 四级：满意度评分展示（1-5星）
    ├── 四级：负面评价跟进（3星以下自动标记需跟进）
    ├── 四级：满意度趋势（按月/按客服统计）
    └── 四级：评价详情查看 + 客服申诉入口
```

#### 6.4 VIP服务绩效（展开至四级）

```
P1 VIP服务绩效
├── 📊 绩效仪表盘
│   ├── 四级：今日VIP消息量
│   ├── 四级：当前等待中的VIP消息数
│   ├── 四级：平均首次响应时间（目标：<5分钟）
│   ├── 四级：平均解决时长（目标：<30分钟）
│   ├── 四级：SLA达标率（目标：>95%）
│   └── 四级：VIP满意度（本月均值）
│
├── 👤 客服绩效详情
│   ├── 四级：个人消息处理量（今日/本周/本月）
│   ├── 四级：个人首次响应时间排名
│   ├── 四级：个人问题解决率
│   ├── 四级：个人VIP满意度评分
│   ├── 四级：个人SLA达标率
│   ├── 四级：响应速度评分
│   └── 四级：绩效趋势（近30天）
│
├── 📈 团队对比
│   ├── 四级：各客服绩效排名
│   ├── 四级：各客服处理问题类型分布
│   ├── 四级：各班次（早/中/晚）服务质量对比
│   └── 四级：组间对比（Team A vs Team B）
│
└── 🎯 目标管理
    ├── 四级：月度KPI目标设置（响应时间/解决率/满意度）
    ├── 四级：KPI完成进度（实时更新）
    ├── 四级：达标/未达标预警
    ├── 四级：绩效奖金计算规则配置
    └── 四级：绩效报告导出（PDF/Excel）
```

---

## 七、路由规划（v2.0完整版）

```
# === 一级导航 ===
/admin                          → 仪表盘（Dashboard）

# === 用户管理 ===
/admin/users                    → 用户列表
/admin/users/[id]               → 用户详情（Tab化）
/admin/users/bots               → Bot用户管理
/admin/users/bots/[id]          → Bot详情与调控
/admin/users/reports             → 举报管理
/admin/users/tracking            → 用户行为追踪（v2.0新增）

# === 匹配管理 ===
/admin/matches                   → 匹配列表
/admin/matches/[id]              → 匹配详情
/admin/matches/engine            → 匹配引擎监控

# === 聊天监控 ===
/admin/chats                     → 会话列表
/admin/chats/[id]               → 会话详情

# === 支付管理 ===
/admin/payments                  → 支付仪表盘
/admin/payments/subscriptions   → 订阅管理
/admin/payments/transactions     → 交易记录

# === 内容管理 ===
/admin/content                   → 内容总览
/admin/content/consent           → 同意请求管理
/admin/content/rules             → 规则引擎监控

# === Bot系统 ===
/admin/bot-system                → Bot系统总控
/admin/bot-system/learning       → 学习效果分析
/admin/bot-system/behavior       → 行为模拟配置

# === 数据分析（v2.0展开）===
/admin/analytics                 → 分析总览
/admin/analytics/funnel          → 转化漏斗
/admin/analytics/retention       → 留存分析
/admin/analytics/revenue         → 收入分析
/admin/analytics/users           → 用户追踪（v2.0新增）
/admin/analytics/traffic         → 流量属性（v2.0新增）

# === AI推广图（v2.0新增）===
/admin/creative                   → AI推广图总览
/admin/creative/templates         → 模板管理
/admin/creative/generate          → 批量生成
/admin/creative/ab-test           → A/B测试管理
/admin/creative/assets            → 素材资产管理

# === AI客服（v2.0新增）===
/admin/ai-support                 → AI客服总览
/admin/ai-support/templates       → 响应模板管理
/admin/ai-support/knowledge       → 知识库配置
/admin/ai-support/routing         → 路由规则
/admin/ai-support/qa              → 情感监控与质检

# === VIP收件箱（v2.0新增）===
/admin/vip-inbox                 → VIP收件箱
/admin/vip-inbox/users           → VIP用户管理
/admin/vip-inbox/tickets         → 工单管理
/admin/vip-inbox/performance     → 服务绩效

# === 系统设置 ===
/admin/settings                  → 系统设置
/admin/settings/roles            → 角色管理
/admin/settings/config           → 系统配置
/admin/settings/audit            → 审计日志

# === 系统健康 ===
/admin/health                    → 系统健康
```

---

## 八、API设计（v2.0完整版）

### 8.1 Admin API 路由前缀

所有管理后台API统一前缀: `/api/admin/*`

### 8.2 API端点详细规划

#### 用户管理（扩展）
```
GET    /api/admin/users                    → 列表 (分页+筛选，含tracking字段)
GET    /api/admin/users/[id]               → 详情（含全Tab数据）
GET    /api/admin/users/[id]/tracking      → 用户行为追踪数据（v2.0新增）
GET    /api/admin/users/[id]/timeline      → 用户事件时间线（v2.0新增）
PATCH  /api/admin/users/[id]               → 更新
DELETE /api/admin/users/[id]               → 删除
POST   /api/admin/users/[id]/ban           → 封禁
POST   /api/admin/users/[id]/unban         → 解封
POST   /api/admin/users/[id]/admin-tags    → 更新adminTags（v2.0新增）
POST   /api/admin/users/[id]/reset-password → 重置密码
POST   /api/admin/users/[id]/assign-lady-free → 分配Lady Free
POST   /api/admin/users/batch-action        → 批量操作（含adminTags批量修改）

GET    /api/admin/users/bots               → Bot列表
GET    /api/admin/users/bots/[id]           → Bot详情
PATCH  /api/admin/users/bots/[id]            → 更新Bot配置
POST   /api/admin/users/bots/batch           → 批量操作
POST   /api/admin/users/bots/import          → 导入新Bot
GET    /api/admin/users/bots/stats           → Bot集群统计（v2.0新增）

GET    /api/admin/users/reports             → 举报列表
GET    /api/admin/users/reports/[id]        → 举报详情
PATCH  /api/admin/users/reports/[id]        → 处理举报
POST   /api/admin/users/reports/batch       → 批量处理
GET    /api/admin/users/reports/sla         → SLA统计（v2.0新增）
```

#### 数据分析（扩展）
```
GET    /api/admin/analytics/overview        → 全局概览
GET    /api/admin/analytics/funnel          → 转化漏斗
GET    /api/admin/analytics/funnel/compare  → 漏斗对比（v2.0新增）
GET    /api/admin/analytics/retention        → 留存数据
GET    /api/admin/analytics/retention/cohort → Cohort分析（v2.0新增）
GET    /api/admin/analytics/revenue          → 收入分析
GET    /api/admin/analytics/revenue/ltv      → LTV分析（v2.0新增）
GET    /api/admin/analytics/users            → 用户追踪（v2.0新增）
GET    /api/admin/analytics/users/[id]       → 单用户追踪
GET    /api/admin/analytics/users/cohorts    → 用户群组
GET    /api/admin/analytics/traffic           → 流量属性（v2.0新增）
GET    /api/admin/analytics/traffic/utm      → UTM分析（v2.0新增）
GET    /api/admin/analytics/traffic/geo     → 地理分析（v2.0新增）
GET    /api/admin/analytics/matching         → 匹配分析
GET    /api/admin/analytics/bot              → Bot分析
```

#### AI推广图（新增）
```
GET    /api/admin/creative/templates         → 模板列表
POST   /api/admin/creative/templates        → 创建模板
GET    /api/admin/creative/templates/[id]    → 模板详情
PATCH  /api/admin/creative/templates/[id]    → 更新模板
DELETE /api/admin/creative/templates/[id]    → 删除模板
POST   /api/admin/creative/templates/[id]/clone → 克隆模板

POST   /api/admin/creative/generate          → 触发批量生成
GET    /api/admin/creative/generate/jobs     → 生成任务列表
GET    /api/admin/creative/generate/jobs/[id] → 任务详情
DELETE /api/admin/creative/generate/jobs/[id]/cancel → 取消任务
POST   /api/admin/creative/generate/jobs/[id]/retry → 重试失败项

GET    /api/admin/creative/ab-tests          → A/B测试列表
POST   /api/admin/creative/ab-tests          → 创建A/B测试
GET    /api/admin/creative/ab-tests/[id]      → 测试详情
PATCH  /api/admin/creative/ab-tests/[id]      → 更新测试
POST   /api/admin/creative/ab-tests/[id]/stop → 停止测试
GET    /api/admin/creative/ab-tests/[id]/results → 测试结果

GET    /api/admin/creative/assets            → 素材列表
POST   /api/admin/creative/assets/upload     → 上传素材
DELETE /api/admin/creative/assets/[id]       → 删除素材
GET    /api/admin/creative/assets/[id]/stats  → 素材效果统计
POST   /api/admin/creative/assets/batch-import → 批量导入
```

#### AI客服（新增）
```
GET    /api/admin/ai-support/templates       → 响应模板列表
POST   /api/admin/ai-support/templates        → 创建模板
PATCH  /api/admin/ai-support/templates/[id]   → 更新模板
DELETE /api/admin/ai-support/templates/[id]   → 删除模板
GET    /api/admin/ai-support/templates/[id]/stats → 模板使用统计

GET    /api/admin/ai-support/knowledge       → 知识库文档列表
POST   /api/admin/ai-support/knowledge        → 创建文档
PATCH  /api/admin/ai-support/knowledge/[id]  → 更新文档
POST   /api/admin/ai-support/knowledge/rebuild-index → 重建检索索引
GET    /api/admin/ai-support/knowledge/misses → 未命中问题列表

GET    /api/admin/ai-support/routing         → 路由规则列表
POST   /api/admin/ai-support/routing          → 创建路由规则
PATCH  /api/admin/ai-support/routing/[id]     → 更新规则
DELETE /api/admin/ai-support/routing/[id]     → 删除规则
GET    /api/admin/ai-support/groups           → 客服分组
POST   /api/admin/ai-support/groups           → 创建分组
PATCH  /api/admin/ai-support/groups/[id]       → 更新分组

GET    /api/admin/ai-support/qa/sentiment    → 情感分析报告
GET    /api/admin/ai-support/qa/scores       → 质检评分报告
GET    /api/admin/ai-support/qa/performance  → 绩效报告
POST   /api/admin/ai-support/qa/samples       → 抽样质检任务
```

#### VIP收件箱（新增）
```
GET    /api/admin/vip-inbox/messages         → VIP消息列表
GET    /api/admin/vip-inbox/messages/[id]     → 消息详情
PATCH  /api/admin/vip-inbox/messages/[id]     → 更新消息状态
POST   /api/admin/vip-inbox/messages/[id]/reply → 发送回复
POST   /api/admin/vip-inbox/messages/[id]/claim → 认领消息
POST   /api/admin/vip-inbox/messages/[id]/transfer → 转接
GET    /api/admin/vip-inbox/messages/sla      → SLA状态统计

GET    /api/admin/vip-inbox/users             → VIP用户列表
PATCH  /api/admin/vip-inbox/users/[id]        → 更新VIP配置
POST   /api/admin/vip-inbox/users/[id]/grant  → 授予VIP
POST   /api/admin/vip-inbox/users/[id]/revoke → 取消VIP
GET    /api/admin/vip-inbox/users/[id]/history → 服务历史
GET    /api/admin/vip-inbox/users/stats        → VIP用户统计

GET    /api/admin/vip-inbox/tickets           → 工单列表
POST   /api/admin/vip-inbox/tickets           → 创建工单
PATCH  /api/admin/vip-inbox/tickets/[id]      → 更新工单
POST   /api/admin/vip-inbox/tickets/[id]/note → 添加内部备注

GET    /api/admin/vip-inbox/performance       → 绩效仪表盘
GET    /api/admin/vip-inbox/performance/staff/[id] → 客服绩效详情
GET    /api/admin/vip-inbox/performance/team  → 团队绩效
```

#### 匹配/聊天/支付（保留v1.0）
```
GET    /api/admin/matches                     → 匹配列表
GET    /api/admin/matches/[id]                → 匹配详情
PATCH  /api/admin/matches/[id]                → 更新匹配
GET    /api/admin/matches/engine/stats         → 引擎统计
GET    /api/admin/matches/engine/config        → 引擎配置
PUT    /api/admin/matches/engine/config        → 更新引擎配置

GET    /api/admin/chats                        → 会话列表
GET    /api/admin/chats/[id]                  → 会话详情
DELETE /api/admin/chats/[id]/messages/[msgId] → 删除消息
GET    /api/admin/chats/sensitive              → 敏感词命中列表

GET    /api/admin/payments/subscriptions       → 订阅列表
PATCH  /api/admin/payments/subscriptions/[id]  → 更新订阅
POST   /api/admin/payments/subscriptions/[id]/cancel → 取消
POST   /api/admin/payments/subscriptions/[id]/refund → 退款
GET    /api/admin/payments/transactions         → 交易列表
GET    /api/admin/payments/revenue              → 收入统计

GET    /api/admin/settings/config               → 配置列表
PUT    /api/admin/settings/config/[key]         → 更新配置
GET    /api/admin/settings/audit                → 审计日志
GET    /api/admin/settings/roles                 → 角色列表
POST   /api/admin/settings/roles                 → 新增管理员
DELETE /api/admin/settings/roles/[id]            → 移除管理员
GET    /api/admin/health                        → 健康检查
```

---

## 九、数据库变更（v2.0完整版）

### 9.1 需要新增的表/字段

```prisma
// ═══════════════════════════════════════════════════════════════
// ADMIN SYSTEM — Enhanced RBAC + Audit
// ═══════════════════════════════════════════════════════════════

// 1. AdminProfile — 管理员扩展信息
model AdminProfile {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  adminRole   AdminRole @default(ADMIN)
  permissions String[]  @default([])  // 精细权限列表
  department  String?  // "operations", "safety", "growth", "creative", "vip"

  lastLoginAt DateTime?
  loginCount  Int      @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 2. AlertRule — 告警规则配置
model AlertRule {
  id          String   @id @default(cuid())
  name        String
  description String?

  // 触发条件
  metric      String   // "bot_reject_rate", "payment_failure", "sla_breach"
  operator    String   // "gt", "lt", "eq", "gte", "lte"
  threshold   Float
  window      String   // "1h", "3h", "24h", "7d"

  // 通知
  severity    String   @default("WARNING")  // CRITICAL, WARNING, INFO
  enabled     Boolean  @default(true)
  channels    String[] @default(["admin_dashboard"])  // admin_dashboard, email, webhook

  // 状态
  lastTriggeredAt DateTime?
  triggerCount    Int  @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 3. Alert — 告警记录
model Alert {
  id          String   @id @default(cuid())
  ruleId      String?
  rule        AlertRule? @relation(fields: [ruleId], references: [id])

  severity    String
  title       String
  description String   @db.Text
  metric      String
  value       Float
  threshold   Float

  status      String   @default("ACTIVE")  // ACTIVE, ACKNOWLEDGED, RESOLVED
  acknowledgedBy String?
  acknowledgedAt DateTime?
  resolvedAt     DateTime?
  resolution     String? @db.Text

  createdAt DateTime @default(now())
}

// 4. AdminRole Enum
enum AdminRole {
  SUPER_ADMIN   // 超管：全部权限 + 角色管理
  ADMIN         // 管理员：用户/匹配/内容/支付
  MODERATOR     // 审核员：举报/内容审核/用户封禁
  ANALYST       // 分析师：只读数据分析
  SUPPORT       // 客服：用户查看 + 基础操作
  CREATIVE      // 创意运营：AI推广图管理（v2.0新增）
  VIP_AGENT     // VIP客服：VIP收件箱专属（v2.0新增）
}

// ═══════════════════════════════════════════════════════════════
// USER ENHANCEMENT — Extended Fields
// ═══════════════════════════════════════════════════════════════

// 扩展 User 表（需migration）
// adminTags    String[]  @default([])  // 内部标签
// loginHistory String?   @db.Text      // JSON: [{ip, device, time}]

// 扩展 UserReport 表（需migration）
// priority     Int       @default(0)   // 优先级 (0=普通, 1=紧急, 2=紧急)
// assignedTo   String?                 // 分配给的管理员

// ═══════════════════════════════════════════════════════════════
// AI CREATIVE — Promotion Image System (v2.0新增)
// ═══════════════════════════════════════════════════════════════

// 5. CreativeTemplate — 推广图模板
model CreativeTemplate {
  id          String   @id @default(cuid())

  name        String
  description String?

  // 模板规格
  format      String   // "landscape" / "portrait" / "square" / "story"
  width       Int      @default(1920)
  height      Int      @default(1080)

  // 模板配置（JSON：组件/变量/样式）
  config      Json     // {components: [...], variables: [...], style: {...}}

  // 元数据
  version     Int      @default(1)
  isPublished Boolean  @default(false)

  // 统计
  useCount    Int      @default(0)
  avgCtr      Float?   // 平均点击率

  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([format])
  @@index([isPublished])
}

// 6. CreativeJob — 图片生成任务
model CreativeJob {
  id          String   @id @default(cuid())

  templateId  String
  status      String   @default("pending")  // pending, running, completed, failed

  // 输入数据
  inputData   Json     // [{variables: {...}}, ...]

  // 输出
  outputUrls  String[] @default([])  // 生成图片URL列表

  // 统计
  total       Int
  completed   Int      @default(0)
  failed      Int      @default(0)

  createdBy   String
  createdAt   DateTime @default(now())
  completedAt DateTime?

  @@index([status])
}

// 7. CreativeAsset — 推广素材
model CreativeAsset {
  id          String   @id @default(cuid())

  name        String
  type        String   // "image" / "video" / "copy"

  // 存储
  url         String
  storage     String   // "cdn" / "local"
  size        Int      // bytes

  // 元数据
  tags        String[] @default([])
  folder      String?
  platform     String?  // "reddit" / "twitter" / "instagram"

  // 效果数据
  impressions  Int      @default(0)
  clicks       Int      @default(0)
  ctr          Float?   // click-through rate

  // 版权
  isOriginal   Boolean  @default(true)
  license      String?  // "original" / "free" / "paid"

  uploadedBy   String
  createdAt    DateTime @default(now())

  @@index([type])
  @@index([folder])
  @@index([tags])
}

// 8. CreativeABTest — A/B测试
model CreativeABTest {
  id          String   @id @default(cuid())

  name        String
  hypothesis  String?  @db.Text

  // 测试配置
  variants    Json     // [{id, assetId, traffic_pct}, ...]
  metric      String   // "ctr" / "cvr" / "impressions"
  duration    Int      // days
  trafficAllocation Json // {total: 1000, perVariant: {...}}

  // 状态
  status      String   @default("draft")  // draft, running, completed, stopped
  startDate   DateTime?
  endDate     DateTime?

  // 结果
  winnerVariantId String?
  conclusion   String?  @db.Text

  createdBy   String
  createdAt   DateTime @default(now())

  @@index([status])
}

// ═══════════════════════════════════════════════════════════════
// AI SUPPORT — Customer Service System (v2.0新增)
// ═══════════════════════════════════════════════════════════════

// 9. SupportTemplate — 客服响应模板
model SupportTemplate {
  id          String   @id @default(cuid())

  name        String
  category    String   // "faq" / "guidance" / "calming" / "escalation" / "marketing"

  // 触发条件
  triggerType  String   // "keyword" / "intent" / "sentiment" / "turn_count"
  triggerConfig Json    // {keywords: [...], sentiment: [...], min_turns: 3}

  // 回复内容
  content     String   @db.Text
  tone        String   // "formal" / "friendly" / "professional" / "empathetic"
  language    String[] @default(["en"])  // ["en", "zh"]

  // 变量
  variables   String[] @default([])  // ["user_name", "order_id"]

  // 状态
  isActive    Boolean  @default(true)
  priority    Int      @default(0)   // 数字越大优先级越高

  // 统计
  useCount    Int      @default(0)
  satisfaction Float?  // 用户满意度评分

  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([category])
  @@index([isActive])
  @@index([priority])
}

// 10. KnowledgeArticle — 知识库文档
model KnowledgeArticle {
  id          String   @id @default(cuid())

  title       String
  content     String   @db.Text  // Markdown/Rich text

  category    String   // "features" / "billing" / "account" / "safety" / "privacy"
  status      String   @default("draft")  // draft / review / published / archived
  version     Int      @default(1)

  // 检索
  keywords    String[]
  synonyms    String[] @default([])

  // 关联
  relatedTemplates String[] @default([])

  createdBy   String
  reviewedBy  String?
  publishedAt DateTime?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([category])
  @@index([status])
  @@index([keywords])
}

// 11. SupportTicket — VIP客服工单
model SupportTicket {
  id          String   @id @default(cuid())

  userId      String
  assigneeId  String?  // 分配的客服ID

  // 问题信息
  type        String   // "inquiry" / "complaint" / "suggestion" / "technical"
  priority    String   @default("P2")  // P0/P1/P2/P3
  status      String   @default("open")  // open / in_progress / resolved / closed

  subject     String
  description String?  @db.Text

  // 关联
  messageId   String?  // 关联的VIP消息ID
  orderId     String?  // 关联订单

  // 时间
  firstResponseAt DateTime?
  resolvedAt     DateTime?
  closedAt        DateTime?

  // 评分
  satisfactionScore Int?  // 1-5

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status])
  @@index([assigneeId])
  @@index([priority])
}

// 12. SupportTicketNote — 工单内部备注
model SupportTicketNote {
  id          String   @id @default(cuid())

  ticketId    String
  authorId    String
  content     String   @db.Text
  isInternal  Boolean  @default(true)  // true = 仅客服可见

  createdAt   DateTime @default(now())

  @@index([ticketId])
}

// ═══════════════════════════════════════════════════════════════
// VIP SYSTEM — VIP Customer Management (v2.0新增)
// ═══════════════════════════════════════════════════════════════

// 13. VIPMembership — VIP会员
model VIPMembership {
  id          String   @id @default(cuid())

  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  tier        String   @default("bronze")  // bronze / silver / gold / platinum
  status      String   @default("active")  // active / expired / revoked

  // 有效期
  startDate   DateTime
  endDate     DateTime?

  // 升级/降级原因
  grantedBy   String?  // 管理员ID（手动授予时）
  revokeReason String? @db.Text

  // 累计价值
  totalSpent  Float    @default(0)   // 累计付费金额

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([tier])
  @@index([status])
}

// 14. VIPMessage — VIP消息
model VIPMessage {
  id          String   @id @default(cuid())

  vipUserId   String
  agentId     String?

  content     String   @db.Text
  direction   String   // "inbound" / "outbound"

  status      String   @default("pending")  // pending / claimed / resolved
  priority    String   @default("normal")  // normal / urgent / critical

  claimedAt   DateTime?
  resolvedAt  DateTime?

  // SLA
  slaDeadline DateTime?
  slaBreached Boolean  @default(false)

  satisfactionScore Int?  // 用户评分

  createdAt   DateTime @default(now())

  @@index([vipUserId])
  @@index([status])
  @@index([slaBreached])
}

// 15. VIPServiceRecord — VIP服务记录
model VIPServiceRecord {
  id          String   @id @default(cuid())

  vipUserId   String
  agentId     String
  action      String   // "granted_vip" / "reply" / "coupon_sent" / "upgraded" / "complaint_resolved"
  detail      String?  @db.Text

  createdAt   DateTime @default(now())

  @@index([vipUserId])
  @@index([agentId])
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS ENHANCEMENT — Extended Event Tracking (v2.0新增)
// ═══════════════════════════════════════════════════════════════

// 16. TrafficEvent — 流量事件（扩展AnalyticsEvent）
// 在AnalyticsEvent基础上新增以下字段的索引/增强
// referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term
// device_type, os, browser, country, city

// 17. UserTrackingEvent — 用户追踪事件
model UserTrackingEvent {
  id          String   @id @default(cuid())

  userId      String
  eventType   String   // "page_view" / "action" / "milestone" / "churn_signal"

  // 页面上下文
  page        String?  // "/discover" / "/matches" / "/chat"
  path        String?  @db.Text

  // 事件数据
  eventData   Json?    // {停留时长, 滚动深度, 点击目标...}

  // 时间
  sessionId   String?
  timestamp   DateTime @default(now())

  @@index([userId, timestamp])
  @@index([eventType])
  @@index([sessionId])
}
```

---

## 十、UI/UX设计规范（v2.0更新）

### 10.1 布局结构（v2.0扩展侧边栏）

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo] LokFeel Admin        [搜索]  [通知🔔]  [Admin▾]          │
├────────┬────────────────────────────────────────────────────────┤
│        │                                                        │
│  📊    │   Page Header (面包屑 + 标题 + 操作按钮)                │
│  仪表盘 │   ────────────────────────────────────────────────     │
│        │                                                        │
│  👥    │   Filter Bar (筛选器 + 搜索)                            │
│  用户   │   ────────────────────────────────────────────────     │
│   ├ Bot│                                                        │
│   ├ 举报│   Main Content Area                                    │
│   └ 追踪│   (表格 / 图表 / 详情面板)                              │
│        │                                                        │
│  ❤️    │                                                        │
│  匹配   │                                                        │
│        │                                                        │
│  💬    │                                                        │
│  聊天   │                                                        │
│        │                                                        │
│  💳    │                                                        │
│  支付   │                                                        │
│        │                                                        │
│  🎨    │   ← v2.0新增主导航                                     │
│  推广图 │                                                        │
│   ├ 模板│                                                        │
│   ├ 生成│                                                        │
│   ├ A/B │                                                        │
│   └ 素材│                                                        │
│        │                                                        │
│  🤖    │                                                        │
│  AI客服 │                                                        │
│   ├ 模板│                                                        │
│   ├ 知识│                                                        │
│   ├ 路由│                                                        │
│   └ 质检│                                                        │
│        │                                                        │
│  👑    │                                                        │
│  VIP   │                                                        │
│   ├ 收件│                                                        │
│   ├ 用户│                                                        │
│   ├ 工单│                                                        │
│   └ 绩效│                                                        │
│        │                                                        │
│  📈    │                                                        │
│  分析   │                                                        │
│   ├ 漏斗│                                                        │
│   ├ 留存│                                                        │
│   ├ 收入│                                                        │
│   ├ 用户│                                                        │
│   └ 流量│                                                        │
│        │                                                        │
│  ⚙️    │                                                        │
│  设置   │                                                        │
│        │                                                        │
└────────┴────────────────────────────────────────────────────────┘
```

### 10.2 侧边栏导航配置（admin-sidebar.tsx v2.0更新）

```typescript
const navigation = [
  // 原有6项保留
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Matches", href: "/admin/matches", icon: Heart },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { name: "Content", href: "/admin/content", icon: FileText },
  { name: "Settings", href: "/admin/settings", icon: Settings },

  // v2.0新增导航（3项）
  { name: "AI Creative", href: "/admin/creative", icon: Palette },      // AI推广图
  { name: "AI Support", href: "/admin/ai-support", icon: Headphones },   // AI客服
  { name: "VIP Inbox", href: "/admin/vip-inbox", icon: Crown },          // VIP收件箱
];
```

### 10.3 设计系统

- **组件库**: shadcn/ui（与现有admin页面一致）
- **图表库**: Recharts（折线/柱状）+ Tremor（KPI卡片/表格）+ 地图库（geo分布）
- **主题**: 复用 Warm Sand v4 设计系统（OKLCH 色彩）
- **新色彩规范（v2.0新增）**:
  - AI创意模块: 紫色系（#7C3AED → #A78BFA渐变）
  - AI客服模块: 蓝色系（#2563EB → #60A5FA渐变）
  - VIP模块: 金色系（#D97706 → #FCD34D渐变）
- **VIP标识规范**: 金色边框（1px solid #F59E0B）用于VIP相关内容
- **响应式**: 桌面优先（管理后台不需要移动端）
- **表格**: Tremor Table — 排序/筛选/分页/虚拟滚动
- **实时数据**: 仪表盘指标 60s 自动刷新，可手动暂停

---

## 十一、实施路线图（v2.0更新）

### Phase 1: 基础框架 + P0 模块 (Week 1-2) — v1.0已完成
```
Sprint 1.1-1.3: ✅ 已完成（见v1.0文档）
```

### Phase 2: P1 模块 (Week 3-4) — v1.0已完成
```
Sprint 2.1-2.3: ✅ 已完成（见v1.0文档）
```

### Phase 3: P2 模块 (Week 5-6) — v1.0已完成
```
Sprint 3.1-3.3: ✅ 已完成（见v1.0文档）
```

### Phase 4: v2.0 新模块开发 (Week 7-10) ← 当前阶段

```
Sprint 4.1 (Week 7 - 3天):
  [ ] 用户追踪模块开发
      - UserTrackingEvent数据模型 + 埋点接入
      - 用户行为时间线UI
      - 用户分群看板
  [ ] 流量属性模块开发
      - UTM参数追踪配置
      - 地理分布地图
      - 设备/浏览器分布

Sprint 4.2 (Week 7-8 - 4天):
  [ ] AI推广图模块开发
      - CreativeTemplate数据模型 + API
      - 模板编辑器UI（组件拖拽）
      - 批量生成任务队列
      - 素材资产管理

Sprint 4.3 (Week 8-9 - 4天):
  [ ] AI客服模块开发
      - SupportTemplate数据模型 + API
      - 知识库文档管理UI
      - 路由规则配置
      - 情感监控面板

Sprint 4.4 (Week 9-10 - 4天):
  [ ] VIP收件箱模块开发
      - VIPMembership数据模型
      - VIP收件箱UI（消息列表 + 处理面板）
      - 工单系统
      - 客服绩效看板
```

### Phase 5: 优化与安全 (Week 11-12)

```
Sprint 5.1:
  [ ] 告警系统（AlertRule + Alert + 通知）
  [ ] 性能优化（虚拟滚动/缓存/懒加载）
  [ ] E2E测试（Playwright管理后台测试套件）

Sprint 5.2:
  [ ] 安全审计（XSS/CSRF/SQL注入检查）
  [ ] 日志增强（结构化日志 + 搜索）
  [ ] 文档完善（Admin使用手册）
```

---

## 十二、风险与依赖（v2.0更新）

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Neon 512MB 限制 | 管理后台查询可能超时 | 增加readonly replica / 优化查询 |
| 现有Admin API不完整 | 需要大量新API | 分阶段开发，复用已有端点 |
| Bot数据量大(3500+) | 列表查询慢 | 分页 + 索引优化 + 游标分页 |
| 单人开发 | 交付周期长 | P0优先，v2.0新增模块可延后 |
| AI推广图生成成本 | 调用图像生成API费用 | 设置每日生成上限 + 后备模型 |
| AI客服质量 | 误回复影响用户体验 | 置信度阈值 + 强制转人工 |
| VIP数据隐私 | VIP用户信息更敏感 | 加密存储 + 访问审计 |

---

## 附录：v1.0 → v2.0 变更摘要

### 新增模块（3个）
| 模块 | 页面数 | API端点数 | 新增数据表 |
|------|--------|-----------|-----------|
| AI推广图生成 `/admin/creative` | 5 | 18 | 4 |
| AI客服设置 `/admin/ai-support` | 5 | 16 | 4 |
| VIP客户收件箱 `/admin/vip-inbox` | 4 | 15 | 4 |

### 扩展模块（5个）
| 模块 | 新增三级项 | 新增四级项 |
|------|-----------|-----------|
| 用户管理 `/admin/users` | +1（用户行为追踪） | +20 |
| 数据分析 `/admin/analytics` | +2（用户追踪/流量属性） | +40 |
| 举报管理 `/admin/users/reports` | SLA追踪（+4四级项） | +4 |
| 匹配引擎 `/admin/matches/engine` | 引擎参数配置展开 | +10 |
| 支付管理 `/admin/payments` | 退款管理展开 | +8 |

### 总计（v2.0 vs v1.0）
- **页面总数**: 7 → **24**（+17个页面）
- **API端点**: ~93 → **~180**（+87个端点）
- **数据表**: 30+ → **~46**（+16个表）
- **四级功能项**: ~50 → **~200+**

---

> **文档版本**: v2.0
> **创建日期**: 2026-04-29
> **作者**: Scout（LokFeel AI协调员）
> **下一步**: 评审本文档 → 确认优先级 → 开始Phase 4开发（Week 7）
