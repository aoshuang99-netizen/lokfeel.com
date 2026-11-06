# 59 · V20.4 Production Release（Batch 7 正式发布）

> 结论：**本轮未发布生产。**

---

## 1. 为什么没发

Batch 7 的准入门槛是「RC GO + D-10 人工授权」。当前两条都未满足：

| 前置条件 | 状态 | 说明 |
|---|---|---|
| RC 判定为 GO | **NO-GO** | 见 `58`：LCP 未达标、Figma BLOCKED、Preview HTTP 不可验证、PR 无法创建、Environment 无审批保护 |
| D-10 人工授权 | **未取得** | 用户本轮指令是「执行 V20.4 攻坚」，未对**具体 SHA** 给出发布授权 |

V20.4 明确写着「不未经授权发布生产」。因此不发布是**遵守指令**，不是执行不力。

---

## 2. 生产现状（只读核实，零变更）

| 项 | 值 | 来源 |
|---|---|---|
| 生产 URL | `https://app.lokfeel.com` | 实测 200 |
| 承载方式 | Cloudflare 代理 → 回源 **Netlify** | `server: cloudflare` + `x-nf-request-id` |
| 当前生产版本 | `79459d6`（T-4 三屏视觉升级，2026-11-03 发布） | 前序发布记录 |
| 本轮是否变更 | **否** | 未执行 `opennextjs-cloudfront deploy` 到 `lokfeel-app`；未触发 Netlify 构建 |
| `lokfeel-app` worker | `modified_on = 2026-11-06T03:26:46Z`（未变） | Cloudflare API |
| 支付 | `configured=false` / `charging=false` | `/api/health` |
| 健康检查 | `status=healthy`，DB / Upstash / Firebase `configured=true` | `/api/health` |
| 登录 | 200 + 下发 `authjs.session-token` | 实测 |

**本轮生产零变更的证据链**：

1. RC 分支的 3 个提交全部带 `[skip netlify]`（Netlify 只看头提交，头提交即 `e5fa762`，带该标记）；
2. `cloudflare-production.yml` 是 `workflow_dispatch`-only，本轮未 dispatch；
3. 未在本地执行任何 `deploy` 命令；
4. Cloudflare API 显示 `lokfeel-app.modified_on` 保持 `03:26:46Z`。

---

## 3. 如果日后要发，需要补什么

按 V20.4 Batch 7 的 12 步，当前可执行与不可执行的分界：

| # | 步骤 | 现在能做吗 |
|---|---|---|
| 1 | 锁定 RC SHA | **能**（`e5fa762`） |
| 2 | 检查 Production Environment 审批 | **不能** —— `protection_rules=0`，没有审批可等 |
| 3 | 记录发布前版本与回滚目标 | **能**（回滚目标 = `79459d6`） |
| 4 | 通过受管工作流部署 | **不能** —— PAT 缺 `Workflows:Write`；等价直推可做但会绕过 Environment 语义 |
| 5 | 等 Cloudflare 部署 ready | 能（API 可查 `modified_on`） |
| 6 | 核对线上真实 commit | 能（`/api/health` 的 `version`/`commit` 字段） |
| 7–10 | smoke / 登录 Session / 核心页面 / 受控 E2E | 能（工具已就绪：`54`/`56` 的脚本可指向生产） |
| 11 | 检查错误率、延迟、关键日志 | **部分不能** —— 无 Workers Logs / Sentry 访问 |
| 12 | 形成发布报告 | 能 |

**必须先解决的两项**：

- **P1 · Environment 无审批保护**：`production` 环境 `protection_rules=0 / reviewers=0`。也就是说「发布必须人工批准」这条治理规则**在 GitHub 侧不成立**。需要配置 required reviewers，否则 D-10 只是口头约定。
- **P1 · 目标运行时未定**：发布到 Netlify（当前真实承载）还是 CF Workers（零绑定，`53`）？这两条路径的验收项完全不同。未定之前，任何「发布」都可能把业务跑在一个没有 DB 凭据的 worker 上。

---

## 4. 回滚方案（本轮未演练）

| 项 | 状态 |
|---|---|
| 回滚目标版本 | `79459d6`（当前生产） |
| 回滚方式 | Netlify：回滚到上一 deploy；CF Workers：`wrangler rollback` 到上一 version |
| 回滚演练 | **未执行**（属 Batch 5 项，见 `57`） |
| 演练缺失的影响 | 发布报告里不能声称「回滚已验证」 |

---

## 5. 发布判定

| 验收项 | 判定 |
|---|---|
| 线上 SHA = 获批 RC SHA | **未发生**（未发布） |
| 生产路由与 API 可用 | **PASS（针对现有版本）** |
| 关键业务功能正常 | **PASS（针对现有版本，见 `53` §4）** |
| 生产支付状态符合批准决策 | **PASS**（`configured=false` / `charging=false`） |
| 无新增 P0 | **PASS**（未变更即无新增） |
| 发布与回滚证据完整 | **N/A（未发布）** / 回滚演练 **未执行** |

**Batch 7 判定：NOT EXECUTED（遵守「未授权不发布」）。**
