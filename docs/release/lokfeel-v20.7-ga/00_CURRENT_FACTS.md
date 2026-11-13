# 00 · 当前事实（single source of truth）

> 快照时间：**2026-11-13 13:5x GMT+8** · 采集者：WorkBuddy（只读）
> 规则：本页只写**从真实系统取到**的值。历史文档的时点数据原样保留在各自文件里，不覆盖。
> 任何 `PASS_CODE_ONLY` / `PARTIAL` / `BLOCKED` / `NOT_TESTED` 都不计入"通过"。

## 1. 三件事必须分开看

| 事项 | 状态 | 依据 |
|---|---|---|
| **A. 生产支付止损（Hotfix）** | ✅ **`PRODUCTION_RISK_CLOSED`** | `evidence/s04-post-deploy-verify.json`（5 blob 与 `c97c893` 全等 + live HTTP 判据） |
| **B. 支付全链路（Provider→账本→权益）** | ❌ **`NOT_TESTED` / `NO_SAMPLE`** | 全库 `BillingEvent=0`、`CHARGE_*=0`；无 test_mode 凭据，未发生真实投递 |
| **C. V20.7 GA 发布** | ❌ **`NO_GO`** | 远端 CI 仍有 `/pricing` 失败；G3/G5/G7/G10 与 D1/D3/D8 未闭合 |

**A 已达成，不能被重新写成 RISK_OPEN；A 也不等于 C。**

## 2. 生产（`https://app.lokfeel.com`）

| 项 | 值 | 采集方式 |
|---|---|---|
| `health.commit` | **`0e16959`** · `builtAt=2026-11-12T12:29:15.741Z` | `GET /api/health` |
| `/api/payments/dodo/plans` | `checkoutReady=false` · `commercialApproval={PENDING_APPROVAL, ref:null}` · `missing=[]` · `environment=live_mode` | `GET` |
| 匿名 `POST /api/payments/dodo/checkout` | **401** | 实测（不产生会话） |
| 已登录 OWNER → 503 | **`NOT_TESTED`**（无生产 QA 会话凭据） | 见 04 |
| 五个公开页 | **200**（已被意外发布） | 实测 |
| 边缘 | `server: cloudflare`（CF Proxy → Netlify 源站） | 响应头 |
| Netlify published deploy id | **取不到**（无 API token；`x-nf-request-id` 不能冒充） | — |

## 3. 本轮的发布事故（已定性、已修根因的一半）

- `0e16959` 是某次推送的**头提交**且消息里没有 `[skip netlify]` ⇒ Netlify 构建并上线（`c46a03d` 等前置提交的跳过标记无效：**只看头提交**）。
- 后果：B2 的五个公开页 404→200，页面含未批准定价与未核实法律主体。
- 已做的修复（代码层）：渲染层冻结（`PublicHold`）+ 导航/页脚/sitemap 摘除 + `noindex`。
- **未做的修复（需要仓库管理员）**：分支保护、required checks、Netlify 停止自动发布。见 `02_MAIN_BRANCH_RELEASE_GOVERNANCE.md`。

## 4. 门禁现状（严格口径）

| 组 | 结论 | 说明 |
|---|---|---|
| G0/G1/G4/G6 | PASS | 沿用 11-12 实测，未因本轮改动回退（待新 CI 复跑） |
| G2 官网/法务 | PARTIAL | 冻结后"未批准声明 0 命中"可达；D8 真实主体仍缺 |
| G3 Figma | BLOCKED | 无 Figma 写入凭据 |
| G5 真人测试 | NOT_TESTED | 需 5 名真实用户，智能体不可代跑 |
| G7 Webhook 实投 | NOT_TESTED | 无 Dodo test_mode 凭据 |
| G8/G9/G10/G11 | PARTIAL | G10 TBT 0/8；G11 远端 CI 非全绿 |
| G12 定价批准 | BLOCKED | D1 未批 |
| G13 | N/A | 尚未发布 |

## 5. 本轮代码改动的性质

全部在 `release/v20.7-ga` 分支，**未推送 main、未部署生产**：

1. 公开面冻结（渲染层 + 导航/页脚/sitemap + noindex）；
2. `/pricing` 金额展示以**商业批准**为条件（修 CI 断言 `not /\$\s?\d/` 的真因）；
3. 触控目标 ≥24px（WCAG 2.2 AA 2.5.8）。

候选 SHA 在 CI 通过后冻结写入 `09_RELEASE_MANIFEST.json`；在此之前 `rcSha=null`。
