# 14 · 部署与回滚

## 一、本轮提交链（main，全部已推送）

| 提交 | 内容 | 生产状态 |
|---|---|---|
| `9ba9075` | 基线（CI 全绿） | 已下线 |
| `6e11646` | T01：Admin 订阅页白屏 + 功能开关页假数据/hydration | — |
| `51d452a` | T02：公开叙事统一 + 品牌门禁 | — |
| `56fd575` | T00/T03/T04：审计与三套原型（纯文档 + 脚本） | — |
| `e5e8846` | 设计 C + F-01/F-04/F-09 + 对比度门禁 + 发布审计脚本 | ready |
| `194acc4` | F-02/F-03/F-05/F-07/F-08（legacy 语义与开发者口径） | ready |
| `1e0a2bd` | LCP（rAF 延后）+ 触控目标 44px | ready |
| `6ca90de` | 主图 WebP（228KB → 65KB）+ 审计脚本 `--out` | 本次部署 |

## 二、部署拓扑

| 项 | 值 |
|---|---|
| 托管 | Netlify（免费计划） |
| 站点 id | `c46478e9-7ac8-4bcf-9052-7638b04fef83` |
| 域名 | `app.lokfeel.com`（Cloudflare 橙云 → `lokfeel.netlify.app`） |
| 构建 | `npm run build`（`@netlify/plugin-nextjs`，Node 22） |
| 触发 | 推送到 `main` 自动部署 |
| 观察 | `GET https://api.netlify.com/api/v1/sites/{id}/deploys?per_page=5` |

## 三、本轮**没有**数据库迁移

- 没有新增/修改 Prisma 模型（阶段条只用既有端点，`providerKind` 早已是 `TEXT` 无 CHECK）。
- 因此不需要 snapshot / plan / apply；回滚只涉及代码。
- 🔴 若后续要动 schema：先迁移后发版是铁律（snapshot → plan → apply → verify → diff → 发布），
  `db push` 对远程 Turso 不可用。

## 四、回滚

### 代码回滚（推荐）

```bash
git revert --no-edit 6ca90de 1e0a2bd 194acc4 e5e8846   # 按逆序
git -c http.proxy=http://127.0.0.1:10808 push origin main
```
推完等 Netlify 构建（约 90s），再跑 §五 的复验。

> 为什么用 revert 而不是 force push：`main` 是共享分支，rewrite 会破坏其他人的工作树；
> 且 Netlify 只看**头提交**，force push 后的构建记录会失去对照。

### 一键回滚到上一个可用部署（应急，最快）

Netlify 控制台 → Deploys → 找到 `1e0a2bd` 的 ready 部署 → **Publish deploy**。
代价：站点立刻回退，但 GitHub `main` 仍指向前进方向，下次推送会再覆盖回来 ——
所以应急之后必须补一次 revert，否则状态会"漂"。

### 单点开关（不需要回滚整站）

| 想关掉什么 | 做法 | 影响 |
|---|---|---|
| 双世界配色 | 删掉 `living-shell.tsx` 上的 `dualWorld`（一行） | 回到单一主题，阶段条仍在 |
| 阶段条 | 不传 `stageRail` prop | 六屏其余功能不变 |
| CF Analytics beacon | 去掉 `next.config.ts` 里的 `static.cloudflareinsights.com` | 恢复 F-01 的 console error |

## 五、部署后必跑的复验

```bash
curl -s https://app.lokfeel.com/api/health | head -c 400     # DB / Redis / Firebase
npm run verify:brand-scan                                    # 公开叙事
npm run verify:contrast                                      # 令牌对比度
npm run audit:release                                        # 溢出 / 触控 / LCP / reduced-motion
node scripts/qa/v16-ux-audit.mjs --out=after                 # 13 屏截图
```

## 六、窗口期注意（历史踩坑）

部署后约 20 分钟内，`request.url` 可能是**部署专用域名**，任何基于 `request.url` 拼的跳转
都会丢 cookie（登录态"随机掉线"）。代码里一律走 `src/lib/http/public-origin.ts`；
复验用 `node scripts/qa/verify-public-origin.mjs`（生产 13/0）。
