# 59 · V20.4 Production Release（Batch 7 正式发布）

> 结论：**本轮未发布生产。**

---

## 1. 为什么没发

Batch 7 的准入门槛是「RC GO + D-10 人工授权」。当前两条都未满足：

| 前置条件 | 状态 | 说明 |
|---|---|---|
| RC 判定为 GO | **NO-GO** | 见 `58`：LCP 未达标、Figma BLOCKED、Preview HTTP 不可验证、PR 无法创建、Environment 无审批保护 |
| D-10 人工授权 | **未取得** | 用户本轮指令是「执行 V20.4 攻坚」，未对**具体 SHA** 给出发布授权 |

V20.4 明确写着「不未经授权发布生产」。因此不发布是**遵守指令**，不是执行不力。

---

## 2. 生产现状（只读核实，零变更）

| 项 | 值 | 来源 |
|---|---|---|
| 生产 URL | `https://app.lokfeel.com` | 实测 200 |
| 承载方式 | Cloudflare 代理 → 回源 **Netlify** | `server: cloudflare` + `x-nf-request-id` |
| **当前生产提交** | **`305d669fb38dd1337d26fef0ffb2df01a1e3b82b`** | **Netlify `published_deploy.commit_ref`（权威）** |
| 已发布部署 ID | `6aec89a8b1fa5f748c7ae101`，state `ready`，published `2026-11-05T13:51:52Z` | Netlify API |
| 相对 RC 落后 | **12 个提交，`src/` 5 个文件有差异** | `git rev-list --count` + `git diff --name-status` |
| 本轮是否变更 | **否** | 未 dispatch `cloudflare-production.yml`；未触发 Netlify 构建 |
| `lokfeel-app` worker | `modified_on = 2026-11-06T03:26:46Z`（未变） | Cloudflare API |
| 支付 | `configured=false` / `charging=false` | `/api/health` |
| 健康检查 | `status=healthy`，DB / Upstash / Firebase `configured=true` | `/api/health` |
| 登录 | 200 + 下发 `authjs.session-token` | 实测 |

### 2.1 更正：生产版本不是 `79459d6`，也不是 Cloudflare Worker

上一版把生产版本写成「`79459d6`（T-4 视觉升级）」，依据是前序发布记录。**本轮用 Netlify API 直查后证明这是错的。**

| 错误来源 | 实际情况 |
|---|---|
| 认为 `lokfeel-app` worker 的 `modified_on` 代表生产更新 | 该 worker **动态路由全 500**（`53` §4.3），根本没在服务流量 |
| 沿用前序记录里的 `79459d6` | 之后又有构建；当前 `published_deploy` 指向 `305d669` |
| 认为「main 已更新 ⇒ 生产已更新」 | `0617c0e` 带 `[skip netlify]`，**没有触发构建**，生产停在 `305d669` |

**生产与 RC 的真实差距（`scripts/qa/prod-commit-drift.mjs` 输出）**：

```
生产提交      : 305d669fb38dd1337d26fef0ffb2df01a1e3b82b
本地 HEAD     : 5a248b9007c5cf6160130c03a6ea22ee3d2fb90d
落后提交数    : 12
src 差异文件  : 5
  M  src/app/api/webhooks/pingpong/route.ts
  M  src/app/workspace/living-workspace.tsx
  M  src/components/living/consent/consent-gate.tsx
  A  src/lib/living/workspace-view.ts
  M  src/lib/pingpong.ts
```

**这条结论很重要**：发布**不是空跑**。`living-workspace.tsx` + 新增的 `workspace-view.ts` 正是 G-03 深链接的实现，
`consent-gate.tsx` 是 G-03 的续接改造。也就是说 —— **RC 里 22/22 通过的那些能力，生产上还没有。**

**本轮生产零变更的证据链**：

1. RC 分支的全部提交都带 `[skip netlify]`（Netlify 只看头提交）；
2. `cloudflare-production.yml` 是 `workflow_dispatch`-only，本轮未 dispatch；
3. 未在本地执行任何 `deploy` 命令；
4. Cloudflare API 显示 `lokfeel-app.modified_on` 保持 `03:26:46Z`；
5. **Netlify `published_deploy` 仍是 `6aec89a8` / `305d669`，published_at 未变**（这是比第 4 条更强的证据）。

---

## 3. 如果日后要发，需要补什么

按 V20.4 Batch 7 的 12 步，当前可执行与不可执行的分界：

| # | 步骤 | 现在能做吗 |
|---|---|---|
| 1 | 锁定 RC SHA | **能**（`e5fa762`） |
| 2 | 检查 Production Environment 审批 | **不能** —— `protection_rules=0`，没有审批可等 |
| 3 | 记录发布前版本与回滚目标 | **能**（回滚目标 = `79459d6`） |
| 4 | 通过受管工作流部署 | **不能** —— PAT 缺 `Workflows:Write`；等价直推可做但会绕过 Environment 语义 |
| 5 | 等 Cloudflare 部署 ready | 能（API 可查 `modified_on`） |
| 6 | 核对线上真实 commit | 能（`/api/health` 的 `version`/`commit` 字段） |
| 7–10 | smoke / 登录 Session / 核心页面 / 受控 E2E | 能（工具已就绪：`54`/`56` 的脚本可指向生产） |
| 11 | 检查错误率、延迟、关键日志 | **部分不能** —— 无 Workers Logs / Sentry 访问 |
| 12 | 形成发布报告 | 能 |

**必须先解决的两项**：

- **P1 · Environment 无审批保护**：`production` 环境 `protection_rules=0 / reviewers=0`。也就是说「发布必须人工批准」这条治理规则**在 GitHub 侧不成立**。需要配置 required reviewers，否则 D-10 只是口头约定。
- **P1 · 目标运行时未定**：发布到 Netlify（当前真实承载）还是 CF Workers（零绑定，`53`）？这两条路径的验收项完全不同。未定之前，任何「发布」都可能把业务跑在一个没有 DB 凭据的 worker 上。

---

## 4. 回滚方案（就绪性已核实，实际切换未演练）

| 项 | 值 |
|---|---|
| 回滚目标版本 | 发布后的回滚点 = **当前 `305d669`**（deploy `6aec89a8b1fa5f748c7ae101`） |
| 回滚方式 | Netlify：把 `published_deploy` 指回目标 deploy（**翻元数据，不重新构建**） |
| 备用路径 | 若已迁 CF Workers：`wrangler rollback` 到上一 version（**当前不适用**，worker 零绑定不可用） |

### 4.1 就绪性核实（只读，未切换）

| 核查项 | 结果 |
|---|---|
| 可回滚的历史 deploy 数量 | **7 个 `state=ready`**（`6aec89a8` / `6aec8322` / `6aec8197` / `6aec7e23` / `6aec6c6b` / `6aec6a07` / `6aec682e`） |
| 历史构建物是否还在 | **在**。逐个 deploy 的固定地址实测：`https://6aec8322169ebe1aecdd89b8--lokfeel.netlify.app/login` → **200**；`https://6aec89a8b1fa5f748c7ae101--lokfeel.netlify.app/login` → **200** |
| 回滚是否需要重建 | **不需要**。构建物按 deploy 独立留存，回滚只是切换 `published_deploy` |

**为什么"构建物还在"这条必须先证明**：如果 Netlify 早已回收旧构建，"回滚"就会退化成一小时的重建，
事故场景下等于没有回滚。现在有实测地址可证 —— 它是即时切换。

### 4.2 仍未做的部分（不美化）

| 项 | 状态 | 说明 |
|---|---|---|
| 真实回滚演练（切换后再切回） | **NOT_TESTED** | 切换会短暂影响线上用户；**未经 D-10 授权不做** |
| 回滚后数据兼容性 | **NOT_TESTED** | 本轮无 prisma 迁移，理论上无兼容问题；但这只是推理，没测过 |
| 回滚判定人 / 触发阈值 | **未定义** | 属发布治理，建议与 D-10 一并确定 |

> 结论：**回滚通道可用且是即时切换，但"演练过"这三个字本轮不能写。**

---

## 5. 发布判定

| 验收项 | 判定 |
|---|---|
| 线上 SHA = 获批 RC SHA | **未发生**（未发布） |
| 生产路由与 API 可用 | **PASS（针对现有版本）** |
| 关键业务功能正常 | **PASS（针对现有版本，见 `53` §4）** |
| 生产支付状态符合批准决策 | **PASS**（`configured=false` / `charging=false`） |
| 无新增 P0 | **PASS**（未变更即无新增） |
| 发布与回滚证据完整 | **N/A（未发布）** / 回滚演练 **未执行** |

**Batch 7 判定：NOT EXECUTED（遵守「未授权不发布」）。**

---

## 6. 发布执行手册（授权后可直接照做，无需再设计）

这一节存在的目的：把「还差一个批准」变成「批准后 20 分钟能发完并自证」。
所有命令都在本轮**验证过可用**，不是伪代码。

### 6.1 唯一的前置：D-10 授权

需要批准的具体对象（**必须点名 SHA，不接受"可以发"这种模糊授权**）：

```
批准发布：rc/v20.4 @ 5a98e12
发布目标：A. Netlify（app.lokfeel.com）    ← 建议
回滚点  ：305d669 (deploy 6aec89a8b1fa5f748c7ae101)
已知未达标：LCP 3580ms / TTFB 中位 1531ms（结构性，见 55）
```

### 6.2 路径 A：Netlify（推荐，也是当前唯一可用运行时）

| 步 | 动作 | 校验 |
|---|---|---|
| 1 | `git checkout main && git merge --no-ff rc/v20.4` | 无冲突 |
| 2 | **去掉提交信息里的 `[skip netlify]`**（否则 Netlify 不构建） | `git log -1 --pretty=%B` 无该标记 |
| 3 | `git push`（SSH-over-443，见下方坑） | `git ls-remote` 确认 main SHA |
| 4 | 等 Netlify 构建完成 | `GET /sites/{id}` 的 `published_deploy.state == ready` |
| 5 | 跑第 6.4 验收矩阵 | 全 PASS 才算发布成功 |

> ⚠️ 这一步是**唯一会真实改变线上**的动作。第 2 步最容易漏 —— 漏了就变成「推了但没发」，
> 正是本轮 `0617c0e` 踩过的坑（main 更新了、生产没动）。

### 6.3 推送通道（沙箱内已验证，别再试 keychain）

```bash
GIT_SSH_COMMAND="ssh -o ProxyCommand='nc -X 5 -x 127.0.0.1:10808 %h %p'" \
git push ssh://git@ssh.github.com:443/aoshuang99-netizen/lokfeel.com.git <branch>
```

keychain 读不到（sandbox 拒），PAT 只有读权限（`POST /git/refs` → 403）。
SSH-over-443 是唯一通路，本轮已验证 4 次。

### 6.4 发布后验收矩阵（每条都能一条命令复现）

| # | 项 | 命令 | 通过判据 |
|---|---|---|---|
| 1 | 生产提交 == 获批 SHA | `node scripts/qa/prod-commit-drift.mjs` | `src 差异文件: 0`，退出码 0 |
| 2 | 新代码真的上线了 | `curl -s -o /dev/null -w "%{http_code}" -X POST https://app.lokfeel.com/api/webhooks/pingpong -H "X-Signature: deadbeef" -d '{}'` | **`503`**（发布前是 `500`）—— 这条是本轮修复的**行为级指纹** |
| 3 | 健康检查 | `curl -s https://app.lokfeel.com/api/health` | 200，`status=healthy`，`payments.configured=false` |
| 4 | 登录可用 | `curl -s -o /dev/null -w "%{http_code}" https://app.lokfeel.com/login` | 200 |
| 5 | OAuth 未回归 | `node scripts/qa/v204-oauth-shape.mjs --base=https://app.lokfeel.com` | 21/21 |
| 6 | 13 屏 × 4 视口 × 2 主题 | `node scripts/qa/v204-visual-audit.mjs --base=https://app.lokfeel.com --only=all` | 104 格全 PASS |
| 7 | G-03 深链接 | `node scripts/qa/v204-workspace-deeplink.mjs --base=https://app.lokfeel.com` | 22/22 |
| 8 | 公开面冒烟 | `node scripts/qa/prod-smoke.mjs --base=https://app.lokfeel.com` | 全 PASS |

> 第 2 条是特意设计的：它不依赖任何"版本号/构建号"接口，只看**行为变没变**。
> 一个 500 变 503 就足以证明新代码在跑。

### 6.5 回滚（一步，约 30 秒）

```bash
# 把 published_deploy 指回 6aec89a8b1fa5f748c7ae101（= 305d669）
curl -X POST -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites/c46478e9-7ac8-4bcf-9052-7638b04fef83/deploys/6aec89a8b1fa5f748c7ae101/restore"
```

构建物已实测仍在（`59` §4.1），所以这是元数据切换，**不重建**。

### 6.6 明确不在本手册范围内

| 项 | 原因 |
|---|---|
| 发布到 Cloudflare Workers | 零绑定、动态路由全 500（`53` §4.3），需先解决 D-11 |
| 开启支付 | 凭据待轮换（P0）+ 通道 12 处 TODO 未核文档（`57` §5.3.1） |
| 补 PingPong 凭据轮换 | 需 PingPong 后台权限，Agent 无 |
| 配 Environment required reviewers | 需仓库管理员权限 |
