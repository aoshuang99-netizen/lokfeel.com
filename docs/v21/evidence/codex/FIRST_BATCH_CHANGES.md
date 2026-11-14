# V21 首批交付 · 变更与证据（C02 + C03 + C05）

**基线 SHA**：`cad717e`（main，与 origin/main 一致）
**证据时间**：2026-11-14（本地构建产物 + 隔离 `file:./ci-e2e.db`，未动生产）
**工作分支状态**：本地工作树已修改，**未推送、未部署**（V21 总令第七节：推 main / 改生产须 Owner 批准）

## 一句话结论

「目标输入 → 服务端真实理解（模型/规则，来源如实标注）→ 可执行方案 → 真实任务 → 列表/详情/状态迁移」
这条链路**在本地真实跑通了**：模型路径 `providerKind=workbuddy` 产出 WorkspaceSpec v1.2；
无模型凭据时走**诚实规则降级**；任务创建/幂等/列表/详情/发布/结束/409 全部有服务端回执。

## 改了什么

### C03 · IntentGateway（新增，替换"纯前端编译"）
| 文件 | 变更 |
|---|---|
| `src/lib/living/now/intent-gateway.ts` | **新增**。`resolveIntent()`：POST `/api/v1/agents/runs`（skill=`INTENT_EXTRACTION`，带 `Idempotency-Key`）→ 读 `run.proposal` 并**再过一遍** `WorkspaceSpecSchema` → 返回 `provenance: 'ai' \| 'rule'`。403/网络/5xx → 本地规则兜底（`note` 写明原因）；401/400 → 诚实报错不兜底。`provenanceBadge()` 只认 provenance。 |
| `src/components/living/now/understanding-card.tsx` | **新增**。来源徽章（AI 理解 / 规则方案）+ 降级原因 + 注入告警 + 「来源与证据」折叠层（runId/状态/降级码）。 |
| `src/app/workspace/living-workspace.tsx` | `runCompile()`（本地 `compileWorkspaceSpec`）→ `runIntent()`（异步，真实服务端）。提交**原位**出结果，不再强制跳屏；结果出现后滚入视野（`prefers-reduced-motion` 尊重）。 |

**为什么不新写一套模型调用**：服务端 `src/lib/agent/skills.ts` 的 `INTENT_EXTRACTION` 已具备
契约骨架提示词、`untrusted` 包裹、zod 校验、额度前置判定、失败降级（`degrade()` 直接落
`compileWorkspaceSpec`）与归因（`providerKind`）。本批的缺口只是**前端从未接线**。

### C05 · Mission 闭环（新增视图 + 修复死入口）
| 文件 | 变更 |
|---|---|
| `src/components/living/missions/mission-board.tsx` | **新增**。`GET /api/v1/missions`（数组信封 + meta）/ 详情 / `POST .../pause {action}` 迁移；无 `mission.update` 能力或终态时**不渲染按钮**；错误如实展示。 |
| `src/lib/living/missions/labels.ts` | **新增**。状态人话标签 + 与服务端 `TRANSITIONS` 逐格一致的迁移表。 |
| `src/lib/living/missions/list.ts` | **新增**。`missionsFromListPayload()` —— 修正「`data` 是数组」却被按 `{items}` 读导致的**假空态**（真实缺陷，见 failure-classification）。 |
| `living-workspace.tsx` | `NAV` 七项按用户动作重命名（开始/工作区/关系网络/授权/成果/执行团队/任务），**key 不变**（深链接兼容）；`missions.ready=true`；新增 `missions` 分支；创建成功后「在『任务』里查看 →」。 |

### C02 · 首屏与信息架构
| 文件 | 变更 |
|---|---|
| `living-workspace.tsx` | 方案区抽为共享 `planSection`（开始屏与工作区屏同一份状态源）；不再出现"编译工作区"这种系统语言，主按钮改为**开始**；空态文案改为"去写下目标"。 |
| `components/living/adaptive/stage-rail.tsx` | 「Mission pipeline」→「事情走到哪一步」。 |
| `components/living/living-shell.tsx` | Inspector **默认收起**（03_UI_DESIGN_CONTRACT §栅格：默认不消耗首屏宽度），顶栏一键展开，内容不变。 |

## 测试（全部真实跑过）

| 套件 | 结果 |
|---|---|
| jest 全量 | **2777/2777 通过**（含新增 27 条 living 单测） |
| `tsc --noEmit` | 通过 |
| e2e-ci（本地构建产物 + 隔离库） | **123/123 通过**（含「任务」屏 2 视口、「提交目标 → 原位理解卡」） |
| 6 视口截图 | `now-initial` / `now-result` / `missions` × 360/390/768/1280/1440/1920，`overflowPx=0` |
| axe（`/workspace`，WCAG 2.x AA 标签） | 390×844 与 1280×800 均 **0 violations**（含 0 serious/critical） |
| C03 真实链路 QA | 模型路径 `providerKind=workbuddy` / `status=PROPOSED`；降级路径 `DEGRADED`+`rules`；幂等重放同 runId |
| C05 Mission 闭环 QA | 201 创建 → 重放 `Idempotent-Replayed` → 列表可见 → 详情一致 → publish(ACTIVE) → close(CLOSED) → 再 publish **409** |

**未做**（诚实标注）：10 人首屏可用性测试（G04）、Figma 帧与代码对照（G02，Figma 凭据仍 BLOCKED）、
可编辑 Spec 的字段级编辑（G06，当前是"重新描述目标再理解"）、跨 5 视口的视觉回归基线入库（G03 部分）。
