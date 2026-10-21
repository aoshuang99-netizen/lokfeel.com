# 01 · 路由清单（Route Inventory）

> 采集时间 2026-10-21，基线 `194acc4`。所有数字来自 `find` / 源码扫描，不是估算。

## 一、规模

| 项 | 数量 |
|---|---|
| `page.tsx` | **78** |
| `layout.tsx` | **11** |
| API `route.ts` | **200**（其中 `/api/v1` **50**） |
| Prisma 模型 | **62** |
| Prisma 枚举 | **61** |
| 测试文件 | **106** |

## 二、路由组

| 组 | 路径前缀 | 定位 | 骨架 |
|---|---|---|---|
| `(public)` | `/`、`/about`、`/faq`、`/pricing` … | 对外叙事（Connection OS） | `PublicLayout`（navbar + footer） |
| `(auth)` | `/login`、`/register`、`/forgot-password` … | 登录注册 | 极简 |
| `(dashboard)` | `/dashboard/*` | **legacy B2C 个人态**（15 页） | `DashboardLayout` |
| `workspace` | `/workspace` | **主产品**：Living Workspace 六屏 | `LivingShell`（dual world） |
| `console` | `/console/*` | **主产品**：组织态七屏 | `ConsoleShell` |
| `(admin)` | `/admin/*` | 平台运营 | `AdminLayout` |
| 其它 | `/blocked`、`/m/[token]`、`/debug/*`、`/admin-test` | geo 拦截页、Mission 分享页、诊断 | 无/独立 |

## 三、主产品路由（必须逐屏验收）

### `/workspace` 六屏（同 URL 内 state 切换）

| 屏 | key | 内容来源 |
|---|---|---|
| Now | `now` | `/api/notifications`、`/api/chats/unread-count`、阶段条 |
| Studio | `studio` | 前端编译 + `POST /api/v1/missions` |
| Field | `field` | `/api/v1/missions`、`/api/v1/connections/pipeline` |
| Consent | `consent` | `/api/v1/intents`、`/api/v1/connections/proposals`、`/api/v1/bridges` |
| Outcomes | `outcomes` | `/api/v1/outcomes`、`/api/v1/outcomes/metrics` |
| Agents | `agents` | `/api/v1/agents/runs`、`/api/v1/agents/usage` |
| Missions | `missions` | **未就绪**（显式禁用 + 原因，不是死按钮） |

### `/console` 七屏（独立路由）

`/console`、`/console/missions`、`/console/missions/[missionId]`、`/console/connections`、
`/console/agents`、`/console/members`、`/console/outcomes`、`/console/settings`。

## 四、公开路由（叙事门禁覆盖范围）

`/`、`/about`、`/faq`、`/careers`、`/press`、`/contact`、`/support`、`/safety-tips`、
`/community-guidelines`、`/privacy`、`/terms`、`/cookies`、`/refunds`、`/cancellations-policy`、
`/dmca`、`/content-removal-appeals-policy`、`/18-usc-2257`（已停用 + noindex）、
`/fan-creator-agreement`（已停用 + noindex）、`/pricing`、`/how-it-works`、`/blog`。

> 后两者若为外链/占位，以 `verify:brand-scan` 的实际扫描清单为准（脚本会打印每个被扫描文件）。

## 五、legacy 路由（保留、不导流）

`/dashboard` 及其 14 个子路由，详见 `07_LEGACY_ROUTE_DECISION.md`。

## 六、机器面

| 面 | 路由 |
|---|---|
| MCP（Streamable HTTP） | `/api/mcp` |
| A2A | `/api/v1/a2a/tasks` |
| Agent Card | `/.well-known/agent-card.json` |
| OpenAPI | `contracts/connection.openapi.yaml` |
| 健康 | `/api/health`（含 `payments` 块） |

## 七、复跑

```bash
find src/app -name 'page.tsx' | wc -l
find src/app -name 'layout.tsx' | wc -l
find src/app/api -name 'route.ts' | wc -l
find src/app/api/v1 -name 'route.ts' | wc -l
grep -rh '^model ' prisma/schema/*.prisma | wc -l
find tests -name '*.test.ts*' | wc -l
```
