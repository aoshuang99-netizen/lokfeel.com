# V19-23 · 解锁包（三步人工决定 → 一键执行）

> **这份文件只解决一件事：把"等你点头"的 5 个门，变成"你回一句话、我按脚本跑"的动作。**
> 生成时间：2026-10-26 · 所有当前真值都是本日实测（`ls-remote` / GitHub API / Netlify API），不是回忆。

## 0. 当前真值（2026-10-26 实测）

| 项 | 值 | 怎么验的 |
|---|---|---|
| `origin/main` | `c3213fd` | `git ls-remote` |
| main 的 CI | **44 success / 2 skipped / 0 失败** | check-runs API |
| 生产（Netlify production） | `dc102cd`（2026-10-21T06:41Z） | Netlify deploys API |
| PR #32 头提交 | `054ee1f`（10 提交 / 96 文件） | GitHub API |
| PR #32 CI | **19 success / 1 skipped（Perf 手动）/ 1 neutral（CF Pages 无关项）/ 0 失败** | check-runs API |
| PR #32 preview | `deploy-preview-32--lokfeel.netlify.app` 可用（`/login` 200） | HTTP 实测 |
| 生产 vs 分支 DB 差异 | `prisma/` + 租户脚本 **0 行** ⇒ 无需迁移 | `git diff dc102cd..c3213fd` 与 `..054ee1f` |
| Netlify 额度 | 1000 credits，已用 0，自动充值已开 | 额度脚本 |

## 1. 🔴 一个必须先知道的事实：合并 PR #32 会直接发生产

Netlify 只在**头提交不含 `[skip netlify]`** 时构建。PR #32 的头提交 `054ee1f` 带有该标记
（它是文档提交），**但 GitHub 的合并提交信息由你决定**：

- 若用默认合并信息 → 合并提交不含标记 → **Netlify 立刻发生产**（V18.3 的 34 提交 + V19 的 96 文件一锅端）；
- 若在合并信息里带 `[skip netlify]` → 合并只进 main，**生产不动**，你随时再按 §3 单发。

所以「合并 PR」与「发生产」是**两个可以分开的动作**，别让它们被默认值绑在一起。

## 2. 决定的三种走法（选一个，回一句就行）

### 走法 A · 稳妥两段式（推荐）
1. 先 `D-10`：按 §3 发 V18.3（main 现在的 `c3213fd`）→ 生产验证；
2. 生产稳定后，合 PR #32（合并信息带 `[skip netlify]`）；
3. 再按 §3 发 V19。归因清楚：万一生产出问题，你知道是哪一段。

### 走法 B · 一次到位
1. 合 PR #32（**合并信息不带** `[skip netlify]`）→ 一次上线 V18.3 + V19；
2. 按 §4 验证。快，但两批变更叠在一起，出问题时要先二分。

### 走法 C · 只做 V18.3，V19 继续挂着
1. 只执行 §3（发 V18.3）；
2. PR #32 保持 open，等你愿意的时候再合。**这是当前默认状态，什么都不用做。**

## 3. D-10 发布动作（批准后我执行的精确命令）

main 已经在远端 = `c3213fd`，但历史提交全带 `[skip netlify]`，所以生产仍是 `dc102cd`。
**发版 = 往 main 补一个不带标记的空提交**（这是本仓既有铁律，见 `docs/implementation/v18/22_RELEASE_RUNBOOK.md`）：

```bash
git checkout main && git pull --ff-only
git commit --allow-empty -s -m "release: V18.3 上线（生产 dc102cd → c3213fd）"
git push origin main     # ← Netlify 只看头提交，这一下才真正构建
```

**验收（缺一条不算发出去了）**：
| 判据 | 命令 | 预期 |
|---|---|---|
| 构建成功 | Netlify deploys API | 新 deploy `state=ready`，`sha` = 你推的空提交 |
| 身份可读 | `curl https://app.lokfeel.com/api/health` | `commit` = 该提交 7 位、`builtAt` 非未知 |
| 支付仍是合法未接入 | `curl -i https://app.lokfeel.com/api/payments/cancel` | **401**（旧生产是 404） |
| 旧路径已按设计改道 | `curl -I https://app.lokfeel.com/pricing` | **200**（旧 307 → `/pay.html`） |
| 无需迁移（已实测） | `git diff dc102cd..c3213fd -- prisma/ \| wc -l` | 0 |

## 4. PR #32 合并（批准后我执行的精确命令）

```bash
# 走法 A/C：只进 main 不动生产
gh pr merge 32 --merge -m "Merge V19 设计系统/审计/性能优化（不发生产）[skip netlify]"
# 走法 B：合并即发生产（合并信息里不要带标记）
```

合并后立刻核：`git ls-remote origin main` = 新合并提交；`curl /api/health` 的 `commit`
**未变**（走法 A/C 下生产不该动，这就是"没误发"的判据）。

## 5. D-06 测试账号（解锁 4 条 PENDING/BLOCKED）

**要什么**（二选一）：
- **方式 1（你给现成账号）**：一个能登录的邮箱 + 密码（会写进 CI secrets 与本机 `.env`，命名 `E2E_AUTHED_EMAIL` / `E2E_AUTHED_PASSWORD`）；
- **方式 2（你授权我注册）**：允许我在生产注册 1 个一次性账号（会写生产 DB），或者你自己在 `/register` 建一个把凭据给我。

**拿到后我跑的**（全是既有脚本，不需要新写）：
| 目标 | 命令 | 解锁 |
|---|---|---|
| 登录门定性 | `QA_PASSWORD='…' node scripts/qa/probe-qa-login.mjs` | UX-01/02 |
| 认证面 18 条移动端 | `E2E_AUTHED_EMAIL=… E2E_AUTHED_PASSWORD=… npx playwright test tests/e2e-ci/authed-mobile.spec.ts` | UX-03/04 |
| 六页签 12 条 | 同上 → `workspace-tabs.spec.ts` | UX-05 |
| 幂等（刷新/重试无重复副作用） | `scripts/qa/e2e-round*.mjs` 既有用例 + 断言 | SEC-04 |
| Mission 闭环 | `17` 里 BLOCKED 的那条走查 | WB19-41 |

> 注：生产 QA 数据已被清空过，账号需含 `org_default` 成员关系，否则登录后业务页是空壳——
> 这是 `17` 里记的那条真实原因，不是推测。

## 6. 两项面板操作（只有你能点，收益最大）

| 操作 | 路径 | 预期收益 | 依据 |
|---|---|---|---|
| 关 GTM 自动加载 | Netlify → Site configuration → Environment variables → 清 `NEXT_PUBLIC_GTM_ID` | 每页少一个阻塞脚本（`gtm.js` ~35KB gz + 主线程） | `20` §8.3：HTML 内联里实测有 `googletagmanager` |
| 关 Cloudflare Web Analytics Auto-Inject | Cloudflare → 你的域名 → Analytics → Web Analytics → 关 Auto-Inject | 少 1.0–2.1s beacon 等待 | `20` §7.5 实测 |

> 这两项是 `/login` 冷态 LCP 达标（≤2500ms）的**唯一剩余杠杆**——代码侧已榨干：
> JS 的 ~88% 是 Next 16 框架基线（react-dom 123KB br + router 42KB + polyfills 38KB），不可裁（`20` §8）。

## 7. 一句话回执模板

- 只发 V18.3 → 「**走 C**」
- 两段式 → 「**走 A**」
- 一次到位 → 「**走 B**」
- 再加账号 → 「**走 A + 方式 2（授权注册）**」
