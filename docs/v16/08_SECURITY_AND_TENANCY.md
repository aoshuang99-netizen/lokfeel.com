# 08 · 多租户与安全边界

> 数据来源：`prisma/schema/*.prisma` 与 `src/app/api/v1/**/route.ts` 的**静态全量扫描**（命令见文末）。
> 结论：应用级隔离**覆盖完整**；DB 级隔离**不存在**（libSQL 无 RLS），因此"应用层漏一个 where"就是越权。
> 本轮把覆盖度量出来，并把负向测试的确切条件写清楚（未执行的部分标 BLOCKED，不标 PASS）。

## 一、模型层的租户归属（62 个模型）

| 分类 | 数量 | 例子 | 隔离方式 |
|---|---|---|---|
| 有 `organizationId` | **21** | `Mission`、`ConnectionProposal`、`Outcome`、`AgentRun`、`WorkflowJob`、`IdempotencyRecord`、`Membership`、`TenantAuditEvent`、`BillingEvent`、`UsageRecord` | 查询必须带 `organizationId`（由 `withTenant` 注入） |
| 仅有 `userId`（个人域） | **18** | `Notification`、`Profile`、`Subscription`、`Block`、`UserReport` | 按 `userId = session.user.id` |
| 两者都有 | **4** | （组织内又归属具体成员的行） | 双重条件 |
| 两者都无（全局/系统） | **23** | `User`、`Organization`、`SystemConfig`、`AdminAudit`、`AdminPermission`、`CustomRole`/`AdminRolePermission`、`AnalyticsEventDef`/`AnalyticsDailyAgg`、`BotProfile`/`BotPreference`/`BotAvatar`/`BotInteractionLog`/`BotLearningBatch`、`Match`、`Conversation`、`IMMessage`、`ConsentRequest`/`ConsentGrant`、`SincerityTransaction`、`CommunityBridge` | 见下节分类 |

> ⚠️ 与 Ledger 的「11 张表缺 `organizationId`」不一致：实测为 **23 张既无 `organizationId` 也无 `userId`**。
> 差异原因是统计口径不同（Ledger 只数了"业务表"）。本文按实际字段统计，并把 23 张逐类定性。

### 23 张"无归属字段"表的定性

| 类别 | 表 | 是否**应该**加 `organizationId` | 判断依据 |
|---|---|---|---|
| 全局身份/系统 | `User`、`Organization`、`SystemConfig`、`AdminAudit`、`AdminPermission`、`CustomRole`、`AdminRolePermission` | 否 | 跨组织的身份与平台级配置；`AdminAudit` 是平台运维审计 |
| 分析聚合 | `AnalyticsEventDef`、`AnalyticsDailyAgg` | 否（但需确认聚合维度不含组织敏感信息） | 事件字典与日聚合，属平台指标 |
| B2C legacy（个人域，经关联表间接归属） | `Match`、`Conversation`、`IMMessage`、`ConsentRequest`、`ConsentGrant`、`SincerityTransaction` | 否（legacy 线不属组织态） | 归属由 `Conversation.participants` / `Match.userA,userB` 表达 |
| Bot 模块（默认关闭） | `BotProfile`、`BotPreference`、`BotAvatar`、`BotInteractionLog`、`BotLearningBatch` | 否 | 仅当 `BOT_ENGINE_ENABLED=true` 时运行，且不接组织态数据 |
| 跨组织桥 | `CommunityBridge` | **否，但必须双主体校验** | 设计上就是两个租户之间的协议，单字段 `organizationId` 表达不了；它的隔离靠 `BridgeMemberOptIn`（有 `organizationId`）+ 逐侧 opt-in |

结论：**没有一张表"漏了 `organizationId` 就必然越权"**。真正的风险点在查询侧，即"该带条件的地方没带"。

## 二、路由层的隔离覆盖（`/api/v1` 共 50 条 route.ts）

| 覆盖情况 | 数量 | 说明 |
|---|---|---|
| 走 `withTenant` / `resolveTenantForUser` | **45** | 租户上下文由封装注入，能力用 `can(...)` 判定 |
| 直连 `prisma` 且**未见**租户封装 | **0** | —— |
| 既无租户封装也无直接 prisma（走 service 层） | **5** | 见下表，逐条已核对 |

| 路由 | 作用域 | 为什么可以不走 `withTenant` |
|---|---|---|
| `GET/POST /api/v1/a2a/tasks` | 机器面 | 用 `resolveTenant` + `can(...)` + 限流，按调用凭据解析租户 |
| `GET /api/v1/me/export` | 个人域 | `requireAuth` + `exportAccountData(userId)` |
| `POST /api/v1/me/erasure` | 个人域 | `requireAuth` + `planErasure/executeErasure(userId)` |
| `GET /api/v1/public/missions/[token]` | 公开分享 | 凭不可猜测的 share token，且 `isShareTokenShaped` 先校验形状；返回字段由投影决定 |
| `POST /api/v1/public/missions/[token]/join` | 公开分享 | `requireAuth` + token + `parseJoin` 校验，加入的是 token 指向的那条 Mission |

## 三、能力模型的一个真实陷阱（已在代码注释里固化）

`withTenant` 的能力数组判定用 `some()` —— 混入一个弱能力就会**静默降级**（"看着有权限"）。
因此档位单调性必须写推导 + 真相表，而不是靠"跑一遍看看"。
参考：`src/lib/tenancy/capabilities.ts` 与 `docs/implementation/T07/*`。

## 四、负向测试：做了什么、没做什么

| 场景 | 状态 | 说明 |
|---|---|---|
| 静态：v1 路由是否有未封装的 prisma 访问 | **PASS** | 50 条全扫，0 条 |
| 静态：`withTenant` 是否在写操作前校验能力 | **PASS** | 45 条路由逐条核对 |
| 动态：组织 A 的成员访问组织 B 的 Mission | **BLOCKED** | 需要**第二个有数据的组织**与两个可登录身份。生产库当前只有 `org_default` 与预览组织 `preview`（后者仅用于看板截图，无 Mission 数据）。没有跨租户样本时，"访问被拒"与"数据不存在"返回同一个 404，测不出区别 |
| 动态：非授权用户审批 Consent | **BLOCKED** | 同上：需要一条属于组织 B 的待批提案 |
| 动态：撤销授权后再执行 Agent Action | **BLOCKED** | 需要已批准且可执行的运行；当前 `execution.available` 恒 false（执行通道未开通） |

**BLOCKED 的确切解除条件**（写成可执行步骤，不是"以后再说"）：

1. 建组织 B（`scripts/qa/grant-preview-org.mjs` 已能幂等建组织与成员，复用即可）；
2. 在组织 B 里用其 OWNER 身份创建 1 条 Mission + 1 条提案（走真实 API，不写库）；
3. 用组织 A 的 OPERATOR 身份请求 `/api/v1/missions/{B 的 id}`，断言 **404 而不是 200**；
4. 用 A 的身份 `POST /api/v1/connections/proposals/{B 的提案}/decisions`，断言 403/404；
5. 把断言脚本落在 `scripts/qa/tenant-negative.mjs`，进 CI 常态跑。

> 为什么不在本轮直接做：第 2 步会在**生产库**写入两个组织的假数据，属于"未经验证的数据写入"；
> 且清理脚本必须能枚举全部外键（历史教训：32 张表引用 `User`，脚本只备份了 4 张）。

## 五、其它安全事实

| 项 | 状态 |
|---|---|
| 生产高危依赖 | **0**（`npm audit --omit=dev`，此前 28 → 0，见 BACKLOG §7sexies） |
| CSP | 白名单模式，`unsafe-eval` 禁止；本轮仅放行 CF beacon 域 |
| Secret scan | gitleaks 在 CI 常态跑；测试夹具用运行时拼接避免误报 |
| 租户隔离级别 | **应用级**，非 DB 级（libSQL 无 RLS）。任何"把过滤放前端"的写法都等于没有隔离 |

## 六、核对命令

```bash
# 模型归属统计
node -e '
const fs=require("fs"),path=require("path");
const ms=[];
for(const f of fs.readdirSync("prisma/schema")){if(!f.endsWith(".prisma"))continue;
const s=fs.readFileSync(path.join("prisma/schema",f),"utf8");
for(const m of s.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g))ms.push({n:m[1],b:m[2]});}
const org=ms.filter(m=>/^\s*organizationId\s/m.test(m.b));
console.log("总",ms.length,"有org",org.length);'

# 路由封装覆盖
node -e '
const fs=require("fs"),path=require("path");const fs2=[];
(function w(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);
if(f.isDirectory())w(p);else if(f.name==="route.ts")fs2.push(p)}})("src/app/api/v1");
let t=0,d=0;for(const f of fs2){const s=fs.readFileSync(f,"utf8");
if(/withTenant|resolveTenantForUser|resolveTenant/.test(s))t++;else if(/prisma\./.test(s))d++;}
console.log("总",fs2.length,"封装",t,"裸prisma",d);'
```
