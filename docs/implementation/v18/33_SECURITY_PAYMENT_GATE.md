# 安全与支付关闭状态（WB18-33）

> 目标：证明**免费受控 Beta 不会产生意外收费，也不会数据越权**。
> 分两层写：**隔离环境跑完整负向测试**，**生产只跑非破坏性冒烟**。
> 生产上不跑任何越权攻击或破坏性测试。

- 代码基线：`0507434` ｜ 生产：`dc102cd`（未部署）
- 采集时间：2026-10-23

---

## 1. 结论表

| # | 判据 | 隔离环境（CI / 本地） | 生产（实测） | 判定 |
|---|---|---|---|---|
| 1 | 未配置支付不能创建真实订单 | `verify-payment-off.mjs` **18/18**；结账端点先校验身份，匿名 401 | 结账端点匿名 **401**（实测） | **PASS** |
| 2 | 公开页不误导用户买别的产品 | HEAD：`/pricing` 是真实页面（`check:products` R5 PASS） | **`/pricing` 仍 307 → Hlua 页** | **FAIL（仅生产）** |
| 3 | 改 `organizationId` 不能跨租户 | `tenant-scoping-audit.mjs` + `withTenant` 真相表 + `discloseSubject()` fail-closed 用例 | 未做（不在生产跑越权） | **PASS（隔离）** |
| 4 | Consent 未批准时 Agent 不执行受限操作 | **BLOCKED**（见 §3） | 未做 | **BLOCKED** |
| 5 | 取消/退款接口不泄露账务数据 | 取消接口需登录；`evaluate()` 单一判定 7 例；退款协议层 5 场景 19 断言 | 取消接口匿名 **401**（HEAD）/ **404**（当前生产） | **PASS** |
| 6 | 错误日志不输出密钥 | gitleaks 增量门禁 success；`/api/health.payments` **只回键名**不回值（实测响应里无任何密钥） | 同上（只读检查） | **PASS** |
| 7 | 测试账号无权限升级 | 夹具全局角色固定 `USER`，只是自己组织的 `OWNER` | 生产无测试账号 | **PASS** |

> 第 2 条要特别注意：**同一个判据在隔离环境是 PASS、在生产是 FAIL**。
> 这不是矛盾，是"代码修好了但没发布"。所以它同时是 `D-10` 的一条论据。

---

## 2. 支付关闭：为什么"未配置"是安全状态而不只是"没做"

**代码层**（7 个结账入口统一）：

```json
{ "error": "PAYMENT_NOT_CONFIGURED", "code": "PAYMENT_NOT_CONFIGURED" }  // HTTP 503
```

**可观测层**（`/api/health.payments`，实测原样摘录，只有布尔与键名）：

```json
{ "configured": false, "charging": false,
  "channels": { "creem.checkout": false, "creem.webhook": false,
                "stripe.card": false, "stripe.refund": false, "stripe.webhook": false },
  "missing": ["CREEM_API_KEY","CREEM_WEBHOOK_SECRET","STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET"],
  "malformed": [] }
```

- `missing` 恰好 4 个 ⇒ 其余已就绪，只差凭据。
- **端点公开但零泄露**：只回名字，不回值、不回长度、不回前缀。
- 结账端点匿名实测 **401**：身份校验在支付校验之前 ⇒ 未登录根本走不到下单。

**为什么这比"把支付页面藏起来"强**：藏起来的东西一旦被直接调 URL 就失效；
这里的拒绝发生在服务端，且用同一个 `code` 让运维能一眼判断"是没配，还是配错了"。

---

## 3. Consent 门禁：这一条**没验成**

CI 注解原话：

> `V18 隔离取证 BLOCKED` —— `SEC-08 Consent 撤销后继续执行被拒` 需要 Connection/Consent 夹具（跨 4 张表）；
> 本轮无本地库可验证，下一轮用真实流程造数。

所以这条是 **BLOCKED，不是 PASS**。代码里 `withTenant` 的能力数组用 `some()` 语义、
`discloseSubject()` 是披露唯一出口（fail-closed 白名单），这些有静态/单测覆盖，
但**"撤销 Consent 之后 Agent 真的停下来"这条行为链，一次都没跑过**。

它需要：一个 Connection + 一条 Consent + 一次 Agent 触发。这是 `D-06`（生产账号）之外
唯一还差夹具的行为级安全断言，建议下一轮优先补。

---

## 4. 本轮新增的一条安全相关判据

`/login`、`/register` 曾被标成 `cache-control: public`（`age` 到 48 小时）。
虽然实测 HTML 里**没有** CSRF token、没有个性化数据 ⇒ **不构成凭证泄露**，
但"响应形状随 cookie 变化"的页面被公共缓存，会让"我到底登录了没有"变得不确定。
已改成 `private, no-store`，并用 `tests/e2e-ci/cache-headers.spec.ts` 钉住（8 条）。

详细证据见 `35_AUTH_NAVIGATION_STABILITY.md`。

---

## 5. 没有做的事（明确边界）

| 项 | 为什么不做 |
|---|---|
| 生产越权攻击（改 `organizationId` 遍历） | 任务书明确禁止在生产跑破坏性测试 |
| 生产 Consent 撤销实验 | 需要真实账号 + 会改生产数据 |
| 真实退款 | 缺 4 个凭据（`D-05`） |
| 密钥有效性实测 | 会调用第三方并可能产生费用；`D-09` 只做到"与生产不同"的哈希比对 |

---

## 6. 一句话

**支付关闭这件事是可信的**（三层证据：代码拒绝、健康端点自报、生产实测 401）。
**跨租户隔离在隔离环境是可信的**（静态审计 + 行为取证 + 披露白名单）。
**Consent 门禁目前只有代码层证据，没有行为证据** —— 这是本轮留下的一处空白，
不是"应该没问题"。
