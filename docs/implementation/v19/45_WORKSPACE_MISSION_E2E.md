# 45 — Workspace 真实任务闭环（V19-82 · Batch 3）

日期：2026-10-30 21:26~21:58 (GMT+8)　环境：生产构建 `1JJT3l3dpPPryqxcrPcVo`（`.next-v202`）@ localhost:3000
工具：`scripts/qa/v198-workspace-loop.mjs`（新增；v196 骨架 + UI 层；夹具 `v198_` 前缀可清理）
账号：`v198.owner@example.invalid`（OWNER）· 移动端视口 390×844 · 库 `file:/tmp/v196-e2e.db`（本地）

## 1. 结论

**12 PASS / 0 BLOCKED / 0 FAIL（exit 0）**。Intent → WorkspaceSpec → Mission 全链路在
真实 HTTP + 真实库 + 真实浏览器（非 mock）下打通；本轮**挖出并修复一个真实 P1 死路缺陷**（§3）。

## 2. 断言清单（全部真实取证）

### API 层（真实 HTTP，先证 Schema 与持久化）

| # | 断言 | 实测 |
|---|---|---|
| W-00 | OWNER 创建 Mission（Idempotency-Key + publish:true）→ 201 | 201, `id=cmvv1e0ya00002ek8zes2j9oj` |
| W-01 | `need` < 4 字符 → 400（Schema 拒绝） | 400 |
| W-02 | 受保护字段 `disclosure.email` → 400（AC-03 用户主动授权边界） | 400 |
| W-03 | 缺 `Idempotency-Key` → 400（写契约） | 400 |
| W-JOIN | OWNER 也要经 shareToken 加入自己任务（服务层"先加入才能提交"） | 200 |
| W-04 | 三连非法**之后**合法提交 → 201（错误恢复） | 201 |
| W-05 | `GET /api/v1/intents?missionId=` 含 W-04 内容（真实持久化） | items=1 |

🔴 取证纪律：W-01/02/03 的 400 在 W-00 失败时（首轮 mkBody 缺 `offer`/`successCriteria`）属于
**假绿**（body 整体非法当然 400）——先让 W-00 过，400 才是"被 Schema 拒绝"的证据。

### UI 层（Playwright + chromium，390×844，真实服务端）

| # | 断言 | 实测 |
|---|---|---|
| U-00 | 移动端 Intent 输入框可见 | ✓ |
| W-06 | 短文本 → 编译按钮 disabled + title 说明差多少 | `title="至少输入 8 个字符"` |
| W-07 | 合法 goal → 编译 → 自动切 Studio，WorkspaceSpec 渲染 | h1=Mission Studio, 正文 782 字符 |
| W-08 | Studio「创建连接任务」→ 真实成功态（服务端 id 才算成功） | `id=cmvv1e9zi00082ek8902abvm7` |
| W-09 | 刷新 → 任务从服务端恢复（GET /api/v1/missions 含该 id） | missions=2, uiId 命中 |

### 重复提交防护（UI 层设计 + 服务端语义，已在 v196/I-01b 与本轮复证）

- UI：`runCreateMission` 按 `JSON.stringify(body)` 签名复用幂等键（`attempt.sig === sig ? attempt.key : new`）；
- 服务端：同键重放返回同一条 + `Idempotent-Replayed: true`（v196 M-02 已断言）；
- 成功态文案明确区分："服务端判定为重复提交（幂等重放），已返回同一条任务。"

## 3. 本轮修掉的真实 P1：编译器不产 offer ⇒「创建连接任务」死路

**发现过程**：探针 W-08 首跑，创建按钮 disabled，`title="还不能创建：缺少 「可提供的对价」——
描述里没写，创建任务需要它。"`；按 UI 提示补写对价文案重新编译，**按钮依然禁用**。

**根因链**（全部源码实证）：
1. `missionDraftFromSpec`（`assemble.ts:472`）要求 `intent.data.offer` 非空才启用创建按钮 —— 正确（服务端必填，且**不编默认对价**）；
2. 但 `compileWorkspaceSpec`（`compile.ts:279-283`）产出的 intent 节点 data 只有
   `goal / constraints / successCriteria / expiresAt`，**从不产出 offer**；
3. UI 提示却说"把缺的补进描述里再重新编译即可"（`living-workspace.tsx:803`）——
   用户照做永远无效。**提示与编译器能力不一致 = 死路**。

**修复**（最小改动，不违反"不伪造"纪律）：
- `extractDraftFields` 增加**句级** offer 抽取：按 `。；！？\n` 切句，含
  提供/给予/付出/作为对价/换取/承担 等关键词的整句；抽不到 = `undefined`（缺口说明照旧）；
- intent 节点 `data` 按需携带 `offer`（schema 本就是 optional，不写入 undefined）。

**回归守卫**：`tests/workspace-spec/compile.test.ts` 新增 4 条（抽到/没写不编/整句语义/
编译→missionDraft 不再缺对价）。workspace-spec 全套 **75/75 passed**。

**诚实设计保留**：没写对价的用户依然会看到禁用 + 三项缺口说明 —— 修复只是让"写了的用户"
走得通，没有放松"不编默认值"的边界。

## 4. 探针自身的坑（供复跑者）

| 坑 | 说明 |
|---|---|
| `Client.create` | `@libsql/client` 的 CJS 导出是 `createClient`（v196 用 `libsql.createClient`） |
| `Organization` 无 `plan` 列 | 真实列为 `id,name,slug,status,createdAt,updatedAt` —— 写库前 `PRAGMA table_info` |
| Mission 缺省 DRAFT | `publish:true`（或 `discoverable`）⇔ ACTIVE；public join 对草稿 **404**（"存在且非草稿"） |
| 改了客户端代码必须重建 | W-08 首复验失败是因为服务还在跑旧 bundle —— 探针红先核对构建 BUILD_ID |
| Playwright `channel` | 本机 mac13 无下载版 chromium，必须 `PW_CHANNEL=chrome` |

## 5. CI 接线

`ci.yml` e2e job 在 Mission 探针之后新增：
- `Workspace 真实闭环探针（V19.8）`（`--base=http://127.0.0.1:3000 --db=ci-e2e.db`）；
- `always()` 步骤 `v198-workspace-loop.mjs --db=ci-e2e.db --cleanup` 精确删除 `v198_` 夹具。

## 6. 未闭合（诚实标注）

- 本探针**未覆盖** Consent 拒绝/撤销/过期与 Outcome 证据（Batch 4 范围）；
- UI 的幂等键复用逻辑（`attempt.sig === sig`）没有专门 UI 断言（服务端语义已由 v196 覆盖）；
- 刷新后**草稿**（未创建的 compiled spec）不恢复 —— React state，刷新丢失。当前设计下
  "编译在本地完成"的语义一致（未写库即不存在）；若产品要草稿恢复，需明确持久化位置（P2 待拍板）。
