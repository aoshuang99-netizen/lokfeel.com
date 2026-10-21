# 上线前重要任务清单（2026-10-21 盘点）

> 口径：P0 = 不做完就不能宣称"已上线"；P1 = 上线后一周内必须补；P2 = 已知但可排期。
> 每项都给验证手段——判定权在实测，不在自报。

## P0 —— 硬阻塞（共 5 项）

| # | 任务 | 现状 | 谁动 | 验证 |
|---|---|---|---|---|
| 1 | **支付 4 凭据**：`CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | 工具链已全自动（`npm run payment:apply`），只差 2 把 API key（Creem + Stripe 后台各一把），whsec 会自动生成回填 | 人：拿 key → 跑一条命令 | `npm run payment:apply` 末尾四条生产判据 + `/api/health` 的 payments 字段 |
| 2 | **真实扣款验收**（AC-21 / AC-25） | BLOCKED，等 #1 | 人 + QA | Stripe test mode 走一次完整 checkout → 订阅/退款闭环 |
| 3 | **多租户越权负向测试** | BLOCKED，需授权建第二个有数据的组织 | 人拍板 | `withTenant` 负向用例从 BLOCKED 转 PASS |
| 4 | **大陆可达性**（本次新发现） | 页面已自托管 `/pay.html` 直连 200；但**结账动作仍跳 gumroad.com（大陆不通）**。若目标买家在大陆，必须换支付通道或明确"海外卡 + VPN"客群定位 | 决策项 | 大陆无代理环境跑一次完整购买 |
| 5 | **Gumroad 真实成交闭环** | webhook 已上线并冒烟 5/5，但 happy path（真买一单 → 订阅激活 + Payment 入账）未验 | 人：下真单（或 100% 折扣码自购） | Gumroad 日志 `[Gumroad Webhook] subscription activated` + DB `Payment`/`Subscription` |

## P1 —— 上线后一周内（共 6 项）

| # | 任务 | 现状 | 验证 |
|---|---|---|---|
| 6 | 桌面冷启动 LCP ~2.7–4s（V16 唯一 FAIL） | 待 AVIF + 双档尺寸；接 `web-vitals` 拿真实 P75 | Lighthouse + RUM P75 < 2.5s |
| 7 | **续费不入账缺口**：Creem route 没处理 `subscription.paid`；且 `subscription.created/cancelled/payment.*` 四个 case 是枚举外死分支 | 已记录未修 | 用 Creem 测试事件打一遍 |
| 8 | Creem 条款是否接受本业务类目 | 未做法务复核 | 书面结论存 PAYMENT-COMPLIANCE.md |
| 9 | Gumroad 取消/退款真实事件验证 | cancellation/refund 端点已建，未收过真 ping | 后台取消一个测试订阅 |
| 10 | `next-auth@beta.32` 的 `peerOptional nodemailer` 写 `^7||^8` | 启用 Email provider 前必复核 | 升级预检脚本 |
| 11 | overrides 16 → 3（`ws` / `nodemailer` / `@grpc/grpc-js`） | 已知债务 | `npm ls` 同名包计数 |

## P2 —— 已知可排期（不阻塞）

- F-06 Evidence Lens 常驻（V16 DEFERRED）
- 11 表 `organizationId` 未 DB 级建模（隔离是应用级；db push 会删列，动 schema 必须走迁移）
- 隔离升级为 DB 级 RLS
- QA 数据清空后复验须先重建账号 + `org_default` 成员

## 运维铁律（发版时）

- 发版顺序：先迁移（snapshot→plan→apply→verify→diff）后发布
- 免构建提交写 `[skip netlify]` 且只看头提交；发版补空提交
- 发版后 ~20min 窗口期跳转必须走 `public-origin.ts`；复验 `verify-public-origin`
- 推送结论只认 `git ls-remote` + `git diff --stat`
- 推送过的提交禁止 `--amend`

## 本次新增交付（2026-10-21 下午）

- Gumroad 店面付款页 `https://shuangster00.gumroad.com/pass`（海外入口）
- 自托管镜像 `https://app.lokfeel.com/pay.html`（大陆可达，纯静态无脚本）
- 三个 Pass 设 7 天退款；FIRST50（50% off × 100 次）× 3 + 页面横幅
- Gumroad→LokFeel 订阅回填 webhook（sale/cancellation/refund 三端点 + 幂等修复）
