# 12 · LokFeel V20.5 GA · 最终发布报告

- 报告时间：2026-11-10
- 生产：`https://app.lokfeel.com`（Cloudflare Proxy → Netlify 源）
- 发布 SHA：**`0aa24f3`**（树 == RC `fd02892`），tag `v20.5.0-ga`
- Netlify deploy：`6af2c1cb7b87b5`（production · ready · 2026-11-10T07:03:39Z）
- 回滚点：**`3e27f3c`**（Netlify `6aef0c3e303b82`，production · ready）
- 发布批准：用户于 2026-11-10 明确批准（本会话）

---

## 一、执行总览（Batch 0–8）

| Batch | 内容 | 状态 | 关键证据 |
| --- | --- | --- | --- |
| 0 | 事实基线 + 安全应急 | **PASS**（1 项 `NOT_TESTED`：历史登录回溯，系统此前未记登录） | `01_SECURITY_CREDENTIAL_RECOVERY.md`；5 账号轮换 + `tokenVersion` 联推；旧 cookie 实测 401 |
| 1 | 组织/成员/权限收口 + D-12 回归 | **PASS** | 30 断言 0 FAIL；`jest tests/tenancy tests/auth` 282/282；D-12 生产 8/8 |
| 2 | 13 屏 × 4 视口 × 2 主题 + WCAG 2.2 AA | **PASS**（Figma 部分 `BLOCKED_FIGMA_WRITE`） | 视觉 104/104（THEME_NA=0）· axe 39/39 |
| 3 | 登出 / 组织切换 / 会话生命周期 | **PASS**（真实 OAuth 回调 `NOT_TESTED`） | `verify:auth:session` 22/0/2；OAuth 形状生产 21/21 |
| 4 | Agent → Consent → Action → Outcome | **PASS**（完整 HTTP 链 v198 `NOT_TESTED`） | 核验阶梯 15/15（含四条反自证负例）；`jest tests/agents` 231/231 |
| 5 | 性能预算 Before/After | **PASS**（TBT 项 **FAIL** = P1 已登记） | LCP/CLS/INP 达标；console TTFB −50%；阈值未改 |
| 6 | 监控 + 发布治理 + Workers 轨道 | **PASS** | 十项信号生产 11/11；G06 流量仍在 Netlify 源 |
| 7 | RC 验收 + GO/NO-GO | **GO 10/10** | 电池 10 项全绿；CI×2 + CodeQL + Preview 全绿 |
| 8 | 生产发布 + 15 步验证 | **PASS** | 本文 §三；`10_POST_RELEASE_VERIFICATION.md` |

---

## 二、本周期修复的真缺陷（不是"测试通过"的装饰）

1. **`errorResponse` 丢 `details`** —— 403/404 的语义码全部退化成"没有权限"，用户被引向错误动作（找管理员，而正确动作是换账号）。B1。
2. **slug 冲突返 500** —— libSQL 下唯一约束冲突**不是 P2002**，用户以为系统坏了反复重试。B1。
3. **过期邀请从未落库** —— 事务内 UPDATE 后 throw 导致整笔回滚，"过期"状态永远停在 PENDING。B1。
4. **移出成员 500 `TRANSACTION_CLOSED`** —— Prisma 默认 5s vs Turso 3.5s 往返；网络一慢，移出/改角色整片失败。B1（`TENANT_TX` 统一预算）。
5. **产品没有登出** —— 全仓 0 条登出入口；Auth.js 自带 signout 在本仓 302 到 MissingCSRF 且**不下发任何 set-cookie**（探测脚本实证）。B3 新增 `/api/auth/logout`。
6. **多社群用户看不到第二个社群** —— `listTenants()` 注释写着"租户切换器用"，但切换器从未被写出来。B3 新增软偏好 + API + UI。
7. **paper 主题三个信号色不达标** —— warning 2.72:1（「失败」徽章实抓）、success 3.39:1、danger 3.94:1。B7 全部换达标色，复扫 39/39。
8. **已泄漏旧口令字面量复写在脚本注释里** —— B0 轮换脚本把旧口令写回注释，CI 首次运行即红（且红灯被埋 3 天，因为当时的推送没触发 CI）。B7 删除 + 文档脱敏，不加 allowlist。

---

## 三、发布后 15 步验证：15/15 PASS

详见 `10_POST_RELEASE_VERIFICATION.md`。摘要：

- 部署身份 `0aa24f3` == Netlify 权威 `commit_ref`；`builtAt 07:04:08Z`；health `healthy`
- `prod-smoke` **15/15**（缓存头、未登录 307、核心 API 无 500、支付未配置结账被拒）
- 十项监控 **11/11**（含 M10 漂移核对、M05 生产出口 PASS 894ms）
- `verify-payment-off` 生产 **18/18**；D-12 **8/8**；OAuth 形状 **21/21**；漂移 **0**
- 新颜色随 CSS 产物发布（`#8a5f18` 在生产构建里，不只是仓库里）
- 回滚点 `3e27f3c` ready；tag `v20.5.0-ga` 已推

---

## 四、诚实边界（未能证明的事，明确列出）

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实 Google OAuth 成功回调（code 交换） | `NOT_TESTED` | 缺 `GOOGLE_CLIENT_SECRET`；需真人浏览器授权 |
| 历史异常登录回溯 | `NOT_TESTED` | 系统此前**从未**记录登录（AuditLog/AdminAudit 均 0 行），B0 才补 `login-audit` |
| FedCM / 第三方 cookie 限制下的跨站会话 | `NOT_TESTED` | 未在真实 Safari/Chrome 第三方 cookie 限制环境验证 |
| Figma 设计文件 | `BLOCKED_FIGMA_WRITE` | 无 connector；未伪造任何产物 |
| AC-25 真实扣款 | `NOT_TESTED` | 支付凭据未配（人工项 H-4），GA 刻意关闭支付 |
| v198 完整 HTTP 链 A01–A12 | `NOT_TESTED` | 按设计拒绝远程库，需本地 file 库 + dev + stub provider 三段前置；逻辑层由 `jest tests/agents` 231/231 覆盖，两者不互相代证 |
| TBT ≤200ms | **FAIL** | P1 非阻塞，整改路径见 `11_KNOWN_ISSUES_AND_BACKLOG.md` PERF-1 |

---

## 五、量化事实（本周期第一次测得并写下来的）

| 事实 | 数值 | 出处 |
| --- | --- | --- |
| 撤销可见延迟（tokenVersion+1 → 401） | 61.4s；上界 90s = 60s 缓存 + 0–30s 抖动 | B3 S08 |
| 还原 tokenVersion 的后果 | 旧 JWT 在缓存换版后**复效** ⇒ 撤销只能单调递增 | B3 S09 |
| 权限变更生效延迟 | **0s**（角色不在 JWT 里） | B3 S14/S15 |
| `/console` 服务端往返 | 串行 3330ms → 并行 1667ms（本地）；生产全量 415–1295ms | B5 |
| 生产 `/console` TTFB | 1.05–1.43s（含跨境 RTT ~250ms） | B5 |
| 生产 dbLatency（热） | 5–6ms | B6 M08 |
| 移动端 TBT | 574–2549ms（4× CPU，全页超预算） | B5 |

---

## 六、发布治理（已生效）

1. 单一发布通道：main 推送 → Netlify；非发布推送带 `[skip netlify]`（本周期 6 次非发布推送全部生效，生产未误动）。
2. 推送结果只认 `git ls-remote`（本周期两次 SSH 推送均以 ls-remote 复核）。
3. 生产基线以 Netlify `published_deploy.commit_ref` 为唯一权威（B6 据此修正"线上是 bc46a22"的错误记录）。
4. CI 首次真正跑在 B0–B2 的代码上就抓到安全门禁红灯 —— 证明"CI 绿"作为 GO 条件不是形式。

---

## 七、下一步（用户决策项）

1. 按 `11_KNOWN_ISSUES_AND_BACKLOG.md` §五 完成 4 项安全人工项。
2. 决定是否开启支付（需 4 凭据 + D-01/D-02/D-03 定稿 + AC-25 真实扣款）。
3. V20.6 首位：TBT 拆包/懒水合。
