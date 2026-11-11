# 06 · G9 · Cloudflare 兼容性探针与迁移演练（lokfeel-final-20261110 · B4）

> 状态：**PARTIAL** —— CF 前置兼容性 **PASS（生产实证）**；全量迁移演练 **BLOCKED（D6 未决）**。
> 本文不执行任何不可逆操作（无 DNS 切换、无新基建）。所有结论可复核。

## 1. 实测事实（2026-11-11）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **生产此刻就运行在 CF 代理之后**：`server: cloudflare`、`cf-cache-status: DYNAMIC`、`cf-ray: …-AMS`；DNS 解析到 CF anycast（104.21.88.244 / 172.67.154.126），NS 为 cloe/rocky.ns.cloudflare.com | `curl -sI https://app.lokfeel.com` + `dig`（evidence/g9-cf-probe-2026-11-11.log） |
| 2 | 该拓扑下登录/OAuth/收银台/webhook 收发此前 prod-smoke 15/15（v19.9，ff57b53） | 历史 evidence（docs/implementation/v20/ga/） |
| 3 | 代码对代理头的消费仅限**只读遥测**：登录/管理员审计、限流、地理、统计取 `x-forwarded-for` **首跳**（共 10 处，注释明确"Cloudflare/Netlify 都写这里"）。CF 代理正是 XFF 的规范写入方 ⇒ 兼容；且生产已在 CF 后正常运行 ⇒ 实证。安全关键路径（跳转构造、同源判定）不消费可伪造头（见 #4） | `grep -rn x-forwarded-for src/` 10 处（login-audit.ts:84 / rate-limit.ts:76 / admin-audit.ts:53 / analytics / geo） |
| 4 | 公开 origin 解析**刻意不读**代理头构造跳转（防伪造开放重定向）；同源判定纳入 Host/X-Forwarded-Host 但只用于比较 | `src/lib/http/public-origin.ts`（L24-38 注释即纪律） |
| 5 | Dodo webhook 验签用**原始字节** `await request.text()` 再验 Standard Webhooks 签名——CF 不改写请求体，兼容 | `src/app/api/webhooks/dodo/route.ts`（"验签先于解析"） |
| 6 | 幂等靠**账本 dedupeKey 唯一约束**（数据库），非内存——多实例/隔离运行时（Workers isolate、冷启动）天然兼容 | webhook 路由纪律 3；R-15 修复后的分态键 |
| 7 | 实时能力走 Pusher（SaaS 出站调用）与 Upstash Redis（出站）——与前置代理无关 | 生产 env（RESEND/PUSHER/UPSTASH 出站键） |

**结论**：G9 的"目标架构可运行"在**当前架构（CF 代理 → Netlify 运行时）**上已有生产实证；候选代码无任何 CF 前置不兼容点。

## 2. D6 未决：迁移范围三选一（需要你拍板）

| 方案 | 内容 | 代价/风险 | 适配证据 |
|---|---|---|---|
| **A · 维持现状** | CF 代理（缓存+TLS+CDN）→ Netlify 运行时 | 零迁移风险；Netlify 免费计划限额内 | ✅ 生产实证（本文 §1） |
| **B · 全量迁移 CF Pages/Workers** | `@opennextjs/cloudflare` 适配 Next 16 + D1/KV/R2 | 适配层成熟度风险（Turbopack/NextAuth/Prisma libSQL→D1 driver）；**KV 不可替代强一致账本**——账本必须继续驻留强一致存储（Turso/D1 主库），KV 只做缓存 | 无生产实证；需演练（§3） |
| **C · 混合** | 静态/ISR 入 CF Pages，API 留 Netlify（拆域名） | cookie 跨域复杂化（app 与 api 分域），登录流改造 | 无实证 |

**建议**：发布批次内取 **A**（零风险，已被生产证明）；B 作为发布后独立项目走完整演练。

## 3. 全量迁移演练 Runbook（方案 B 被批准后执行；全部可逆）

1. **预演部署**（不动生产 DNS）：同一候选 SHA 用 `@opennextjs/cloudflare` 构建到 CF Workers **preview 环境**（`*.workers.dev` 预览域名），生产 env 键位一一镜像。
2. **门禁复跑**：对 preview 域名跑 G4 矩阵（112 格）+ G6 阶梯（15 条）+ Provider 连通（28 项）+ prod-smoke 全套。
3. **对账（只读）**：迁移前后 `BillingEvent` 计数、`state.charges` 归约结果、订阅状态三向对比（Netlify 库 vs CF 库读到的同一 Turso 库应全等——**若 B 方案把账本也迁 D1，则做双写期对账**）。
4. **webhook 双投验证**：Dodo 控制台临时加第二个 webhook 端点指向 preview，验证同键幂等（dedupeKey 拦截重复入账），观察一轮后移除。
5. **回滚**：DNS 不切则无需回滚（preview 删除即回滚）；正式切换用 CF 灰度（按地域/比例），异常即切回 Netlify 源——TTL 内生效。
6. **完成判据**：preview 上 G4/G6/G11 全绿 + 对账零差异 + webhook 幂等实证 ⇒ 才允许 DNS 灰度切换。

## 4. G9 判定

- **CF 前置兼容性：PASS**（生产实证 + 代码层 5 项适配证据，§1）。
- **目标架构可运行可恢复：PASS（方案 A 口径）**——当前架构即"CF + Netlify"，生产 healthy、回滚 = Netlify 重新部署（发布流程已具备）。
- **全量迁移（方案 B/C）：BLOCKED 于 D6**——不可替代的架构决定，未获批准前不预演不部署。
