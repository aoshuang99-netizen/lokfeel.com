# 贡献指南 (Contributing Guide)

感谢你有意为本项目贡献代码。在提交第一个 PR 前，请完整阅读本文件 —— 其中**第 2 节（范围边界）**与**第 5 节（DCO 签署）**是硬性要求，不满足的 PR 会被直接关闭。

---

## 1. 本地开发环境

### 1.1 环境要求

| 组件 | 版本要求 | 说明 |
|---|---|---|
| Node.js | 见 `.nvmrc` | 建议用 `nvm use` |
| npm | 随 Node.js | 本项目使用 npm（存在 `package-lock.json`） |
| PostgreSQL | 14+ | 生产与开发均以此为准 |
| Redis | 6+ | 限流、缓存、实时消息广播 |

### 1.2 启动步骤

```bash
# 1. 安装依赖（postinstall 会自动执行 prisma generate）
npm install

# 2. 准备环境变量
cp .env.example .env.local
# 然后按需填写数据库、Redis、认证等配置

# 3. 初始化数据库
npm run db:push        # 开发环境快速同步 schema
# 或 npm run db:migrate  # 需要生成迁移文件时使用
npm run db:seed        # 可选：写入基础数据

# 4. 启动
npm run dev            # http://localhost:3099
npm run dev:socket     # 需要实时通信（IM / WebRTC 信令）时另开一个终端
```

### 1.3 常用命令

```bash
npm run lint            # ESLint
npx tsc --noEmit        # 类型检查（提交前必须通过）
npm test                # Jest 单元/集成测试
npm run test:coverage   # 覆盖率（阈值见 jest.config.js）
npm run test:e2e        # Playwright 端到端测试
```

> **注意**：`jest.config.js` 中声明了 80% 的覆盖率阈值。当前实测覆盖率尚未达标，这属于已知技术债（见 `docs/` 中的改造计划）。**新增代码必须自带测试**，不要进一步拉低覆盖率。

---

## 2. 范围边界（不接受的内容）

本项目定位为**内容中立的关系匹配 / 社群平台引擎**。以下内容**不会**被合入主仓库：

| 类别 | 说明 |
|---|---|
| ❌ 用户内容 | 任何用户生成内容、种子数据、演示用的真实用户数据 |
| ❌ 成人内容素材 | 图片、视频、文案等任何成人内容素材 |
| ❌ 机器人/虚假用户体系 | 用于伪造用户规模的自动化账号、互动模拟、learning 任务 |
| ❌ 硬编码凭证 | API key、token、私钥。见第 6 节 |
| ❌ 特定运营方的业务定制 | 面向单一客户的定制逻辑，请做成插件或 fork |
| ❌ 特定支付通道的强绑定 | 支付必须以可替换的 provider 接口接入（见 `docs/PAYMENT-COMPLIANCE.md`） |

如果你需要上述能力，正确做法是**做成可选插件**并在你自己的 fork 中启用。

---

## 3. 分支与提交规范

### 3.1 分支命名

```
feat/<简短描述>      新功能
fix/<简短描述>       缺陷修复
docs/<简短描述>      文档
refactor/<简短描述>  重构
chore/<简短描述>     构建、依赖、配置
```

### 3.2 提交信息

采用 Conventional Commits：

```
<type>(<scope>): <subject>

<body 可选：说明为什么这么改>

<footer：DCO 签署，见第 5 节>
```

示例：

```
fix(payments): 结账入参改用计划 ID 校验，拒绝非法套餐字符串

原先直接透传前端传回的 plan 字段，未做白名单校验。
现改为经 isPlanId() 鉴权后再查询配置。

Signed-off-by: Your Name <you@example.com>
```

---

## 4. Pull Request 检查清单

提交 PR 前请逐项确认：

- [ ] `npx tsc --noEmit` 通过（**零类型错误**）
- [ ] `npm run lint` 通过
- [ ] `npm test` 通过，且为新增逻辑补充了测试
- [ ] 没有引入新的硬编码价格 / 凭证 / 套餐名
- [ ] 涉及价格或配额时，只修改 `src/config/plans.ts`（单一配置源）
- [ ] 涉及数据库 schema 时，附带了迁移文件与回滚说明
- [ ] 不包含第 2 节列出的任何内容
- [ ] 已按第 5 节完成 DCO 签署
- [ ] 描述中说明了：**改了什么、为什么改、如何验证**

PR 描述请使用以下结构，便于审阅者快速判断：

```markdown
## 改了什么
## 为什么
## 如何验证（复现步骤 / 测试命令）
## 影响范围与风险
## 截图（UI 变更时）
```

---

## 5. DCO 签署（强制）

本项目采用 **Developer Certificate of Origin 1.1**（全文见 `DCO.md`）。

每一次提交都必须包含签署行：

```
Signed-off-by: Your Real Name <you@example.com>
```

可用 Git 自动添加：

```bash
git commit -s -m "fix(payments): ..."
```

配置真实姓名与邮箱（**不接受匿名或化名签署**）：

```bash
git config user.name  "Your Real Name"
git config user.email "you@example.com"
```

未签署的 PR 会被 CI 自动拦截。

### 关于 CLA

若项目未来需要接受外部贡献并保留**双许可（AGPLv3 + 商业许可）**的转售能力，将要求贡献者额外签署 Contributor License Agreement。该协议目前处于草案阶段（见 `CLA.md`，**尚未生效**）。

在此之前提交的贡献，将按 `DCO.md` 的声明处理。**如果你不同意未来可能的 CLA 要求，请在 PR 中明确说明。**

---

## 6. 安全与凭证

- **绝对不要**提交 `.env`、`.env.local`、`.env.production`、`.cf-secrets.json` 等任何含真实凭证的文件
- 新增外部服务依赖时，同步更新 `.env.example`（只写占位符）
- 若误提交了凭证：**立即**在 PR 中说明，凭证会被要求轮换，历史提交需清理
- 密钥扫描（gitleaks）会在 CI 中运行，检出即失败

## 7. 发现安全问题

**不要**开公开 Issue。请按 `SECURITY.md` 的流程私下披露。

---

## 8. 插件与扩展

如果你要做的是"主流不接受、但你想自己用"的能力（例如成人场景合规模块、机器人演示体系）：

1. 做成独立插件包，通过本项目的插件接口接入
2. 不要修改核心仓库
3. 欢迎在 Discussions 中分享你的插件，但不代表官方认可

---

## 9. 行为准则

所有参与者需遵守 `CODE_OF_CONDUCT.md`。

---

*感谢你的贡献。正是这些贡献让这个项目值得存在。*
