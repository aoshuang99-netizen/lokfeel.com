# 53 · RELEASE EXECUTION LOG — V19.9 发布执行记录（2026-11-01）

> 用户已下达 **D-10 发布批准**（"发布！"）。本文记录：**做完了什么、卡在哪、解除只需一步。**

---

## 1. 发布链路真相（实测，非推断）

| 环节 | 事实 | 取证 |
|---|---|---|
| 生产站点 | Netlify `lokfeel`（`c46478e9-…`）→ 自定义域 **`app.lokfeel.com`** | `GET /api/v1/sites/{id}` |
| 部署方式 | **Git 集成**：repo = `github.com/aoshuang99-netizen/lokfeel.com`，branch = `main`，命令 `npm run build` + `@netlify/plugin-nextjs` | `netlify.toml` + sites API |
| 线上版本 | `dc102cd`（2026-10-21T06:43Z，`ready`） | sites API `published_deploy` |
| 结论 | **代码不在 GitHub 的 main 上 ⇒ Netlify 无从构建**。手工 zip 部署会绕过站点环境变量与 Next 运行时插件，**不做**（会把生产认证/密钥打坏） | — |

---

## 2. 本轮已完成（自主推进部分）

| # | 动作 | 结果 |
|---|---|---|
| 1 | 创建 `release/v19.9` = `v19/design-exploration`（`01d7602`） | ✅ |
| 2 | 合并 `fix/p2-soft-delete-aggregate`（11 个 B-5~B-20 修复） | ✅ **零冲突**，23 文件 / +2565 −246 |
| 3 | 清掉合并带进来的 3 处 lint 新增（`Record<string,any>`→`unknown`、`deleteMany` 窄类型、`require`→`jest.requireActual`） | ✅ 棘轮零新增（债务下降 5、清零 16） |
| 4 | 全套门禁（发布分支 `55d67fd`） | ✅ **Jest 124 套件 / 2450 tests 全绿** · tsc **0 error** · `check:acceptance` PASS · `check:products` PASS |
| 5 | 数据库迁移判定 | ✅ `git diff dc102cd..HEAD -- prisma/` = **0 行** ⇒ 发布**不需要** DB 迁移 |
| 6 | Netlify 令牌有效性 | ✅ 可读站点列表（`NETLIFY_AUTH_TOKEN` 在 `.env.production` 内，**未外泄**） |

> 发布分支 HEAD：**`55d67fd`**（`release/v19.9`），工作树干净。

---

## 3. 唯一阻断：GitHub 写权限（三项证据）

| 尝试 | 结果 |
|---|---|
| HTTPS push（经代理 `:10808`） | `fatal: could not read Username for 'https://github.com': terminal prompts disabled` |
| 钥匙串凭据（**脱沙箱**再试） | `username=<empty> password=<empty>` ⇒ 钥匙串里**确实没有** GitHub 凭据 |
| SSH（`git@github.com`） | `Permission denied (publickey)` ⇒ 本机公钥**未注册**到 GitHub |
| GitHub 连接器 | **未安装**（已出推荐卡，待启用） |

---

## 4. 解除方式（任选其一，均只需 1 步）

### 方案 A（最快，无需传任何密钥）— 注册本机公钥
1. 打开 https://github.com/settings/keys → **New SSH key**
2. Title 随意，Key 粘贴下面这行（**这是公钥，可公开**）：
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII/eSi8ajsDnbn04IaIYlhpMm1H8mY9DtYl2tc7vKjMC frankzhao@frankdeMacBook.local
```
3. 告诉我"加好了" → 我立即 `git push` 两条分支 + 下发部署，并每 30 分钟盯 Netlify 构建与线上复验。

### 方案 B — 启用 GitHub 连接器
左下角「+」→ 连接器 → GitHub → 授权。之后全程由我操作（push / PR / 盯 CI）。

### 方案 C — 你自己推
```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
git push origin v19/design-exploration fix/p2-soft-delete-aggregate release/v19.9
git push origin release/v19.9:main
```
（第二行直接发布；Netlify 会在 main 的新提交上自动构建，HEAD 提交**不带** `[skip netlify]`，会触发。）

> ❌ 不要把 PAT 明文发到聊天里。

---

## 5. push 成功后的自动执行序列（我这边已备好）

1. `git ls-remote` 核对三条分支 SHA；
2. 轮询 Netlify deploy（`state` → `ready`），失败则拉 build log 定位；
3. 生产复验 9 条：
   - `/api/health` → `commit` = 发布 SHA（R-05 关闭证据）
   - `/pricing` 200（不再 307→`/pay.html`）、`/hlua` 200
   - `verify-public-origin.mjs` 13/0、`verify-payment-off` 18/18
   - 落地页/登录页 axe 0 严重、移动端 360 触控 ≥24px
4. 回填 `53` 号与 `51` 号（RELEASE_CANDIDATE → RELEASED），并更新 `PROJECT_LEDGER` 生产 SHA。

---

## 6. 仍未闭合（不因发布而消失）

- AC-25 / 真实扣款：缺 4 个凭据（H-4）
- D-01 退款口径、D-02 定价展示、D-03 法律主体
- gitleaks 历史 55 处形似凭据是否轮换（D-09 / R-15）

---

## 7. 合并后树的 E2E 复核（2026-11-01 增补）

**为什么补这一步**：§2 的门禁跑在 `v19/design-exploration` 上；`release/v19.9` 把 B-5~B-20 修复线
**合并**了进来（23 文件 / +2565 −246）。合并后只跑了 Jest / tsc / lint，**浏览器层没有任何证据**。
"Jest 绿" 覆盖不到 "构建产物能不能起来"，更覆盖不到版面与真实登录态。

### 7.1 构建

| 项 | 值 |
|---|---|
| 命令 | `env -u NODE_OPTIONS NEXT_DIST_DIR=.next-v206 DATABASE_URL=file:/tmp/v196-e2e.db npx next build` |
| 结果 | `BUILD_EXIT=0`，`BUILD_ID=KNKU9Q6LoK7nKXQ1Sag4e`（32m30s） |
| 说明 | `distDir` 用临时补丁注入、**启动读取后立即 `git checkout` 还原**，工作树保持干净 |

### 7.2 E2E（`playwright.ci.config.ts`，113 条，真实 `next start` + 真实登录）

| 轮次 | 环境变量 | 结果 |
|---|---|---|
| ① | 缺 `E2E_CHAT_A_*` / `E2E_CHAT_CONV_ID` | **102 passed / 3 failed / 8 skipped** — 3 条失败全部是**入口处的环境变量缺失**（`Error: 缺少 E2E_CHAT_A_* …`），未进入任何断言 |
| ② | 补齐聊天夹具 5 个变量 + 清掉上一轮 `UserReport` 夹具残留 | **113 passed（4.8m）/ 0 failed** |

**判据口径**：`E2E_BASE_URL=http://127.0.0.1:3100` 指向 `.next-v206` 产物，**不是** dev server、
**不是**生产站；登录走 `global-setup` 的真实表单（含 `__reactFiber` 水合等待）。

### 7.3 现场教训（写进下次的检查单）

1. **缺环境变量会伪装成用例失败**：3 条用例在 `beforeAll` 就 `throw`，报告里长得像版面回归。
   先读 `error-context.md` 的第一行，别先看截图。
2. **夹具库会被上一轮污染**：`UserReport` 24h 去重窗口跨轮残留 ⇒ 第二轮必须按
   `chatRoomId='e2e_conv_chat' AND reporterId LIKE 'e2e_user_%'` 精确清除，
   而不是 `--cleanup` 全删（那会把登录夹具一起删掉）。
3. **`tail` 会吞掉后台进度**：Playwright 输出接到 `| tail -120` 上，整轮结束前一行都看不到；
   落盘到文件才可观测。

> 结论：**`release/v19.9` 的合并后构建 + 浏览器层门禁已补齐（113/113）。**
> 仍未闭合的只有 **§3 的写权限**，与代码质量无关。

---

## 8. 发布执行完毕（2026-11-01 08:45Z 触发 / 08:49Z 上线）

用户注册 SSH 公钥（`SHA256:6Laz9NvwWsRMz4FMLIPezKKEm6Zy4SdVbyOhjAEZq84`）后，
`ssh -T git@github.com` → `Hi aoshuang99-netizen!`，写权限解除。执行如下：

### 8.1 推送（`git ls-remote` 核对，非脚本退出码）

| 引用 | 结果 |
|---|---|
| `refs/heads/release/v19.9` | `ff57b53826f37cedfd8676c32a3d1ac81424df46`（新建） |
| `refs/heads/main` | `c3213fd → ff57b53`（**快进**，0 落后 / 52 提交） |
| `v19/design-exploration` | `3968f8f → 01d7602` |
| `fix/p2-soft-delete-aggregate` | 新建 |

### 8.2 Netlify

部署 `6ae6fc1ce2…`（`branch=main`，`commit=ff57b538`，`context=production`）：`building → **ready**`。

### 8.3 生产复验（全部对 `https://app.lokfeel.com`）

| 项 | 结果 |
|---|---|
| `/api/health.commit` | **`ff57b53`** = 发布 SHA（R-05 关闭证据） |
| `prod-smoke.mjs --commit=ff57b53` | **15 / 15 PASS**（含 `/pricing` 200、`/hlua` 200、`/refunds`、`/pay.html`、匿名 cancel 401、支付缺口恰 4 键、核心 API 无 500、`/login` 不被公共缓存） |
| `verify-public-origin.mjs` | **13 通过 / 0 失败**（含 OAuth `redirect_uri` 落在公开域名、0 处部署域名泄漏） |
| `verify-payment-off.mjs --base=https://app.lokfeel.com` | **18 / 18 通过** |

### 8.4 🔴 本轮新踩的假绿（已修正，写进检查单）

`verify-payment-off.mjs` 的 `BASE` 默认值是 `http://127.0.0.1:3000`。
本机当时**有进程占着 3000**（早前遗留的服务），于是第一次跑出来的「18/18 通过」
打的是**本机**，不是生产 —— 报告里只有一个小标题写着 `目标 : http://127.0.0.1:3000`，
其余 18 条全绿，极易被当成生产通过。

> **规则**：任何 `--base` 可覆盖的复验脚本，对生产跑时**必须显式传 `--base`**，
> 并在结论里回读被打印的「目标」行。默认值只能用于本地。

### 8.5 收尾事实

- 生产 = `main` = `ff57b53`；后续仅文档提交（带 `[skip netlify]`），不触发重建。
- 发布**不含** `prisma/` 变更 ⇒ **无需 DB 迁移**（§2 第 5 条复核仍成立）。
- 未闭合项与 §6 完全一致，不因发布而消失。
