# HUMAN APPROVAL PACKET · LokFeel V20.7 GA

> 一页看完：**只有这 9 项需要人**。其余工程项由 WorkBuddy 自动推进，不需要你回答。
> D2（生产支付止损）**已闭合**，不再作为待答项。
> 每项都写清了"你给什么 → 我用它做什么 → 验收看哪条证据"。

## 1. 需要你签字/提供的 9 项

| # | 项目 | 我需要你给的（最小） | 拿到后我自动做什么 | 验收证据 |
|---|---|---|---|---|
| **D1** | 定价批准 | 对 Starter / Growth / Scale 的**月付/年付金额与权益**一句"批准"；批准人姓名与日期 | 把 `products.ts` 的 `pricing.status` 改 `APPROVED` 并写入 `approvalRef`（指向本记录）；重跑收银台开闸检查 | `checkoutReady=true` 只在 D1 之后出现；`tests/billing/hotfix-checkout-gate-open.test.ts` 正控 |
| **D3** | Scale 年付 | 决策：维持下架 / 申请 Dodo 提额 / 改价 | 维持下架则保持 SKU 禁用并在定价页标注；提额则只改绑定，不改价 | `plans` 逐格 `bound` 矩阵；`/pricing` 显示与实际可卖一致 |
| **D4** | Dodo **test_mode** 凭据 | `test_mode` 的 API key + webhook secret（走受控存储，不要贴聊天） | 真实 test 环境发起订阅 → 收 Provider 原始 event id/签名 → 账本/权益四方对账 | `05_DODO_REAL_WEBHOOK_LEDGER_ENTITLEMENT.md` + `evidence/ga/` |
| **D5** | 真实扣款授权 | 指定金额、测试账户、时间窗；明确"授权扣款/不授权" | 只在你授权的窗口内由真人执行；我做前后快照、对账、异常即停 | 交易 ID + 退款/开通证据；未授权则保持 `NOT_TESTED` |
| **D6** | 架构范围 | 确认维持 **Cloudflare Proxy → Netlify**（默认建议） | 维持则只补 CF→Netlify 的源站加固与回源限制；不迁 Workers | `06_G9_CF_MIGRATION_REHEARSAL.md`；生产头 `server: cloudflare` |
| **D7** | 5 名真人测试 | 5 位真实目标用户的参与安排（含知情同意） | 按 `08_G5_USER_TEST_PROTOCOL.md` 执行、录屏/计时/问答，按 4/5 判据汇总 | 5 份会话记录 + 汇总分；智能体不代跑 |
| **D8** | 法律主体 | 真实法人名、注册地址、客服地址、适用司法辖区、退款合同主体 | 替换全站占位并复扫至 0 命中；同步更新 Terms/Privacy/Refunds/Contact | `npm run verify:brand-scan` + 公开面声明审计 0 命中 |
| **F1** | Figma 写入权限 | Figma PAT 或官方 connector 授权（可编辑 File） | 复用 33 token / 3 systems 的 Import Kit 生成可编辑节点，输出 File URL + Node ID + Component→code 映射 | `03_FIGMA_IMPLEMENTATION_MAP.md`；节点可编辑截图 |
| **F2** | 最终 GA SHA 发布授权 | 在 CI/Preview/G13 前置全绿后，对**具体 SHA** 说"批准发布" | 一次受控部署 → G13 → 48h 观察 | 生产 `health.commit` = 批准 SHA；`11_PRODUCTION_G13_EVIDENCE.md` |

## 2. 需要仓库/平台管理员（不是业务决策，但只有你能点）

| # | 项目 | 为什么必须由管理员做 | 我给的替代 |
|---|---|---|---|
| **G1** | GitHub `main` 分支保护：required reviews ≥1、required checks、禁止直推 | 我没有仓库 admin 权限（无 `gh`、无 token） | 已给出可直接打开的 Compare/PR 链接与 ruleset 配置清单（`02_...md`） |
| **G2** | Netlify 关闭"生产分支 push 自动发布"或改为受控发布 | 站点设置需账号权限；本轮事故正是这条缺口 | 已实测并记录根因；在此之前所有提交走 `[skip netlify]` 且**只推分支、不推 main** |
| **G3** | Netlify/GitHub API token（只读即可） | 用于取 published deploy id / 创建 PR / 读 check-runs | 现只能靠公开 check-run 注解与 HTTP 头，deploy id 无法核实 |

## 3. 已经不需要你再回答的（避免重复询问）

- **D2 生产支付止损**：`PRODUCTION_RISK_CLOSED`（`checkoutReady=false`、匿名 401、支付源码与 RC 逐 blob 相等）。
- **五个页面误上线**：已按"保守冻结"处理（渲染层占位 + 导航/页脚/sitemap 摘除 + noindex）。**不再需要你在"保留/回收/冻结"里选**。
- **Scale 年付受单笔上限阻塞**：默认维持下架，等你 D3 决定是否提额。

## 4. 我不会做的事（除非你逐条授权）

真实扣款 / 退款 · 改生产密钥或 env · 批准价格 · 填写法律主体 · 切流量 · 发布生产 · 修改仓库保护规则。
`PASS_CODE_ONLY` / `PARTIAL` / `BLOCKED` / `NOT_TESTED` 一律不计入"通过"。
