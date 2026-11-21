# UX-04 + CI 红灯真修 · 状态页（2026-11-21）

> 唯一状态页。证据类型分级：`LOCAL_REAL_BROWSER`（本地真实浏览器/真 DB）· `CI_CONFIRMED`（远端 CI）· `BLOCKED`（环境/授权限制）。
> 纪律：不用"文件数/测试数/工作流成功"冒充产品交付；不刷基线、不改断言、不登记未审豁免换绿。

## 候选锚点（git ls-remote 权威）

| 项 | 值 |
|---|---|
| UI 源码候选 | `becaa47f2cf4180bcf8827256eac7767c46f98de` |
| 前一候选 | `b796e8d8266ff1acfe487b3c73db817f826ea886` |
| 远端 `ui-remediation/20261121` | `becaa47`（本轮推送） |
| 远端 `rc/ui-remediation-20261121` | `becaa47`（本轮推送，触发 CI/Preview） |
| 生产 main | `cad717e92542395e4346e49d388f09be78ec1557`（**未变，未部署**） |
| CI Run | `44886998433`（候选 `becaa47`） |
| Preview Run | `44886998449`（候选 `becaa47`） |

## 一、UX-04 移动端邀请不可达 —— 真修（LOCAL_REAL_BROWSER）

**根因（systematic-debugging Phase 1 实证）**：`src/app/(dashboard)/dashboard/chats/layout.tsx` 把右侧 `children` 设为 `hidden md:flex`。带 Invite 按钮的空态正是 `children`，手机端整棵子树 `display:none`，按钮不在可见 DOM。旧录屏脚本用 `click({force:true})` 强点隐藏节点 = 假绿。

**TDD 证据**：
- RED：320/390 视口 `getByRole('button',{name:/Invite someone you know/})` → `count:0, visible:false`。
- GREEN：把真实 Invite 入口放进**所有视口可见**的左侧列表面板 Header（44px 触控、`aria-label` 明确），打开同一 `InvitePanel`（服务端 `/api/invites` 生成真实邀请码）。重跑 → 两视口 `count:1, visible:true`、无 force 点击成功、面板出现真实邀请码 `7252VB`。
- 回归固化：`tests/e2e-ci/legacy-mobile.spec.ts` 新增 2 条（320×720 / 390×844），真实 Chrome 跑 **2 passed**。
- 可视证据：`after-ux04/chats-{320,390}-{closed,invite-open}.png`，320px 截图已人工核验（面板完整、邀请码清晰、无溢出）。

**诚实边界**：`/api/invites` 的 6 位码是**内存 Map**（源码注释 `until DB schema is updated`），注册页 `?ref=` 不消费它。因此"第二账号凭此码接受"在**当前产品契约里不存在**，不做假证据。真实组织邀请是 `/api/v1/invitations/*`（DB+token+accept），其闭环由 `tests/tenancy/invitations.test.ts` 28 项真实单测覆盖（含 token 消费、防转发、建成员、审计），本地全过。

## 二、CI 四项红灯 —— 逐项真修

| 门禁 | 原失败 | 真修 | 本地证据 | 远端 CI |
|---|---|---|---|---|
| Dependency audit | effect/prisma/@prisma/config 三个 high（CVE 时间漂移） | `overrides.effect 3.20.0 → 3.22.5`（`<=3.22.0` 受影响，3.22.5 已修复）；无豁免 | `npm audit --omit=dev` high **3→0**；`dependency-ratchet --full` **PASS**；lock 一致性 dry-run OK | 待 `44886998433` |
| E2E（Workspace 闭环探针） | 探针用过时文案 `/编译工作区/`、`/Studio/` h1、`/cm.../` 宽正则，假红 | 对齐真实 UI：`[data-testid=intent-submit]`、`section[aria-label="Living Canvas"]`、新增 `[data-testid=created-mission-id]` 精确取 id；补 SocialIntent/Mission 正确清理表名 | `v198-workspace-loop` 从 exit1 → **12 PASS / 0 FAIL**；UI 创建的 id 与 DB 落库 id 一致（消除假成功误判） | 待 `44886998433` |
| Lint ratchet | 6 处新增债（set-state-in-effect×4、fatal disable×2、any×1） | 逐条真修：set-state-in-effect 改渲染期同步（React 官方 props 变更模式）+ 微任务边界；删多余 eslint-disable；any→真实 Prisma delegate 类型 | `lint-ratchet --report` 从 +7 → **零新增（债务下降 1、清零存量）** | 待 `44886998433` |
| Migration drift | 4 条真实 V25.6 迁移未登记（`sourceRunId`/`actorId`/Mission/IdempotencyRecord） | **未擅自刷基线**。这些是 `20261115120000_v21_batch2_execution_loop` 等真实迁移。登记属棘轮正规路径，但分诊列为需 Owner/Release 批准 | 本地按 CI 步骤建库后 drift 门禁 PASS（环境敏感）；CI 上报 4 条 | **保持 RED（需 Owner 批准登记）** |

补充：`ai-assist-route.test.ts` any→类型、`register/page.tsx` 4 个未使用导入清理，属顺带真修（ratchet 债务下降）。

验证（本地，候选 `becaa47` 全量改动后）：`tsc --noEmit` 0 错误、`next build` exit 0、Jest 41 项（invitations+ai-assist）与 workflow-api 19 项 PASS、Workspace 12/12、UX-04 14/14。

## 二·补：远端 CI 第一轮（44886998433）结果与第二轮修复

第一轮远端 CI（`becaa47`）逐 job 结论：
- ✅ **Dependency audit 转绿**（effect override 生效，生产 high=0）——真修确认。
- ✅ Build / Typecheck (tsc) / Jest / Secret scan / 租户审计 / 支付凭据 / cron / Perf SLO 全绿。
- 🔴 Migration：4 条真实迁移未登记（预期，保持，需 Owner 批准）。
- 🔴 Lint：`(fatal) 0→1` —— 定位到 `tests/agents/v21-batch3-approval-separation.test.ts:13` 的 `eslint-disable no-explicit-any` 已成多余指令（unused disable 被判 fatal）。**第二轮真修**：删除该多余 disable，单文件 lint 0 违规，全量 ratchet **零新增（下降 7、清零 42）**。
- 🔴 E2E 浏览器冒烟：6 个失败 = 连接页空态×2 + 聊天空态×2 + race×2。根因：前 4 个是**测试契约过时**（V25.6 已把连接页改为真实入口，旧断言 `No likes yet` 文案已移除；`No conversations yet` 因 layout 改动出现 2 个同名节点触发 strict mode）。**第二轮真修**：断言对齐真实产品（连接页入口文案 + `>> visible=true` 取可见节点），本地 4/4 PASS；race×2 本地连续 4 轮 PASS（CI 时序偶发，非代码缺陷，未改断言）。

> 诚实边界：race 用例在 CI 环境偶发超时（`旧 A 的方案` 未被 B 覆盖），本地 4 轮全绿。未放宽断言、未加重试规避；如 CI 复验仍红，需单独调查 CI 时序，不宣称通过。

## 二·再补：远端 CI 第二轮（44888177078 · 候选 `7b03a84`）结果

| job | 结论 | 说明 |
|---|---|---|
| Lint | ✅ success | 第一轮 fatal（unused disable）真修生效 |
| Dependency audit | ✅ success | effect override 生效，生产 high=0 |
| Build / Typecheck / Jest / Secret scan / 租户审计 / 支付凭据 / cron / Perf SLO | ✅ success | 全绿 |
| Migration | 🔴 failure | 4 条真实迁移未登记，按设计保持，需 Owner 批准登记 |
| E2E 浏览器冒烟 | 🔴 failure（2 条） | 从第一轮 6 条降到 2 条；连接页/聊天空态 4 条真修转绿 |

**E2E 剩余 2 条（诚实标注，不冒充通过）**：
- 用例：`workspace-now-race.spec.ts`「先输 A 再输 B：A 的响应晚到也不能覆盖 B」。
- 现象：CI 稳定失败（屏幕停在"旧 A 的方案"），本地真实 Chrome 连续 4 轮全 PASS。
- 根因定性：测试用 `el.dispatchEvent(MouseEvent)` 强行绕过 disabled 制造并发，CI 的 React 19 水合时序下合成事件捕获不可靠，B 请求可能未真正发出；**产品过期守卫逻辑正确**（`intent-race.ts` token 机制 + 本地 4 轮证明）。曾尝试改用 Playwright `dispatchEvent` 手法，本地反而不稳定，已回退（systematic-debugging：手法试验失败即回退，不改断言骗绿）。
- 处置：这是**存量 CI 环境特定失败**（第一轮的 Workspace 探针失败把它遮住了，从未跑到），非本轮引入。需单独调查 CI 时序 / 改成确定性单测，**不在本轮宣称通过**。

**Preview**：Cloudflare Preview Run `44888176984` = completed/success（部署 job），但 `https://lokfeel-preview.aoshuang99.workers.dev` 从本环境 DNS 可解析（104.244.46.93）却 TCP 45s 超时——出网被阻断。**运行时未验证，保持 BLOCKED**，不用 job success 冒充页面可用。

## 三、API 业务闭环（真实 HTTP + DB 回读，≥6 动作）

| # | 动作 | 证据 | 结果 |
|---|---|---|---|
| 1 | 创建 Mission | W-00/W-08：POST→201 真实 id，DB `Mission` 表回读到同 id | PASS |
| 2 | Intent 提交错误恢复 | W-04：400（need<4）→ 合法提交 201 | PASS |
| 3 | 刷新恢复 | W-09：reload→GET /api/v1/missions 含 UI 创建 id | PASS |
| 4 | 邀请码生成 | UX-04：点击→/api/invites 200→真实 6 位码 | PASS |
| 5 | Workflow Takeover | `workflow-api.test.ts`：POST→200，状态转 TAKEN_OVER | PASS |
| 6 | Workflow Requeue | `workflow-api.test.ts`：POST→200，重新入队；终态 409 | PASS |
| 7 | 跨租户/未授权负例 | invitations 28 项 + workflow 19 项：EMAIL_MISMATCH 403、跨租户 0 成功 | PASS |

## 四、诚实边界 / BLOCKED

- **Preview 运行时**：`https://lokfeel-preview.aoshuang99.workers.dev` 从本环境两次 30s 连接超时（出网限制）。部署 job 成功 ≠ 页面可用。**未升级为 PREVIEW_VERIFIED**，需在有权限环境用独立浏览器复核 8 路由/登录/API/部署 SHA。
- **Migration drift**：4 条真实迁移需 Owner 批准登记，**不擅自刷基线**。
- **生产部署**：main `cad717e` 未变、未部署、未迁移。需 Owner 对精确 SHA `becaa47` 批准 + 人类 Reviewer + Preview 运行时验收。
- **第二账号邀请接受**：`?ref=` 码无消费闭环（产品事实），未伪造；真实 v1 邀请闭环有单测证据。
- **完整 legacy-mobile spec**：本地全量跑被沙箱 OOM（exit137）中断；UX-04 两条单独 PASS，其余为存量版面用例未改动。CI 全量在 `44886998433` 跑。
