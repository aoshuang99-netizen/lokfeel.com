# 09 · 发布 Runbook（Batch 8 执行版）

- 适用：LokFeel V20.5 GA（2026-11-10 首次执行，实际流程即本文）
- 原则：**单一通道**（main 推送 → Netlify 构建）、**先迁移后发版**、**发布即验证**、**回滚点先确认**

## 1. 发布前（已在 Batch 7 完成，此处为可复用清单）

1. RC 分支 `release/v20.5-ga` 与 `main` 同 SHA。
2. CI 全绿：`CI ×2 + CodeQL + Cloudflare Preview`（本次 `fd02892`）。
3. GO 10/10（`08_RC_ACCEPTANCE.md`）。
4. 回滚点确认：`GET api.netlify.com/.../deploys` 中上一 production deploy 仍 `ready`（本次 `3e27f3c` / `6aef0c3e303b82`）。
5. prisma 变更？本次**无** ⇒ 跳过迁移；有则迁移先行。

## 2. 发布动作（人工批准后执行）

```bash
# ① 发布提交：头提交消息**不得**含 [skip netlify]（Netlify 只看头提交）
git commit --allow-empty -m "release(v20.5-ga): ..."   # 树与 RC 完全一致
git push <ssh-remote> main

# ② 等待构建（约 5 分钟）
curl -s https://app.lokfeel.com/api/health | jq '{commit, builtAt, status}'
```

本次结果：`commit=0aa24f3 builtAt=2026-11-10T07:04:08Z status=healthy`，Netlify deploy `6af2c1cb7b87b5`（production, ready）。

## 3. 发布后 15 步（见 `10_POST_RELEASE_VERIFICATION.md`，全过）

## 4. 回滚（任一步失败即执行，不"再观察一下"）

```bash
# 方式 A：Netlify 一键回滚到上一个 production deploy（推荐，秒级）
curl -X POST -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  https://api.netlify.com/api/v1/sites/c46478e9-7ac8-4bcf-9052-7638b04fef83/deploys/6aef0c3e303b82/restore

# 方式 B：git revert 发布提交（保留审计痕迹，不 rewrite）
git revert --no-edit <release-sha> && git push <ssh-remote> main
```

回滚后必须重跑：`prod-smoke --commit=<回滚后SHA>` + `monitor:ga`。

## 5. 纪律（本周期内化，勿违）

- 非发布推送一律 `[skip netlify]`；已推送的提交**禁止** `--amend`。
- 推送结果只认 `git ls-remote`（脚本退出码不算）。
- 生产窗口期 `request.url` 是部署域名会丢 cookie ⇒ 统一走 `public-origin.ts`。
- 禁止改阈值/删断言求绿；Figma 无权限就记 `BLOCKED_FIGMA_WRITE`。
