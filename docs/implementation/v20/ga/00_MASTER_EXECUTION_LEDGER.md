# 00 · V20.5 GA 主执行台账

> 这份台账**只记结论与证据指针**，不复述过程。每一行的"状态"必须是四个词之一：
> `PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`。
> 没有证据的 `PASS` 一律视为 `NOT_TESTED` —— 本文件的存在意义就是不允许"看起来做完了"。

- 分支：`main`（RC 分支 `rc/v20.5-ga`，发布分支 `release/v20.5-ga` 见 Batch 7）
- 线上当前：`bc46a22`（Netlify deploy `6aeeb9cd`，2026-11-07T05:40:29Z）
- 台账最后更新：2026-11-07 · 基线 `3e27f3c` + Batch 3 本轮改动（提交见 `git log --grep=v20.5-b3`）

---

## 一、批次总览

| Batch | 内容 | 状态 | 证据 |
| --- | --- | --- | --- |
| 0 | 事实基线 + 安全应急（明文管理员口令） | **PASS**（1 项 `NOT_TESTED`） | `01_SECURITY_CREDENTIAL_RECOVERY.md` |
| 1 | 组织 / 成员 / 权限收口 + D-12 回归 | **PASS**（本地生产构建；线上路径待发布后重跑） | `02_ORG_MEMBER_LIFECYCLE.md` |
| 2 | 世界级 UI/UX（13 屏 × 4 视口 × 2 主题） | **PASS**（视觉 104/104、axe 39/39；Figma 部分 `BLOCKED_FIGMA_WRITE`） | `03_UI_UX_13SCREENS.md` |
| 3 | 真实 OAuth 回调 / 会话续期 / 登出 / 切租户 | **PASS**（22 PASS / 0 FAIL / 2 `NOT_TESTED`） | `04_AUTH_SESSION_LIFECYCLE.md` |
| 4 | Agent → Consent → Action → Outcome（含 Verify 正例） | `NOT_TESTED` | 待执行 |
| 5 | 性能预算（LCP/CLS/TBT/INP，Before/After） | `NOT_TESTED` | 待执行 |
| 6 | 监控 + 发布治理 + Workers 独立轨道 | `NOT_TESTED` | 待执行 |
| 7 | RC 验收 + GO/NO-GO 门 | `NOT_TESTED` | 待执行 |
| 8 | 单次生产发布 + 15 步验证 + 最终报告 | `NOT_TESTED` | 待执行 |

---

## 二、Batch 0 · 事实基线 + 安全应急

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 0.1 明文管理员口令在生产可用 | **确认（已是后门，不是"潜在风险"）** | 泄漏口令登录生产返回 `200` + `role: SUPER_ADMIN`；仓库 `private=false` |
| 0.1 轮换 5 个账号 | **PASS** | `admin@`(SUPER_ADMIN) + `test.male`/`test.female`/`test.new`/`e2e-test`(USER)；凭据存 `.qa-credentials.local.json`（gitignored） |
| 0.1 旧 JWT 撤销 | **PASS** | 口令轮换与 `tokenVersion+1` 在**同一条 UPDATE**；复验 4/4：泄漏口令→401、新口令→200、**轮换前 cookie→401**、新会话→200 |
| 0.1 历史提交清理 | **决定不改写** | 公开仓库可能已被 clone/fork/镜像/索引；改写只对"本仓库"隐藏，收益为零，且凭据已失效 |
| 0.2 零依赖密钥门禁 | **PASS** | `scripts/check-secrets.mjs` 自测 9/9（含 5 个负向对照）；G1 已知泄漏字面量 + G2 `process.env.X \|\| '字面量'` |
| 0.3 登录审计能力 | **PASS** | 新增 `src/lib/auth/login-audit.ts`，接入 4 个判定点；`AuditLog`/`AdminAudit` 此前均为 **0 行** —— 系统从未记录过登录 |
| 0.4 历史异常登录回溯 | **NOT_TESTED** | 无留存的服务端日志 ⇒ 既不能证明也不能否证。不写成 PASS |
| 0.5 PingPong / 支付开关 | **PASS（保持关闭）** | 生产 env 44 键中 `PINGPONG_API_KEY`、`PINGPONG_WEBHOOK_SECRET` 均缺失 ⇒ 支付不可用；`verify-payment-off` 见 Batch 7 |

---

## 三、Batch 1 · 组织 / 成员 / 权限收口

- 证据 SHA：`36053fe`
- 复验命令：`node scripts/qa/verify-t07-org-lifecycle.mjs --base=<BASE>`
- 结果：**30 PASS / 0 FAIL / 0 SKIP**（生产构建 + 生产 Turso 库）

| 验收 | 结论 | 关键证据 |
| --- | --- | --- |
| 1.1 新建组织 100% 有有效管理员 | **PASS** | org+OWNER 同事务；`C03 memberships=1 activeOwner=1`；重试 `409 SLUG_TAKEN orgs=1 memberships=1` |
| 1.2 邀请全流程 | **PASS** | I01–I07、A01–A07 共 14 条；token 只存 sha256；换票；邮箱绑定；单次消费；过期落库；撤销终态 |
| 1.3 成员移出 | **PASS** | R01–R08；软移出（行留、状态 SUSPENDED、角色保留）；下一次请求即 403；跨租户 404；`reactivated=true` 且行数不变 |
| 1.4 D-12 回归（不重复开发） | **PASS** | `verify-member-role-prod` 8/8；`org-admin-invariant` 全部组织 ≥1 管理员 |
| 单元测试 | **PASS** | `jest tests/tenancy tests/auth` 275/275；`tests/api` 9/9（含负向对照 3 红） |
| 构建 | **PASS** | `next build` exit 0；`/api/v1/organizations`、`/api/v1/invitations{,/accept,/[invitationId]}`、`/invitations/accept` 均在产物中 |
| lint 棘轮 | **PASS** | `npm run lint:gate` exit 0，零新增 |
| 线上 HTTP 路径 | **NOT_TESTED** | 线上仍是 `bc46a22`，新路由未发布。Batch 8 发布后必须重跑 |

### Batch 1 修复的真缺陷（4 个，均在单测里是绿的）

| # | 缺陷 | 用户可感知后果 |
| --- | --- | --- |
| 1 | `errorResponse` 对 403/404 丢弃 `details` | 拒绝原因退化成"没有权限"，用户去找管理员而正确动作是换账号 |
| 2 | slug 冲突返回 500 | 用户看到"服务器错误"并反复重试，而正确动作是换标识 |
| 3 | 过期邀请从未落库 | 同一过期链接被无限次重试，"有人试过"这件事没有任何记录 |
| 4 | 移出成员 500（`TRANSACTION_CLOSED`） | 网络稍慢时移出/改角色整片失败 |

---

## 三·二、Batch 2 · 13 屏视觉与无障碍

- 视觉审计：`node scripts/qa/v204-visual-audit.mjs` → **104 PASS / 0 FAIL，主题 PASS 104 / N/A 0**
- 无障碍审计：`node scripts/qa/v205-a11y-13screens.mjs` → **39 PASS / 0 FAIL / 0 NOT_TESTED**，serious 以上归零
- Before → After：`THEME_NA 56 → 0`；`a11y 28/39 → 39/39`

| 缺陷 | 用户可感知后果 |
| --- | --- |
| Console 七屏不参与双主题 | 产品一半能切深色/纸面，另一半连切换入口都没有 |
| Inspector 标题浅字压白底 1.13:1 | 1440 宽屏下"详情"两个字几乎不可见 |
| 纸面信号色 4.28:1 | 11px 状态标签在纸面主题下不可读 |
| 成员屏角色徽章深灰压深灰 | ADMIN 徽章字看不清（本轮新写 UI 引入） |
| agents 表格不可聚焦 | 键盘用户永远滚不到右侧成本/活跃列 |
| `BLOCKED_FIGMA_WRITE` | 环境无 Figma 连接器，设计文件交付阻塞（不伪造） |

---

## 三·三、Batch 3 · 会话生命周期与授权边界

- 复验命令：`node scripts/qa/v205-auth-session.mjs --base=<BASE>`（`npm run verify:auth:session`）
- 结果：**22 PASS / 0 FAIL / 0 SKIP / 2 `NOT_TESTED`**，exit=0
- 原始日志：`evidence/2026-11-07_auth-session_local.log`

| 验收 | 结论 | 关键证据 |
| --- | --- | --- |
| 会话基线（cookie 属性 / 有效期内 / 与库一致） | **PASS** | S01–S05；`HttpOnly=true SameSite=lax`、`Max-Age=604800` |
| 会话续期（滑动） | `NOT_TESTED` | S06；需跨 `updateAge` 窗口，不伪造时间 |
| 撤销（tokenVersion） | **PASS** | S08 **失效延迟 61.4s**；上界 90s = 60s TTL + 0–30s 抖动 |
| 撤销后还原 | **PASS** | S09 DB 已还原，旧 JWT 在 94.5s 后重新被接受（**降版本号会让旧凭据复效**） |
| 登出 | **PASS** | S10–S12：清了 2 个 `session-token` cookie（含 `__Secure-` 变体）；清后 jar → 401；重放旧 jar → 200（无状态边界） |
| 组织切换 | **PASS** | S13–S18 + UI 端到端：`preview → default` 头部真的变了；非成员 → 403 且不写 cookie；非法形状 → 400 |
| 权限变更即时生效 | **PASS** | S19/S20：OPERATOR(19) → MEMBER(9)，失去 10 项运营能力、**新增 0 项**；还原后集合相等 |
| CSRF（登录 / 登出） | **PASS** | S21–S23：跨源与缺头均 403；登出跨源不下发清 cookie |
| OAuth 成功回调 | `NOT_TESTED` | S24；需 `GOOGLE_CLIENT_SECRET` + 真人 |
| OAuth 授权形状（state / PKCE / redirect_uri） | **PASS** | `v204-oauth-shape.mjs` 对生产 **21/21**；坏回调 3 类全部拒绝且不建会话 |

### Batch 3 补上的两个缺失能力（不是"测试没覆盖"，是"用户点不到"）

| # | 缺口 | 用户可感知后果 | 修法 |
| --- | --- | --- | --- |
| 1 | 产品**没有登出**（全仓 0 条 `signOut\|登出\|退出登录`；Auth.js 自带端点实测 `302 → MissingCSRF` 且不清 cookie） | 共享设备换人只能清浏览器数据 | 新增 `POST /api/auth/logout`（同源校验 + 两个 cookie 名都清）+ 两套骨架各一个入口 |
| 2 | 多社群用户**看不到第二个社群**（布局永远取"最早加入"的那个） | 第二/第三个社群在 UI 上不存在 | `lf-active-org` 软偏好 cookie + `POST /api/v1/organizations/active` + Console 切换器 |

### 判据写错的三处（留档，防止下次再用"放宽断言"收场）

| 原断言 | 实测 | 真因 | 改成 |
| --- | --- | --- | --- |
| 还原 tokenVersion 后**立即** 200 | 401 | 60s 用户缓存 + 该账号无 ACTIVE 租户（`/api/v1/org` 恒 403） | 换 `/api/v1/organizations` 探针，判据改"401 → 非 401" |
| `POST /api/auth/signout` 会清 cookie | `302 清cookie=false` | 302 跳的是 `/login?error=MissingCSRF`（假绿） | 测新端点 + 清后 jar → 401 |
| 降级后失去 `member.invite` | `含invite=false` | `qa.female` 是 OPERATOR，**本来就没有**该能力 | 算实际差集 + 断言"新增为空" |

---

## 四、待办清单（按阻塞关系排序）

1. **Batch 4 → 5**：无前置阻塞，可并行推进。（Batch 2 已完成：Figma 写权限判定为 `BLOCKED_FIGMA_WRITE`，前端工作照常推进，未因缺 Figma 停摆；Batch 3 已完成。）
2. **Batch 6**：需要决定监控落地形态（自建 probe / 外部 uptime），并写清 "5xx / p50 / p95 / 登录成功率 / Agent 成功率 / Provider 降级 / Consent 异常 / Outcome 核验失败 / DB 错误 / Secrets 缺失 / 部署漂移" 各自的口径与阈值。
3. **Batch 7**：GO 需要 Batch 0–6 全绿且 P0=0；`admin 口令风险已消除` 已有证据。
4. **Batch 8**：发布是**唯一需要人工批准**的动作；发布后必须对 `https://app.lokfeel.com` 重跑
   `verify-t07-org-lifecycle`、`verify-member-role-prod`、`prod-smoke`、`verify-public-origin`、`verify-payment-off`。

### 需要人（不是 AI）做的事

| # | 事项 | 为什么必须人来 |
| --- | --- | --- |
| H-1 | 确认泄漏口令是否在 LokFeel 之外被复用（邮箱/其他站点） | 只有本人知道他还在哪些地方用过同一口令 |
| H-2 | 开启 GitHub Secret Scanning + Push Protection | 仓库设置项，需要账号权限 |
| H-3 | 把新的管理员口令写入 GitHub Secrets（供 CI 用） | 凭据分发不能经过对话 |
| H-4 | 支付/退款相关凭据（CREEM / STRIPE × API_KEY / WEBHOOK_SECRET） | 涉及真实扣款，属高风险操作，未获授权 |
