# 发布 Runbook（V18 · 从"绿"到"上线"的最后一段）

> 这份文件回答一个问题：**现在能不能发，怎么发，发完怎么证明它真的上去了。**
> 它不是愿望清单 —— 每一步都有可执行的命令与预期输出，做不到就停下来。
>
> 生成时间：2026-10-22 · 对应代码 `90b9453` 之后（详见 `PROJECT_LEDGER.md`）

---

## 0. 一句话现状

代码侧已经具备发布条件：类型、lint 棘轮、单测、构建、迁移、密钥扫描、依赖、
租户静态/行为审计、支付契约、浏览器冒烟、移动端 390/360 全部有门禁（新增两项见 §2）。
**但生产仍是旧代码** —— 本轮全部提交都带 `[skip netlify]`，因为"CI 绿"不等于"该发"。
`D-10`（发不发布）是人的决定，本文只把"发"这件事变成可重复的动作。

---

## 1. 发布前置：必须同时为真

| # | 判据 | 命令 / 位置 | 预期 |
|---|---|---|---|
| 1 | 头提交 CI 全绿 | `gh run list --branch main -L1` 或 Actions 页面 | **0 失败**（跳过项 ≤2：Perf 手动、DCO） |
| 2 | 构建身份可读 | `npm run build` 后 `curl /api/health` | `commit` 为 7 位、`builtAt` 不是未知 |
| 3 | 验收台账不漂移 | `npm run check:acceptance` | 42 条 = 汇总一致 |
| 4 | 商业契约不串线 | `npm run check:products` | 5 条规则全过（含 9 条自证） |
| 5 | 未接入支付仍是"合法状态" | CI `payment-off 契约` | 18/18 |
| 6 | 双组织隔离是**行为级**证据 | CI `双组织隔离取证` | `CTRL-1/2` + `SEC-01..07` 全 PASS |
| 7 | 移动端 390/360 无溢出、触控 ≥24px | CI `浏览器冒烟`（含 `mobile.spec.ts`） | 12 条全过 |
| 8 | 数据库无待迁移差异 | `npm run check:migration-drift` | PASS（本轮无 schema 变更） |

> 🔴 第 8 条不是形式：本轮**刻意没有**加 `Subscription.provider` 列（见 `D-11`），
> 就是为了让"发布"不需要碰生产 Turso。发布铁律仍是 **先迁移后发版**。

---

## 2. 本轮新增的两道门禁（发布相关）

| 门禁 | 位置 | 守的是什么 |
|---|---|---|
| `tests/e2e-ci/mobile.spec.ts` | CI · e2e job | 2 视口（390×844 / 360×800）× 6 公开路由：横向溢出 ≤1px、触控目标 ≥24×24（WCAG 2.2 AA 2.5.8）。<44px 只作 annotation 报告，不判红 |
| `GET /api/payments/cancel` + `evaluate()` | jest | 取消按钮的"亮/灰"与 POST 的真实结果**共用一次判定**，7 个 case 逐一对撞 |

> 为什么把阈值定在 24 而不是 44：先用生产实测过一遍（2026-10-22）：
> 横向溢出全 0；`/login` 有 3 个 20px 高的控件、`/pay.html` 有 1 个 17px 的。
> 24 是 AA 的下限（能守住"按得到"），44 是 AAA/HIG 的建议值 ——
> 拿 44 当硬门禁会让大量既有布局判红，等于用门禁换噪声。

---

## 3. 发布动作（唯一一条需要"不带 skip"的提交）

```bash
# ① 确认要发的提交就是本地 HEAD，且远端一致
git rev-parse HEAD && git -c http.proxy=http://127.0.0.1:10808 ls-remote origin refs/heads/main

# ② 发版提交：空提交，**不带** [skip netlify] —— 否则 Netlify 不构建
git commit --allow-empty -F - <<'MSG'
release: 上线 V18 批次（构建身份 · 取消入口 · 移动端门禁）

本提交只做一件事：触发 Netlify 构建。代码内容与上一条提交完全一致。
MSG

# ③ 推送（scripts/push-main.sh 会自动走代理；失败就直连）
bash scripts/push-main.sh
```

🔴 Netlify **只看头提交**的 commit message。正文里出现 `[skip netlify]` 同样会跳过构建，
所以发版提交的**标题和正文都不能**出现这个标记。

---

## 4. 发布后 5 分钟内必须完成的验证

```bash
# ① 构建身份：commit 必须等于你刚推的头提交（这是唯一"它真上去了"的硬证据）
curl -s https://app.lokfeel.com/api/health | jq '{status,commit,builtAt,version,commitSource}'
# 预期：commit == 步骤 3 的 HEAD 前 7 位；commitSource == "env"

# ② 商业隔离：定价页不再指向 Hlua 的结账页
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://app.lokfeel.com/pricing
# 预期：200（此前是 307 → /pay.html）

# ③ 新页面存在
for p in /hlua /refunds /pay.html; do
  curl -s -o /dev/null -w "$p %{http_code}\n" https://app.lokfeel.com$p
done

# ④ 取消能力在未配置支付时是"诚实失败"，不是 500
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.lokfeel.com/api/payments/cancel
# 预期：401（未登录）。登录态下应为 404/409/503 之一，绝不能是 500

# ⑤ 支付缺口仍是可查的一行
curl -s https://app.lokfeel.com/api/health | jq '.payments'
# 预期：configured=false，missing 恰好 4 个键
```

> ① 是这次新增的能力。**在它存在之前，"发布成功"只能靠"我记得我 push 了"** ——
> 上一次生产复测里 `/api/health` 的 `version` 就是 `"unknown"`。

---

## 5. 回滚

| 情形 | 动作 | 备注 |
|---|---|---|
| 发版后 5 分钟内发现坏 | Netlify → Deploys → 上一个 deploy → **Rollback** | 最快，1 分钟内生效 |
| 需要代码也回滚 | `git revert <release-sha>` + 再发一次 | 生产提交链保持线性 |
| 只是某个页面坏 | 用 `public/` 静态页兜底不适用 —— 走 revert | 本项目没有 feature flag 层 |

🔴 **回滚后必须复测 `/api/health` 的 `commit`**：它必须变回旧值。
否则说明 CDN/边缘还在给旧响应，"回滚"只是你以为回滚了。

---

## 6. 发布也**不会**有的东西（别把"上线"当成"能收钱"）

| 缺什么 | 现状 | 影响 |
|---|---|---|
| 4 个支付凭据 | `payments.configured=false` | 付费入口一律 503 + `PAYMENT_NOT_CONFIGURED`（**合法状态**） |
| 退款天数唯一口径 | `/refunds` 写 14 天、`pay.html` 写 7 天（不同产品，但没标"属于谁"） | `D-01` 待批；工程不自行选 |
| Creem 订阅的自助取消 | 返回 409 + 指向客服 | 未验证过 Creem 的取消 API，不编调用 |
| 认证面 13 屏的移动端实测 | 未测（需生产测试账号 `D-06`） | `UX-08` 仍为部分证据 |
| 法律主体 | `D-03` 未定 | `privacy@`/`billing@` 背后没有承诺人 |

---

## 7. 发布前需要人签字的 4 项

1. **D-10 · 发不发布**（本文就是为它准备的）
2. **D-01 · 退款天数**（`/refunds` 与 `pay.html` 同时在线，且指向不同产品）
3. **D-09 · 历史提交里的 55 处凭据**哪些还活着、要不要轮换
4. **D-11 · 是否给 `Subscription` 加 `provider` 列**（当前靠环境推断，两家都配时拒绝自助取消）

> 前两项影响"用户看到的承诺"，后两项影响"下一次改动的成本"。
> 都不阻塞本次发布 —— 但都会在发布后继续以 `BLOCKED` 的身份留在验收台账里。
