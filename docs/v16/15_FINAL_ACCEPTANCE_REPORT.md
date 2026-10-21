# 15 · 最终验收报告（V16 · 2026-10-21）

> 基线 `9ba9075` → 交付 `a336263`（生产 `app.lokfeel.com`，Netlify ready）
> 结论：**5 PASS / 1 FAIL（单项性能指标）/ 2 BLOCKED（外部条件）**
> 「FAIL」不修饰、不藏；「BLOCKED」写清解除条件。

## 一、门禁看板

| # | 门禁 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| 1 | Admin 两项故障关闭 | **PASS** | 根因比原判断更深（API 从不返回 `amount/currency`；DB 大写枚举按小写查表兜底成"活跃"）；27 例回归 + 2 次变异判红 | `6e11646` |
| 2 | 公开页面叙事统一 | **PASS** | 19 个公开路由 0 禁词（含 `--self-test` 自证）；顺带修 9 处 `lokfee.com` 拼错、3 条虚构媒体报道、2 个成人内容法务页 | `51d452a` |
| 3 | 13 屏真实交互审计 | **PASS** | 生产真实登录态，26 张改版前 + 26 张改版后截图，全程 200、0 pageerror | `56fd575` / `audit:ux13` |
| 4 | 三套独立可交互预览 | **PASS** | A/B/C 原型 + 评分卡；C 已落地 | `docs/v16/design/preview/` |
| 5 | 生成式工作区真实接线 | **PASS** | 阶段条四段全部来自真实端点；`—`≠0 的判定有单测把守；Mission 创建带幂等键 | `e5e8846` |
| 6 | 多租户与越权安全 | **BLOCKED** | 静态：50 条 v1 路由 0 条裸 prisma，45 条走 `withTenant`；动态负向测试缺"第二个有数据的组织" | 见 §三 |
| 7 | 全链路质量门禁 | **FAIL** | E2E / 无障碍 / 视觉 / CI 全绿；**桌面落地页冷启动 LCP 2672ms > 2500ms** | 见 §二 |
| 8 | 支付商业发布 | **BLOCKED** | `/api/health.payments.configured=false`，缺 4 个变量 | 见 §三 |

## 二、唯一 FAIL 的明细（性能）

| 指标 | 目标 | 实测 | 判定 |
|---|---|---|---|
| LCP `/` 桌面（暖） | ≤2500ms | 2292ms | PASS |
| LCP `/` 桌面（冷，3 次中位） | ≤2500ms | 3656ms | **FAIL** |
| LCP `/` 桌面（全量终跑） | ≤2500ms | 2672ms | **FAIL（超 172ms）** |
| LCP `/` 移动 | ≤2500ms | 380ms | PASS |
| LCP `/workspace` 桌面 / 移动 | ≤2500ms | 1328 / 968ms | PASS |
| LCP `/console` 桌面 / 移动 | ≤2500ms | 1204 / 592ms | PASS |
| CLS 全部采样 | ≤0.1 | ≤0.003 | PASS |
| 横向溢出 26 组合 | 0 | 0 | PASS |
| INP | ≤200ms | UNKNOWN | 需真实用户数据 |

已做掉的：rAF 装饰动画推迟启动（7008 → 4280ms，实测 −2.7s）、主图 PNG→WebP（228 → 65KB，−71%）。
仍不达标的原因很明确：**HTML TTFB 只有 4ms（边缘已缓存），瓶颈是首屏这张图自身的传输+解码**。
下一步（`10_PERFORMANCE_REPORT.md` §六）：AVIF / 按视口出两档尺寸 / 确认 preload 生效 / 接 `web-vitals` 拿真实 P75。

## 三、两个 BLOCKED 的解除条件

### 6 · 多租户负向测试

需要：① 建组织 B（`scripts/qa/grant-preview-org.mjs` 可复用）→ ② 用 B 的 OWNER 建 1 条 Mission + 1 条提案 → ③ 用 A 的 OPERATOR 请求 B 的 mission，断言 404 → ④ 用 A 审批 B 的提案，断言 403/404 → ⑤ 落成 `scripts/qa/tenant-negative.mjs` 进 CI。

不在本轮做的原因：第 ② 步要往**生产库**写两个组织的假数据，清理脚本必须先能枚举全部外键
（历史教训：32 张表引用 `User`，当时的清理脚本只备份了 4 张）。

### 8 · 支付

需要 4 个变量：`CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`，
配置在 Netlify → Site configuration → Environment variables（production + deploy-preview + branch-deploy）。
到位后按 `09_PAYMENT_READINESS.md` §三 的 6 步真实扣款验收；**在那之前 AC-25 不得标 PASS**。

## 四、本轮实际改了什么（可审计）

| 类别 | 提交 | 关键文件 |
|---|---|---|
| Admin 双修 | `6e11646` | `src/lib/admin/*`、两页 + 27 例测试 |
| 叙事统一 | `51d452a` | `(public)/*` 19 个文件、`src/config/brand.ts`、`verify-brand-scan.mjs` |
| 审计与原型 | `56fd575` | `docs/v16/00,04`、`design/preview/*`、`v16-ux-audit.mjs` |
| 设计 C + 3 缺陷 + 对比度 | `e5e8846` | `living-shell.tsx`、`adaptive/stage-rail.tsx`、`lib/living/adaptive/stages.ts`、`globals.css`、`next.config.ts` |
| 文案与 legacy 语义 | `194acc4` | `living-workspace.tsx`、`console/page.tsx` |
| LCP + 触控目标 | `1e0a2bd` | `(public)/page.tsx`、`living-shell.tsx`、`console-shell.tsx` |
| WebP | `6ca90de` | `public/showcase/studio.webp` |
| 窄视口 44px 兜底 | `a336263` | `globals.css`、`console-shell.tsx` |

合计 **70 个文件 / +5385 −720**。

## 五、门禁复跑清单

```bash
npm run verify:brand-scan      # 19 文件 0 命中
npm run verify:contrast        # 5 板块 × 15 组全绿
npm run audit:ux13             # 13 屏截图（只读）
npm run audit:release          # 溢出 / 触控 / LCP / reduced-motion
npm run verify:llm:live        # 真实模型调用 9/9
npm run verify:payment-off     # 7 入口 503 · 18/18
```

## 六、下一轮建议顺序

1. **性能收口**：AVIF + 双档尺寸 + `web-vitals` 上报，把 LCP 从"时好时坏"变成"知道 P75"；
2. **安全收口**：按 §三 的 5 步把租户负向测试自动化（这是唯一还没有动态证据的高风险项）；
3. **支付**：等凭据；
4. **G-01**：给 `/workspace` 六屏加 URL 状态，支持"把这个屏发给同事"；
5. **legacy 弃用**：等访问量 / 活跃账号 / 续费数三项数据。
