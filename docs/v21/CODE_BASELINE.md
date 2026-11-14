# V21 · CODE_BASELINE（C00 只读盘点 · 2026-11-14）

**盘点人**：WorkBuddy（Agent 模式，只读，未修改任何生产配置）。
**方法**：`git log` / `git ls-remote` / `curl /api/health` / 全仓 grep / 逐文件阅读。
**对应门禁**：V21-G01（环境、截图、候选与生产 SHA 对应关系）。

## 1. 版本与部署对应

| 项 | 值 | 证据 |
|---|---|---|
| 本地工作树 | `cad717e`（main，与 origin/main 一致，无未提交代码变更） | `git log --oneline -1` |
| 远端 main HEAD | `cad717e92542395e4346e49d388f09be78ec1557` | `git ls-remote`（结论只认 ls-remote） |
| 生产健康 | `healthy`，DB 延迟 324ms，Redis upstash 正常 | `GET https://app.lokfeel.com/api/health` 2026-11-14T09:09Z |
| 生产版本 | `b50e53e`（上一代码提交，`cad717e` 为 `[skip netlify]` 纯文档） | Netlify 只看头提交 |
| 用户截图对应 | `b50e53e` 部署后的 `/workspace` Now 屏 | 截图内容与 `b50e53e` 的「输入在前」改造一致 |

**PROD ≠ CANDIDATE 判断**：当前无 V21 候选分支；工作树即 main，尚未开始 V21 开发提交。

## 2. 审计六问题的核实结论（对 `01_SOURCE_AUDIT.md`）

| ID | 审计主张 | 核实结果 |
|---|---|---|
| A01 | 主交互是规则编译非生成式 AI | **属实**。`living-workspace.tsx:489` `runCompile()` 直接调本地 `compileWorkspaceSpec(draft)`，无模型调用。**但**服务端生成式链路已完整存在：`POST /api/v1/agents/runs`（skill `INTENT_EXTRACTION`）→ `runSkill()` → WorkBuddy/OpenAI provider → `WorkspaceSpecSchema` 校验 → 失败**诚实降级**回 `compileWorkspaceSpec`（`src/lib/agent/runtime.ts` `degrade()`）。**差距是接线，不是能力缺失。** |
| A02 | `WIRED_ACTION_KEYS` 只有 create-mission | **属实**（`living-workspace.tsx:143`）。 |
| A03 | Missions `ready:false` 死入口 | **属实**（`living-workspace.tsx:133`），但服务端 `GET /api/v1/missions`（列表/分页/状态过滤）、`GET /api/v1/missions/[id]`（详情）、`POST .../pause`（publish/pause/resume/close 状态机 + 审计）**全部已存在**。死入口是纯前端决策。 |
| A04 | 创建成功≠Agent执行 | **属实**；执行链路 `/api/v1/agents/runs/[runId]/approve|reject|execute` 存在，`executor.ts` 是 `EXECUTED` 唯一写入点。 |
| A05 | `null != 0` 应保留 | **属实**，`evidence.ts` 已执行该原则。 |
| A11 | 截图右下 `e2e.auth...invalid` 测试身份 | 截图为登录态真 UI；测试 fixture 未接入生产。生产无 QA 账号（记忆：业务 401 须先 `qa:probe:login` 定性）。 |

## 3. 首批开发结论（C02+C03+C05 打法）

- **C03 IntentGateway = 接线而非新建**：客户端 Composer 提交 → `POST /api/v1/agents/runs`（`skill:'INTENT_EXTRACTION'`, `input:{goal}`, `Idempotency-Key`）→ 读 `run.proposal`（唯一可渲染来源，服务端已过 zod）+ `run.providerKind`/`status`/`degradeCode` → UI 显示 **AI/规则 真实来源 badge**。无 `agent.run` 能力（403）或服务端不可达 → 本地规则编译**明示降级**（provenance='rule'），绝不冒充 AI。
- **C05 Mission 闭环 = 前端补视图**：`GET /api/v1/missions` + 详情 + 状态迁移全部现成；补 MissionBoard 组件，修 `ready:false` 死入口。
- **C02 Now 首屏**：原位展示理解卡（来源 badge + 降级原因 + 注入警告）+ 可执行计划，不强制跳屏。

## 4. 环境事实

- 本地 `.env.local` **无** `WORKBUDDY_LLM_*` 三键 → 本地服务端 provider `unavailable` → agent run 落 `DEGRADED`（规则降级，诚实标注）。生产 Netlify 已配置三键（记忆 + `providerHonesty`）→ 生产 AI 路径真实可用。
- 测试基线：jest 全量 120/120（截至 `b50e53e`）；e2e-ci 10 specs；产线只读 E2E 17/17。

## 5. 风险与边界

- `POST /api/v1/agents/runs` **消耗组织额度**（真实模型调用计费）——CI e2e 保持只读，不在 CI 里提交意图；真实 AI 路径用本地 dev + 显式 QA 脚本取证。
- 推送 main / 生产部署须 Owner 批准（V21 总令第七节），本批先本地全量验证。
