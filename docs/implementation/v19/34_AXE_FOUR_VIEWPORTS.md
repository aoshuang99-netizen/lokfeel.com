# 34 · AXE-CORE 四视口扫描（WB19-64 · V19.6）

日期：2026-10-30　分支：`v19/design-exploration`

## 1. 交付物

`scripts/qa/v196-axe-scan.mjs` —— axe-core 4.13.0 注入式扫描 + 棘轮门禁：

- **6 页 × 4 视口**（360×800 / 390×844 / 768×1024 / 1440×900）= 24 次扫描；
- 公开面 `/` `/login` `/register`；认证面 `/dashboard/explore` `/dashboard/chats/<夹具会话>`；产品面 `/workspace`；
- **不新增依赖**：仓里已有 `axe-core`（传递依赖），直接 `page.addScriptTag(axe.min.js)`；
  沙箱装不完依赖是已知事实，`@axe-core/playwright` 引不进来也没必要；
- 门禁语义与 lint 棘轮同构：逐 `(page × viewport × ruleId)` 比对基线
  `docs/implementation/v19/axe-baseline.json`，**只有新增才判红**；下降记为改进；
- 诚实护栏：登录态被重定向到 /login 的格子记 `redirected-to-login`（**不算 0 违规** ——
  空集恒真是假绿）；HTTP ≥400 与页面异常同样显式记录，不冒充扫描结果。

## 2. 首跑实测（2026-10-30 · 构建 `F5MMlHi7tIE9ttOAt9ulO`）

| 规则 | 页面 | 节点数（随视口浮动） | 定性 |
|---|---|---|---|
| `color-contrast` | `/` | 30~32 | 存量债（落地页大量文字/背景组合） |
| `scrollable-region-focusable` | `/` | 1 | 存量债 |
| `color-contrast` | `/register` | 4~5 | 存量债 |
| `region` | `/workspace` | 3 | 存量债（landmark 结构） |
| `color-contrast` | `/workspace` | 1 | 存量债 |
| **`button-name`** | `/dashboard/chats/*` | 2~7 | **真缺陷 → 已修** |
| **`page-has-heading-one`** | `/dashboard/explore`、`/dashboard/chats/*` | 1 | **真缺陷 → 已修** |
| **`link-name`** | `/dashboard/chats/*`（360/390） | 1 | 待定位（移动端专有节点） |

### 修复前的取证细节（不靠猜）

- `button-name` 的节点是 `.gap-2 > button:nth-child(1/2)` —— 会话列表外壳
  `chats/layout.tsx` 顶部的 **Filter / MoreVertical 两个图标按钮**（无 aria-label、无 title）；
- `page-has-heading-one` 的一个**假线索**：/login 源码里明明有 `<h1>Welcome Back</h1>`。
  带登录态实测才发现真相 —— **带 cookie 访问 /login 会 302 到 /dashboard/explore**，
  所以违规的其实是 explore。而 explore 只有"有人可刷"的主视图有 `<h1>Discover</h1>`，
  **加载态与空态（新用户首访的常态！）都没有 h1**。

## 3. 已修（最小改动，零视觉影响）

| 文件 | 修复 |
|---|---|
| `chats/layout.tsx` | Filter / More 按钮补 `aria-label`；`<h1 class="sr-only">Messages</h1>` 挂在**根节点**（挂侧栏会被 `hidden md:flex` 整树 display:none 吞掉，360 视口照样违规） |
| `chats/[roomId]/page-content.tsx` | 6 个图标控件补 `aria-label`：Mic、Send image、Emoji picker、Quick replies(Zap)、Dismiss AI suggestions(X)、移动端返回链接 |
| `explore/page-content.tsx` | 加载态 / 空态两个分支各补 `<h1 class="sr-only">Discover people</h1>` |
| `stage-rail.tsx` | 阶段条状态小字 `text-lf-text-faint` → `text-lf-text-muted`（暗色主题下 faint 叠聚焦卡 signal-soft 底只有 ~3.78:1 < 4.5；muted 5.02:1 达标） |

修复后：`/dashboard/explore` 与 `/dashboard/chats/*` **全 4 视口 0 违规**。

lint 棘轮定向复算：全部改动文件**零新增**。

### 扫描器自身的两次工程修正（门禁可信的前提）

门禁自证抓出了**非确定性**（同一格 30↔31、0↔1 翻转），解法不是放宽门禁：

1. **同格连扫 3 次取逐规则最大值** —— 落地页有随加载时序变化的动态内容，
   基线必须按"最坏情况"冻结，否则每次重跑都在赌运气；
2. **settle 等"DOM 静默期"**（MutationObserver，800ms 无变更，封顶 8s）——
   只等 networkidle 会扫到 SSR 半成品 / 入场动画渐变中的临界对比度。

修完后 `--gate` 连跑两次均**零新增**（2026-10-30）。

## 4. 存量债（冻结在基线里，不许再涨）

`color-contrast`（落地页 ~31 节点 / 注册页 4~5 / workspace 1）、`region`（workspace 3）、
`scrollable-region-focusable`（落地页 1）本轮**不修**：都是视觉层的系统性问题，
需要设计侧给对比度方案（V16 的 `verify:contrast` 门禁管的是设计令牌，管不到
运行时组合出的每一组前景/背景），硬拍颜色会破坏双世界主题。
它们已冻结进 `axe-baseline.json`，**只许下降不许上涨**。

## 5. 附带修复：`src/generated` 陈旧生成物

构建期类型检查暴露 `DbProviderKind is not assignable to AgentProviderKind`：
HEAD 里检入的 `src/generated` 落后于 `prisma/schema`（缺 `AgentProviderKind.WORKBUDDY`）。
按 CI 同款顺序（`prisma generate` → `next build`）重新生成后一致，
本批把再生成结果一并提交，消除"检入产物与 schema 漂移"的坑。

## 6. 与 CI 的关系

- 门禁模式（`--gate`）已实现并本地双跑稳定；本轮先以**报告模式**冻结基线，
  `--gate` 接进 e2e job 放在下一批次（避免一次改动同时引入新扫描面与新门禁）；
- 接入时与 lint 棘轮同样的纪律：基线变化必须出现在 diff 里被 review；
- 注意：扫描器本地跑的是 `next dev`（沙箱生产构建易被环境打断），
  接入 CI 时跑的是 e2e job 里的生产构建 —— 基线取"最坏情况"语义下两者可比。
