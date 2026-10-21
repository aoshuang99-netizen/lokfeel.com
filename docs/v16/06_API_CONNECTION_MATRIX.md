# 06 · API 接线矩阵（13 屏 → 真实端点）

> 所有端点均从源码里**实际引用**处提取（`src/components/living/**`、`src/app/console/**`），
> 不是按命名猜的。核对命令见文末。
>
> 三态口径：**L** = Loading、**E** = Empty、**X** = Error、**R** = Ready。
> 「R」不是"有数据"，而是"服务端返回了什么就渲染什么，包括返回空"。

## 一、`/workspace` 六屏

| 屏 | 读端点 | 写端点（全部经服务端鉴权） | 三态 | 说明 |
|---|---|---|---|---|
| Now | `/api/notifications`、`/api/chats/unread-count` | — | L E X R | 第三张卡「待你介绍」改为消费阶段条数据（`connections/proposals`） |
| Now/全部 | `/api/v1/connections/proposals`、`/api/v1/agents/runs`、`/api/v1/outcomes/timeline` | — | L E X R | 由 `buildOsStages` 折叠成阶段条；`null` 显示「—」 |
| Studio | 编译在**前端**完成（纯函数 `compileWorkspaceSpec`） | `POST /api/v1/missions`（带 `Idempotency-Key`） | L E X R | 创建成功只认服务端返回的 `mission.id`；失败原样展示服务端原因 |
| Field | `/api/v1/missions`、`/api/v1/connections/pipeline` | — | L E X R | 2.5D 关系网络；节点点击 → Inspector |
| Consent | `/api/v1/intents`、`/api/v1/connections/proposals`、`/api/v1/bridges` | 提案决策（accept / reject / revoke / introduce）、bridge opt-in / opt-out / approve / revoke | L E X R | 可执行动作由服务端 `availableActions` / `canIntroduce` 下发，前端不判权限 |
| Outcomes | `/api/v1/outcomes`、`/api/v1/outcomes/metrics` | 对手方确认 / 外部核验（`canConfirm` / `canVerify` 由服务端算） | L E X R | 未核验数取服务端 `counts.unverified`，前端不重算 |
| Agents | `/api/v1/agents/runs`、`/api/v1/agents/usage` | approve / reject | L E X R | `execution.available` 恒为 false 时原因原样展示（诚实块） |

## 二、`/console` 七屏（组织态，`withTenant` 把关）

| 屏 | 端点 | 能力门槛 |
|---|---|---|
| 总览 | `/api/v1/workflow/overview`、`/api/v1/missions` | `workflow.read` |
| 任务 | `/api/v1/missions`、`/api/v1/missions/{id}` | `mission.read` |
| 连接 | `/api/v1/connections/pipeline`、`/api/v1/connections/proposals` | `workflow.read` |
| 智能体 | `/api/v1/agents/runs`、`/api/v1/agents/usage` | `agent.run` |
| 成员 | `/api/v1/org/members` | `member.read` |
| 成果 | `/api/v1/outcomes`、`/api/v1/outcomes/metrics` | `outcome.read` |
| 设置 | `/api/v1/org` | `org.read`（写操作按 `org.update` 降级） |

> 导航项的 `capability` 与服务端 `withTenant(...)` 口径一致：无权限的入口渲染为**不可点的 span**
> 并标「无权限」，不是死链、也不是"点了才 403"。

## 三、机器面（与 UI 共用同一套内核）

| 面 | 路径 | 复用 |
|---|---|---|
| MCP | `/api/mcp`（Streamable HTTP，5 工具） | `src/lib/interop/tools.ts` |
| A2A | `/api/v1/a2a/tasks` | 同上 |
| 契约 | `contracts/connection.openapi.yaml` | 与 DTO 同源 |

## 四、数据诚实度检查（本轮复核）

| 检查项 | 结果 | 方式 |
|---|---|---|
| 是否有写死的假数字 | 无（审计脚本逐屏核对数字出现处均标注端点） | `audit:ux13` 抓取页面文本 + 端点注释 |
| 是否存在"前端自己判权限" | 无：`canIntroduce` / `availableActions` / `canConfirm` / `canVerify` / `execution.available` 全部服务端下发 | 源码引用处逐一核对 |
| 读不到时是否显示 0 | 阶段条不会（`count: null` → 「—」）；其余屏沿用 `Loadable`（loading/error/empty 三态） | 单测 + 源码 |
| 写操作是否有幂等 | Mission 创建带 `Idempotency-Key`；重复提交服务端返回同一条 | `create-mission` 分支 |

## 五、核对命令

```bash
# 从组件里提取真实端点
node -e '
const fs=require("fs"),path=require("path");
(function w(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);
if(f.isDirectory())w(p);else if(/\.tsx?$/.test(f.name)){const s=fs.readFileSync(p,"utf8");
const eps=[...new Set([...s.matchAll(/[\x27"`](\/api\/[a-z0-9\/\[\]{}._-]+)[\x27"`]/g)].map(m=>m[1]))];
if(eps.length)console.log(p,eps.join(", "))}}})("src/components/living")'
```
