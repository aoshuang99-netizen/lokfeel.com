# V25.6-GA｜可执行 UI / UE / UX / CSS 规范

**范围**：首页、注册、聊天、私人AI、联系人、Space、个人隐私、组织 Console 和开源开发者页。以下 CSS 是候选设计 Token 和布局约束，**尚未实装**；实施时审计现有 Tailwind Token 后通过增量迁移，不能无声覆盖全站。

## 1. 核心体验原则

1. **人先于系统**：人、联系人和下一步沟通动作占主视觉。Mission/Agent/A2A/Token/Queue/RAG/MoE 只在高级抽屉或开发者区域出现。
2. **一个页面，一个核心任务**：当前页主要 CTA 恰好一个；次要动作不与它争夺层级。未知功能展示实际禁用原因，不能放按钮让人猜。
3. **真实、可追溯、可行动**：页面上的每一个数据卡和可视化必须有 `source_endpoint / underlying_record_ids / last_updated / permission_scope / drilldown / next_action`。缺一项，则改成真实可操作的列表或移除。
4. **将 AI 放进真实对话，而不是另造工作台**：聊天输入框上方放“帮我表达”，从实际会话上下文生成；默认仅当前用户草稿，不写入其他用户的会话、不自动发送。
5. **私密边界必须同屏**：显示处理位置 Local / Cloud, 数据使用范围、已授权与否，尤其是 AI 草稿、记忆、导出、转发等操作。
6. **先做真闭环，再做效果装饰**：如使用图谱，应有实际人/Space/Consent/事件关联且可点击，否则删除。没有关系数据时显示如何邀请朋友，不显示静态宇宙图。

## 2. IA 与行为模型

### 官网（英文站）
`Logo | For You | For Teams | Open Source | Safety | [Start a conversation]`
只允许实际可用或明确标记 `Private Beta` 的 CTA。Pricing 在商业批准前不放主导航。

### Personal（移动）
底部四入口：`Chats / People / Spaces / My AI`。桌面改左侧栏。首屏优先最近真实聊天，不显示陌生人滑卡、不展示爱心匹配数和历史产品积分。

### Business（组织）
左侧：`Overview / Spaces / People / Connections / AI / Settings`。首页上方是“需要你确认的事项”列表；运营技术队列可折叠至 `Advanced / Operations`。企业账号切换位置清晰，切换时清空/重新查询缓存。

### 开源开发者
`Overview / Self-host / API & SDK / Models / Security / Contribute`。必须有真实发行与运行指引，尚未交付标 `planned`；不能以功能幻灯片代替安装。

## 3. 设计 Token（可直接提案给 CSS/Tailwind）

```css
/* 提议：只在新的 lf-* 作用域内启用，逐页迁移后再决定是否作为全局 Token。 */
.lf-root {
  --lf-bg: #F7F8F6;
  --lf-surface: #FFFFFF;
  --lf-ink: #17251E;
  --lf-muted: #526159;
  --lf-primary: #0E563E;
  --lf-primary-hover: #0A4330;
  --lf-primary-soft: #E7F1EB;
  --lf-border: #D7E2D9;
  --lf-error: #B42332;
  --lf-focus: #1464BD;
  --lf-radius-sm: 10px;
  --lf-radius-md: 16px;
  --lf-radius-lg: 24px;
  --lf-shadow: 0 16px 48px rgb(13 39 28 / 6%);
  --lf-space-1: 4px; --lf-space-2: 8px; --lf-space-3: 12px;
  --lf-space-4: 16px; --lf-space-6: 24px; --lf-space-8: 32px;
  --lf-content-max: 1160px;
  --lf-touch: 44px;
  background: var(--lf-bg); color: var(--lf-ink);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.lf-root * { box-sizing: border-box; }
.lf-root :focus-visible { outline: 3px solid var(--lf-focus); outline-offset: 3px; }
.lf-root button, .lf-root a[role="button"], .lf-root input { min-height: var(--lf-touch); }
.lf-root .lf-page { width: min(100% - 32px, var(--lf-content-max)); margin-inline: auto; }
.lf-root .lf-hero { display: grid; gap: 40px; align-items: center; padding-block: clamp(52px, 8vw, 104px); }
.lf-root .lf-hero h1 { max-width: 13ch; font-size: clamp(2.25rem, 5vw, 4.5rem); letter-spacing: -0.04em; line-height: 1.08; }
.lf-root .lf-copy { max-width: 57ch; font-size: clamp(1rem, 1.25vw, 1.125rem); line-height: 1.6; color: var(--lf-muted); }
.lf-root .lf-primary-action { color: #FFF; background: var(--lf-primary); border-radius: 999px; padding: 12px 22px; }
.lf-root .lf-primary-action:hover { background: var(--lf-primary-hover); }
.lf-root .lf-card { background: var(--lf-surface); border: 1px solid var(--lf-border); border-radius: var(--lf-radius-md); padding: 20px; }
.lf-root .lf-shell { display: grid; grid-template-columns: 236px minmax(0, 1fr); min-height: 100dvh; }
.lf-root .lf-chat { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); height: min(100dvh, 960px); }
.lf-root .lf-chat-thread { min-width: 0; overflow-y: auto; overscroll-behavior: contain; }
.lf-root .lf-composer { position: sticky; bottom: 0; padding: 12px 16px max(12px, env(safe-area-inset-bottom)); background: var(--lf-surface); border-top: 1px solid var(--lf-border); }
.lf-root .lf-assist-sheet { width: min(100%, 560px); max-height: 70dvh; overflow-y: auto; }
.lf-root .lf-bottom-nav { display: none; }
@media (min-width: 920px) {
  .lf-root .lf-hero { grid-template-columns: minmax(0, 1fr) minmax(360px, 0.95fr); }
}
@media (max-width: 767px) {
  .lf-root .lf-page { width: calc(100% - 32px); }
  .lf-root .lf-hero { padding-block: 40px 48px; }
  .lf-root .lf-hero h1 { max-width: 17ch; }
  .lf-root .lf-shell, .lf-root .lf-chat { display: block; min-height: 100dvh; height: auto; }
  .lf-root .lf-chat-thread { padding-bottom: 112px; }
  .lf-root .lf-bottom-nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); position: fixed; bottom: 0; left: 0; right: 0; padding-bottom: env(safe-area-inset-bottom); background: var(--lf-surface); border-top: 1px solid var(--lf-border); z-index: 20; }
  .lf-root .lf-desktop-sidebar { display: none; }
  .lf-root .lf-composer { bottom: calc(56px + env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
  .lf-root *, .lf-root *::before, .lf-root *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

颜色对比的静态计算：`#17251E` on `#F7F8F6` ≈ 14.94:1；`#526159` on `#FFFFFF` ≈ 6.54:1；`#0E563E` on `#FFFFFF` ≈ 8.68:1。**仍须在真实界面中按实际层叠背景、不同状态、浅色/深色逐格测量**。建议先稳定浅色系统，随后再设计完整深色主题，不要混用旧 cool-blue、gold、玻璃和 gradient 风格。

## 4. 关键页面的视觉与行为

### Homepage
- 第一屏只有 Logo、价值主标题、说明、唯一 CTA 与一处可辨认的真实聊天场景。场景必须使用有来源、获许可的真实测试数据且标注 **test environment**；不能制作看似已有用户业绩的“截图演示”。
- 移除旧 3D rAF 漂浮芯片、`Outcome verified` 假视觉、Token / MCP / Mission 流水线、技术能力计数和巨型营销卡。将“安全与控制”移至 CTA 同屏，后续为 Personal/Business 两个明确场景入口。
- 无登录态 CTA → `/register` 且保留安全 callback；有登录态 CTA → `/dashboard/chats`（新主导航）。首屏所有文案按 capabilities 标记 “Available” / “Private beta” / “Planned” 并经真实服务验证。

### Chats
- 左：最近真实会话、未读、搜索、创建联系人/邀请；右：真实消息列表与输入框。未建立会话时左/右合为一个“邀请联系人”动线；禁止旧 `LokFee! Messages / Find Matches` 作为默认主操作。
- 每个消息：`DRAFT`（仅本人可见） / `SENDING` / `SENT`（服务端持久） / `DELIVERED`（接收客户端确认） / `READ`（接收者查看） / `FAILED`（可重试）。缺设备级确认时**不得渲染 Delivered**。
- 发送按钮在未获许可、无有效会话或存在严重输入错误时禁用并解释。读取侧权限撤回后显示“无法查看该媒体”而非敏感原文或空白。
- 轮询模式需诚实标 `Syncing` / `Updated X seconds ago`（仅有可靠服务时才显示），不伪装实时 Socket。

### AI Assist（与 Chats 绑定，不另起系统首页）
- 按钮：`Help me say this`；功能：Translate / Rephrase / Clarify；默认处理当前输入，不读取全会话历史。要扩大上下文必须有显式 `include_context` 切换和有效服务端 Consent。
- 侧抽屉应同时展示 `Original` 与 `Suggested`，并提供 `Use suggestion`、`Edit`、`Discard`。AI 建议写入 composer，不直接调用 send。
- Consent UI：`Processing: On this device` / `Cloud processing (requires permission)`、数据范围、用途、撤回链接。无 Provider 时显示 `AI writing is not available yet`，可继续普通聊天，不可生成 Stub 文本冒充模型。
- 请求状态：idle/requesting/ready/error/unavailable/revoked；前端不接收 raw model key；Trace 内仅显示 provider/model 和费用/延迟等非敏感元数据。

### Personal privacy
- 三栏：`Saved by me`、`Shared with others`、`Used for AI`。每条记忆有来源、最后更新时间、可见范围、删除/撤回/纠错；对方已收到内容不可宣称已从对方设备远程删除。
- 没有可信记忆时明确显示“你还没有保存任何私人记忆”，可触发记录/帮助，不能渲染空雷达。

### Business Overview / Console
- 主区：真实操作列表三组 `Waiting for my decision` / `Ready to introduce` / `Needs follow-up`。每行：真人或受许可成员、任务/连接标题、必要权限、真实时间、**可实际点击的操作**和记录 ID。
- 运营 KPI（jobs running、delivery failure、captured, sent）下沉二级 `Operations`。`captured` 不能写成 `sent`，工作流阶段不能冒充关系结果。
- 每个数值类可视化必须满足 DataCard 六条件（来源、更新时间、权限域、分子分母、钻取、下一步动作），否则删除。
- `No people yet` 空状态 → Invite member；`No accepted introductions yet` → Create consent-based request；`No evidence` → 说明未验证，而不是写 `0% success`。

### Developer / OSS
- 页首：Self-host in your environment；提供已验证 install runbook、版本、依赖、model adapter、security statement；无正式制品时禁用安装 CTA 并标注 source-build/under review。

## 5. 全页面/组件质量门禁
- 320 / 375 / 390 / 768 / 1024 / 1440 / 1920 px；200% zoom；触摸 >=44 CSS px（内部建议，WCAG 2.2 最小目标另行审计）；普通文本对比 >=4.5:1；键盘 Tab 顺序、焦点可见、ESC 关闭、读屏标签、编辑器语义完整。
- `loading, empty, denied, offline, error, retrying, missing-source, AI-unavailable, draft, sent, delivered, read` 每个交互流程都有真实状态与 UI 测试；错误不能只弹 Toast 后丢弃用户草稿。
- 真实首值性能：PerformanceBudget：P0 LCP <=2.5s, CLS <=0.1, TBT <=200ms（实验室值）；移动可交互成本要配合主线程和 JS bundle 数据测量；有真实用户数据时报告 p75 INP <=200ms。
- 所有图表显示本组织真实业务数据，数据只读访问越权时**不允许前端拿到数据后再隐藏**；字段级权限服务端实现。
- Snapshot/视觉检查必须覆盖 7 视口×state（至少 loaded/empty/error/denied/AI-unavailable），不是只测一种 happy path。
