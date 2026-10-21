# 05 · 交互缺口矩阵（Interaction Gap Matrix）

> 依据：`04_UX_AUDIT_13_SCREENS.md`（2026-10-21 生产真实登录态审计，26 张截图）
> 本轮执行：`e5e8846`（设计 C + 三处审计缺陷 + 门禁）、`194acc4`（legacy 语义与开发者口径）
> 状态口径只有三种：**FIXED**（有提交与证据）/ **OPEN**（已确认、未动）/ **DEFERRED**（明确不做，附理由）

## 一、审计缺陷的闭环状态

| 编号 | 严重 | 位置 | 现象 | 本轮处置 | 状态 |
|---|---|---|---|---|---|
| F-01 | P1 | 全站 | CSP 拦截 `static.cloudflareinsights.com/beacon.min.js`，13/13 屏各 1 条 console error，Web Analytics 同时丢数据 | `next.config.ts` 放行该域（`script-src`）并补 `connect-src https://cloudflareinsights.com`。仍保持白名单，`unsafe-eval` 继续禁止 | **FIXED** `e5e8846` |
| F-02 | P1 | `/workspace` Studio | 首段讲 "zod 严格校验 / 白名单组件 / 不允许产出 HTML" —— 实现细节当产品文案 | 改为用户语言："要联系谁、要谁同意、做成什么算完成、结果怎么核验" | **FIXED** `194acc4` |
| F-03 | P2 | `/workspace` 底部 | "编译在本地完成（规则式，纯函数）" 是开发者口径 | 改 "编译在本地完成；只有真正创建任务时才会写入服务端" | **FIXED** `194acc4` |
| F-04 | P1 | `/console/*` 七屏 | 组织名被写成 `<h1>`，七屏各有两个 h1，DOM 首个恒为同一组织名 | 组织名降为 `<p>`，页面标题由各屏自己声明唯一 h1 | **FIXED** `e5e8846` |
| F-05 | P2 | `/workspace` Now | 首屏三卡全是计数器，第三张还是 B2C 的「我的匹配 / `GET /api/matches`」 | 第三张改「待你介绍」，数字来自 `connections/proposals` 的已同意未介绍提案；同时从 Evidence Lens 删除该 legacy 端点 | **FIXED** `194acc4` |
| F-06 | P2 | `/workspace` 全部 | Evidence Lens 常驻，对普通用户是噪音 | 未动。它当前是 Now/Studio 两屏唯一的"数据来源可核对"入口，折叠会削弱审计性；需要先做出"角标 → 展开"的等价证据入口再改 | **DEFERRED** |
| F-07 | P3 | `/console` 首页 | 一句里混排括号与斜杠 | 压成「筛选、发布与状态迁移都在「任务」屏。」 | **FIXED** `194acc4` |
| F-08 | P3 | `/workspace` Studio | 主操作在折叠线以下，空态画布占首屏 | 空态加「开始输入目标」按钮，直接聚焦底部输入框 | **FIXED** `194acc4` |
| F-09 | P1 | `/workspace` 移动端 | 底部悬浮输入框压住页面尾部内容 | `main` 底部留白改 `calc(10.5rem + env(safe-area-inset-bottom))`；Inspector 浮层与 composer 同步加安全区 | **FIXED** `e5e8846` |

## 二、设计 C 引入的交互契约（新增，必须持续守住）

| 编号 | 契约 | 为什么是硬约束 | 证据 |
|---|---|---|---|
| C-01 | 阶段条四段计数**只能**来自 `/api/v1/connections/proposals`、`/api/v1/agents/runs`、`/api/v1/outcomes/timeline` | 任何"看起来合理"的数字都是伪造；审计里最有价值的一点就是每个数字都能追到端点 | `src/lib/living/adaptive/stages.ts` 头部注释 |
| C-02 | 端点未返回时显示「—」，**不得**显示 0 | 0 表示"真的没有"，null 表示"读不到"，两者混用等于虚报 | `tests/living/adaptive-stages.test.ts` 第 1 例；变异把 `null` 折成 `0` 即判红 |
| C-03 | 点阶段条 = 聚焦对应屏；**不做**自动跳屏 | 把用户正在读的页面从底下换掉是敌意行为；"自适应"只体现在默认聚焦与状态排序上 | `stage-rail.tsx` 只调用 `onFocusView`，无 `router.push` |
| C-04 | 双世界的两个调色板必须各自满足 WCAG AA | 左深右浅是两套底，任何一套不达标都是真实不可读 | `npm run verify:contrast`：5 个调色板块 × 15 组令牌全绿 |
| C-05 | 双世界的换肤只能通过 `[data-lf-world]` 的令牌作用域，不允许给组件传 theme | 传 theme 会漏掉写了死色的角落；令牌作用域让既有子组件零改动 | `globals.css` 的 `[data-lf-dual='1'] [data-lf-world='canvas'|'inspector']` |

## 三、仍未闭合的交互缺口

| 编号 | 缺口 | 影响 | 为什么这一轮不做 |
|---|---|---|---|
| G-01 | `/workspace` 六屏之间没有 URL 状态：刷新后回到 Now，深链无法分享到某一屏 | 协作场景下"把这个屏发给同事"做不到 | 需要引入 `?view=` 与 `history.replaceState`，并处理登录回跳；属于路由层改造，单独立项 |
| G-02 | 六屏切换是 `state` 切换，键盘用户需要按 Tab 逐个数 | 键盘效率低 | 可先加 `aria-keyshortcuts` + 数字键直跳；待与 C-03 一起设计，避免与浏览器快捷键冲突 |
| G-03 | 阶段条在移动端横向滚动，四段不能一屏排下 | 需要左右滑才看全 | 已保留 `overflow-x-auto` 与 `aria-label`；改成 2×2 栅格会牺牲"流水线"隐喻，留待可用性测试 |
| G-04 | Field 的画布节点没有等价的无障碍列表视图 | 屏幕阅读器用户无法遍历节点 | 属于 `field-canvas` 的独立改造（图 + 列表双视图），工作量大于本轮 |

## 四、验收方式（可复跑）

```bash
npm run audit:ux13        # 13 屏截图 + 标题 + 错误（只读）
npm run audit:release     # 横向溢出 / 触控目标 / LCP / CLS / reduced-motion
npm run verify:contrast   # 令牌对比度（纯计算，可进 CI）
npm run verify:brand-scan # 公开路由禁词
```
