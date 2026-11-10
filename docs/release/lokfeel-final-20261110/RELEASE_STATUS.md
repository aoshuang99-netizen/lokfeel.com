# RELEASE_STATUS · lokfeel-final-20261110（唯一状态页）

> 本文件是本次总令执行的**唯一**状态结论页。其他文档与它不一致时，以本页为准。
> 状态词只用 `PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`；`BLOCKED`/`NOT_TESTED` 不计入完成。

**当前状态：`NO_GO`**（未达到 `READY_FOR_APPROVAL`；未发布，未切流，未发生任何真实扣款）

- 更新时间：2026-11-10 20:05 GMT+8
- 基线 T0：2026-11-10 18:59:43 CST（接令取证）
- 候选代码：`main` @ 本分支头（见 §2 门禁段），**未推送生产**（待 READY_FOR_APPROVAL + 用户批准）
- 生产现状：`https://app.lokfeel.com` 运行 `5a161c4`（deploy `6af2d9afb8e9`），**收银台按钮仍处于可点状态** —— 已在候选代码中关闭（见 §3），但**线上止损须发布候选或另行操作**，见 §6 紧急项。

## 1. 目标完成度（诚实计数，分母为总令强制项）

| 强制门禁 | 状态 | 一句话 |
|---|---|---|
| G0 基线冻结/取证 | **PASS** | SHA/部署/health/路由全部实测，evidence 留档 |
| G1 对外八问 | **NOT_STARTED**（B1 未启动） | 定位文案已具备素材（总令 §4），未落页面 |
| G2 页面/路由/法律闭环 | **NOT_STARTED**（B1/B2 未启动） | 现有公开页 7 个 200，但缺 /product /solutions /stories /how-it-works /about /contact |
| G3 Figma 可编辑交付 | **BLOCKED**（环境无 Figma 写入连接） | 上一轮已实测并登记 `BLOCKED_FIGMA_WRITE`；本轮未重复探测 |
| G4 响应式/无障碍矩阵 | **NOT_STARTED**（绑定最终候选后执行；沿用旧 104/104 无效） | 总令禁止复用固定分母 |
| G5 ≥5 人真实用户测试 | **NOT_TESTED**（不可替代人工） | 需用户招募或代理目标用户 |
| G6 真实授权行动核验 | **PASS**（历史证据：B4 核验阶梯 15/15） | 但须在**最终候选 SHA** 上重跑方可计入发布门禁 |
| G7 幂等/乱序/重试/权益 | **PASS（候选代码层）** | R-15 修复 + 负控 5 条 + 翻译层 4 条 + 探针转绿；**真实投递仍未证** |
| G8 权限/隔离/凭据安全 | **PARTIAL** | 租户隔离/权限等历史 PASS；产物密钥扫描未在候选 SHA 重跑 |
| G9 CF 目标架构 | **NOT_STARTED**（B4） | 迁移演练/对账/回滚均未开始；Netlify 仍是运行时 |
| G10 性能预算 | **NOT_TESTED**（绑定最终候选后实测） | 旧 TBT 600–2500ms 超预算，不允许沿用旧数据宣称达标 |
| G11 同一 RC 完整门禁 | **PASS（本地）** | tsc 0 · eslint 0 · jest 143 套 2719 例 · build 见 evidence；**未绑定发布 SHA** |
| G12 商业审批真实 | **BLOCKED（待用户）** | 代填 APPROVED 已回退；恢复开卖的唯一路径 = 你亲手批准（§4） |
| G13 发布后生产复验 | **N/A**（未发布） | — |

**完成率（强制项口径）：1 项 PASS 全量有效（G0）+ 候选层部分推进；未达到 READY_FOR_APPROVAL。**

## 2. 本轮实际完成（全部可逆工程，未推送生产）

| # | 交付 | 证据 |
|---|---|---|
| 1 | **R-15 发布阻断缺陷已修复**（TDD 红→绿）：结算幂等键分态 `:succeeded/:failed`；"失败吞成功"路径消灭 | `tests/billing/dodo-events.test.ts`（终态区分组 4 例）、`tests/billing/subscription.test.ts`（内核负控 5 例，此前 CHARGE_FAILED 零覆盖）、探针转绿 |
| 2 | **R-14 假设已显式化**：renewed 与 payment.succeeded 成对同 id 幂等（正向测试钉住）；异 id 记两笔是"无关联事实不猜测"的正确行为，待真实投递观察 | `dodo-events.test.ts:成对幂等`；事件矩阵见 05 |
| 3 | **G12 机制化**：新 `src/lib/payments/commercial-gate.ts`，`checkout 开放 = 技术就绪 AND 人工批准`；checkout 路由未批准 → `503 PRICING_NOT_APPROVED`；products.ts 回退 `PENDING_APPROVAL` | `tests/billing/commercial-gate.test.ts` 5 例；`check:products` 0 |
| 4 | **候选门禁**：tsc 0 · eslint 0 · jest 全量 143 套 2719 例（+14）· `check:products` 0 · next build 见 evidence | `evidence/gates-2026-11-10.log` |
| 5 | 发布文档框架（本目录 00/05/07/09/状态页）+ G0 取证留档 | `evidence/g0-baseline-2026-11-10.txt` |

## 3. B0 止损（收银台入口）

- 候选代码中：`/pricing` 按钮 disabled（gate.enabled=false）、`POST /api/payments/dodo/checkout` → 503、`/api/payments/dodo/plans` 的 `checkoutReady=false`。
- **线上（5a161c4）仍是可点状态**。两清方式（二选一）：
  1. 将候选发布上线（走 B6 流程：READY_FOR_APPROVAL → 批准 → 单次发布）；
  2. 立即止损：临时在 Netlify 删除/改名 `DODO_PAYMENTS_API_KEY`（入口立即 503，不影响其余功能）。
- 推荐 1（候选同时修复 R-15 与门禁问题）；若你要先止损后评审，我可以执行 2。

## 4. 仅剩的、需要你决定的不可替代事项（集中一次）

| # | 决定 | 说明 |
|---|---|---|
| D1 | **定价批准** | 三档价格（Starter $49 / Growth $149 / Scale $399 ×10 年付）从未经你逐项批准。批准后把 `src/config/products.ts` 的 connection-os 块填回 `APPROVED + approvalRef（引用你的批准）`，`readCheckoutGate()` 即自动解锁。或者改价（需改 `subscription-plans.ts` + `PRICING_APPROVAL` 版本）。 |
| D2 | **线上收银台止损方式** | §3 的二选一。 |
| D3 | **SCALE 年付** | Dodo 单笔上限 $3,000（实测 $2,998 过/$3,001 拒）：找 Dodo 提额 ≥$4,000，或降价 ≤$2,999，或年付下架。 |
| D4 | **Dodo 沙箱凭据**（test_mode API key） | G7 的"官方沙箱真实投递"需要它；你只提供过 live 凭据。 |
| D5 | **真实扣款授权** | 独立于沙箱，按总令须单独授权 + 受控测试账户，不索要聊天明文卡号。 |
| D6 | **CF 迁移范围确认** | B4 前需确认：是全量迁移（D1/KV/R2）还是保留 Turso/Upstash 仅前端入 CF？KV 不可替代强一致账本。 |
| D7 | **≥5 名用户测试招募**（G5） | 你招募或授权"代理目标用户"方式。 |
| D8 | **公司/法律主体信息** | /about /terms /privacy 需真实经营主体与联系方式；缺失则这些页面不能上线。 |

## 5. 后续批次入口（不重复询问，按序执行）

- **B1（T0+8h 目标）**：八问内容矩阵 + 逐页文案 + `01_CONTENT_AND_CLAIMS.csv` + `02_ASSET_REUSE_REGISTER.csv`（KKmatch 资产逐项登记）。
- **B2（T0+24h 目标）**：新公开页 /product /solutions /stories /how-it-works /about /contact + 帮助中心；Figma 若连接器可用则建文件，否则继续 `BLOCKED`。
- **B3 剩余**：真实 Provider 链路在候选 SHA 重跑（G6）；产物密钥扫描（G8）。
- **B4**：CF 兼容性探针 + 迁移演练（G9）+ 性能实测（G10）+ 无障碍矩阵（G4）+ 用户测试（G5）。
- **B5**：07_ACCEPTANCE_MATRIX.csv 全量填实 → 09_GO_NO_GO → `READY_FOR_APPROVAL`。
- **B6**：批准后单次发布 + G13 生产复验 → `RELEASED_AND_VERIFIED`。

## 6. 紧急事项（越早越好）

**线上 `/pricing` 当前可点结账**，而 R-15 缺陷在线上代码中仍存在：若此刻发生"同一笔付款先失败后成功"（Dodo 复用 payment_id 的情形），会**收了钱不开通且无任何告警**。触发概率低但后果是真实资损/客诉。请对 §3 表态；候选发布或止损前，建议**暂不对外宣传付费入口**。
