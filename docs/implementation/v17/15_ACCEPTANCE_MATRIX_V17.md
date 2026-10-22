# 15 · V17 统一验收矩阵

**基线**：`f8dd997`（2026-10-21）
**CI**：`f8dd997` 上 **15 成功 / 2 跳过 / 0 失败**（共 17 项）（跳过的是「DCO sign-off」与「Perf 基线实跑（手动）」）
**生产**：`dc102cd ready`（本轮全部提交带 `[skip netlify]`，未触发重新部署）
**文档范围**：`00`–`10` 全部产出。每条判定的可复跑命令见 `07_EVIDENCE_LENS.md`（由 `npm run check:evidence` 双向对齐，缺一条即 CI 红）

---

## 0. 判定口径

只有四种值，**不存在"大概没问题"**：

| 值 | 含义 |
|---|---|
| **PASS** | 有可复跑的判据，且当前通过 |
| **FAIL** | 有可复跑的判据，且当前不通过 |
| **BLOCKED** | 判据明确，但**缺执行条件**（凭据 / 账号 / 法律意见 / 真实交易）。**不等于通过** |
| **NOT_APPLICABLE** | 该条在当前离线形态下不适用 |

另加一列**证据层级**，因为「PASS」有四种含金量，混着说就是自欺：

| 层级 | 含义 |
|---|---|
| `代码` | 纯函数 / 单测 / 静态扫描 |
| `协议` | 本地假服务端 + 真实 SDK（相当于"契约正确"） |
| `生产` | 打真实生产端点取到的响应 |
| `真实` | 真实用户、真实资金、真实第三方回执 |

> 本表里没有任何一条达到 `真实` 层级。这是全表最重要的一句话。

### 0.1 条目数与 V17 原文的差值（显式说明，不悄悄凑数）

V17 原文写「40 项」。按五组编号展开实为 **42 项**（8 + 10 + 12 + 8 + 4）。
此处**以展开后的 42 项为准**，并把差值写出来 —— 为了凑成"40"而删掉两项，
正是这份文档最不该做的事。

---

## 1. 总览

| 组 | 项数 | PASS | FAIL | BLOCKED | N/A |
|---|---|---|---|---|---|
| SEC（安全与隔离） | 8 | 8 | 0 | 0 | 0 |
| PAY（支付与订阅） | 10 | 7 | 0 | 3 | 0 |
| UX（十三屏与体验） | 12 | 9 | 0 | 3 | 0 |
| OPS（运维与可观测） | 8 | 5 | 0 | 3 | 0 |
| BIZ（商业与合规） | 4 | 0 | 0 | 4 | 0 |
| **合计** | **42** | **29** | **0** | **13** | **0** |

**0 FAIL 的含义**：所有"能跑的判据"都跑通了。**13 BLOCKED 的含义**：这 13 条一条都没验，
而它们恰好集中在"钱能不能真的收、人能不能真的用、出了事谁负责"上。

> **⚠️ 2026-10-22（V18 D1）修正：汇总表此前写的是 25 PASS / 17 BLOCKED，与逐行数据不符。**
>
> 逐行重算：**29 PASS / 0 FAIL / 13 BLOCKED**。差 4 项，原因是增量交付只改了行、没改汇总：
>
> | 条目 | 原先记 | 实为 | 依据（何时改的） |
> |---|---|---|---|
> | PAY-04 续费入账 | BLOCKED | **PASS** | `tests/billing/creem-events.test.ts` 用例 4/5/11（WB17-02） |
> | PAY-05 乱序降级 | BLOCKED | **PASS** | 同文件用例 16/17/18（WB17-02） |
> | PAY-06 事件目录完整 | BLOCKED | **PASS** | 同文件用例 2/3（WB17-02） |
> | UX-07 动效降级 | BLOCKED | **PASS** | UI 不变量 R11 + 2 条变异（WB17-07） |
> | OPS-07 CI 可作发布前置 | BLOCKED | **PASS** | 2026-10-22 复测 `f62f342`：21 成功 / 2 跳过 / 0 失败 |
>
> 这 4 项都是**代码级**证据，没有一条升级到生产级。修正方向是「让汇总跟上逐行」，
> 不是「让逐行迁就汇总」—— 否则等于把已交付的判据降级。
>
> 从此这类漂移由 `npm run check:acceptance` 强制：汇总表 ≠ 逐行重算 ⇒ CI 红。

---

## 2. 逐项

### 2.1 SEC · 安全与隔离（8/8 PASS）

| ID | 判据 | 判定 | 层级 | 证据 |
|---|---|---|---|---|
| SEC-01 | 多租户面上每个 org 模型查询都带租户谓词 | **PASS** | 代码 | `audit:tenancy --strict`，5 条白名单已登记并注明理由；`scanned===0` 直接 FAIL |
| SEC-02 | 多能力守卫不得"混入弱能力即放行" | **PASS** | 代码 | `withTenantAll/Any` 拆开；MEMBER 有 `org.read` 无 `mission.update` → 403；换 `Any` → 200（变异对照） |
| SEC-03 | 授权必须可撤回（不能是单行道） | **PASS** | 代码 | 新增 `DELETE /api/im/consent`；`isRevoked` 此前**只读不写**，读取路径已过滤但无写入者 |
| SEC-04 | 隐私接口的对象只能来自会话 | **PASS** | 代码 | `GET.length===0` 结构性证据；`?userId=受害者` 仍只作用于本人（导出+删除各一条） |
| SEC-05 | 不存在绕过租户谓词的写入口 | **PASS** | 代码 | 删 `withdrawFromMission`（零调用）；`compensate` 硬删补当事方谓词；3 处写操作补租户谓词 |
| SEC-06 | 角色能力矩阵无断层（单调） | **PASS** | 代码 | MEMBER ⊆ OPERATOR ⊆ ADMIN ⊆ OWNER 逐能力断言 |
| SEC-07 | Webhook mock 旁路不得在生产生效 | **PASS** | 代码 | `isMock && !allowMock → 401`；配了真实 secret 后 mock 签名被拒（单测） |
| SEC-08 | 生产可达依赖无已知高危 | **PASS** | 代码 | CI `Dependency audit（生产可达 · 棘轮）` 绿；16→3 overrides |

### 2.2 PAY · 支付与订阅（7 PASS / 3 BLOCKED）

| ID | 判据 | 判定 | 层级 | 证据 / 缺口 |
|---|---|---|---|---|
| PAY-01 | 未接入支付时给 503 + 稳定码，不伪装成 500/200 | **PASS** | 生产 | 分两种路径（`03` §2 逐条实测）：**公共**端点匿名即 503 —— `GET /api/payments/creem/products` → `{"code":"PAYMENT_NOT_CONFIGURED","channel":"creem.checkout","missing":["CREEM_API_KEY"]}`；**需登录**的结账类端点先撞鉴权 401（`/api/payments/status`、`checkout` 等），登录后才轮到 503。`GET checkout` 为 405（仅 POST）。⇒ "统一 503"这个旧说法不准确，已在 `03` §2 纠正 |
| PAY-02 | 首购开通正确入账（金额/币种/归属） | **BLOCKED** | — | 需真实 checkout；缺 4 凭据 |
| PAY-03 | 同一笔交易只入账一次（幂等） | **PASS** | 代码 | 同事件重放 `duplicate: true`；不同期续费键不同 |
| PAY-04 | 续费必须入账（`subscription.paid`） | **PASS** | 代码 | 原实现**完全没处理**；现补上并以 `creem:tran:<tran_id>` 为键 |
| PAY-05 | 乱序降级不得把已付费订阅打成逾期 | **PASS** | 代码 | 以 `stripeCurrentPeriodEnd` 为逻辑时钟；迟到 `past_due` → `ignored: 'stale'`，同周期仍真降级 |
| PAY-06 | 事件目录完整，无永不可达的死分支 | **PASS** | 代码 | 17 条穷举；删 4 个 Stripe 词汇死分支；自证断言"真源码死分支=0" + 合成夹具证检测器仍有效 |
| PAY-07 | 退款只翻原账单，不改订阅状态 | **PASS** | 协议 | `refund-e2e.mjs`（真实 SDK + 本地假 Stripe，5 场景 19 断言 + 变异） |
| PAY-08 | 真实退款拿到网关回执 | **BLOCKED** | — | 无凭据、无真实交易 |
| PAY-09 | 订阅状态与权益发放一致 | **PASS** | 代码 | `isEntitled`：仅 ACTIVE/TRIALING 发权益；`paused` 有损映射到 PAST_DUE（宁可停权不白送） |
| PAY-10 | 三方对账（发票 / 账单 / 退款）一致 | **BLOCKED** | — | `03_PAYMENT_RECONCILIATION.md` 列 E1~E5 五项证据全缺 |

### 2.3 UX · 十三屏与体验（9 PASS / 3 BLOCKED）

| ID | 判据 | 判定 | 层级 | 证据 / 缺口 |
|---|---|---|---|---|
| UX-01 | 无"点了没反应"的按钮 | **PASS** | 代码 | `check-ui-invariants` R1/R2，扫 49 文件 |
| UX-02 | 未就绪能力 disabled 且有**具体**原因 | **PASS** | 代码 | R4；原因是具体句子，不是"敬请期待" |
| UX-03 | 三态渲染是真的（不拿空数组当成功） | **PASS** | 代码 | `Loadable` 统一三态；`tenantSource` 区分"仍在读"与"读失败" |
| UX-04 | 计数不得把"读不到"显示成 0 | **PASS** | 代码 | `null` → `—`；`countHint` 说明口径；有单测 + 变异 |
| UX-05 | 文本对比度达 WCAG AA | **PASS** | 代码 | 5 板块 × 15 组全达标 |
| UX-06 | 双世界切换不产生死色 | **PASS** | 代码 | 令牌作用域，对比度门禁覆盖两个世界 |
| UX-07 | `prefers-reduced-motion` 降级 | **PASS** | 代码 | R11（新）：四档 `[data-lf-motion='0'/'1'/'3']` 存在且 L3 > L1 > 0、默认档落在 L1 与 L3 之间、`@media (prefers-reduced-motion: reduce)` 至少一处把 `--lf-dur*` 清零；2 条变异（删媒体查询 / 把 L3 调成 L1）均被捕获。⚠️ 浏览器实测（`audit:release`）仍需生产账号 ⇒ 本条的 PASS 只是"机制存在" |
| UX-08 | 移动端（<1024px）不溢出可操作 | **BLOCKED** | **行为** | V18-06（2026-10-22 收口）变成 CI 门禁，`3046f2b` 全绿（42 条）：**公开 6 路由 + 认证 9 屏 + `/workspace` 六个页签**，各 × 2 视口（390×844 / 360×800），横向溢出 ≤1px 且触控目标 ≥24×24（WCAG 2.5.8）。认证面走 globalSetup 真实登录 + storageState；页签组每条先断言 `aria-current="page"` 转移（否则量的是上一屏）。**新门禁第一次跑就抓到真缺陷**：`/console`「查看全部→」62×16（已修）—— 因为先前量到的是**骨架屏**。**仍 BLOCKED 的部分**：legacy B2C 线（`/dashboard/chats`、`/dashboard/matches`、`/dashboard/profile` 等）未进门禁 —— 它们不是主线，但 `/dashboard/subscription` 之外仍无证据 |
| UX-09 | 界面与契约不脱节（枚举漂移） | **PASS** | 代码 | `verify:workspace-drift` 变异自证；本轮已修"从未进 CI" |
| UX-10 | 不把假数据/示例当真实数据 | **PASS** | 代码 | R5 无假数据标识、R6 agent 节点必须有源 |
| UX-11 | 空态告诉用户下一步做什么 | **BLOCKED** | — | 有 `emptyText`，未逐屏实测 |
| UX-12 | 十三屏在真实登录态下完整走通 | **BLOCKED** | **部分**（行为） | 2026-10-22 收口：CI 用隔离库自造账号（`seed-authed-e2e-user.mjs`）+ `global-setup.ts` 真实登录产出 storageState；**9 屏 × 2 视口**外加 **`/workspace` 六个页签 × 2 视口**都已稳定渲染并被断言（`3046f2b` 全绿，42 条）。但**走通 ≠ 渲染**：自动用例只量版面与触控、只点页签，**没有走任何业务流程**（Consent 撤销后是否真的停止执行、Outcome 能否验证等）。仍需一次人工走查（D-06） |

### 2.4 OPS · 运维与可观测（5 PASS / 3 BLOCKED）

| ID | 判据 | 判定 | 层级 | 证据 / 缺口 |
|---|---|---|---|---|
| OPS-01 | 站点是否活着能被自动发现 | **PASS** | 生产 | `uptime-probe` 打 4 个面；`uptime.yml` 每 20 分钟，失败即 job 红 |
| OPS-02 | 探针本身不得恒绿 | **PASS** | 代码 | 自证 12 条：9 变异（503/慢库/状态错/Redis 降级/支付矛盾/非 JSON/空白页/越权 200/挂死）+ 1 负数对照 |
| OPS-03 | 导出/删除有闸门，默认只看不动 | **PASS** | 代码 | `GET` 不执行；`apply` 只认 `1`（`0/yes/true/裸 apply` 均不执行）；`NotFoundError → 404` |
| OPS-04 | 删除过程可断言、可对账 | **PASS** | 代码 | 返回 `plan/applied/cache`；`applied` 与 `plan.impact` 不一致须在报告注明 |
| OPS-05 | 业务指标（注册/付费/失败率）可观测 | **BLOCKED** | — | 无指标存储，且当前无真实用户（基线会是编的） |
| OPS-06 | 错误追踪可用且已脱敏 | **BLOCKED** | — | Sentry 代码在，DSN 是否配置未确认；**无 `beforeSend` 脱敏** |
| OPS-07 | CI 全绿可作发布前置 | **PASS** | 代码 | `f8dd997`：15 成功 / 2 跳过 / 0 失败（共 17 项） |
| OPS-08 | 发布可回滚且回滚过 | **BLOCKED** | — | Netlify 有 rollback；本轮**未实际回滚验证** |

### 2.5 BIZ · 商业与合规（0 PASS / 4 BLOCKED）

| ID | 判据 | 判定 | 层级 | 缺口 |
|---|---|---|---|---|
| BIZ-01 | 客户能真的付钱（含大陆可达） | **BLOCKED** | — | `payments.configured=false`（缺 4 凭据）；Gumroad 大陆不可达（DNS 污染 + 12s 超时） |
| BIZ-02 | 退款政策唯一且合法 | **BLOCKED** | — | `/refunds` 写 **14 天**、`pay.html` 写 **7 天**，两处同时在线；已定临时仲裁（宽者优先=14 天），法律适用需外部意见 |
| BIZ-03 | 法律主体 / 数据控制者明确 | **BLOCKED** | — | `privacy@` `billing@` 背后是谁未定 ⇒ "我们会删除您的数据"在法律上没有承诺人 |
| BIZ-04 | 至少 1 个真实客户走通完整闭环 | **BLOCKED** | — | 无真实用户、无真实交易 |

---

## 3. 四个就绪判定

V17 要求**分别**判定，禁止只输出"项目已全部完成"。

### 3.1 `TECHNICAL_BETA_READY` → **YES**

| 判据 | 结果 |
|---|---|
| TypeScript 严格通过 | ✅ `tsc --noEmit` 绿 |
| 生产构建通过 | ✅ `next build` 绿 |
| Lint 棘轮无新增债 | ✅ 绿 |
| 单测 + E2E 冒烟 | ✅ Jest 绿、Playwright 冒烟绿 |
| 迁移可全批次重放 | ✅ Migration job 绿 |
| 无已知崩溃级缺陷 | ✅ 本轮修掉 6 个真缺陷（见 §6） |
| 依赖无生产可达高危 | ✅ |
| 租户隔离有静态门禁 | ✅ `audit:tenancy --strict` |

**结论**：技术上可以给"内部/受邀技术用户"用。
注意：这不代表"别人用起来没问题"——UX-08/11/12 三条一条都没验。

### 3.2 `PUBLIC_BETA_READY` → **NO**

| 阻断项 | 说明 |
|---|---|
| 十三屏未在真实登录态走过 | UX-12 BLOCKED；截图与三态全缺 |
| 没有定价页 | `/pricing` → 307 → `/pay.html`，漏斗少一环 |
| 退款/隐私/条款只有英文 | 用户无法用母语理解自己同意的条款 |
| 存活监控只有几小时数据 | 首轮告警尚未发生过，通道未经验证 |
| 无错误追踪脱敏 | OPS-06 BLOCKED |
| **站内没有"取消订阅"入口** | `pay.html` 承诺 "cancel in one click"，而那个点击**在 Gumroad 收据邮件里**。全仓与取消相关的代码只有 Stripe webhook 的**被动**处理（`customer.subscription.deleted`），无取消端点、无账单门户 ⇒ 客户要在"他正在用的产品"之外才能停掉扣款。公开 Beta 期间这条会直接变成投诉（`09` §4-6） |

**距离可公开的最小集合**：建测试账号做一轮十三屏截图与三态验证 → 补定价页 → 三条法律页中文化 → 确认 Sentry DSN 与脱敏。前两项是纯工程，后两项需要拍板。

### 3.3 `PAID_BETA_READY` → **NO**

| 阻断项 | 说明 |
|---|---|
| `payments.configured=false` | 缺 `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` |
| 无真实交易 | PAY-02 / PAY-08 / PAY-10 全部 BLOCKED |
| 退款窗口冲突未决 | 7 天 vs 14 天同时在线，且缺法律意见 |
| 大陆支付通道未定 | Gumroad 不可达；备用通道（Creem/Stripe）大陆可用性未验证 |
| **对外有两套互不相干的价格** | 代码 `plans.ts`：$19.99/月 · $149.99/年（省 37%）；公开 `pay.html`：$12.99/月 · $99.99/年 · $32.99/季。**代码里的价格用户看不到，页面上的价格代码里没有** ⇒「改价」是两个互不同步的动作。已登记 3 条偏差，第 4 个未登记价格会被 `check:pricing` 判红（`10` §1） |

**结论**：**现在收钱会在第一次真实扣款或第一次真实退款时暴露问题**。
尤其注意 PAY-02/PAY-10 的失效形态：首月扣款成功、次月静默丢失（已修代码，
但没在真实网关上验过）。所以"能付就行"这个判断在本项目上是不成立的。

### 3.4 `GENERAL_AVAILABILITY_READY` → **NO**

| 缺口 | 说明 |
|---|---|
| 无 on-call | 1 人项目，告警是异步邮件；无分页 |
| 无 SLO / 错误预算 | 无流量基线 |
| 无业务指标 | OPS-05 BLOCKED |
| 回滚未演练 | OPS-08 BLOCKED |
| 法律主体未定 | BIZ-03 BLOCKED |
| 冷启动 13 秒 | 首次访问者首屏 13s，需付费升级或预热。`08` 实测：移动端 4G 下**首访 LCP 6284ms**、暖机 3388ms（均超 CWV 的 2500ms） |
| 付款页卖的是另一个产品 | `/pricing` → 307 → `/pay.html`，标题是 "Hlua Pass"，权益写"streaming / H-Points"，全部 CTA 指向 Gumroad —— 收钱这一步产品身份断裂（`08` §5.1） |

---

## 4. 文档产出情况（00–10 全部产出）

V17 的 12 个任务包对应的 11 份文档已全部落盘。**这不等于对应的验收条目都通过了** ——
下表最后一列是各文档对判定的实际影响：

| 文档 | 主题 | 对应条目 | 产出后判定有变吗 |
|---|---|---|---|
| `07_EVIDENCE_LENS.md` | 证据透镜 | 横切要求 | 无（但 42 条判定从此可被机器对齐） |
| `08_PERF_MOBILE_PAY.md` | LCP + 移动端支付 | UX-08（部分） | **无**：UX-08 仍 BLOCKED（十三屏需登录） |
| `09_CUSTOMER_PLAYBOOK.md` | 真实客户 playbook | BIZ-04 | **无**：BIZ-04 仍 BLOCKED（0 客户） |
| `10_PRICING_VALIDATION.md` | 定价验证 | BIZ-01（部分） | **无**：BIZ-01 仍 BLOCKED（缺凭据 + 大陆不可达） |

**写文档不解锁判定。** 这三份对判定的影响都是 0 —— 它们的价值在于
把"没验的部分"写成可执行的东西，而不是把"没验"变成"验过"。

---

## 5. 13 条 BLOCKED 的解除路径

按"解除一条要多久"排序，而不是按严重度 —— 因为严重度都差不多，能先解的先解。

| # | 条目 | 解除需要什么 | 谁给 | 预估 |
|---|---|---|---|---|
| 1 | UX-12 / UX-08 / UX-11 | 生产测试账号（一次确认） | 用户 | 2h |
| 2 | OPS-06 | 确认 Sentry DSN + 加 `beforeSend` | 工程 | 1h |
| 3 | OPS-08 | 在 Netlify 手动回滚一次再前滚 | 工程 | 30min |
| 4 | BIZ-02 | 定 7 天或 14 天 + 改两处文案 | 产品 | 1h（法律意见另计） |
| 5 | OPS-05 | 接指标存储（Upstash 或轻量） | 工程 | 4h |
| 6 | PAY-02/08/10 | 4 个凭据 + 一笔真实（可退）小额交易 | 用户 | 2h |
| 7 | BIZ-01 | 大陆支付通道决策（Gumroad 不可达） | 用户/产品 | 决策 |
| 8 | BIZ-03 | 法律主体 | 用户 | 决策 |
| 9 | BIZ-04 | 有真实客户 | 时间 | — |

前 4 条（含一次确认）**今天就能推到只剩"真实交易"和"法律主体"两条**。

---

## 6. 本轮修掉的真缺陷（不是重构、不是补测试）

| # | 缺陷 | 失效形态 | 为什么难发现 |
|---|---|---|---|
| 1 | `withTenant` 传数组按 `some()` 判定 | 混入弱能力即放行 | 57 处调用**零数组** ⇒ 从未触发；是"以后会踩"的地雷 |
| 2 | `isRevoked` 只读不写 | 授权只能给不能收 | 字段、索引、审计动作全在，读取也过滤了 —— 只缺写入者 |
| 3 | `withdrawFromMission` 无租户谓词 | 跨租户撤回他人参与 | 全仓零调用，只被 barrel 导出 |
| 4 | Creem 续费完全不入账 | 首月收款、次月静默丢失 | 首月永远正常 |
| 5 | 幂等键用订阅 id | 第二期续费被判成"重复"跳过 | 与 #4 叠加：两个原因都让续费不入账 |
| 6 | 乱序降级无保护 | 迟到的 `past_due` 把已付费订阅打成逾期 | 只在网络乱序时出现 |
| 7 | `ERASURE_ACTIONS` 写 `CANCELLED` | 该值在枚举里**不存在**，照它写会炸 | 它自称"单一真相源"，没人会去查枚举 |
| 8 | 漂移守卫从未进 CI | 门禁形同不存在 | "有脚本"看起来就像"有门禁" |

另有 3 处是**我自己的测试写错了**（详见 `06` §3.1 与工作日志），已记在案 —— 不掩盖。

---

## 7. 需要拍板的事（汇总 00–06）

| # | 事项 | 出处 | 影响 |
|---|---|---|---|
| 1 | 4 个支付凭据 | `03` / `LAUNCH_READINESS` | 阻断 PAID_BETA |
| 2 | 大陆支付通道（Gumroad 不可达） | `03` | 阻断 BIZ-01 |
| 3 | 退款窗口 7 天还是 14 天 + 法律适用 | `04` | 阻断 BIZ-02 |
| 4 | 法律主体 / 数据控制者 | `04` | 阻断 BIZ-03 |
| 5 | 是否允许建生产测试账号（做删除演练 + 十三屏截图） | `04` §9.3 / `06` §5.1 | 阻断 UX-11/12、OPS-03 的动态验证 |
| 6 | 是否补定价页 | `06` §4.1 | 影响 PUBLIC_BETA |
| 7 | 法律三页中文化 | `06` §4.2 | 影响 PUBLIC_BETA |
| 8 | 是否为消除 13s 冷启动升级 Netlify | `05` §8 | 体验 / 成本 |
| 9 | `scheduler.yml` 定时是否开启 | `05` §8 | **功能是否在工作**（outbox 事实上停摆） |

> 第 9 条最容易被当成"运维小事"，但它其实是功能问题：`workflow-tick` 的重试退避
> （30s 起、租约 60s）在没人手动触发时根本不会推进。

---

## 8. 本轮交付物索引

| 文件 | 内容 |
|---|---|
| `00_BASELINE_AUDIT.md` | 基线：HEAD / CI / 生产 / 支付状态 |
| `01_SECURITY_TENANCY.md` | 租户隔离：41 张无 `organizationId` 的表分四类 |
| `02_PAYMENT_EVENT_MATRIX.md` | 17 事件矩阵 + 3 种幂等键 + 5 项有损映射 |
| `03_PAYMENT_RECONCILIATION.md` | 对账 BLOCKED + E1~E5 证据缺口 |
| `04_PRIVACY_REFUND_SOP.md` | 导出/删除/退款六段 SOP + 10 家处理者 + 对外话术三档 |
| `05_MONITORING_ALERTS.md` | 存活探针 + 告警通道 + 8 类症状 Runbook |
| `06_UX_THIRTEEN_SCREENS.md` | 十三屏清单 + UX-01~12 判定 + 两个真 UX 问题 |
| `07_EVIDENCE_LENS.md` | 42 行证据透镜 + 11 种假绿形态 + 本轮复跑录 |
| `08_PERF_MOBILE_PAY.md` | 移动端 4G 首屏实测（LCP/TTFB/CLS/JS）+ 触控目标 + 付款页身份断裂 |
| `09_CUSTOMER_PLAYBOOK.md` | 9 步客户旅程 + 5 个失败剧本 + 6 个地雷 + 一页话术 + 15 项演练状态 |
| `10_PRICING_VALIDATION.md` | 两套价格体系对照 + 算术审计 + 敏感性表 + 样本量估算 |
| `11_FINAL_REPORT.md` | 最终验收报告：12 包交付表 + 9 条硬约束自查 + 8 个真缺陷 + 解除顺序 |
| `15_ACCEPTANCE_MATRIX_V17.md` | 本文件 |

代码侧新增（均已进 CI）：

- `scripts/qa/tenant-scoping-audit.mjs`（+ `audit:tenancy`）
- `scripts/qa/uptime-probe.mjs`（+ `probe:uptime` / `verify:uptime` / `uptime.yml`）
- `scripts/qa/verify-evidence-lens.mjs`（+ `check:evidence` / `verify:check:evidence`）
- `scripts/perf/measure-vitals.mjs`（+ `perf:vitals` / `verify:perf:vitals`）
- `scripts/qa/verify-pricing-consistency.mjs`（+ `check:pricing` / `verify:check:pricing`）
- `scripts/check-ui-invariants.mjs` 新增 **R11**（动效四档 + 系统级降级），
  变异自证 +2 变异 1 负向对照
- `src/lib/payments/creem-events.ts`（+ 36 条单测）
- `tests/lifecycle/privacy-rights-api.test.ts`（11 条）
- `tests/tenancy/{capability-semantics,consent-revocation}.test.ts`（16 条）

---

## 9. 一句话结论

> **代码层面已经站得住（0 FAIL），商业层面一条都还没验（13 BLOCKED）。**
>
> 现在这个状态适合"内部技术预览"，不适合"公开 Beta"，更不适合"收钱"。
> 距离公开 Beta 最近的一步不是写代码，是**允许我建一个生产测试账号** ——
> 它一解锁，UX-11/12、OPS-03 的动态验证、删除演练三件事会同时从 BLOCKED 变成可执行。
