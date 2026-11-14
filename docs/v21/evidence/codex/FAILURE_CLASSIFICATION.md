# V21 首批 · 失败分类（FAILURE_CLASSIFICATION）

规则（同 DAG）：3 轮自动修复仍失败 ⇒ `BLOCKED`，不改断言/阈值求绿。

| # | 现象 | 分类 | 根因 | 处理 | 结论 |
|---|---|---|---|---|---|
| F1 | e2e `getByRole('button', {name:/开始/})` strict mode violation（2 个元素：导航「开始」+ 提交按钮） | **测试写法缺陷**（非产品缺陷） | 导航重命名为「开始」后与提交按钮同名 | 提交按钮加 `data-testid="intent-submit"`，断言改用 testid | 已修，123/123 |
| F2 | `MissionBoard` 列表恒空（"还没有任务"） | **产品缺陷（假空态）** | `paginated()` 的 `data` 是**数组**，代码按 `{items}` 读 | 抽 `missionsFromListPayload()` 纯函数 + 5 条单测（含未知形状不抛错） | 已修，27/27 |
| F3 | e2e auth-dialogs 3 条失败：`缺少 E2E_CHAT_A_* / E2E_CHAT_CONV_ID` | **环境装配缺陷** | 本地跑 `seed-chat-fixture.mjs` 只打印 env，未导出（CI 写 `$GITHUB_ENV`） | 夹具加 `--out=.qa-chat-e2e.local.json`，运行器统一导出 | 已修，123/123 |
| F4 | 首次 `npx jest` 在会话根目录执行（找不到 jest.config） | **工具用法** | 工作目录未落在仓库 | 统一 `bash /tmp/nr.sh` 包装脚本 + `--prefix` | 已修 |
| F5 | 单测「本地也编译不了的坏 proposal → error」失败 | **测试断言与设计冲突** | 服务端 FAILED 但目标本地可编译时，设计上应规则兜底（诚实且可用），不是报错 | 拆成两条：可编译 → 兜底 ok + note；不可编译 → error + suggestions | 已修（保持"不假成功"语义） |

## 未闭合 / 需 Owner 决策
- **CI 里不做真实 agent run**：`POST /api/v1/agents/runs` 消耗组织额度并写库，e2e-ci 保持只读；
  新用例用 `page.route` 在**边界**拦截并标注。真实链路证据由 `scripts/qa/v21-intent-gateway.mjs`
  在本地隔离库取证（模型路径与降级路径各一次）。
- **Figma（G02）**：本会话无 Figma 写入凭据 / MCP 连通，设计帧对照仍 `BLOCKED`；未伪造。
- **生产验证**：本批**未推送**。生产仍是 `b50e53e`，`/workspace` 行为未变。
