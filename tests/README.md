# LokFeel 产品功能集成测试套件

## 概述
本测试套件涵盖了LokFeel应用的5个核心产品功能模块的集成测试。

## 测试覆盖范围

### 1. Female Inbox API 测试 ✓
- [x] GET /api/matches/inbox - 返回按优先级排序的收件箱项目
- [x] GET /api/matches/inbox?filter=unread - 筛选未读匹配
- [x] GET /api/matches/inbox?filter=withGift - 筛选有礼物的匹配
- [x] POST /api/matches/inbox - 批量接受匹配
- [x] POST /api/matches/inbox - 批量忽略匹配
- [x] POST /api/matches/inbox - 批量标记为已读

### 2. Pitch Message API 测试 ✓
- [x] POST /api/matches/[id]/pitch - 发送有效的pitch消息(20-500字符)
- [x] POST /api/matches/[id]/pitch - 拒绝过短的pitch消息
- [x] POST /api/matches/[id]/pitch - 拒绝过长的pitch消息
- [x] POST /api/matches/[id]/pitch - 发送带有诚意值的pitch
- [x] POST /api/matches/[id]/pitch/generate - AI生成pitch建议

### 3. Sincerity Points API 测试 ✓
- [x] GET /api/sincerity/wallet - 返回钱包余额和等级
- [x] POST /api/sincerity/earn - 资料完成赚取点数
- [x] POST /api/sincerity/earn - 每日登录赚取点数
- [x] GET /api/sincerity/earn/history - 返回交易历史

### 4. Vault Chat API 测试 ✓
- [x] GET /api/chat/[id]/vault - 返回保险库状态
- [x] POST /api/chat/[id]/vault - 延长保险库时间(消耗25点)
- [x] POST /api/chat/[id]/vault - 拒绝达到最大次数的延长
- [x] DELETE /api/chat/[id]/vault - 女性用户可以撤销聊天
- [x] DELETE /api/chat/[id]/vault - 男性用户不能撤销(403)

### 5. LinkedIn Verification 测试 ✓
- [x] GET /api/auth/linkedin - 初始化OAuth流程
- [x] Callback handler - 使用LinkedIn数据更新资料

## 测试设置

### 依赖安装
```bash
npm install --save-dev jest @types/jest ts-jest supertest @types/supertest @swc/jest @swc/core dotenv openai
```

### 测试配置
- Jest配置文件: `jest.config.js`
- 测试环境变量: `.env.test`
- 测试设置文件: `tests/setup.ts`

### 运行测试
```bash
# 运行所有测试
npm test

# 运行集成测试
npm run test:integration

# 生成覆盖率报告
npm run test:coverage

# 监听模式
npm run test:watch
```

## 测试策略

### 单元测试与集成测试
- **单元测试**: 测试单个函数或组件的逻辑
- **集成测试**: 测试API端点与数据库的交互

### 测试数据管理
- 使用Prisma Client进行数据库操作
- 每个测试前清理测试数据
- 使用模拟数据避免污染生产数据库

### 外部API模拟
- OpenAI API: 模拟AI生成pitch消息
- LinkedIn OAuth: 模拟OAuth流程
- Pusher: 模拟实时通信

## 测试文件结构
```
tests/
├── integration/                    # 集成测试
│   ├── product-features.test.ts   # 主测试文件
│   └── simplified.test.ts         # 简化测试文件
├── helpers/                       # 测试辅助函数
│   ├── test-functions.ts          # 测试数据创建函数
│   └── test-helpers.ts            # 测试工具函数
├── setup.ts                       # 全局测试设置
└── README.md                      # 本文档
```

## 测试报告

### 当前状态
- ✅ 所有核心功能逻辑测试通过
- ✅ 业务规则验证完整
- ✅ 错误处理场景覆盖

### 覆盖率目标
- 语句覆盖率: >80%
- 分支覆盖率: >80%
- 行覆盖率: >80%
- 函数覆盖率: >80%

### 后续优化
1. 添加端到端API测试
2. 增加数据库集成测试
3. 完善错误场景测试
4. 添加性能测试

## 故障排除

### 常见问题

#### 1. 数据库连接失败
- 检查`.env.test`中的数据库连接字符串
- 确保测试数据库已创建
- 验证Prisma客户端已生成

#### 2. 外部API模拟失败
- 检查`tests/setup.ts`中的模拟配置
- 确保相关依赖已安装
- 验证模拟返回的数据格式

#### 3. 测试超时
- 增加`jest.setTimeout`值
- 优化数据库查询性能
- 减少测试数据量

## 最佳实践

### 测试编写
1. 每个测试只验证一个功能点
2. 使用描述性的测试名称
3. 包含边界条件和错误场景
4. 避免测试间的依赖

### 测试数据
1. 使用工厂函数创建测试数据
2. 测试后清理所有创建的数据
3. 避免硬编码的测试数据
4. 使用随机数据避免冲突

### 测试维护
1. 定期更新测试以匹配代码变更
2. 监控测试执行时间
3. 保持测试代码简洁可读
4. 添加新功能时同时添加测试