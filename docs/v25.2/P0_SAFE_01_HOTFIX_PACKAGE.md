# V25.2 · P0-SAFE-01 商业止损最小 Hotfix 候选包（未部署）

- **生成**：2026-11-17 · 分支 `v25.2/consent-closure` · 本地候选 HEAD 见 git log
- **状态**：`SAFE_FOR_HOTFIX_APPROVAL`（候选就绪）；**未推送 / 未部署 / 未改生产**
- **依据**：V25.2 执行令 §P0-SAFE-01 —— "不得以 Owner 未授权作为不制作候选的理由；未经授权不得部署"

## 1. 生产实时风险（本轮重取证，非引用旧报告）
| 端点 | 生产实测 |
|---|---|
| `/api/health` | `commit=b50e53e`（`commitSource=env`，`builtAt=2026-11-14T08:38:05.985Z`） |
| `/api/payments/dodo/plans` | `checkoutReady=true`、`environment=live_mode`、`commercialApproval.status=APPROVED`（目录自填引用）、3 档套餐 |
| `/pricing` | HTTP 200，旧构建含 `From $89` + `showPrices:true`（V25.1 已取证；本轮 title 仍 `Pricing · LokFeel Connection OS`） |

**结论**：生产运行的旧 commit 在"商业批准为假"的情况下仍暴露可购买价格与新结账入口。无证据证明已发生真实扣款。

## 2. 最小 Hotfix 的精确范围（不夹带其它未发布功能）
候选仅包含**已在本地 master 谱系、fail-closed 的商业门代码**，不引入 V25.2 的媒体/Consent/UI 改动：
- `src/config/pricing-gate.ts`：`PRICING_APPROVED = false`（Owner 未签 ⇒ 门默认关）
- `src/lib/payments/commercial-gate.ts`：`readCheckoutGate` = 三重合取 `PRICING_APPROVED && 目录 APPROVED && approvalRef`
- `src/app/(public)/pricing/page.tsx`：`pricingPublished = PRICING_APPROVED && gate.commercialApproved && gate.enabled`，为假时不渲染金额
- `src/app/api/payments/dodo/plans`：`pricingPublished` 新信封，未批时不返回 `checkoutReady:true`/金额
- `src/app/api/payments/dodo/checkout`：服务端 create 前过 `readCheckoutGate`，未批拒绝且**零 Provider session**

> 上述改动在 V22/V23 批次已落本地谱系并通过 billing 374/374；本包把它们识别为"可独立切出的止损热修复"，未新写代码。

## 3. 三层 fail-closed 候选实测（本地 3214 隔离服务，候选代码）
| 层 | 无批准时的候选行为 | 实测 |
|---|---|---|
| SSR 页面 `/pricing` | 不渲染可购买金额/按钮 | 无 `From $`、title 已去旧叙事 ✅ |
| JSON `/api/payments/dodo/plans` | `pricingPublished=false`，无 checkoutReady | `pricingPublished:false` ✅ |
| 服务器创建 Checkout | 未登录 401；已登录未批拒绝、零 Provider session | 匿名 POST → 401 ✅ |
| 既有回归 | `check:pricing`、billing 测试 | check:pricing EXIT 0 ✅；billing 374/374（V23 实测） |

## 4. 回滚方案与"回滚不重开门"防护
- **回滚目标**：Netlify 上一个成功 deploy ID（需 Owner/Release 从 Netlify 控制台读取；本 Agent 无部署写权限，不猜测 ID）。
- **风险**：直接回滚到旧 `b50e53e` 会**重新打开**未批结账（旧代码无 fail-closed）。
- **防护**：回滚必须与"摘除/停用生产 `DODO_PAYMENTS_API_KEY`"或"Netlify 环境变量设置禁售开关"同时执行；任何回滚路径都不得让 `checkoutReady=true & 无 Owner 批准` 组合重新出现。回滚后 5 分钟内只读复验 `/pricing` 与 plans API。

## 5. 影响矩阵（合法能力保留）
| 能力 | 热修复影响 |
|---|---|
| 已有订阅管理/续订 | 不变（走 subscription 路由，不依赖新 checkout 门） |
| 合法 Webhook | 不变（Dodo webhook 验签与账本逻辑未动） |
| 新结账（未批） | **关闭**（这正是止损目标） |
| 新结账（Owner 将来批准后） | 需 `PRICING_APPROVED=true` + approvalRef 才恢复，届时单独审批 |

## 6. 交 Owner 的部署批准项（U-1）
需要明确批复：①唯一 hotfix SHA；②Preview 结果确认；③部署窗口；④回滚 ID 与"回滚即摘密钥"联动；⑤是否授权真实生产部署。
**在本批复到达前：不推送 main、不部署、不改生产环境变量、0 真实扣款。**
