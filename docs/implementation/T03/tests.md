# T03 · tests — 测试证据

> 所有命令均可复现。数据库相关项标注了目标库（生产 / 本地夹具 / 本地演练副本）。
> 环境：macOS 13 · Node 22 · 真实 Chrome（`channel: 'chrome'`）+ Pixel 5 视口。

---

## 1. 运行命令与结果

| # | 命令 | 目标 | 结果 |
|---|---|---|---|
| 1 | `npx jest tests/connection --silent` | 单元/集成 | ✅ **241 passed / 241**（12 suites） |
| 2 | `npx jest --silent`（全量） | 回归 | ✅ **620 passed / 620**（34 suites），exit 0 |
| 3 | `npx tsc --noEmit` | 全量类型 | ✅ **0 error**（exit 0） |
| 4 | `npm run check:script-decls` | 脚本静态检查 | ✅ **41 脚本 / 0 未声明引用** |
| 5 | `node scripts/connection/migrate.mjs verify` | **生产库**对账 | ✅ **42/42 通过**（全库 49 表） |
| 6 | `npx playwright test -c playwright.t02.config.ts tests/e2e/intent-disclosure.spec.ts` | **AC-12 + AC-03 移动端 E2E** | ✅ **2 passed / 2**（真实 Chrome） |
| 7 | 回滚演练（副本库，见 `rollback.md` §3） | 回滚 | ✅ 42/42 → 回滚 C1 → 25/35(exit 1) → **业务数据零丢失** → 重新 apply → 42/42 |

### 门禁（改动波及面全绿）

| 门禁 | 结果 |
|---|---|
| `npm run verify:geo` | ✅ **69 项**（新增 6 条 `/api/v1/intents*` 路由已符合地域/缓存策略，无需改配置） |
| `npm run verify:bot` | ✅ **111 项** |
| `npm run verify:pusher` | ✅ 48 通过 / 0 失败 |
| `npm run verify:oauth` | ✅ 21 通过 / 0 失败 |
| `npm run verify:gender` | ✅ 37 通过 / 0 失败 |
| `npm run verify:ice` | ✅ 42 通过 / 0 失败 |

> ⚠️ `tsc` 必须**在 dev server 停止后**运行：`next dev` 会持续写入 `.next/dev/types/validator.ts`，
> 运行期间读它可能读到半写入状态，报出与该文件有关的假错误（本次实测踩到过 2 条）。

---

## 2. 单元/集成用例清单（241 条 · 12 suites）

| 套件 | 条数 | 覆盖点 |
|---|---:|---|
| `field-catalog.test.ts` | 13 | 目录自检（键集合与定义一一对应）；**受众包含式方向**（`SELF < ORGANIZER < COUNTERPARTY`）；`audienceCanSee(viewer='SELF')` 恒 false；受保护字段结构标记；敏感字段默认 `SELF` |
| `disclosure.test.ts` | 19 | **AC-03 主证据**：未授权字段的键**不存在**（而非 `undefined`）、值级泄露断言、空披露表下任何外部受众都拿不到字段、`SELF` 与"未出现"等价、包含式语义矩阵、编解码容错（脏数据静默丢弃）、`withheld` 分组 |
| `intent-import.test.ts` | 11 | 导入三件套校验；受保护字段 `not_importable`；未知字段 `unknown_field`；导入字段上限 |
| `intent-input.test.ts` | 20 | need/offer 长度边界；**受保护字段出现在 disclosure → 400**；`importConsent` 必需；不可变字段（missionId/userId/status/importFields）出现即 400；PATCH 空对象拒绝 |
| `intents.test.ts` | 29 | 三重谓词防回归锁（逐函数断言）；`createIntent` 四道关卡（租户/状态/已加入/一人一意图 409）；状态派生（`WITHDRAWN` 优先于 `EXPIRED`）；撤销幂等；`reactivate` 对已过期 → 409；**组织者视角白名单投影**；`liveDisclosureOf` 在撤销/过期后归零 |
| `intent-api.test.ts` | 19 | HTTP 层：401/403/400/404/409/幂等冲突；统一错误信封；**组织者视图端到端字符串扫描**（`email` / `age` / `bio` 的**值**不出现） |
| `idempotency.test.ts` | 14 | T02 已有 13 条 + 本任务新增 **`Date` 指纹**用例：`expiresAt` 不同 → 指纹不同（防"改了有效期却被判为重放"） |
| `sw-cache-policy.test.ts` | 7 | **Service Worker 源码断言**：API 分支不得 `respondWith`、任何策略不得用 `API_CACHE`、`activate` 必须仍清理 `api-` 前缀（详见 `risks.md` R12） |

**拆分口径**（`tests/connection` 共 **241 条**，exit 0）：

| 来源 | 条数 | 套件 |
|---|---:|---|
| T02 既有 | **130** | `json-codec` 19 / `public-view` 14 / `mission-input` 22 / `missions` 35 / `mission-api` 26 / `idempotency` 14 |
| **T03 新增** | **111** | `field-catalog` 13 / `disclosure` 19 / `intent-import` 11 / `intent-input` 20 / `intents` 29 / `intent-api` 19 |

> `idempotency.test.ts` 的 14 条里，**13 条属 T02**，**1 条为 T03 新增**（`Date` 指纹），故上表按归属拆开计入。
> 另有 `sw-cache-policy.test.ts` **7 条**（保护的是既存 `sw.js` 的策略修复，不属 T03 领域逻辑）。

### 测试编写的两条纪律（本任务踩出来的）

1. **纯函数测试不经 barrel 导入**。`@/lib/connection`（`index.ts`）会传递依赖到 `next-auth`（ESM），
   jest 下报 `Cannot use import to load ES Module`。6 个新测试文件一律直接 import 具体模块。
2. **负向用例必须自证"变异确实发生"**。例如"未授权字段不出现"这类断言，
   若投影因为**档案里本来就没值**而返回空，测试会假绿。因此夹具显式提供全部字段的值。

---

## 3. 移动端 E2E（AC-12 + AC-03 的浏览器证据）

```
node scripts/qa/seed-t02-e2e.mjs --reset
DATABASE_URL=file:/tmp/t02-e2e.db npx next dev --turbopack -p 3101
E2E_BASE_URL=http://localhost:3101 \
E2E_MISSION_TOKEN=e2eActiveTokenAbcdefghijklmnop \
E2E_MEMBER_EMAIL=e2e.member@example.test \
E2E_PASSWORD='E2E-Test-Passw0rd!' \
npx playwright test -c playwright.t02.config.ts tests/e2e/intent-disclosure.spec.ts
```

**结果：2 passed / 2**（真实 Chrome + Pixel 5，2026-10-10）。

| # | 用例 | 断言要点 |
|---|---|---|
| 1 | 🔒 匿名访问意图页 | 307 到登录且带回跳（`/m/<token>/intent` 出现在 URL 里）；**表单不在 DOM 中** |
| 2 | 加入 → 提交 → 预览 → 编辑 → 撤销 | 见下 |

用例 2 的完整链路（每一步都是真实写操作 + 真实读回）：

| 步骤 | 断言 | 对应的验收 |
|---|---|---|
| ① 真实登录页登录 | 拿到 `session-token` cookie | 敏感动作需身份验证 |
| ② 加入任务 | `mission-joined` 可见（父锚点 `MissionParticipation` 建立） | 意图提交的前置条件 |
| ③ 进入意图页 | `intent-page` + `intent-form` 可见；**不出现"需要先加入"提示** | — |
| ④ 填写 need/offer/约束；"采用建议"；**主动把敏感字段「年龄」扩大为组织者可见** | `intent-aud-age-ORGANIZER` 为 checked；**受保护字段「邮箱」没有可选项、只有说明** | **AC-12** 字段校验 + 主动授权 |
| ⑤ 提交 | 提示"已提交"；状态 `ACTIVE` | **AC-12** |
| ⑥ 披露预览 | 组织者视角**含**「昵称：林晓」与「年龄」（扩大的确生效） | **AC-03** 正面证据 |
| ⑦ 整页 HTML 扫描 | **不含成员邮箱的值** | **AC-03** 未授权字段不进入输出 |
| ⑧ 编辑：改正文 + **把「年龄」收紧回「仅自己」** | 提示"已更新"；预览**立刻不再含「年龄」** | **AC-12** 可编辑 + **AC-03** 授权可撤回 |
| ⑨ 刷新页面 | 输入框仍是改后的正文（**真实落库**，不是前端状态） | **AC-12** |
| ⑩ 撤销 | 状态 `WITHDRAWN`；组织者预览变「（无）」；撤销按钮消失 | 撤销后不再披露 |
| ⑪ 移动端布局 | 横向溢出 ≤ 1px | 移动端可用 |

**这一步 ⑧ 是本任务最有价值的一条断言** —— 它抓出了一个真实缺陷（Service Worker 缓存 `/api/`，
导致"收紧后预览仍是旧范围"），详见 `risks.md` R12。

### E2E 稳定性处理（全部有理由，不是"加 sleep 糊过去"）

| 处理 | 原因 |
|---|---|
| `test.setTimeout(240_000)` | 这条用例串了 5 个真实写操作，dev 下每次写都要现场编译路由；120s 是 T02 单写操作的口径 |
| 不用 `waitForLoadState('networkidle')` | dev 模式 HMR 长连接与客户端预取让"500ms 无网络"可能永不达成 → 改为对**目标元素** `toPass` 重试 |
| 点 `label` 而非 `input` | 披露选项的 radio 带 `sr-only`（视觉隐藏），点 input 会被外层 label 拦成 `intercepts pointer events`；真实用户在移动端点到的也正是胶囊 label。并用 `toBeChecked` 断言点击**真的生效** |
| `beforeAll` 预热 6 个端点 | Turbopack dev 首次编译动态度点（实测 7–14s）会吃掉断言窗口，表现为"服务端 200、客户端超时"的假失败 |
| 登录带 3 次重试 | 登录页偶发 `AbortError`（`login-inner-client.tsx`）会中断一次提交 |

---

## 4. 生产库对账

```bash
node scripts/connection/migrate.mjs verify        # 读 .env.local 的 DATABASE_URL
```

结果：**42/42 通过**。`SocialIntent` 的断言包括：

- 关键列均为 `NOT NULL`（`id`/`organizationId`/`missionId`/`userId`/`need`/`offer`/`status`/`createdAt`/`updatedAt`）
- 默认值符合 schema（`status` 默认 `ACTIVE`）与 schema 定义一致
- **三路孤儿检查**：`organizationId` → `Organization`、`missionId` → `Mission`、`userId` → `User`，均为 0
- 唯一约束 `SocialIntent_missionId_userId_key` 存在（一人一意图）
- 三个索引存在（`missionId`+`status`、`userId`+`status`、`expiresAt`）

当前生产 `SocialIntent` **0 行**（尚未有真实意图提交，功能刚上线）。

---

## 5. 回滚演练

完整记录见 `rollback.md` §3。摘要：副本库 42/42 → `rollback --batch=C1` → `verify` **25/35 exit 1**（按预期失败）
→ 业务表逐表核对**零丢失**（`Organization` 1 / `User` 2 / `Membership` 2 / `Mission` 2 / `MissionParticipation` 1）
→ `apply --batch=C1` → **42/42** 复原。

---

## 6. 本任务实测抓出的三个真实缺陷（都不是"改一行就好了"的那种）

| # | 缺陷 | 如何被发现 | 归因 |
|---|---|---|---|
| 1 | `stableStringify` 把 `Date` 序列化成 `{}` → 不同 `expiresAt` 指纹相同 → 幂等误判重放 | 写 `expiresAt` 相关用例时 | T02 遗留，被 T03 的日期字段首次暴露 |
| 2 | Service Worker 对 `/api/` 用 stale-while-revalidate → **写完读到旧值** + 个人数据被持久化缓存 | 移动端 E2E 步骤 ⑧ | 既存 `sw.js` 策略，被 T03"改完要立刻看到"的需求首次暴露 |
| 3 | `--reset` 删库文件与 dev server 句柄冲突 → `SQLITE_READONLY`（读全对、写全挂） | E2E 提交步骤 500 | 测试工具链 |

**共同点**：三个都不会被类型检查或纯单测发现，都只在"真实浏览器 + 真实时序"下暴露。

---

## 7. 已知盲区（明确没测的）

1. **真实网络与多实例**：全部 E2E 在本机 dev server 上跑，没有跨实例时钟偏移、没有真实 CDN。
2. **向量索引 / Agent 上下文**：AC-03 的这两条下游在 T03 无落点（见 `risks.md` R1），因此**没有测试**。
3. **移动端真实设备**：Pixel 5 是视口模拟，非真机；触摸手势（下拉、长按）未覆盖。
4. **并发**：`Idempotency-Key` 的并发路径由单测覆盖（含"并发胜者指纹不同时回收孤儿"），
   但没有真实的双进程并发测试。
