# V19-00 · 工程与设计基线（BASELINE）

> 本轮所有值都在 2026-10-23T11:50Z **现场重验**，不沿用上一轮报告的数字。

## 1. 环境核验（实测）

| 项 | 值 | 取证 |
|---|---|---|
| 本地 HEAD | `c3213fd060087d978f9db793b727eafad5460a8f` | `git rev-parse HEAD` |
| `origin/main` | 同上（fetch 后比对） | `git ls-remote` |
| 工作树 | 干净 | `git status --short` |
| 分支 | `main` → 本轮设计工作在 **`v19/design-exploration`** 独立分支进行 | `git branch` |
| CI（`c3213fd`） | 17 项 = 16 成功 / 2 跳过 / 0 失败 | check-runs API |
| 生产 | `dc102cd`（**未部署**，`D-10` 未批准） | 下表生产探针 |
| 生产探针 | `/api/health` **无 `commit` 字段** · `payments.configured=false`（缺 4 键）· `/pricing` **307→Hlua** · `/hlua` **404** | 真实 HTTP（2026-10-23T08:19Z） |

> 结论：V18.3 工程发布**仍未完成**，V19 设计工作不依赖发布、不触碰主线，全部在新分支进行。

## 2. 真实路由清单（逐个从 `src/app/**/page.tsx` 枚举，共 60 个页面 / 202 个 API 路由）

| 组 | 路由 |
|---|---|
| **SaaS 主线** | `/workspace`（单路由，内含六视图：Now / Studio / Field / Consent / Outcomes / Agents —— V16 定稿的结构，**不是六个独立 URL**） |
| **Console 七屏** | `/console` · `/console/agents` · `/console/connections` · `/console/members` · `/console/missions` · `/console/missions/[missionId]` · `/console/outcomes` · `/console/settings` |
| **公开面** | `/` · `/login` · `/register` · `/forgot-password` · `/reset-password` · `/verify-request` · `/pricing` · `/refunds` · `/privacy` · `/terms` · `/cookies` · `/about` · `/contact` · `/support` · `/faq` · `/hlua` · `/18-usc-2257` · `/dmca` · `/cancellations-policy` · `/community-guidelines` · `/content-removal-appeals-policy` · `/fan-creator-agreement` · `/press` · `/careers` · `/safety-tips` |
| **Legacy B2C（只修一致性，不重新包装）** | `/dashboard` · `chats` · `chats/[roomId]` · `connections` · `explore` · `matches/[id]` · `notifications` · `onboarding` · `profile` · `profile/[id]` · `settings` · `subscription`(+`/cancel`,`/success`) |
| **其他** | `/admin/*`（20 屏）· `/m/[token]/*`（magic-link 邀请流）· `/admin-login` · `/auto-login` |

## 3. 基线截图（真实 Chromium · 18 张）

`docs/implementation/v19/screenshots/production-dc102cd/` · 脚本 `scripts/qa/v19-baseline-shots.mjs`（1440×900 与 390×844 双视口）。

| 路由 | 结果 | 关键发现 |
|---|---|---|
| `/` | 200 | **生产首页已是 Connection OS 表达**（"Describe the outcome. Get a workspace that runs it."）——旧记忆中"首页仍是交友叙事"已过期 |
| `/login` `/register` | 200 | 与首页同一浅色暖调体系 |
| `/pricing` | 307 → `/pay.html` | 🔴 **浏览器截图坐实 R-01**：点"定价"落地的是 Hlua Pass 结账页（`_pricing__390x844.png`） |
| `/refunds` `/pay.html` | 200 | |
| `/hlua` | **404** | HEAD 已建页，生产未发布 |
| `/workspace` `/console` | 307 → `/login?callbackUrl=…` | 守卫生效（匿名正确） |

**认证面（Workspace 六视图 / Console 七屏）没有生产截图**：需要登录态，而生产测试账号依赖 `D-06`（待批）。
这块基线以**代码级审计**（§见 `02_UI_AUDIT.md`）+ CI 里的隔离库 E2E 证据代替，不拿登录页冒充业务屏。

## 4. 本轮边界

- 全部工作在 `v19/design-exploration` 分支；**不合并 main、不触发生产部署**。
- 设计原型不含真实业务动作（见各原型页脚的 prototype 标注）。
- Legacy B2C 面只登记一致性问题，不重设计。
