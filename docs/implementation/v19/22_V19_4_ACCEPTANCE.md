# V19-22 · V19.4 验收矩阵（WB19-47）

> **判定时间：2026-10-23。** 30 项逐条给证据；**缺证据 = BLOCKED/PENDING，不给 PASS**。口径先说明：完整 17 项 CI 在 `main`（`c3213fd`）成立；`v19/design-exploration` 分支的 CI 只有 Cloudflare Pages 一项（workflow 过滤 main）+ 本地四门禁实跑。

## UX（10 项）

| # | 判定 | 证据 |
|---|---|---|
| UX-01 13 屏真实加载有证据 | **部分 PASS** | 公开 8 路由 × 2 视口真实截图 + JSON（`16` §2）；认证 8 路由 = 登录重定向态（门健康，业务态 BLOCKED 于 D-06） |
| UX-02 390px 主流程可操作 | **BLOCKED** | `17`（缺可登录隔离环境）；公开面输入框可用有截图 |
| UX-03 无阻断遮挡 | **部分 PASS** | CI 触控/遮挡断言（四视口 27 条 legacy + 30 条公开/认证）在 `main` 全绿；认证后业务页未在真浏览器核 |
| UX-04 无非预期水平溢出 | **PASS（公开面）/ PENDING（认证面）** | 16 审计 32 次导航仅 1 处溢出 = 生产旧 404 页（`16` §4） |
| UX-05 导航与页签状态正确 | **PASS** | `workspace-tabs.spec.ts`（先证 `aria-current` 转移）CI 绿 |
| UX-06 Loading/Empty/Error 正确 | **PASS（代码+组件级）** | `living-states.tsx` + 空态文案审计（`18`）；生产业务态 BLOCKED |
| UX-07 API 状态与 UI 一致 | **PASS（代码级）/ PENDING（端到端）** | `18` 四向核验表 |
| UX-08 Agent 状态不造假 | **PASS** | 服务端 statusLabel 直显；无 setTimeout 假进度（`18` §1） |
| UX-09 Consent 权限正确 | **PASS（代码级）** | 只按服务端 `actions` 渲染；`withTenant` 重判 |
| UX-10 Outcome 不伪造成功 | **PASS** | 「自报不算验证成功」「—≠0」在屏（`18` §1 #6/#7） |

## SEC（4 项）

| # | 判定 | 证据 |
|---|---|---|
| SEC-01 跨租户拒绝 | **PASS（门禁级）** | 租户隔离门禁在 CI（`main` 绿）；V19 分支未触碰隔离代码 |
| SEC-02 Consent 拒绝后不可执行 | **PASS（门禁级）** | AC10/AC18/AC19 生命周期与 E2E 门禁 |
| SEC-03 撤销后不可继续 | **PASS（门禁级）** | 同上 |
| SEC-04 刷新/重试无重复副作用 | **PENDING** | 幂等断言属 `17` 解锁后的端到端验证 |

## FIG（4 项）

| # | 判定 | 证据 |
|---|---|---|
| FIG-01 Figma 节点映射真实 | **BLOCKED_FIGMA_CONNECTOR** | `19`（不虚构 Node ID） |
| FIG-02 Tokens 不分叉 | **PASS** | `06` §2/§3：原型 21 色归一映射，代码唯一事实源 + contrast 门禁 |
| FIG-03 不引入第二套状态机 | **PASS** | `07` §3 裁决：状态徽章走服务端下发；stages.ts 不新建状态机 |
| FIG-04 13 屏组件优先复用 | **PASS** | `08` §5：Toast 零调用点、不新建 Table/Button 抽象 |

## PERF（4 项）

| # | 判定 | 证据 |
|---|---|---|
| PERF-01 条件可复现 | **PASS** | `20` §1 |
| PERF-02 冷暖分离 | **PASS** | `20` §2 |
| PERF-03 优化前后数据 | **PENDING** | 本轮仅测量归因（`20` §5），未实施优化 |
| PERF-04 无安全/功能回退 | **PENDING** | 同上 |

**性能现状：`PERF_TARGET_NOT_MET`**（`/login` 冷 6544ms / 暖 5472ms vs 目标 2500ms）。

## CI（8 项）

| # | 判定 | 证据 |
|---|---|---|
| CI-01 Typecheck / CI-02 Lint / CI-03 Build / CI-04 Jest / CI-05 Playwright | **PASS（`main` = `c3213fd`）** | 17 项 CI 0 失败（2026-10-23 复核仍为远端 main）；分支无完整 CI（如实说明） |
| CI-06 原有安全门禁 | **PASS** | 同上（tenant/consent/secret scan 含在 17 项内） |
| CI-07 证据矩阵可复跑 | **PASS** | 本轮新增 3 个可复跑脚本（审计/性能/原型），全部只测不判或增量落盘 |
| CI-08 main 与生产未被擅自修改 | **PASS** | `origin/main` = `c3213fd`（今日 fetch 复核）；生产 health 无 commit 字段 = 仍 `dc102cd` |

## 汇总

**PASS 17 · PENDING 5 · BLOCKED 3 · NOT_MET 1（PERF 目标）· 部分 PASS 4**

**关键 P0 未清零 ⇒ 本轮不标完成。** 三条主线遗留：① D-06 账号（解锁 UX-02/SEC-04/认证面证据）；② 性能优化实施（PERF-03/04）；③ Figma 连接器（FIG-01）。
