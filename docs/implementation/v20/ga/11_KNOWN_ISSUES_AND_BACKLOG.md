# 11 · 已知问题与下一版本待办（V20.5 GA 发布时点）

> 原则：**不为凑数造条目，也不为好看藏条目**。以下每条都有证据或复验命令。

## 一、性能

| ID | 问题 | 级别 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| PERF-1 | 移动端 TBT 600–2500ms，超 200ms 预算（4 页全中，Before/After 同级） | **P1 非阻塞** | `06_PERFORMANCE_BUDGET.md` §3/§4.1 | 下一版本首位：按路由拆包 + 懒水合（图表/编辑器/Inspector 延后） |
| PERF-2 | 本地→远端 Turso 单趟往返 1.5–1.9s，本地测量 `/console` LCP 失真 | 观测口径 | 同上 §4.2 | 已在 B5 并行化（TTFB −50%）；后续可评估 Turso 嵌入式副本 |

## 二、认证与会话

| ID | 问题 | 级别 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| AUTH-1 | 真实 Google OAuth 成功回调未验（缺 `GOOGLE_CLIENT_SECRET` + 需真人） | **NOT_TESTED** | `04_AUTH_SESSION_LIFECYCLE.md` §5；形状与坏回调已 21/21 | 用户提供凭据后人工走一遍 |
| AUTH-2 | 登出后 JWT 到期前仍有效（JWT 策略固有） | 设计特征 | `10_POST_RELEASE_VERIFICATION.md` §补充 | 如需"登出即全端失效"改会话表/黑名单 |
| AUTH-3 | 撤销可见延迟上界 90s（60s 缓存 + 0–30s 抖动） | 设计特征 | B3 实测 61.4s | 高风险场景（疑似被盗）用 `tokenVersion+1` + 等待 90s 复核 |

## 三、支付域（GA 关闭，全部休眠）

| ID | 问题 | 级别 | 处置 |
| --- | --- | --- | --- |
| PAY-1（H-4） | 4 个支付凭据未配（CREEM/STRIPE × API_KEY/WEBHOOK_SECRET） | 人工项 | charging=false 已锁；用户提供后按 `payment:apply` 灌注并做真实扣款验证（AC-25） |
| D-01 | 退款口径（可退余额=`amount_paid`−有效退款，`invoice.payments[].payment.payment_intent`）需与财务确认 | 休眠 | 开启支付前定稿 |
| D-02 | 定价展示与实际扣款一致性 | 休眠 | 同上 |
| D-03 | 法律主体/条款主体信息 | 休眠 | 同上 |

## 四、产品与运营

| ID | 问题 | 级别 | 来源 |
| --- | --- | --- | --- |
| H-3 | 举报去重 | P2 | 前序评估 |
| H-5 | 草稿刷新恢复 | P2 | 前序评估 |
| D-09 | 历史提交中的 55 处"形似凭据"（测试夹具/占位） | 已受控 | 不改写历史；G1/G2 门禁看住新增 |
| FIGMA | Figma 写入能力缺失 | `BLOCKED_FIGMA_WRITE` | 无 connector；未伪造文件 |

## 五、安全人工项（需用户本人完成，AI 无法代做）

1. **确认旧管理员口令未在外部系统复用**（邮箱/其他 SaaS），有则逐个更换。
2. 在 GitHub 仓库开启 **Secret Scanning + Push Protection**。
3. 把轮换后的管理员口令写入 GitHub Actions Secrets（仅当 CI 需要时；当前 4 个 D-12 断言可用本地凭据文件跑）。
4. 决定是否把 `.qa-credentials.local.json` 迁到密码管理器（当前 0600 仅本地）。

## 六、下一版本（V20.6）建议顺序

1. **TBT 达标**（拆包 + 懒水合，目标 ≤200ms，同口径 Before/After）。
2. 真实 OAuth 成功回调验收（AUTH-1）。
3. 支付开启前的 D-01/D-02/D-03 定稿 + AC-25 真实扣款。
4. H-3 / H-5。
