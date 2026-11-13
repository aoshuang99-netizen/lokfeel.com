# 02 · 主分支与发布治理（T1）

> 结论：**根因已定性、代码侧缓解已完成；治理配置 `BLOCKED`（需仓库/Netlify 管理员）。**
> 我没有 `gh`、没有 `GITHUB_TOKEN`、没有 `NETLIFY_AUTH_TOKEN`，因此不能"假装"已完成 ruleset 或关闭自动发布。

## 1. 事故的可复现流程（不是猜测）

```
① 本地在 main 上提交（前置提交都带 [skip netlify]）
② 再提交一个**不带** [skip netlify] 的头提交 0e16959
③ git push origin main
④ Netlify 读取**头提交消息** ⇒ 无跳过标记 ⇒ 触发生产构建
⑤ 构建产物 = main 当时的整棵树（含 B2 五个公开页 + 首页改版）
⑥ 生产 /product /solutions /stories /how-it-works /help 由 404 变为 200
```

实测证据：`health.commit=0e16959`、`builtAt=2026-11-12T12:29:15Z`；
哨兵独立记录 `11:33:50Z RISK_OPEN/5a161c4` → `13:38:05Z CLOSED/0e16959`。

**根因不是"忘了写标记"，而是"发布权在开发者手上"**。标记只是让这个权力偶尔失效。

## 2. 已做的代码侧缓解（本轮）

| 措施 | 效果 | 位置 |
|---|---|---|
| 所有新工作只在 `release/v20.7-ga` 分支 | 不再直推 main | 本分支 |
| 公开面渲染层冻结 | 即便再次误发版，五个页面也只输出占位，不输出商业声明 | `src/components/marketing/public-hold.tsx` + 5 页面早返回 |
| 导航/页脚/sitemap 同源过滤 | 不产生孤儿入口 | `src/config/public-surface.ts` |
| 提交自检 | 推送前确认**头提交**含 `[skip netlify]` | 见 §4 |

## 3. 必须由管理员完成的配置（我列清单，不代做）

### 3.1 GitHub `main` 规则集（Settings → Rules → Rulesets）

- Target: `main`；Enforcement: **Active**
- ✅ Require a pull request before merging（required approvals ≥ 1）
- ✅ Require status checks to pass：`Typecheck`、`Lint`、`Build`、`Test`、`E2E（构建产物 · 浏览器冒烟）`、`Secret scan`
- ✅ Require branches to be up to date
- ✅ Block force pushes / 禁止删除分支
- ✅ Do not allow bypassing the above settings（含管理员）

### 3.2 Netlify（Site configuration → Build & deploy）

二选一（推荐其一，不要都开）：

- **A. Stop auto publishing**：生产只允许手工 "Deploy" 或经批准 PR 的合并触发；
- **B. Locked deploys + Deploy Preview only**：`main` 不再自动发布，PR 合并后由人工点发布。

同时：`Deploy previews` 打开（基于真实 PR），`Branch deploys` 只留 `main`。

### 3.3 独立 PR（当前 `BLOCKED`）

Compare URL（点开即可建 PR）：
`https://github.com/aoshuang99-netizen/lokfeel.com/compare/main...release/v20.7-ga?expand=1`

建议 PR 标题：`release(v20.7-ga): 公开面保守冻结 + 定价金额商业门 + 触控目标 ≥24px`

## 4. 在治理落地前，我自己的操作纪律（已写入流程）

1. 只推 `release/v20.7-ga`，**不推 main**；
2. 任何推送前 `git log -1 --format=%B | grep -q '\[skip netlify\]'`，不通过就不推；
3. 每次推送后用 `git ls-remote` 复核远端 SHA（脚本退出码不算证据）；
4. 推送后 60 秒内查 `health.commit/builtAt` 是否变化 —— 变化即视为"发生了发布"，立即记录并评估。

## 5. 验收（T1 PASS 的定义）

| 判据 | 现状 |
|---|---|
| 不带 `[skip netlify]` 的提交不能直达生产 | ❌ 未配置（`BLOCKED`） |
| PR 必须通过 required checks 才能合并 | ❌ 未配置 |
| Preview 基于真实 PR 且 `state=ready` | ❌ 未配置 |
| 代码侧：误发版也不泄漏未批准声明 | ✅ 已实现（冻结） |
