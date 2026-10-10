# T02 · tests — 测试证据

> 所有命令均可复现。数据库相关的项分别标注了目标库（生产 / 本地夹具 / 本地演练）。

---

## 1. 运行命令与结果

| # | 命令 | 目标 | 结果 |
|---|---|---|---|
| 1 | `npx jest tests/connection --silent` | 单元/集成 | ✅ **130 passed / 130**（6 suites） |
| 2 | `npx jest --silent`（全量） | 回归 | ✅ **502 passed / 502**（27 suites），exit 0 |
| 3 | `npx tsc --noEmit` | 全量类型 | ✅ **0 error**（exit 0） |
| 4 | `npm run check:script-decls` | 脚本静态检查 | ✅ **41 脚本 / 0 未声明引用** |
| 5 | `npm run connection:verify` | **生产库**对账 | ✅ **25/25 通过** |
| 6 | `node scripts/connection/migrate.mjs verify --url=file:/tmp/t02-e2e.db` | **本地夹具库**对账 | ✅ 25/25 通过（修复前为 ❌ 23/25，见 §4） |
| 7 | `npx playwright test -c playwright.t02.config.ts tests/e2e/mission-link.spec.ts` | **AC-11 移动端 E2E** | ✅ **8 passed / 8**（真实 Chrome + Pixel 5） |

### 门禁（改动波及面全绿）

| 门禁 | 结果 |
|---|---|
| `npm run verify:geo` | ✅ **69 项**（原 67 + 分享页 no-store 2 项） |
| `npm run verify:pusher` | ✅ 48 通过 / 0 失败 |
| `npm run verify:oauth` | ✅ 21 通过 / 0 失败 |
| `npm run verify:gender` | ✅ 37 通过 / 0 失败 |
| `npm run verify:ice` | ✅ 42 通过 / 0 失败 |

---

## 2. 单元/集成用例清单（130 条）

| 套件 | 条数 | 覆盖点 |
|---|---:|---|
| `json-codec.test.ts` | 19 | 编解码往返；`null`/空串/非 JSON 文本不抛异常；**`{` 开头返回 `[]`**（不产生假元素）；数组元素非字符串时过滤；`normalizeObject` 对数组/标量的兜底 |
| `public-view.test.ts` | 14 | **白名单投影**：`EXCLUDED_PUBLIC_FIELDS` 逐一断言不出现在视图；`candidates` 恒为 `never[]` 且 `candidatesAvailable=false`；`evaluateJoinability` 对 PAUSED/CLOSED/过期/满员/非成员**各有明确原因**；`buildSeats` 计数 |
| `mission-input.test.ts` | 22 | 必填/长度/枚举校验；**动作白名单**（未知动作被拒，无"其他"分支）；`LIMITS` 边界（恰好等于上限通过、+1 拒绝）；PATCH 空对象与未知字段处理 |
| `idempotency.test.ts` | 14 | 缺 `Idempotency-Key` → 400 且带 `details.field`；同键同体 → **回放**且不重复写；同键异体 → **409**；**并发胜者 `requestHash` 不同时孤儿资源必须被回收**；失败路径先 `compensate` 再抛错 |
| `missions.test.ts` | 35 | 状态机 `TRANSITIONS` 全矩阵（含非法跃迁拒绝）；**跨租户查询与写入拒绝**；全部查询谓词含 `organizationId`（防回归锁）；名额竞态（写入后超额 → WITHDRAWN + 409）；审计事件落库且元数据经 JSON 序列化；`getSharePageData` 各分支 |
| `mission-api.test.ts` | 26 | HTTP 层：匿名 401、越权 403、不存在 404、幂等冲突 409、校验失败 400；**统一错误信封**（`errorResponse` 映射）；`Cache-Control` 头；限流 429 |

---

## 3. 生产库对账（`npm run connection:verify`）

```
✅ 表 Mission 存在 — 17 列            ✅ 表 MissionParticipation 存在 — 8 列
✅ 表 IdempotencyRecord 存在 — 8 列
✅ 9 个索引全部存在且唯一性一致（含 Mission_shareToken_key 唯一、IdempotencyRecord 三元唯一）
✅ 6 个外键全部存在（Mission→Organization/User；MissionParticipation→三表；IdempotencyRecord→Organization）
✅ Mission 关键列均为 NOT NULL       ✅ Mission.constraints 可为空
✅ Mission 无孤儿 organizationId — 孤儿 0      ✅ MissionParticipation 无孤儿 missionId — 孤儿 0
✅ 三表行数可读 — 0 / 0 / 0
━━ 结果：✅ 全部通过（25/25）
```

---

## 4. 负向验证（证明测试与校验器**并非空转**）

| # | 手段 | 预期 | 实测 |
|---|---|---|---|
| 1 | **孤儿断言注入测试**（见下） | 应精确报出 1 行孤儿 | ✅ 由 25/25 降为 **24/25**，断言 `❌ Mission 无孤儿 organizationId — 孤儿 1` |
| 2 | 清理孤儿后重跑 `verify` | 应恢复全绿 | ✅ **25/25** |
| 3 | 在**非空库**上跑修复前的 `verify` | 应暴露缺陷 | ✅ 报「孤儿 2 / 孤儿 1」= 正是总行数 → 证明 `where` 参数确实被吞掉 |
| 4 | `check-script-decls` 覆盖新脚本 | 应包含 `scripts/connection/migrate.mjs` | ✅ 41 个脚本 / 0 未声明 |
| 5 | E2E 首跑前未预热 | 应真实失败 | ✅ 首跑 7/8、次跑 7/8（失败点分别为「客户端 10s 超时 abort」「join 冷编译 13.8s 撑爆断言窗口」）→ 修复后 8/8 |

### 孤儿断言的负向自证（可复现）

> 起因：`countRows(client, table)` 漏了第三个 `where` 形参（见 `changes.md` §5.3），
> 使「孤儿」断言实际在数**全表行数**。修复后必须证明它**真的在看引用完整性**。

```bash
# 1) 本库 FK 是强制的（直接插孤儿会 SQLITE_CONSTRAINT_FOREIGNKEY），
#    因此在同一连接内临时关闭 FK 强制来构造一行孤儿数据
node tmp-orphan-probe.mjs inject     # INSERT Mission(organizationId='org_does_not_exist')

# 2) verify 必须精确报出这 1 行
node scripts/connection/migrate.mjs verify --url=file:/tmp/t02-e2e.db
#   → ❌ Mission 无孤儿 organizationId — 孤儿 1     （24/25，exit 1）

# 3) 清理后必须恢复
node tmp-orphan-probe.mjs cleanup
node scripts/connection/migrate.mjs verify --url=file:/tmp/t02-e2e.db
#   → ✅ 全部通过（25/25）
```

> 临时脚本用完即删（不在提交中）。未做这一步时，"孤儿 0" 与"表不存在"是**不可区分**的。

---

## 5. AC-11 移动端 E2E 明细（8 例）

| # | 用例 | 断言要点 |
|---|---|---|
| 1 | 匿名可预览 | 200；标题/目标/Offer/成功标准可见；**有**「登录后加入」、**无**加入按钮 |
| 2 | 不泄露内部标识 | 整页 HTML 不含 `organizationId` / `ownerId` / `shareToken` / 夹具 id |
| 3 | 无候选不伪造 | 渲染 `mission-candidates-empty` 空态且文案含「不会」；候选区无「匹配度」字样 |
| 4 | 移动端布局 | `scrollWidth ≤ clientWidth + 1`（无横向滚动）；CTA 按钮完全落在 Pixel 5 视口内 |
| 5 | 令牌不存在 | 404（不区分"格式非法"与"查不到"） |
| 6 | 暂停中的任务 | 状态含「已暂停」；有确定原因；**无**「登录后加入」也**无**加入按钮 |
| 7 | 未登录点击 CTA | 跳 `/login` 且 URL 含 `callbackUrl=` 与 `/m/<token>` |
| 8 | **真实登录 → 真实加入** | 拿到 `session-token` cookie（真实身份验证）→ 点击加入 → 出现「你已加入」→ **刷新后仍为已加入**（幂等）→ 名额真实为 **1/5** |

> 第 8 例是 AC-11「敏感动作需身份验证」的**唯一硬证据**：
> 它既证明"未登录不能加入"（第 1/6 例的 `toHaveCount(0)`），
> 也证明"登录后能加入且落库幂等"（刷新后状态不回退、计数为真实值）。

---

## 6. 明确未覆盖（诚实标注）

| 项 | 原因 |
|---|---|
| 分享页在 **Safari / iOS 真机**上的表现 | 本机 Playwright 自带 chromium 在 macOS 13 不受支持，E2E 用系统真实 Chrome 模拟 Pixel 5 视口；真机手势需人工验收（沿用 T01 的标注口径） |
| **分布式**限流行为 | Redis 未配置，`rateLimit` 退化为进程内计数 → 见 `risks.md` R2 |
| **数据库级**隔离（RLS）负测 | libSQL 无 RLS，需 M6 上 PostgreSQL |
| 跨租户**并发**压测 | 本轮只有夹具库，无真实多租户流量 |
| 分享页富预览 / 通知 | 不在 T02 任务卡范围 |

---

_产出：2026-10-10 · 代码提交 `49ee97d`_
