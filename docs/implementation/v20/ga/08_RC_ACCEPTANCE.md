# 08 · RC 验收与 GO / NO-GO（Batch 7）

- 日期：2026-11-10
- RC 分支：`release/v20.5-ga`（与 `main`、`rc/v20.5-ga` 同 SHA）
- 本地验收环境：`next build && next start -p 3111`，产品代码 = RC 头（b6/b7 仅脚本与文档，`git diff -- src prisma` = 0 行）

## 1. RC 电池（本地生产构建，2026-11-10）

| # | 验收 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | Jest 全量 | `npx jest --silent` | **exit 0**（全绿） |
| 2 | 组织/成员全生命周期 | `verify-t07-org-lifecycle` | **30 PASS / 0 FAIL / 0 SKIP** |
| 3 | 会话生命周期 S01–S24 | `verify:auth:session` | **22 PASS / 0 FAIL / 2 NOT_TESTED**（真实 Google 回调需真人授权，见 §3） |
| 4 | Outcome 核验阶梯 P01–P15 | `verify:outcome:verify` | **15 PASS / 0 FAIL** |
| 5 | 支付关闭 | `verify:payment:off --base=local` | **exit 0（18/18）** |
| 6 | OAuth 形状 + 三类坏回调 | `v204-oauth-shape`（本地/生产双跑） | **本地 20/20 · 生产 21/21** |
| 7 | 组织切换器 + 登出可达性 | `v205-a11y-org-switcher` | **5 PASS / 0 FAIL** |
| 8 | 13 屏 × 4 视口 × 2 主题 | `v204-visual-audit` | **104 PASS / N-A 0 / FAIL 0** |
| 9 | 13 屏 WCAG 2.2 AA（axe） | `v205-a11y-13screens` | **39 PASS / 0 FAIL** |
| 10 | tsc / lint 棘轮 | `tsc --noEmit` / `lint:gate` | **0 错误 / 零新增**（债务另降 5 处） |

电池原始日志：`evidence/2026-11-10_rc_battery.log`；axe/视觉复扫（含对比度修复后）：`evidence/2026-11-10_rc_a11y_visual_rerun.log`。

## 2. RC 期间发现并修复的两个真问题（不是"发现就放过"）

### 2.1 CI 红灯：已泄漏旧口令字面量复写在注释里（P0 级安全纪律）

- `1a54de3` 首次触发 CI 即红：确定性密钥门禁 G1 在 `scripts/ops/rotate-user-credential.mjs:6` 命中——B0 轮换脚本的**说明注释**里复写了旧管理员口令的完整字面量。
- 时间线诚实记录：该字面量自 `37ea993`（B0）就在仓库里，但 `3e27f3c` 推送时 CI 从未运行（无 push 事件），红灯埋了 3 天。
- 整改（`69eeae5`）：删除脚本注释字面量 + 文档两处脱敏；**不加 allowlist**；`check-secrets` 恢复 PASS，`git grep` 跟踪文件 0 条。
- `69eeae5` CI 全绿（tsc/lint/jest/build/migration/E2E/密钥扫描/依赖审计/DCO/SLO/租户门禁 + CodeQL）。

### 2.2 axe 39 格首跑 1 红：paper 主题三个信号色不达标（P1 级可访问性）

- `ws-agents-1440-paper` 实抓：`--lf-warning: #b8862f` 在浅底仅 **2.72–3.23:1**（「失败」徽章 + 降级横幅）；核查发现 `--lf-success`（3.39:1）`--lf-danger`（3.94:1）是同类潜伏雷。
- B2 时未暴露的原因：当时 QA 库尚无带「失败」徽章的运行与降级横幅——数据是 B3/B4 复验播种出来的。扫描口径没错，缺陷是真的。
- 修复：三个 paper 作用域统一换达标色（warning `#8a5f18` 4.73:1+ / success `#1f6b52` / danger `#a13a33`，与 Console paper 映射同源）。复扫 **39/39 + 104/104**。

## 3. GO / NO-GO 判定

| # | GO 条件（总作战令原文） | 证据 | 判定 |
| --- | --- | --- | --- |
| 1 | CI 绿 | `69eeae5` CI + CodeQL 全绿；最终 RC SHA 的 CI 在其推送后核验（Batch 8 前置） | **GO**（以最终 SHA 复核为准） |
| 2 | P0 = 0 | 旧口令字面量已清除（§2.1）；生产无已知 P0 | **GO** |
| 3 | 阻塞性 P1 = 0 | 对比度缺陷已修（§2.2）；TBT=**非阻塞 P1**（Before/After 同级、整改属结构性改造，06 §4.1 有完整论证） | **GO** |
| 4 | 管理员口令风险消除 | B0 轮换 5 账号 + tokenVersion 联推 + 字面量清除；旧 JWT 实测 401 | **GO** |
| 5 | 核心登录 | M03 生产实测 + S01–S18（22/0/2） | **GO** |
| 6 | 核心业务 E2E | 生命周期 30/30 · jest 全绿 · 切换器 5/5 · 视觉 104/104 | **GO** |
| 7 | Outcome 核验 | P01–P15（15/15，含四级反自证负例） | **GO** |
| 8 | Preview == RC SHA | 发布后用 Netlify `published_deploy.commit_ref` 核对（Batch 8 第 1 步） | 待发布时核 |
| 9 | 回滚点确认 | `3e27f3c`（线上现版，B0–B2 已上线；Netlify API 实核） | **GO** |
| 10 | 支付关闭 | M09（charging=false）+ payment-off 18/18 | **GO** |
| NO-GO 条件核查 | 无 P0 未处置、无阻塞 P1、无运行时切换、无未批准支付 | 均无 | **无 NO-GO 命中** |

**结论：GO** —— 唯一悬而未决的是最终 RC SHA（含本文件与两处修复）的 CI，推送后即刻核验；CI 绿后进入 Batch 8（生产发布，**需人工批准**）。

## 4. 已知未闭合项（不阻塞 GO，全部显式登记）

| 项 | 级别 | 说明 |
| --- | --- | --- |
| TBT ≤200ms 未达标 | P1（非阻塞） | 13 屏拆包+懒水合，下一版本首位待办（06 §4.1） |
| 真实 Google OAuth 成功回调 | NOT_TESTED | 需 `GOOGLE_CLIENT_SECRET` + 真人授权；凭据登录为主通道 |
| 支付 4 凭据 | 人工项 H-4 | GA 支付关闭，凭据由用户提供后另行开启 |
| D-01 退款口径 / D-02 定价展示 / D-03 法律主体 | 支付域休眠项 | 支付关闭期间不暴露 |
| D-09 历史形似凭据 | 已由 G1/G2 门禁看住新增 | 历史改写零收益（B0 决定） |
| H-3 举报去重 / H-5 草稿刷新恢复 | P2 | 下一版本 |
| Figma 技能 | `BLOCKED_FIGMA_WRITE` | 无 connector；未伪造任何文件 |
