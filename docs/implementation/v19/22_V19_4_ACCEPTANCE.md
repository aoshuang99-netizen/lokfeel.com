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
| PERF-03 优化前后数据 | **PASS（载荷级）** | 优化 #1 已实施 + 同会话前后对照（`20` §7.4）：preview 实测 `/login` JS **244KB/13req → 201KB/11req**（−37KB = framer-motion 移除）；LCP 跨环境对照因 GFW 干扰不具判定力，口径已实证落档 |
| PERF-04 无安全/功能回退 | **PASS** | CI 19 success / 0 失败（HEAD `44e49c5`）；preview `/login`、`/api/health` 200；E2E 全绿作为行为不变证据 |

**性能现状：`PERF_TARGET_NOT_MET` 维持**（冷态 LCP 未达 2500ms）。剩余主因：
cloudflareinsights 注入（面板操作，`20` §7.5）+ `/login` 剩余 201KB 客户端 JS +
`/pricing` 192KB（main 自带新页，非本分支引入，另立项审计）。

## CI（8 项）

| # | 判定 | 证据 |
|---|---|---|
| CI-01 Typecheck / CI-02 Lint / CI-03 Build / CI-04 Jest / CI-05 Playwright | **PASS（PR #32 分支 CI 全绿）** | HEAD `44e49c5`：**19 success / 1 skipped（手动档）/ 0 失败**（2026-10-26 实测 check-runs；DCO/依赖棘轮/lint 棘轮三红已修转绿） |
| CI-06 原有安全门禁 | **PASS** | tenant/consent/secret scan 均在上述 19 success 内 |
| CI-07 证据矩阵可复跑 | **PASS** | 本轮新增 3 个可复跑脚本（审计/性能/原型），全部只测不判或增量落盘 |
| CI-08 main 与生产未被擅自修改 | **PASS** | `origin/main` = `c3213fd`（2026-10-26 `ls-remote` 复核）；生产仍 `dc102cd`。工程仅开启 Netlify Deploy Previews 设置（`skip_prs` false，不影响生产构建），未触碰生产部署 |

## 汇总

**PASS 19 · PENDING 3 · BLOCKED 3 · NOT_MET 1（PERF 目标）· 部分 PASS 4**

**关键 P0 未清零 ⇒ 本轮不标完成。** 三条主线遗留：① D-06 账号（解锁 UX-02/SEC-04/认证面证据）；② 性能冷态 LCP 仍超标（PERF 目标 NOT_MET，载荷优化已实证）；③ Figma 连接器（FIG-01）。
