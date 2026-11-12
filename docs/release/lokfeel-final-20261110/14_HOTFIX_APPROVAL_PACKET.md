# HOTFIX 审批包（S-04）· `SAFETY_READY_FOR_APPROVAL`

> 本包只请求**一件事**：授权把 `c97c893` 部署到生产，以关闭未获人工批准的新结账入口并修掉 R-15。
> 它**不**替代 GA 验收，也**不**请求任何商业批准、法律主体、真实扣款。

## 1. 待授权对象（唯一 SHA）

| 项 | 值 |
|---|---|
| 分支 | `rc/hotfix-checkout-safety` |
| **RC SHA** | **`c97c893c450e2139db7e824cfce01e9c34d9b0b0`** |
| 基线 | `5a161c4`（= 当前生产运行时，= Netlify deploy `6af2d9afb8e9e8e1aab031e4`） |
| 远端复核 | `git ls-remote origin refs/heads/rc/hotfix-checkout-safety` → 同 SHA |
| 远端 CI | `run_id=43215650524`：**12 PASS / 1 FAIL / 2 SKIP**（失败项与本次修复无关，见 §4） |
| 改动规模 | 14 文件；源码 **5 个**；无新页面 / 无依赖 / 无 schema |

## 2. 部署后**立即生效**的行为变化（可逐条验证）

| # | 变化 | 部署后 60 秒可验证的判据 |
|---|---|---|
| 1 | 收银台对公众关闭 | `GET /api/payments/dodo/plans` → `checkoutReady=false`、`commercialApproval={status:"PENDING_APPROVAL",ref:null}` |
| 2 | 结账请求被服务端拒绝 | 已登录 OWNER 调 `POST /api/payments/dodo/checkout` → **503 `PRICING_NOT_APPROVED`**（不是 200，也不是 500） |
| 3 | 匿名仍先撞 401 | 匿名同请求 → **401**（守卫顺序不变） |
| 4 | R-15 修复 | 结算键分态；同 `payment_id` 先失败后成功不再互相吞单（jest 11 例 + 内核负控） |
| 5 | 已订阅用户不受影响 | `GET /api/payments/dodo/subscription` 与「管理订阅」路径不变（未改该路由） |

> 变与不变要一起看：**它不改首页、不改定价页、不改订阅管理、不改 webhook 验签。**

## 3. 我不需要你做技术判断的部分（已实测）

- 全量 billing 测试 **380/380**；路由级拒绝/放行 **7/7**（含变异自证：拆掉门立刻变红）
- 白名单 **PASS（14 文件 / 0 违规）**：不可能夹带新页面或依赖
- 真实 HTTP 双场景：灌满 live 凭据仍 `checkoutReady=false`（`evidence/s02-hotfix-http-live-credentials.json`）
- 生产构建 `npm run build` **exit 0**
- 本机 `tsc --noEmit` **0 error**、`eslint` 改动面 **exit 0**

## 4. 必须让你知道的一件"不完美"

远端 CI **不是全绿**：E2E 浏览器冒烟有 **6 例失败**，全部在 `/pricing`：

- 页面渲染 `$49.00`（断言要求"未获批不得出现金额"）
- 2 个链接高度 20px < 24px（WCAG 2.2 AA 2.5.8）：`了解 Hlua Pass`、`需要采购/发票/年度合同？联系我们`

**这些缺陷在生产站今天就存在**，我用独立探针在生产实测过（`evidence/s03-production-pricing-defect.json`）：
`/pricing` 200、出现 `$49`、两个 <24px 链接。**不是本次修复引入的。**

为什么不在 hotfix 里顺手修：任务书 S-02 明确"不夹带未经法律审核的页面"，
而 `/pricing` 的正确修法依赖 GA 线上的新版定价页（B2 已交付，尚未发布）。
在 hotfix 里改页面 = 把"止损"变成"改版"，评审面与回滚面都会失控。

**所以这是你的一个明确取舍**（不是技术债，是范围决策）：

- **A（推荐）**：接受这 2 类已知页面缺陷（今日线上已有，hotfix 不加重），先止损；
- **B**：暂不部署 hotfix，等 GA 一起发（期间收银台继续开放、R-15 继续在线上）。

## 5. 回滚预案（已 dry-run）

| 动作 | 结果 | 是否安全 |
|---|---|---|
| 回滚到 `6af2d9af` | 回到 `5a161c4`：`checkoutReady=true` + `live_mode` + 无商业门 + R-15 | 🔴 **重开风险** |
| 部署后若需停售：Netlify 摘 `DODO_PAYMENTS_API_KEY` | 通道不就绪 → `checkoutReady=false`、`missing` 列出变量名、checkout 503 | ✅ 已实测（场景 B） |
| 重新部署 hotfix | 回到关闭态 | ✅ |

**明确写死：绝不把"回滚到 `5a161c4`"当作安全动作。** 它是本轮风险的来源。

## 6. 我需要的授权（勾选其一即可）

```
[ ] A. 授权将 c97c893 部署到生产（Netlify 站点 lokfeel / c46478e9-7ac8-4bcf-9052-7638b04fef83）
       部署后由我执行只读复验：plans.checkoutReady=false、匿名 401、OWNER 503、
       health.commit=c97c893、48 小时只读观察日志
[ ] B. 暂不部署，等 GA 一并发布（保持现状，收银台继续开放）
[ ] C. 先只做"摘 DODO_PAYMENTS_API_KEY"（不换代码，不修 R-15）—— 仅关入口
```

> 若选 A，请同时确认：**部署窗口内不并发其他发布**，以便把 `health.commit` 的变化归因到唯一 SHA。

## 7. 部署后我会自动做的事（无需再问）

1. `POST` 以外的只读复验：`/api/health`、`/plans`、`/pricing`、五个公开页（仍 404，属 GA 范围）
2. 逐条比对 §2 的 5 条判据，落盘 `evidence/s04-post-deploy-verify.json`
3. 记录新 deploy id、`health.commit`、与 `c97c893` 的一致性
4. 启动 48 小时只读观察（health / plans / 账本对账 / SHA 漂移 / 告警），空样本写 `NOT_TESTED` 而非"0 异常"
5. 若任一判据不符 → 立刻执行 §5 的安全回滚并报告，不隐瞒

## 8. 本包**不**覆盖的事（避免误读为"上线完成"）

GA 仍是 `NO_GO`：G5 真人测试 `NOT_TESTED`、G7 真实投递 `NOT_TESTED`、G3 Figma `BLOCKED`、
G10 TBT `PARTIAL`（0/8 达标）、D1/D3/D8 未批、五个公开页在生产仍 404。
**Hotfix 通过 ≠ V20.7 通过。**
