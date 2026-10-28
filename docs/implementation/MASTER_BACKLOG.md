# MASTER_BACKLOG · 任务总账

> **任务状态**（本文件）与**验收判定**（`ACCEPTANCE_LEDGER.md`）是两件事：
> 任务可以先 `DOING` 而验收仍是 `BLOCKED`。**任务做完 ≠ 验收通过。**
>
> 任务状态：`TODO` / `DOING` / `DONE` / `BLOCKED`（带解除条件） / `DROPPED`（写明为什么不做）
> 验收判定：`PASS` / `FAIL` / `BLOCKED` / `NOT_APPLICABLE`（只认矩阵）
>
> **单周主任务 ≤ 1 个，附属修复 ≤ 2 个**（V18 §7）。超了就是并行过多，不是效率高。

**基线**：`main`=`c3213fd` · 工作线 `v19/design-exploration`=`8720868`（PR #32）· **本周主任务**：V18.3 发布（独立轨道）+ V19.4 真实体验 · **更新于**：2026-10-25（V19.4）

---

## 0. 本周（W01 · 10/22–10/28）优先级

| 序 | ID | 任务 | 状态 | 依赖 | 验收映射 |
|---|---|---|---|---|---|
| 1 | V18-00 | 五份持续台账 + 台账门禁 | **DONE** | — | 横切 |
| 2 | V18-01 | 隔离环境 + 双组织 + 8 类越权负向 | **DOING** | 无需外部 | SEC-01~08（已有 PASS，需升级到"真实双组织"层级） |
| 3 | V18-02 | LokFeel / Hlua 商业契约隔离 | **DONE（代码）** | V18-00 | BIZ-01（部分）、UX-11；**生产未部署** |
| 4 | V18-03 | 退款承诺统一 | TODO | 人工裁决 D-01 | BIZ-02 |
| 5 | V18-04 | 真实取消订阅能力 | **DONE**（API + UI） | 无凭据下也能做到"诚实失败" | BIZ-02、PAY-09、BIZ-05 |
| 6 | V18-06 | 关键触控目标 ≥24px | **DONE**（公开面 + 认证面 9 屏） | 页签级（/workspace 五个阶段）待下一轮 | UX-08 |
| 7 | V18-08 | 生产账号 E2E | **BLOCKED** | 需批准建生产测试账号 | UX-12 |

---

## 0.5 V18.3 受控 Beta 发布准备（WB18-30 ~ WB18-39 · 发布候选 `bba8c36`）

> 纪律：**批准进入"发布准备"，不等于批准发布。** `D-10` 未点头 ⇒ 生产继续停在 `dc102cd`。
> 全部提交带 `[skip netlify]`，所以"CI 全绿"没有触发任何部署。

| ID | 任务 | 优先级 | 状态 | 交付物 / 卡点 |
|---|---|---|---|---|
| WB18-30 | 发布前最终门禁 | P0 | **DONE** | `v18/30_PREDEPLOY_GATE.md`：九条前置全 PASS，结论「工程侧 GO / 授权侧 BLOCKED」 |
| WB18-31 | 受控 Beta 发布 | P0 | **BLOCKED（D-10）** | 批准后按 `22_RELEASE_RUNBOOK.md` §3 执行，产出 `31_DEPLOYMENT_RECORD.md`；**未批准 ⇒ 不部署** |
| WB18-32 | 生产五项冒烟 | P0 | **DONE（可执行）/ 五项 NOT_EXECUTED** | `scripts/qa/prod-smoke.mjs`（15 条，三态 PASS/FAIL/UNVERIFIED）；判据严格取 Runbook §4 五项。**对当前生产实跑 9 PASS / 6 FAIL**，6 条红即"生产仍是旧代码"的六个症状（无 `commit` 字段、`/pricing` 307、`/hlua` 404、`cancel` 404、两条 `public`）⇒ 发布后必须全绿 |
| WB18-33 | 安全与支付关闭 | P0 | **DONE** | `v18/33_SECURITY_PAYMENT_GATE.md`：支付四键缺失=设计，7 入口 503 稳定码；D-09 凭据哈希比对（`.env.test` 7 键与生产**全部不同**） |
| WB18-34 | Legacy B2C 四视口 | P1 | **DONE（27 条全绿）** | `v18/34_LEGACY_MOBILE_AUDIT.md` + `tests/e2e-ci/legacy-mobile.spec.ts`；纠正任务书路由（`/matches`、`/profile` 实测 404）；抓到 2 个真缺陷 |
| WB18-35 | 登录缓存与 307 稳定性 | P1 | **DONE（缓存修好 / ERR_FAILED 收窄未根治）** | `v18/35_AUTH_NAVIGATION_STABILITY.md`；7 个认证入口改 `private, no-store`，10 条响应头门禁 |
| WB18-36 | 性能专项 | P1 | **DONE（判定 PERF_TARGET_NOT_MET）** | `v18/36_PERFORMANCE_BASELINE.md`：5 冷 5 暖真实采样，推翻"TTFB 占 42–68%"与"图片是瓶颈"两个前提；**不伪称通过** |
| WB18-37 | 真实用户 Mission 试点 | P1 | **BLOCKED（D-06）** | 需生产账号 + 真实用户；`37_CUSTOMER_PILOT.md` 待写 |
| WB18-38 | 商业决策收口 | P1 | **DONE** | `v18/38_HUMAN_DECISION_REGISTER.md`：D-01~D-11 逐条给选项与后果，工程不代拍 |
| WB18-39 | 7 天观察 | P2 | **BLOCKED（无发布）** | 观察期只能从发布日起算，`39_SEVEN_DAY_OBSERVATION.md` 待写 |

---

## 1. V18 十项任务（含负责人与解除条件）

## 1.5 V19 设计与真实体验（分支 `v19/design-exploration` · PR #32 挂 CI · 合并需人工批准）

| ID | 任务 | 状态 | 证据 |
|---|---|---|---|
| V19-00~05 | 基线审计 / 技能记录 / 三案原型 / 选型 C / 设计系统 / 文案处置 | **DONE** | `docs/implementation/v19/00`–`06` · `design/v19/` |
| V19-06~08 | Workspace/Console spec（三处原型↔代码差异裁决） | **DONE** | `07` / `08` |
| WB19-40 | 13 屏真实交互审计（32 次导航 / 390+1440） | **DONE** | `16_REAL_UI_AUDIT.md` + 32 截图 |
| WB19-41 | 390px Mission 闭环 | **BLOCKED** | 需 D-06 账号 + 隔离库（`17`） |
| WB19-42 | Agent/Consent/Outcome 七问核验 | **DONE**（全过，无文案改动） | `18` |
| WB19-43 | 移动端缺陷修复 | **DONE**（P0=0；P1×2 = 生产旧代码症状，发布即消） | `16` §4 |
| WB19-44 | Figma 追溯 | **BLOCKED**（`BLOCKED_FIGMA_CONNECTOR`） | `19` |
| WB19-45 | `/login` 性能 | **DOING** — 测量+归因完成；LazyMotion 下放已提交（`8720868`），PR #32 CI 验证中；第三方注入（cloudflareinsights/GTM）待用户面板操作 | `20` §2–§7 |
| WB19-46 | 无障碍与响应式回归 | **PARTIAL**（PASS 6/部分 3/PENDING 4） | `21` |
| WB19-47 | 30 项验收矩阵 | **PASS 17 / PENDING 5 / BLOCKED 3 / NOT_MET 1** | `22` |
| WB19-48 | 发布轨道隔离 | **DONE**（PR #32 明确标注合并需人工批准） | PR #32 描述 |

| ID | 任务 | 优先级 | 状态 | 负责人 | 解除条件 / 备注 |
|---|---|---|---|---|---|
| V18-01 | 生产/隔离测试账号与双组织 | P0 | **DONE（行为取证）** | 工程 | 2026-10-22 CI：`CTRL-1/2` + `SEC-01..07` 全 PASS（真实 HTTP + 真实库）；SEC-08 仍 BLOCKED |
| V18-02 | SaaS 产品目录独立 | P0 | **DONE（代码）** | 工程 | 路由/目录/页面已拆（`18_COMMERCIAL_CONTRACT.md`）；定价仍待 D-02、退款天数待 D-01 |
| V18-03 | 退款承诺统一 | P0 | **BLOCKED** | 产品 | D-01 定 7 或 14 天；**工程不自行选**。盘点与冲突清单已出（`20_REFUND_PROMISES.md`，C1/C2/C3） |
| V18-04 | 取消订阅能力 | P0 | **DONE** | 工程 | `GET/POST /api/payments/cancel` + 20 条单测；判定收敛到 `evaluate()`，GET 与 POST 不可能错位；服务商归属 `resolveCancelProvider()` fail-closed（两家都配 ⇒ 409）。UI 在 `/dashboard/subscription#manage-subscription` |
| V18-05 | 支付凭据与真实收款 | 付费 P0 | **BLOCKED** | 用户 | 4 个凭据 + 一笔可退小额真实交易（D-05） |
| V18-06 | 关键触控目标修复 | 公开 P0 | **DONE（公开 + 认证 + 页签 + legacy）** | 工程 | 生产实测 4 页：`/login` 3 个 20px、`/pay.html` 1 个 17px ⇒ 撑到 44px。门禁四组：`mobile.spec.ts`（2 视口 × 6 公开路由）+ `authed-mobile.spec.ts`（2 视口 × 9 屏）+ `workspace-tabs.spec.ts`（2 视口 × 6 页签，先证 `aria-current` 转移）+ `legacy-mobile.spec.ts`（**4 视口 × 6 屏**，`bba8c36` 27 条全绿）。判据共用 `waitForStableDom` + 24px + 溢出 ≤1px。**新门禁共抓到 3 个真缺陷**：`/console`「查看全部→」62×16、768「Discover people →」119×20、1440 页脚 4 个 16px 链接（均已修） |
| V18-07 | 性能瓶颈治理 | P1 | TODO | 工程 | 先复现 3388ms 基线，再动 TTFB/JS |
| V18-08 | 生产账号 E2E | P0 | **BLOCKED** | 工程+用户 | 需生产测试账号（D-05） |
| V18-09 | 真实客户试点 3–5 家 | P1 | **BLOCKED** | 产品 | 有客户才有数据，`NO_DATA` 不是 0 |
| V18-10 | 经营与告警看板 | P1 | **BLOCKED** | 工程 | 需指标存储（D-07）+ Sentry（OPS-06） |

---

## 2. 从 V17 继承的未闭合项（13 条 BLOCKED → 任务化）

| 验收 | 卡点 | 对应任务 | 谁给 | 预估 |
|---|---|---|---|---|
| UX-08 | 移动端实机未验 | V18-06 + V18-08 | 工程 / 用户 | 3h |
| UX-11 | 空态文案未逐屏审 | V18-02 顺带 | 工程 | 1h |
| UX-12 | 十三屏无真实登录态走查 | V18-08 | 用户（账号） | 2h |
| OPS-05 | 无业务指标 | V18-10 | 工程 | 4h |
| OPS-06 | Sentry 无 `beforeSend` 脱敏 | OPS-06（独立） | 工程 + DSN | 1h |
| OPS-08 | 回滚未演练 | 独立（30min） | 工程 | 0.5h |
| PAY-02 | 首购未真实入账 | V18-05 | 用户 | 2h |
| PAY-08 | 真实退款无回执 | V18-05 | 用户 | 1h |
| PAY-10 | 三方对账未做 | V18-05 | 工程 | 2h |
| BIZ-01 | 客户付不了钱（含大陆可达） | V18-02 + V18-05 | 产品 | 决策 |
| BIZ-02 | 退款政策不唯一 | V18-03 | 产品（D-01） | 1h |
| BIZ-03 | 法律主体未定 | 独立 | 用户（D-03） | 决策 |
| BIZ-04 | 无真实客户闭环 | V18-09 | 时间 | — |

---

## 3. 本轮新登记（2026-10-22 实测发现）

| ID | 问题 | 优先级 | 状态 | 证据 |
|---|---|---|---|---|
| OPS-11 | `/api/health` 的 `version` 返 `"unknown"` ⇒ **线上跑哪个 commit 不可从运行时确认** | P1 | **DONE（代码）** | `src/lib/build-info.ts` + `next.config.ts` 构建期内联；`/api/health` 现回 `version/commit/builtAt/commitSource`。**生产仍 unknown**，等发版后复测 |
| BIZ-05 | 站内**没有取消订阅入口**，而 `pay.html` 承诺 "cancel in one click" | P0 | **DONE** | `src/app/api/payments/cancel/route.ts` + `/dashboard/subscription#manage-subscription`；`/refunds` 的指路牌已改为真实路径，并补充"Hlua Pass 由 Gumroad 收款、取消在 Gumroad" |
| BIZ-06 | 两套价格互不相干（`plans.ts` vs `pay.html`），代码里的价用户看不到 | P0 | **DONE（V18-02）** | `npm run check:pricing` |
| BIZ-07 | **工作区订阅的退款承诺自相矛盾**：`/refunds` 写「首次订阅 14 天」，`/pricing` 写「没有已生效的退款承诺」，`pay.html` 写「7 天」 | P0 | **BLOCKED（D-01）** | `docs/implementation/v18/20_REFUND_PROMISES.md`（C1/C2/C3） |
| DOC-02 | 会话 cookie 名按 `NODE_ENV` 判、Auth.js 按协议判 ⇒ http 部署登不进去（表现为"登录 200，之后全 401"） | P0 | **DONE** | `v18/19_SESSION_COOKIE_LAYER.md`；`tests/auth/session-cookie.test.ts` |
| DOC-01 | 矩阵汇总表与逐行差 4 项（25/17 vs 29/13） | P0 | **DONE** | `npm run check:acceptance` |

---

## 4. 明确不做（DROPPED，避免反复讨论）

| 事项 | 为什么不做 |
|---|---|
| 全站重做 UI / 再出三套视觉方案 | V16 设计系统稳定，V18 不重做 |
| 把 AVIF/图片优化当性能首要任务 | 实测 LCP 元素是 `H1`、图片传输 0KB，收益为零 |
| 同时接通 Stripe + Creem + Gumroad | 先让一个客户为**正确的产品**付一次款 |
| 为过 CI 删除/跳过测试 | 硬约束 |
| 在真实源码上跑变异测试 | 已被 SIGKILL 污染三次 |
| 用文档数量证明进度 | V18 明令禁止 |

---

## 5. 依赖关系（谁挡谁）

```
V18-00 台账 ──┬──> V18-02 商业契约 ──> V18-03 退款统一 ──> V18-05 真实收款
              │            │                  │
              │            └──> V18-04 取消 ──┘
              └──> V18-01 隔离/双组织 ──> V18-08 生产 E2E ──> G0 受控 Beta
                                                     │
                                        V18-06 触控 ──┴──> G1 公开 Beta
                                        V18-07 性能 ──┘
V18-05 真实收款 + V18-09 真实客户 ──> G2 付费 Beta ──> G3 GA（2027 Q1 再评估）
```

---

_新增任务必须写清：ID、优先级、依赖、解除条件。没有解除条件的 BLOCKED 等于永远不做。_
