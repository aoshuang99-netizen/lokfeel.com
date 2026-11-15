# V21 第二批 · 发布候选（RC）SHA 与版本对应

**结论：NO-GO｜本地候选，未推送、未部署、未改生产。** 本文件只登记版本对应关系，不构成发布批准。

## 发布候选

| 角色 | SHA | 取证方式 |
|---|---|---|
| **发布候选（代码 + 测试 + 全部证据树）** | **`dbb95a7182256ed693e12066f630885f3082fa1d`**（短 `dbb95a7`） | `git log -1 --format=%H` on `v21/batch2` |
| RC 审批包 HEAD | `dbb95a7` 之后的**纯文档回填提交**（只改 `.md`，回填本文件与 SHA 索引） | `git log -2 --oneline` |
| 首批基线 | `f6665640bf1ff5e385accf4d329209207196bb65` | `git log -2` |
| 本地 `main` | `f666564...`（**未被本批移动**） | `git rev-parse main` |
| 远端 `main` | `cad717e92542395e4346e49d388f09be78ec1557`（**未推送**，与首批一致） | `git ls-remote origin refs/heads/main` |
| 生产 | `b50e53e`，`/api/health` `{"status":"healthy","commit":"b50e53e","commitSource":"env"}` | `curl --noproxy '*' https://app.lokfeel.com/api/health`（2026-11-15） |

候选提交内容：**114 files changed, 44767 insertions(+), 252 deletions(-)**，含 18 张六视口截图、37 份红队原始响应、4 个可重放 QA 脚本、9 页性能 Trace 原始数据。

## 为何有两个提交（自指问题的诚实处理）

审批包里要写「发布候选 SHA」，而写有该 SHA 的文档本身不能在同一个提交里自指。因此：

1. `dbb95a7` = **代码树**（发布候选本体，用于验收 / 远端 CI / Preview / 部署）。
2. 紧随其后的提交仅回填 `.md` 文档中的 SHA 索引，并新增本文件。

复核两提交之间**无代码差异**：

```bash
git diff dbb95a7 HEAD --name-only                       # 应只列出 .md 文件
git diff dbb95a7 HEAD -- '*.ts' '*.tsx' '*.mjs' '*.prisma' '*.json'   # 应为空
```

`src/generated` 生成产物已包含在 `dbb95a7` 内（CI 不重跑 `prisma generate`）。

## 发布前置（缺一不可，均未完成）

- 本批**含 Prisma 变更**：3 张新表 + 2 个可选列 ⇒ **先迁移后发版**，并在回滚演练中验证 `IdempotencyRecord.actorId=NULL` 旧记录的重放语义变化。
- G15 **9/9 MISS**（`PERF_ANALYSIS.md`）、G09 PARTIAL（仅 IN_APP 回执）、G02 BLOCKED、G04 UNTESTED、G20 外部独立复核未做。
- Owner 的 9 项批复、远端 CI 全绿、Preview 与回滚验证、生产档 RUM/Trace 复测，全部待办。

逐条门禁与授权需求见 **`RC_APPROVAL_PACKAGE.md`**（本批唯一状态页）。
