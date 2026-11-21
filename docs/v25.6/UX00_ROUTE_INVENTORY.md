# UX00 — 全站路由取证与 ownership 映射（V25.6）

- 日期：2026-11-20
- 方法：本地源码只读清点 + `git ls-remote` 只读复核（未登录生产页面、无 Preview）
- 证据类型：`LOCAL_SOURCE` + `REMOTE_GIT_READONLY`。生产登录态与 Preview 一律标 `NOT_TESTED`。

## 1. SHA 取证

| 来源 | SHA | 说明 |
|---|---|---|
| 本地 HEAD（工作前） | `1d69b1713294776c63902c37d3afd94ae3e0c73e` | 分支 `v25.2/consent-closure`，V25.5 文档回填提交 |
| 远端 `origin/main` | `cad717e92542395e4346e49d388f09be78ec1557` | `git ls-remote` 只读复核，与 V25.6 作战包记录一致 |
| 生产部署 | 无法独立读取 | 作战包记录为 `b50e53e`（V25.5 报告值，本轮未登录生产页面复核）→ **NOT_TESTED** |
| Preview | 无 | **NOT_TESTED** |

结论：本地候选 ≠ 远端 main ≠ 报告中的生产 SHA。三条线未对齐，任何"上线"宣称均不成立。本轮代码改动全部停留在本地工作区，未提交、未推送、未部署。

## 2. 路由 ownership 表（5 问：为谁 / 为何 / AI 增量 / 真实入口 / 后端证据）

### 2.1 对外官网（`(landing)` + `(public)`，25 个 public 页）

| 路由 | 服务谁 | 当前状态 | V25.6 处置 |
|---|---|---|---|
| `/` | 所有人 | 本轮已重构首屏为"Say it better — with AI. Whether to send is your call."；单一 CTA → 真实消息草稿 | 已改（文案/CTA），5 秒盲测 **NOT_TESTED**（无真人） |
| `/product` `/solutions` `/pricing` `/about` `/privacy` `/terms` `/refunds` 等 | 所有人 | 存在；内容审计见 UX13/G08（未做） | 延后，标 NOT_TESTED |
| `/how-it-works` | 所有人 | 存在，首页次 CTA 指向它 | 需按 UX03 复核 AI 描述真实性 |

### 2.2 旧 `/dashboard/*`（legacy B2C 线，8+ 页）

| 路由 | ownership | 处置 |
|---|---|---|
| `/dashboard/chats`、`/dashboard/chats/[roomId]` | 真实 IM（前端+后端） | 保留为 legacy；V25.6 统一 Chats 体验（UX05）尚未做双端 UI E2E |
| `/dashboard/connections`、`/dashboard/explore`、`/dashboard/matches/[id]` | 关系/发现 | 保留；旧 matches 列表由 redirect 并入 connections |
| `/dashboard/onboarding`、`/dashboard/settings`、`/dashboard/profile` | 账号/Vault | 保留；My AI/Vault 管理界面（UX10）未做 |
| `/dashboard` 根 | — | `next.config.ts` 已对本地/生产双 cookie 名做 307 → `/workspace` |

`next.config.ts` 重定向（已核对）：`/discover`→`/explore`、`/activity`→`/notifications`、`/chat`→`/chats`、`/matches`→`/connections`、`/inbox`/`/messages`→`/chats`、`/square`→`/explore`、`/plans`/`/subscribe`→`/pricing`、`/membership`/`/pass`→`/hlua`。

### 2.3 新 `/workspace`（Living Workspace 六屏）

- 单路由 `/workspace`，`?view=` 白名单六屏：`now`/`studio`/`field`/`consent`/`outcomes`/`agents`；`missions` 为 `ready:false` 未接线。
- ownership：Organization/协作态 Living Workspace。与 `/dashboard`（个人 legacy）和 `/console/*`（组织态）并存。
- 问题（对应 5 Whys Why1/Why2）：**个人、Workspace、Console 三套入口并存**，用户首屏看到系统模块而非"我能和谁沟通、AI 帮我什么"。UX02 的 IA 统一（旧深链→新交互映射）尚未完成。

### 2.4 `/console/*`（组织态，8 页）

`agents`/`connections`/`members`/`missions`/`missions/[id]`/`outcomes`/`settings` + 根。ownership：Business Console。UX11 组织价值闭环未做。

### 2.5 `/api/im/*`（真实 IM 后端）

`send`、`ai-assist`、`consent`、`ai-consent`（本轮新增）、`conversations`、`messages/[id]`、`read`、`typing`、`presence`、`reactions`、`call/signal`、`pusher/auth`。这些是可复用的真实数据链路。

## 3. 5 Whys 反证（本轮证据支撑程度）

| 层级 | 作战包判断 | 本轮可证据化部分 | 仍为假设/未验证 |
|---|---|---|---|
| Why1 看不懂价值 | 技术/管理术语占屏 | 已证实旧首页 HERO 为"Meet people worth knowing"关系引擎叙事，本轮已改写 | 新文案是否 5 秒有效（需真人盲测，**NOT_TESTED**） |
| Why2 用不起来 | 缺统一首路径 | 已证实三套入口（dashboard/workspace/console）并存于源码 | 用户真实路径耗时（需双端 E2E） |
| Why3 后端领先前端 | DB 脚本冒充 UI | 已证实 V25.5 证明脚本走 DB/进程内调用；本轮授权证明同样是进程内（诚实标注） | 生产/真实浏览器双端收发（**NOT_TESTED**） |
| Why4 多轮绿灯 | tsc exit137 | 已实证根因并修复为 exit 0（见 `UX16_TSC_EXIT137_ROOTCAUSE.md`） | AI 效果 150 样本盲评未做 |
| Why5 管理根因 | 缺 Value Contract | 本轮产出 `UX01_VALUE_CONTRACTS.md`（草案） | 独立 Product Owner 签署 **PENDING** |

## 4. Owner 待办（不在本轮授权范围）

1. 登录生产/Preview 取真实截图与重定向链（本轮无法访问）。
2. 决定 `/workspace`、`/dashboard`、`/console` 的最终 IA 归并方案（删除/重定向需审查，不得删数据）。
3. 签署三条 Value Contract（见 UX01）。
