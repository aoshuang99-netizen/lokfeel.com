# 07 · Legacy B2C 线治理决定

> 结论先行：**保留能力、隔离入口、停止对外叙事、暂不删除代码与数据**。
> 依据 V16 任务书 §11 与 §5，本文是可追踪的决定记录（Decision Record），不是待办清单。

## 一、现状（实测）

| 项 | 数量 | 证据 |
|---|---|---|
| `/dashboard/*` 页面 | **15** | `find src/app -path '*dashboard*' -name 'page.tsx' \| wc -l` |
| 公开导航（navbar）指向 legacy 的链接 | **0** | `src/components/layout/navbar.tsx` 的全部 `href` 里无 `/dashboard`、`/matches`、`/chats` |
| 公开页脚指向 legacy 的链接 | **0** | `src/components/layout/footer.tsx` 同上 |
| 公开营销页里指向 `/dashboard` 的链接 | **0** | 扫描 `src/app/(public)/**/*.tsx` |
| 产品内进入 legacy 的入口 | **1**（`/console` 顶部「个人模式」） | `src/app/console/console-shell.tsx`；这是**跨态切换**，不是营销入口 |

15 个页面：`/dashboard`（首页）、`chats`、`chats/[roomId]`、`connections`、`explore`、`matches/[id]`、
`notifications`、`onboarding`、`profile`、`profile/[id]`、`settings`、`subscription`、
`subscription/cancel`、`subscription/success`、`users/[userId]`。

## 二、决定

| 处置 | 对象 | 理由 |
|---|---|---|
| **保留** | 代码、数据库表、用户数据、API（`/api/matches`、`/api/chats/*` 等） | 已存在用户的书签、会话、订阅与 IM 记录不能因一轮改版中断；IM / 匹配 / TURN 是未来 Connection OS 可复用能力 |
| **隔离** | 从公开导航与营销路径移除（**已完成**，实测 0 入口） | 对外只需要一个产品叙事：Connection OS |
| **保留唯一入口** | `/console` 顶部「个人模式」 | 组织态用户需要回到个人态；这是功能性切换，且只在登录后的组织控制台出现 |
| **停止叙事** | 首页、about、faq、careers、press、safety-tips、privacy/terms 等已切到 Connection OS 口径 | 已完成（`51d452a`），门禁 `verify:brand-scan` 19 文件 0 命中 |
| **不做** | 全量 301 跳转、删表、删用户数据 | 未验证流量与合同义务前，任何不可逆动作都不做 |

## 三、本轮额外清理

| 动作 | 位置 | 原因 |
|---|---|---|
| 页脚移除 `18 U.S.C. 2257` 与 `Fan/Creator Agreement` 两个入口 | `src/components/layout/footer.tsx` | 这两页是**成人内容平台**法务模板，与 Connection OS 业务范围无关。路由保留（已停用 + `noindex`，不断链），但不再从全站页脚导流 —— 继续挂着等于对外声明我们经营那类业务 |
| `/workspace` 移除「我的匹配 / `GET /api/matches`」卡片与证据行 | `living-workspace.tsx`（`194acc4`） | 主工作台出现交友语义，会让用户误判产品；数字本身对 SaaS 用户无行动价值 |

## 四、用户影响评估

| 用户类型 | 影响 | 保障 |
|---|---|---|
| 老 B2C 用户（书签 / 直接访问 `/dashboard`） | 页面仍可访问，功能不变 | 未加 redirect、未加拦截 |
| 老 B2C 用户（站内导航） | 公开站点已没有入口，但**已登录**用户仍可通过 `/console` 的「个人模式」进入 | 明确的功能切换按钮 |
| 新用户（只看公开站） | 不会看到交友叙事 | 门禁把守 |
| 订阅用户 | 订阅页、取消页、成功页全部保留 | 未改路由 |

## 五、弃用计划（需要数据才能定，当前 UNKNOWN）

判断标准不是"这些页面有没有用"，而是：
1. 是否还服务真实的 Connection Mission 工作流；
2. 是否还存在不能中断的用户承诺（订阅、IM 历史、已配对的连接）。

因此下一步必须先拿到数据，而**当前无法取得**：

| 需要的数据 | 状态 | 取数方式 |
|---|---|---|
| 15 条 legacy 路由的 30 天访问量 | **UNKNOWN** | Cloudflare Analytics / Netlify Analytics（本轮刚修好 CF beacon 被 CSP 拦截的问题，历史数据本身也不完整） |
| 仍活跃的 B2C 账号数（近 30 天登录） | **UNKNOWN** | `User.lastLoginAt` 聚合；需在只读副本上跑 |
| 仍在续费的 B2C 订阅数 | **可查**：`Subscription` 表按 `status=ACTIVE` 统计 | 需 DB 只读访问 |

在上述三项落地前，**不设日期、不设 301**。这是刻意留白，不是遗漏。

## 六、验收

- [x] 公开站 0 处 legacy 叙事入口（实测）
- [x] legacy 路由全部仍可访问（未删除、未重定向）
- [x] 决定有记录（本文）
- [ ] 三项使用数据（UNKNOWN，需分析权限）
- [ ] 弃用时间表（依赖上一条）
