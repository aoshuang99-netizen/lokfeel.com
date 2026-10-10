# T00 — risks.md

## 阻断级（BLOCKER）— 未解决，必须在下游任务处置

| ID | 风险 | 证据 | 归属任务 | 现状 |
|---|---|---|---|---|
| R1 | **数据层方言冲突**：目标契约 PostgreSQL，现网 libSQL/sqlite | `prisma/schema/core.prisma:10` vs `contracts/schema.sql:1-4` | T01 | **未决**（待用户确认 P1/P2/P3，见 `MIGRATION_PLAN.md` §6 Q1） |
| R2 | **零租户维度**：39 个 model 无任何 tenant 概念 | 全量 grep 零命中；`docs/MULTI-TENANCY-DESIGN.md:12-14` | T01 | 未开始 |
| R3 | **无 Mission / 无 Outcome 实体** → 目标闭环两端缺失 | 见 `REPO_AUDIT.md` §4 | T02 / T08 | 未开始 |

## P0 级

| ID | 风险 | 证据 | 归属 |
|---|---|---|---|
| R4 | 匹配为**单向投递**，非双向互认 | `core.prisma:263-337`（senderId/receiverId + pitchMessage） | T04 |
| R5 | 无工作流持久化（outbox / 幂等 / 重试 / 死信 / 人工接管） | 无相关模块 | T06 |
| R6 | **支付生产 BLOCKED**：缺 `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / 两个 `PRODUCT_ID` | `docs/PAYMENT-COMPLIANCE.md`；上轮生产自证 500 | T08 |
| R7 | **地域策略不保护 API**：生产自述 `blocked:true`（CN），但 `/api/*` 仍返回 200 而非 451 | 实测 `GET /api/geo-check` → `200 {"country":"CN","blocked":true}`；`GET /api/health` → 200 | T01（须显式确认并加测试，AC-02） |
| R8 | 既有 Jest 失败（`plans-consistency`、`webrtc/components`） | 上轮以 `git worktree add origin/main` + 软链 node_modules 对照证明为**既有失败**，与本次无关 | T12（清零） |

## P1 / P2 级

| ID | 风险 | 归属 |
|---|---|---|
| R9 | `.env.*` 变体被追踪（`.env.vercel` / `.env.creem-check` 等，值均为空或占位，**无真实密钥**） | 卫生清理 |
| R10 | 性别词表不一致（存量 `MALE/FEMALE` vs 代码 `MAN/WOMAN`） | 产品决策 |
| R11 | 文档漂移（`MULTI-TENANCY-DESIGN.md` 称 42 表 / `schema.prisma`，实际 39 model / `schema/*.prisma`） | T01 订正 |
| R12 | WebRTC 级联未闭合（Pusher 频道前缀不一致、无 TURN 时对称 NAT 失败、无 TURN relay） | T06/T12 |

## 方法论风险（本任务发现）

| ID | 风险 | 说明 |
|---|---|---|
| M1 | **模式匹配判鉴权会同时漏报与误报** | 首轮正则报 60 条"无守卫"，加 `withPermission` 后降 23 条，逐条读码后确认全部为有意公开。**结论：路由鉴权必须以「读入口包装」或「真实请求探测」取证，禁止用 grep 计数下结论。** |
| M2 | **"返回 200" ≠ "无问题"** | 已在本任务规避：对每条可疑端点读取响应体（如 `403 "Forbidden: Admin access required"`）而非只看状态码。 |

## 未验证项（不声称已确认）

- 未做全量 147 条路由的**逐条**鉴权阅读（仅对「无守卫」名单逐条核验 + 抽样读入口包装）。
- 未做渗透测试 / 对抗测试（属 T12）。
- 未验证 libSQL → PostgreSQL 的实际迁移可行性（属 T01）。
- 未验证 Creem 生产链路（凭据缺失，属 T08）。
