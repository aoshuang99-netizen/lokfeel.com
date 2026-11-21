# LokFeel 前后台 UI/UX 真实整改报告 · 2026-11-21

> 分支：`ui-remediation/20261121`（从 RC `8de107c` 切出，隔离工作分支）
> 证据类型：`REAL_BROWSER`（本地 HTTP / 登录夹具账号 / 非生产）
> 诚实边界：本报告证明 **LOCAL / REAL_BROWSER_TESTED**，不升级为 PRODUCTION_VERIFIED。
> 全程未部署生产、未迁移、未改密钥、未扣款、未对外发消息。

## 0. 用户指控的核实（先证伪自述）

用 `git rev-parse <main>:<file>` 与 `<rc>:<file>` 对比 blob 哈希，用户"一半没发布、一半根本没改"的判断属实：

| 页面 | main vs 原 RC 候选 | 本轮整改后 |
|---|---|---|
| `/dashboard` | **SAME**（`876bfefb`）| CHANGED（`7446945c`）|
| `/console` | **SAME**（`e631eafd`）| CHANGED（`58a50a6e`）|
| `/dashboard/connections` | **SAME**（`54d33b82`）| CHANGED（`db1de0e7`）|
| `/workspace`（living-workspace） | **SAME**（`5e712193`）| CHANGED（`444eef8e`）|
| `/dashboard/chats` | CHANGED（局部）| CHANGED（`b53dfb57`）|
| `/` 首页 | CHANGED（仅标题）| 未再改（本次聚焦没变的页面）|
| `/product` `/solutions` | CHANGED（偏 Goal 叙事）| solutions CHANGED（`61975070`）|

四个"完全没变"的页面全部产生了新的 blob 哈希。

### 🔴 整改中发现的关键事实：用户看到的"首页"其实是 `/workspace`
`next.config.ts:184-190`：已登录访问 `/dashboard` 会被 **307 重定向到 `/workspace`**（2026-11-14 的产品决策，主线是 Living Workspace + Console，dashboard 是 legacy）。这意味着：
- 单改 `dashboard/page.tsx` 用户根本看不到——这本身就是"改了但前台没变"的根因之一。
- 因此本轮**额外在 `/workspace` 默认 Now 屏**落实用户要的四入口（Chats / People / Spaces / My AI 诚实态），带真实未读数，才是用户真正看到的"个人首页"。
- `dashboard/page.tsx` 的重写仍保留（legacy 直链、`?` 场景与未来取消重定向时可用），但主战场是 Workspace。

## 1. 逐页改动（用户价值口径）

### P0 个人 Dashboard（`src/app/(dashboard)/dashboard/page.tsx`）
- **删掉**：约会式 Today's Picks 滑动卡、`matchScore` 百分比、`Flame` 热门标、`auto-match` 后台任务、静态 `AnalyticsReport` 看板。
- **改成**：以用户真实要做的四件事为核心入口——
  - **Chats**：显示真实会话数与未读数（`/api/im/conversations`、`/api/chats/unread-count`）；
  - **People**：指向真实连接/邀请页 `/dashboard/connections`；
  - **Spaces**：显示真实组织数（`/api/v1/organizations`），指向 `/console`；
  - **My AI**：诚实态——"真实模型写作辅助尚在私人测试，目前不可用"，明确 `不可用 · 不是 stub`，**不渲染成可点按钮**（无空按钮）。
- 最近对话列表来自真实会话接口，每条可点进真实聊天室 `/dashboard/chats/[roomId]`。
- 保留 loading / empty / error 三态；资料未完成时给真实引导。

### P0 企业 Console（`src/app/console/page.tsx`）
- **新增**五个人类可读的价值入口：待我确认 / 成员沟通 / 协作空间 / AI 辅助协作 / 真实结果，全部指向已实现的真实子屏。
- **待我确认**从纯展示改为**可操作**：每条死信/失败任务提供"接管处理"（`POST /api/v1/workflow/jobs/<id>/takeover`）、"重新排队"（`/requeue`）、"查看任务记录"（真实 `/console/missions/<id>`）；无权限时服务端拒绝并如实提示，不渲染空按钮。
- 保留四个数据面（在飞/需处置/停滞/投递）与 **AC-09 诚实口径**：`captured`（沙箱捕获）不并入 `sent`（真实送达）。
- 保留 h1「社群总览」（`verify-ac18-console-e2e.mjs` 门禁依赖）。

### P0 Connections（`src/app/(dashboard)/dashboard/connections/page.tsx`）
- **主区改为三种真实入口**：邀请你认识的人（打开真实 `InvitePanel` → 服务端 `/api/invites` 生成邀请链接）/ 发现新的人（`/dashboard/explore`）/ 继续对话（`/dashboard/chats`）。
- 旧 Likes/Matches/Pending 匹配反应**保留为可折叠次要区**（不删功能、不虚构数据），保留 E2E 锚点 `h1:Connections` 与 `No likes yet/No matches yet/All caught up!`，**未改任何断言**。
- 邀请 CTA 现在真正触发邀请流程——修复了"按钮指向 Likes/Matches 页"的空按钮缺陷。

### P0 Chats 空状态（`src/app/(dashboard)/dashboard/chats/page.tsx`）
- 用户点名的具体错误：`Invite someone you know` 曾指向 `/dashboard/connections`（约会匹配页，没有邀请动作）。
- **改为**打开真实 `InvitePanel`（`/api/invites`），按钮有真实业务结果。
- 保留 `No conversations yet` 与 `a[href="/dashboard/explore"]` 锚点（`legacy-mobile.spec.ts` 依赖）。

### P0 Workspace（`src/app/workspace/living-workspace.tsx`）—— 用户真正看到的个人首页
- 默认 Now 屏在输入区之前新增**四个核心入口**（用户点名要求的 Chats / People / Spaces / My AI）：
  - **Chats**：显示真实未读数（`/api/chats/unread-count`），指向 `/dashboard/chats`；
  - **People**：指向 `/dashboard/connections`（真实邀请/连接）；
  - **Spaces**：指向 `/console`（社群与协作）；
  - **My AI**：诚实态"私人测试 · 暂不可用"，`aria-label="My AI 私人测试"`，**不可点击、不是 stub**。
- 全部指向已实现页面，无空按钮、无静态图表；保留原有 Goal/理解/阶段等真实接线与全部 E2E 锚点。

### P1 Solutions（`src/app/(public)/solutions/page.tsx`）
- 三个 job story 各自补上真实入口 CTA（workspace / console / 授权审批），不再是纯描述。

## 2. 三类交付证据

### 2.1 视觉差异（同视口新旧截图）
- 抓图脚本：`scripts/qa/ui-remediation-capture.mjs`（真实登录、PC 1440×900 + 移动 390×844）。
- 修改前：`docs/v25.6/ga-closure/ui-remediation/before/`（16 张 + capture.json）
- 修改后：`docs/v25.6/ga-closure/ui-remediation/after/`（16 张 + capture.json）
- 对比结论（PC 首屏 DOM）：

| 页面 | H1 | Body | 新增真实 CTA |
|---|---|---|---|
| dashboard | 保留锚点 | **DIFF** | Chats/People/Spaces 3 个 |
| console | 保留锚点 | **DIFF** | 成员/空间/AI/结果 4 个 |
| connections | 保留锚点 | **DIFF** | 继续对话/发现 2 个 |
| workspace | 保留锚点 | **DIFF** | 聊天/认识的人/社群 3 个 |
| chats | 保留锚点 | **DIFF** | Discover people（邀请按钮改为真实动作）|
| solutions | 保留锚点 | **DIFF** | 3 个真实入口 |
| landing / product | 未改 | same | —（本次不在范围）|

> H1 保持不变是为了不破坏合法 E2E 锚点；可见差异由 body 结构、入口卡与 CTA 落点承担，不是"只改标题"。

### 2.2 功能差异（真实 API 回执）
- 脚本：`scripts/qa/ui-remediation-api-proof.mjs`
- 结果：`docs/v25.6/ga-closure/ui-remediation/api-proofs.json` — **10/10 PASS**
  - 登录 200；会话列表 200（1 段真实会话）；未读 200（20 条真实未读）；组织 200；邀请码 200；匹配 200；workflow overview 200；missions 200；通知 200；
  - **权限负例**：匿名读会话 401（拒绝），证明权限边界真实。
- 录屏：`videos/ui-remediation-pc.webm`（1.3M）+ `videos/ui-remediation-mobile.webm`（642K），14 步中 13 步 OK。
  - 唯一失败：移动端"Chats 邀请按钮"点击超时——这是**已知的移动端布局行为**（聊天布局在窄屏只显示会话列表面板，未选中房间时空态被隐藏，`legacy-mobile.spec.ts:71-74` 有同样记录），不是产品缺陷；PC 端同一步 PASS，证明按钮本身有真实业务结果。
  - `videos/report.json` 逐步骤记录 OK/FAIL 与原因。

### 2.3 发布差异（哈希 / CI / Preview / SHA）
- 源码哈希对照见第 0 节表（全部相对 main 变化）。
- 分支：`ui-remediation/20261121`，提交后记录唯一 SHA。
- CI / Preview：推送后由 `rc/**` 触发器产生 Run ID 与 Preview URL，见最终状态页。

## 3. 未通过 / 阻断（诚实结论）
- **PREVIEW_VERIFIED / PRODUCTION_VERIFIED：未达成**。本地真实浏览器 PASS ≠ 生产可用。
- 生产站点仍是旧版 main `cad717e`，本轮 UI 整改**尚未部署**（需 Owner 精确 SHA 批准）。
- 真模型 AI 仍未接通：My AI 保持诚实不可用态，不用 Stub 冒充。
- 产品候选 CI 五项失败的分流：见单独 CI 修复记录（依赖棘轮经证实为 CVE 库时间漂移，非补丁引入；租户/迁移/lint/E2E 逐项定位）。
- 10 人盲测、150 样本人工评测仍 NOT_TESTED。

## 4. 验收口径
- 本页所有截图为本地隔离库真实浏览器渲染，非生产、非 Figma 源。
- API 回执为本地服务真实响应，非生产数据。
- 不将 `CODE_COMPLETE / LOCAL_TESTED / REAL_BROWSER_TESTED` 自动升级为 `PRODUCTION_VERIFIED`。
