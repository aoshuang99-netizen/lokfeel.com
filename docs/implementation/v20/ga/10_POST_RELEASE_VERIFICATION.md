# 10 · 发布后 15 步验证（Batch 8 实测，2026-11-10）

- 发布 SHA：`0aa24f3`（树 == RC `fd02892`，`git diff` 为空）
- 生产：`https://app.lokfeel.com` · Netlify deploy `6af2c1cb7b87b5`（production, ready）
- 原始日志：`evidence/2026-11-10_post_release_15step.log`

| # | 验证 | 命令/方法 | 结果 |
| --- | --- | --- | --- |
| 1 | 部署身份 | `GET /api/health` | **PASS** `commit=0aa24f3` `builtAt=2026-11-10T07:04:08Z` `status=healthy` |
| 2 | 部署权威源 | Netlify `published_deploy.commit_ref` | **PASS** `0aa24f3` == 发布 SHA，state=`ready`，deploy `6af2c1cb7b87b5` |
| 3 | 生产冒烟 | `prod-smoke --commit=0aa24f3` | **PASS** 15/15（含 C1 缓存头、G3/G4 未登录 307、G9 无 500、G10 支付未配置结账被拒） |
| 4 | 十项监控 | `monitor:ga --expect-commit=0aa24f3` | **PASS** 11/11（M01–M10 + G06，含 M10 漂移核对） |
| 5 | 支付关闭 | `verify-payment-off --base=prod` | **PASS** exit 0（18/18），charging=false |
| 6 | D-12 角色回归 | `verify-member-role-prod`（带 ADMIN_PASSWORD） | **PASS** 8/8（P03 自改 409、P04 授 OWNER 403、P05/P06 降级还原 200、P08 双审计） |
| 7 | OAuth 形状 | `v204-oauth-shape --base=prod` | **PASS** 21/21（state/PKCE/redirect_uri + 三类坏回调） |
| 8 | 部署漂移 | `prod-commit-drift` | **PASS** 落后 0 提交，`src/` 差异 0 文件 |
| 9 | 登录取会话 | 真实 QA 登录 + `session` 回读 | **PASS** login 200，user=qa.male@lokfeel.com |
| 10 | 组织切换 API | `POST /api/v1/organizations/active` | **PASS** 200 + 下发 `lf-active-org` cookie |
| 11 | 登出 | `POST /api/auth/logout` | **PASS** 200 + 2 条 `session-token` 清除头（Max-Age=0） |
| 12 | 新颜色随产物发布 | 抓生产 CSS 产物 grep | **PASS** 2 个 CSS 均含 `#8a5f18`（对比度修复不是"只在仓库里"） |
| 13 | 回滚点 | Netlify deploys 列表 | **PASS** `6aef0c3e303b82` @ `3e27f3c` production/ready |
| 14 | 发布标识 | `git tag v20.5.0-ga` | **PASS** annotated tag 已推远端 |
| 15 | 最终报告 | `12_FINAL_GA_RELEASE_REPORT.md` | **PASS** 见该文件 |

## 需要如实记录的一条设计特征（非缺陷）

**第 11 步的补充**：登出清除浏览器 cookie 后，**已签发的 JWT 在到期前仍被服务端接受**（手工携带旧 cookie 的 `session` 请求仍返回用户）。这是 NextAuth JWT 策略的固有语义，不是本次发布的回归：
- 真实浏览器路径：cookie 被清 → 无法再带凭证 → 等同登出；
- 应急撤销路径：`tokenVersion+1`（B0 实测旧 JWT → 401，B3 量化撤销可见延迟 61.4s，上界 90s = 60s 缓存 + 0–30s 抖动）。

若未来需要"登出即全端失效"，应改为会话表/黑名单策略——属于架构选择，非补丁。

## 结论

15/15 PASS。生产 V20.5 GA 上线完成，回滚点 `3e27f3c` 保持就绪至下一发布。
