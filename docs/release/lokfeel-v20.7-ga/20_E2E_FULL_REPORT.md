# 全量 E2E 深度检查报告

| 项 | 值 |
| --- | --- |
| 被测对象 ① | 本地生产构建 `http://127.0.0.1:3211`（`next start`，SHA `abe1623`） |
| 被测对象 ② | 生产 `https://app.lokfeel.com`（SHA `eb53f39`，`/api/health` `status=healthy`） |
| 代码同一性 | `git diff eb53f39 abe1623 -- src prisma public next.config.ts` **为空**；两提交间仅 4 个文档/证据文件 ⇒ 本地测的就是线上那套代码 |
| 检查时间 | 2026-11-14 13:35 – 14:05 GMT+8 |
| 检查方式 | Playwright 1.64 + 本机 Chrome（`PW_CHANNEL=chrome`）· 9 个 spec / 113 条用例 · 生产只读 16 条 · 5 个独立探针 · axe-core WCAG 2.1 AA |
| 数据库 | `file:./ci-e2e-20261114.db`（本地一次性库，`prisma db push` + tenancy/connection 双迁移） |
| 原始证据 | `evidence/e2e-2026-11-14/{e2e-local-full,e2e-prod-readonly}-20261114.json`、`{axe-gate,v198-workspace-loop,v196-mission-flow,v18-isolation,payment-off}.log` |

---

## 一、结论

**本地全量 113/113 通过（0 失败、0 跳过、0 flaky，7.6 分钟）；生产只读 16/16 通过（67 秒）。**

| 层 | 范围 | 结果 |
| --- | --- | --- |
| 本地生产构建 E2E | 113 条 / 9 个 spec | **113 PASS** / 0 FAIL / 0 SKIP |
| 生产只读 E2E | 16 条（冒烟 6 + 缓存头 10） | **16 PASS** / 0 FAIL |
| 可访问性棘轮 | 3 页 × 4 视口 = 12 次运行 | **0 条 serious/critical**，“零新增” |
| 工作区闭环探针 | 12 项 | **12 PASS** |
| 高风险运行链探针 | 18 项 | 15 PASS / **3 BLOCKED** / 0 FAIL |
| 租户隔离探针 | 10 项 | 9 PASS / **1 BLOCKED** / 0 FAIL |
| 支付未接入面 | 18 项 | **18 PASS** |

但这不是“全绿可以收工”。本轮同时确认了 **5 项新缺陷**（2 项 P2、3 项 P3），其中最严重的一条是：

> **这 113 条用例从未进入 CI。** `.github/workflows/` 里没有任何 Playwright 步骤，它们只能在人工记得的时候在本机跑一次。门禁不存在，绿灯就是一次性的。

另有 3 条 P1 从页面正确性报告继承下来，**至今未修**（canonical 全站指向首页、内页 logo 仍是旧品牌、`/checkout/success` 主按钮 1.5:1）。

---

## 二、套件矩阵（本地生产构建）

| Spec | 条数 | 结果 | 覆盖什么 |
| --- | --- | ---: | --- |
| `smoke.spec.ts` | 6 | 6 | 健康检查真实连库、匿名访问受保护 API 401、登录页已水合、未知路径 404、根路径 HTML、定价页不是 Hlua 结账页 |
| `auth-dialogs.spec.ts` | 11 | 11 | 举报弹窗语义/焦点陷阱/Tab 循环/Escape 恢复焦点/落库/429 去重/取消不产生记录、跨租户 404、通话矩阵 |
| `dialogs.spec.ts` | 10 | 10 | 通用对话框键盘与 ARIA 契约 |
| `register-form.spec.ts` | 7 | 7 | 注册表单校验、错误播报、提交态 |
| `cache-headers.spec.ts` | 10 | 10 | 认证面 `private, no-store`、`/api/health` 不缓存、公开页仍可 CDN 缓存 |
| `mobile.spec.ts` | 12 | 12 | 公开面 390/360 移动端版面、无横向溢出 |
| `authed-mobile.spec.ts` | 18 | 18 | 认证后 13 屏 × 移动视口 |
| `legacy-mobile.spec.ts` | 27 | 27 | legacy `/dashboard/*` 线在移动端的回归面 |
| `workspace-tabs.spec.ts` | 12 | 12 | `/workspace` 六页签 × 2 视口 |
| **合计** | **113** | **113** | 0 失败 / 0 跳过 / 0 flaky |

### 两次运行的真实过程（不粉饰）

| 轮次 | 结果 | 说明 |
| --- | --- | --- |
| 第 1 轮（r2） | 110 PASS / **1 FAIL** / 2 未执行 | `auth-dialogs ⑦` 断言“24h 内该用户对该目标无既有举报”失败（`Expected 0, Received 1`）。同一 `describe.serial` 块内 ⑧⑨ 被标“未执行” |
| 中间处置 | — | `seed-chat-fixture --cleanup` → 重新 seed ⇒ 单跑该 spec **11/11 通过** |
| 第 2 轮（r4） | 启动即失败 | `global-setup` 连续 3 次 `net::ERR_FAILED`（DB 刚被外部写入后立即启动）；单跑 `smoke` 第 1 次登录成功 ⇒ 瞬时故障 |
| 第 3 轮（r6） | **113 PASS** | 干净夹具、无并发写库 |

也就是说：**113 绿是真的，但它不幂等。** 同一套用例连跑第二次就会红在第 ⑦ 条——这不是“偶发”，是确定性失败（详见 N-1）。

---

## 三、生产只读 E2E（16/16）

对 `https://app.lokfeel.com` 用同一套代码跑只读子集（不登录、不写数据）：

- `smoke`：健康检查 200 且数据库真实可达（280ms）、匿名 `/api/*` 401、`/login` 表单已水合、未知路径 404、根路径 HTML、`/pricing` 是 Connection OS 自己的页面
- `cache-headers`：`/login`、`/register`、`/forgot-password`、`/reset-password`、`/verify-request`、`/auto-login`、`/admin-login` 全部 `private, no-store`；`/api/health`、`/api/auth/session` 不缓存；`/` 仍允许 CDN 缓存（没有为了安全把公开页一起收紧）

这一层证明的是**线上产物本身**：守卫没被构建绕开、缓存策略没在 CDN 后面失效、定价页没被别的产品顶掉。

---

## 四、探针明细

| 探针 | 输出 | 判读 |
| --- | --- | --- |
| `v198-workspace-loop` | 12 PASS / 0 BLOCKED / 0 FAIL | Mission 创建 → Schema 拒绝（need<4、受保护字段、缺幂等键）→ 分享加入 → 错误恢复 → 持久化 → 移动端编译 → Studio 创建 → 刷新恢复，全链路真实读写 |
| `v196-mission-flow` | 15/18 PASS · **3 BLOCKED** · 0 FAIL | Intent 重放、MEMBER 越权 409/403 均过；**A-01/C-01 的运行终态是 `runStatus=FAILED`** ⇒ C-03 批准、C-04a 驳回、E-01 执行无法裁决（详见 N-2） |
| `v18-isolation-proof` | 9 PASS / 0 FAIL / **1 BLOCKED** | A 不能对 B 的 mission 起运行、MEMBER 缺 `mission.create` 403、MCP `list_missions` 不泄露他租户；SEC-08「Consent 撤销后继续执行被拒」缺跨 4 表夹具 |
| `v196-axe-scan --gate` | 12 次运行 0 违规 | `/`、`/login`、`/register` × 360/390/768/1440；仅计 serious/critical；对棘轮零新增 |
| `verify-payment-off` | 18/18 | 支付未接入时必须 503 + `PAYMENT_NOT_CONFIGURED`、不得 500、不得泄露变量值、webhook 带签名也不能 500 |

---

## 五、本轮新发现（按严重度）

### N-1 · P2 · E2E 用例 ⑦ 不幂等：同一套用例第二次必红

- **文件**：`tests/e2e-ci/auth-dialogs.spec.ts:245-258`
- **现象**：用例先断言 `/api/reports?type=my-reports` 长度为 0。服务端去重是 **per（举报人, 被举报人）24 小时**，不是 per 原因；⑦ 自己会写入一条举报，于是**下一次全量运行的前置必然不干净**。
- **代价**：任何“跑两遍确认稳定”的做法都会得到假红；CI 一旦挂上，每天第一次跑绿、重跑红。
- **修法**（二选一）：
  1. 给 ⑦ 单独造一个只被它举报的目标用户（`e2e_user_chat_b2`），生命周期跟着 `seed-chat-fixture` 走；
  2. 或加 `test.afterEach` 直连 DB 删除本用例写入的 `UserReport`（`--db` 已在夹具脚本里，连接串可取）。
- **验收**：连续跑同一 spec 两次都绿。

### N-2 · P2 · 本地没有模型凭据，三条最高风险的“人机协同”链只能记 BLOCKED

- **证据**：`v196` 里 `A-01 INTENT_EXTRACTION` → `status=201 runStatus=FAILED`；`C-01 INTRO_DRAFT` 同样 `FAILED`。`.env.local` 中 **`WORKBUDDY_LLM_*` 一个都没有**（`grep -c` = 0）。
- **后果**：`C-03 批准 → APPROVED`、`C-04a 驳回 → REJECTED`、`E-01 执行已批准运行 → 真实终态` 三条**永远测不到**。而这三条正是“高风险操作要有人批准”这件事的全部证据。
- **性质**：这是**覆盖缺口**，不是产品失败。生产环境三键齐备（`wbapp_GcSJVu9PTUQyKGX2O7Pv8t`），但它只能在服务端调、只支持 `stream:true`，本地拿不到。
- **修法**：CI/预发注入三键 + 一份**自带契约骨架**的提示词夹具，把 A/C/E 三条跑到终态；在此之前发布说明里不能写“审批链已端到端验证”。

### N-3 · P3 · 登录前置对服务端瞬时不可用零容忍

- **证据**：第 2 轮（r4）`global-setup` 连试 3 次全是 `net::ERR_FAILED`；一分钟前同一账号第一次就成功。发生在“夹具刚写完库、服务端刚被外部写事务打断”的窗口。
- **问题**：3 次重试之间**没有退避**，对瞬时故障等于一次。且失败信息把网络错误与“版面问题”混在一句里，容易误判成登录坏了。
- **修法**：重试加 1s/3s 退避；`ERR_FAILED`/`net::` 与断言失败分开计数并在报错里标注“网络层，非界面”。

### N-4 · P3 · Playwright 1.64 在 macOS 13 上装不了自带 Chromium

- **证据**：`npx playwright install chromium-headless-shell` → `ERROR: Playwright does not support chromium-headless-shell on mac13`；本机缓存最高 `chromium-1223`，而 1.64 需要 `1248`。
- **现状**：`playwright.ci.config.ts` 的 `launchOptions` 已支持 `PW_CHANNEL=chrome` 借道本机 Chrome（配置里有注释），本轮所有浏览器用例都靠它跑通。
- **风险**：如果哪天把 E2E 挂到 `macos-13` runner 上，会 100% 全红，且报错看起来像产品挂了。
- **修法**：CI 固定 `ubuntu-latest`（或 `macos-14+`）。

### N-5 · P2 · E2E 根本没有进门禁

- **证据**：`.github/workflows/` 全目录检索无 `playwright`、无 `e2e` job。
- **含义**：本报告这 113 条的价值，取决于“有人记得手动跑”。回归保护为零。
- **修法**：新增 job：`ubuntu-latest` + `prisma db push`（file 库）+ 两个迁移脚本 + `next build && next start` + 夹具 seed（`GITHUB_ENV`）+ `PW_CHANNEL` 不设 + 三键注入 + 失败上传 HTML/trace。约 10 分钟，与现有 CI 并行不冲突。

---

## 六、继承未修（来自 `19_PAGE_CORRECTNESS_REPORT.md`，本轮未改动）

| 编号 | 严重度 | 问题 | 状态 |
| --- | --- | --- | --- |
| P1-1 | P1 | 全站 canonical 写死首页（`src/app/layout.tsx:48`），子页等于自请出索引 | **未修** |
| P1-2 | P1 | 内页导航 logo 仍是旧品牌 `LokFee!`（26/35 页） | **未修**，待定品牌口径 |
| P1-3 | P1 | `/checkout/success` 主按钮 `text-white` on `bg-primary` = 1.5:1 | **未修** |
| P2-1 | P2 | `/dmca` 等三页仍写 `LokFeel Inc. Wilmington, Delaware` | **未修**，待法人主体 |
| P2-2 | P2 | `/blocked` 整页旧约会文案 + 2.69:1 对比度 | **未修** |
| P2-3 | P2 | `/admin-login` 四处对比度不足 | **未修** |
| P2-4 | P2 | `/dashboard/users/[id]` 未登录返 200 空白 | **未修** |

---

## 七、不能声称的事（覆盖边界）

1. **没有发生过一次真实扣款。** 支付面只验证了“未接入时的正确失败”（18/18），不是“能收钱”。
2. **没有验证 SCALE 年付**——它被 $3,000 单笔上限挡着，页面上禁用并引导对公。
3. **没有验证真实邮件投递**（注册验证、找回密码只到“界面正确”）。
4. **没有做并发/长稳压测**；`dbLatency` 本地 1ms、生产 280ms，只说明连通，不说明容量。
5. **没有人工读屏验收**；axe 只覆盖自动规则，键盘可达性由 `auth-dialogs` 的焦点陷阱用例覆盖，不等于 WCAG 全量合规。
6. **Consent/Connection 撤销链（SEC-08）无夹具**，属未测而非通过。

---

## 八、建议动作（按性价比排序）

| 序 | 动作 | 归属 | 预计 |
| --- | --- | --- | --- |
| 1 | 把 E2E 挂进 CI（N-5），同时修 N-1 幂等、N-3 退避 | 我 | 一次提交 |
| 2 | 修 P1-1 canonical + P1-3 对比度（机械改动，各 1 行 + 断言） | 我 | 一次提交 |
| 3 | 注入 LLM 三键跑通 A/C/E 终态（N-2） | 我（需三键） | 一轮 |
| 4 | P1-2 品牌字面量收敛到 `BRAND.name` + CI grep 守卫 | 需你确认品牌写法 | 一次提交 |
| 5 | P2-1 法人地址 / P2-2 `/blocked` 去留 | 需你给真实主体与地址 | 待定 |

> 第 1、2 项我可以直接做完并复跑回归；第 3 项缺凭据；第 4、5 项涉及对外口径，不擅自改。
