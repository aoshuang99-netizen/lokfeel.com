# G02 · Figma 权限核查 + 设计映射 + 可编辑交付准备（V21 第二批）

> **状态横幅：G02 = BLOCKED（保持）。**
> 本环境**无 Figma 写入凭据、无文件链接/授权、无 MCP/connector 连通**。
> 本批只做「权限核查 + 设计映射 + 可编辑设计交付准备」，**不伪造 Figma 证据、不假称读取了 Figma API 元数据**。
> 与 `docs/v21/V21_STATUS.md` 的 `G02 | Figma 可编辑设计与 Tokens 对齐 | BLOCKED | 本环境无 Figma 写入凭据 / MCP 连通；未伪造设计帧` 一致。

---

## 0. 权限核查结论（先把结论说死）

### 0.1 本批实际复核（只读，不打印任何凭据值）

| 核查项 | 方法 | 结果 |
|---|---|---|
| 进程环境中的 Figma 凭据变量 | 列出 `process.env` 中含 `figma` / `design token` 的**变量名**（不读值） | `FIGMA_ENV_KEYS=[]` —— 空 |
| 仓库内 Figma 相关文件 | 全仓文件名匹配 `*[Ff]igma*` | 仅命中**历史文档与校验脚本**（`docs/implementation/v19/*`、`docs/release/*`、`scripts/qa/verify-figma-import-kit*.mjs`），**无 `.fig` 文件、无 Figma 文件 URL、无 node-id 映射** |
| 既有可导入资产包 | `docs/release/lokfeel-final-20261110/figma-import-kit/` | 存在 `tokens.json` / `frames.csv` / `components.csv` / `README.md`，但其 README 第 3 行明确写「**这不是 Figma 文件，G3 仍然 BLOCKED**」 |

> 历史 README 第 4 行另记录第四轮凭据复核：`env`、仓库 `.env*`、`~/.workbuddy/mcp.json`、
> `list_installed_plugins(type=connector) = No connectors installed` **四类全空**。
> 本批复核了其中 `env` 一类（仍为空），其余三类沿用该历史结论并在此标注来源，**不冒称本批重新逐项跑过 MCP 连接**。

### 0.2 结论

- **没有 Figma token、没有文件 key、没有写入权限、没有 MCP/connector** ⇒ G02 **BLOCKED**。
- **本文件所有映射均为「基于源码推断」**，不是 Figma API 元数据、不是从设计稿读回的数据。
- 不产出 `.fig`、不写「Tokens 已对齐」、不把 HTML/代码预览当可编辑设计交付（历史 README §6 已把此列为踩雷项）。

### 0.3 需要 Owner 提供的具体权限 / 文件 key（缺一不可）

| # | 需要 Owner 提供 | 用途 | 具体形态 |
|---|---|---|---|
| 1 | **Figma 访问令牌** | 读文件 / 读 Variables / 读组件；写回则需提升 | Personal Access Token 或 OAuth，scope 至少 `files:read`、`file_variables:read`、`file_components:read`；写回另需 `files:write`、`file_variables:write` |
| 2 | **文件 key / 分支链接** | 定位唯一设计源文件 | `https://www.figma.com/file/<FILE_KEY>/...` 或 `.../design/<FILE_KEY>/branch/...`；`<FILE_KEY>` 由 Owner 给出，**本批不猜、不编** |
| 3 | **团队 / 项目 ID** | 若用组织级组件库或 Variables | Figma Organization/Team id |
| 4 | **组件库发布权限 + 席位** | 把主组件发布为 Library、供 Variables 消费 | 可写成员席位 + 邮箱，Dev Mode 可见 |
| 5 | **Variables Collection 命名约定** | 与仓库既有资产包对齐 | 既有系统名 `landing-light` / `public-dark` / `--lf-*`（`[data-lf-theme=field]` 深色 / `[data-lf-theme=paper]` 浅色），见 `verify-figma-import-kit.mjs:72-77` |
| 6 | **node-id 回填授权** | 每帧 `file URL + node id` 回填到帧/组件清单 | 可写权限 + 允许写回 `frames.csv` / `components.csv` / 验收矩阵 |
| 7 | **MCP / connector 授权**（若走工具链） | 让 Agent 能直连 Figma | 绑定并启用对应 connector；历史记录为 `No connectors installed` |

---

## 1. 方法：figma-to-code Phase 3（组件识别与拆分）入口

按已加载技能 `figma-to-code` 的要求：**无 Figma 链接 / 授权 ⇒ 从 Phase 3（组件识别与拆分）入口**，
基于现有代码组件树做映射，并**注明推断依据**。

- **本批采用**：Phase 3 = 从源码组件树识别组件、拆分层级、建立「组件 → 语义 → Token」映射。
- **明确不采用 / 不假称**：没有调用 Figma API、没有读取过任何 Figma 帧 / node / Variables 元数据、
  没有 Component Set / Variant 的 Figma 侧数据。下表的每一行都标注为**源码推断**。
- **Phase 4（Token 化 / 语义化）原则**用于 §4 的**自查清单**（供凭据到位后执行），本批不执行 Token 写回、
  不生成/修改任何 Figma Variables。

### 1.1 推断依据（全部为仓库内可读源码，非 Figma）

| 依据 | 路径 | 提供什么 |
|---|---|---|
| 七屏组件树 / NAV 人话术语 | `src/app/workspace/living-workspace.tsx:123-131`（`NAV`）、`src/components/living/living-shell.tsx:163` | 七屏 key、标签、装配关系、深链接 `?view=` |
| 七屏术语的测试口径 | `tests/e2e-ci/workspace-tabs.spec.ts:29-37`（`VIEWS`） | 「开始/工作区/关系网络/授权/成果/执行团队/任务」逐字对照 |
| 组件清单 | `src/components/living/**/*.tsx` | 19 个组件文件（见 §3） |
| 组件引用关系 | 静态统计（见 §3 注） | 「复用次数」列 |
| Design Token 权威源 | `src/app/globals.css:1727-1754`（`field` 深色）、`1759+`（`paper` 浅色）、`1793+`、`1938+`（reduced-motion） | `--lf-*` 变量：色板 / 圆角 / 动效 / 焦点环 |
| Token 权威性的既有结论 | `docs/release/lokfeel-final-20261110/figma-import-kit/README.md:41-48` | V20.7 作战包指定 `--lf-*` 为 Workspace/Console 唯一权威色板 |
| 既有可导入交付格式 | `docs/release/lokfeel-final-20261110/figma-import-kit/{README.md,tokens.json,frames.csv,components.csv}` | §5 交付格式沿用此约定 |

---

## 2. 七屏组件树（源码推断，非 Figma 帧）

```
/workspace  (src/app/workspace/living-workspace.tsx · 单路由 + ?view= 深链接)
└── LivingShell  (src/components/living/living-shell.tsx · aria-label="工作区导航")
    ├── StageRail        (四段阶段条，常显)
    ├── [navigation]     7 × button · aria-current="page"
    ├── [inspector]      证据/详情抽屉（aria-label="证据与详情" / role="dialog"）
    └── [main] 按 activeKey 二选一渲染：
        ├── now      「开始」        → composer(hero) + UnderstandingCard + LivingCanvas + Loadable(待处理)
        ├── studio   「工作区」      → UnderstandingCard + LivingCanvas（与 now 共用 planSection）
        ├── field    「关系网络」    → FieldCanvas (→ FieldGraphView[dynamic] / FieldListView) + FieldInspector
        ├── consent  「授权」        → ConsentSubTabs → ConsentGate | BridgePanel + 对应 Inspector
        ├── outcomes 「成果」        → OutcomeObservatory + ObservatoryInspector
        ├── agents   「执行团队」    → AgentBoard + AgentsInspector
        └── missions 「任务」        → MissionBoard → [mission-list] → [mission-detail]
                                        ├── MissionSpecSection → SpecEditor（方案版本/字段级编辑）
                                        └── ExecutionPanel（运行/审批/执行/回执/独立核验）
```

| view key | 人话术语 | 主组件 | 深链接 | 备注 |
|---|---|---|---|---|
| `now` | 开始 | `living-workspace.tsx` 内联 section | `/workspace`（默认） | 输入框在首屏正中，只渲染一个 `#lf-composer` |
| `studio` | 工作区 | `LivingCanvas` | `?view=studio` | 与 now 共用同一份 `planSection` |
| `field` | 关系网络 | `FieldCanvas` | `?view=field` | `FieldGraphView` 为 `dynamic()` 懒加载 |
| `consent` | 授权 | `ConsentGate` / `BridgePanel` | `?view=consent` | 子面板（同意与披露 / 跨社群），**不新增第八屏** |
| `outcomes` | 成果 | `OutcomeObservatory` | `?view=outcomes` | |
| `agents` | 执行团队 | `AgentBoard` | `?view=agents` | |
| `missions` | 任务 | `MissionBoard` | `?view=missions` | 列表 → 详情 → ExecutionPanel / SpecEditor |

---

## 3. 组件 → 语义 → Token → 复用次数 映射表

> ⚠️ **全表基于源码推断，非 Figma API 元数据。**
> 「语义」是从组件职责翻译成的人话；「Token」取自 `globals.css` 的 `--lf-*` 权威源；
> 「复用次数」是**源码 `import ... from` 静态引用点计数**（见下方统计口径），**不是 Figma 设计稿里的组件实例数**。

| # | 组件（源码路径，均在 `src/components/living/` 下，除标注外） | 语义（人话） | 代表性 Token（`--lf-*`） | 复用次数¹ |
|---|---|---|---|---|
| 1 | `living-shell.tsx` | 七屏共用外壳：导航、证据抽屉、顶栏、底部输入条 | `--lf-bg` `--lf-surface` `--lf-line` `--lf-text` `--lf-signal` `--lf-radius` `--lf-dur-fast` `lf-focus-ring` | 1（**七屏共用**） |
| 2 | `living-canvas.tsx` | 把 WorkspaceSpec 摊成白名单节点画布 | `--lf-surface` `--lf-line` `--lf-text-muted` `--lf-radius-lg` | 1 |
| 3 | `node-card.tsx` | 单个节点卡（intent/candidate/consent/action/outcome/agent 六型） | `--lf-surface` `--lf-line` `--lf-text` `--lf-signal` `--lf-danger` `--lf-success` `--lf-radius` | 1（画布内按 `nodes` 渲染 N 个实例） |
| 4 | `living-states.tsx` | **共享三态**：loading / error / empty 的真实反馈 | `--lf-text-muted` `--lf-danger` `--lf-line` `--lf-radius` | **4**（被 agent-board / bridge-panel / consent-gate / outcome-observatory 引用） |
| 5 | `adaptive/stage-rail.tsx` | 提案→同意→执行→成果 四段阶段条 | `--lf-line` `--lf-text-faint` `--lf-signal` | 1 |
| 6 | `now/understanding-card.tsx` | 理解卡：目标摘要 + 来源徽章（AI/规则）+ 降级原因 | `--lf-surface` `--lf-line` `--lf-text` `--lf-signal` `--lf-radius` | 1 |
| 7 | `now/spec-editor.tsx` | 方案字段级编辑器（改期限/对价/判据、版本 diff、409 冲突） | `--lf-surface-2` `--lf-line` `--lf-text` `--lf-danger` `--lf-signal` `--lf-radius` | 1（经 mission-spec-section） |
| 8 | `missions/mission-board.tsx` | 任务列表 + 详情装配 + 状态迁移 | `--lf-surface` `--lf-line` `--lf-text` `--lf-radius` | 1 |
| 9 | `missions/mission-spec-section.tsx` | 方案版本 / 历史 / 编辑入口（内含 SpecEditor） | `--lf-surface` `--lf-line` `--lf-text-muted` `--lf-radius` | 1 |
| 10 | `missions/execution-panel.tsx` | 服务端真实执行闭环：运行/审批/执行/回执/独立核验 | `--lf-surface` `--lf-line` `--lf-danger` `--lf-success` `--lf-signal` `--lf-radius` | 1 |
| 11 | `field/field-canvas.tsx` | 关系网络主视图（取数 + 图/列表切换） | `--lf-surface` `--lf-line` `--lf-text` `--lf-radius` | 1 |
| 12 | `field/field-graph.tsx` | 关系网络图（懒加载） | `--lf-line` `--lf-signal` `--lf-text` | 1² |
| 13 | `field/field-inspector.tsx` | 选中网络节点的详情面板 | `--lf-surface` `--lf-line` `--lf-text-muted` | 1 |
| 14 | `field/field-fallback.tsx` | 移动端关系网络列表降级视图 | `--lf-surface` `--lf-line` `--lf-text` | 1 |
| 15 | `consent/consent-gate.tsx` | 同意与披露：谁能看到哪个字段 | `--lf-surface` `--lf-line` `--lf-signal` `--lf-danger` `--lf-radius` | 1 |
| 16 | `bridge/bridge-panel.tsx` | 跨社群协议（各自划范围、成员逐个加入） | `--lf-surface` `--lf-line` `--lf-text` | 1 |
| 17 | `observatory/outcome-observatory.tsx` | 成果核验（自报/对手方确认/外部验证三档） | `--lf-surface` `--lf-line` `--lf-success` `--lf-text` | 1 |
| 18 | `agents/agent-board.tsx` | 执行团队：Agent 运行、哪一步等你批 | `--lf-surface` `--lf-line` `--lf-signal` `--lf-danger` `--lf-radius` | 1 |
| 19 | `app/workspace/living-workspace.tsx`（装配层，非 `living/**`） | 七屏状态机、理解卡、缺口提示、创建结果 | 同 #1 + `--lf-text-faint` `--lf-dur` | 1（单一根） |

**统计口径与脚注（诚实登记）**：

- ¹ 「复用次数」= 在 `src/components/living/**` 与 `src/app/workspace/**` 中，以 `from '<path><组件名>'` 形式
  import 的**引用点数**，由静态计数得出（复核命令：对 `src` 下 `.ts/.tsx` 扫描 `from ['"][^'"]*<name>['"]`）。
  它衡量「被几个父组件引用」，**不等于** Figma 设计稿里该组件的实例数量，也不等于运行时渲染次数。
  计数时间：2026-11-15。**源码推断，非 Figma 数据。**
- ² `field-graph.tsx` 由 `field-canvas.tsx:37` 以 `dynamic(() => import('./field-graph'))` **动态导入**，
  `from`-正则未命中，故静态计数为 0；实际为 1 处动态引用，已人工核对后如实登记为 1²，不隐藏。
- `living-states.tsx` 的 4 次引用具体来自：`agents/agent-board.tsx`、`bridge/bridge-panel.tsx`、
  `consent/consent-gate.tsx`、`observatory/outcome-observatory.tsx`。
- 主题变体：`--lf-*` 有 `field`（深色，`globals.css:1727+`）与 `paper`（浅色，`1759+`）两套取值，
  另有 `prefers-reduced-motion` 下 `--lf-dur-* = 0ms`（`1938+`）。Token 列写的是**变量名**，不是某一套的固定色值。

---

## 4. Phase 4（Token 化 / 语义化）自查清单

> 这一节是把 `figma-to-code` Phase 4 原则转成本批可用的**自查清单**，供凭据到位后执行。
> 本批**不执行** Token 写回；「现状」列如实写「源码已具备 / 待 Figma 对齐 / 未核查」，不写成「已对齐」。

| # | 自查项 | 判据 | 现状（源码推断） | 凭据到位后动作 |
|---|---|---|---|---|
| 1 | 语义命名 | 组件名描述职责（人话），不描述视觉（如「大蓝按钮」） | 源码已具备（§3 语义列） | Figma 主组件名与代码名一一对应 |
| 2 | 颜色 Token 化 | Workspace 色值全部走 `--lf-*`，无硬编码 hex | 源码已具备（`globals.css` 权威源）；**未做全量硬编码扫描** | 全量扫描 + Variables Collection 对齐 |
| 3 | 主题变体 | `field` / `paper` 两套 + reduced-motion | 源码已具备（CSS 变量） | Figma 建两个 Mode 对应两套 |
| 4 | 状态色语义 | signal / danger / success / warning 各司其职，不混用 | 源码已具备（§3 Token 列） | Variables 语义别名对齐 |
| 5 | 文本层级 | `--lf-text` / `-muted` / `-faint` 三级 + 对比度 | 源码已具备；对比度实测**待人工/脚本**（见 `scripts/qa/contrast-tokens.mjs`，非本批） | Figma Text Styles + 对比度标注 |
| 6 | 圆角 / 间距 / 动效 | `--lf-radius*` / `--lf-dur*` / `--lf-ease` | 源码已具备 | Figma 数值与变量对齐 |
| 7 | 焦点环 | 所有可交互元素有 `lf-focus-ring`，键盘可见 | 源码广泛使用；全覆盖**待脚本/人工** | Figma focus 变体 |
| 8 | 组件变体 | default / hover / focus / disabled / loading / error / empty 齐全 | 三态由 `living-states.tsx` 保证；**变体全集待人工** | Figma Component Set + Variants |
| 9 | 响应式 | 6 档视口不横向溢出、移动优先 | 由 `v21-batch2-visual.mjs` 覆盖（**待运行**） | Figma 帧按 6 视口建 Auto Layout |
| 10 | 帧 ↔ 代码可追溯 | 每帧有 `code_path` + `file URL + node id` | **BLOCKED**（无 Figma 文件） | 回填 `frames.csv` 与验收矩阵 |
| 11 | 组件 ↔ 代码可追溯 | 每主组件有 `code_path` | **BLOCKED**（无 Figma 文件） | 回填 `components.csv` |
| 12 | 不假绿 | 资产包 ≠ Figma 可编辑交付；BLOCKED 不计完成率 | 已遵守（本文件 §0 / 历史 README §6） | 凭据到位前 G02 保持 BLOCKED |

---

## 5. 可编辑设计交付准备清单

### 5.1 缺什么（逐项，缺一不可）

| # | 缺口 | 归属 | 状态 |
|---|---|---|---|
| 1 | Figma 访问令牌（scope 见 §0.3 #1） | Owner | **缺（BLOCKED）** |
| 2 | 文件 key / 分支链接 | Owner | **缺（BLOCKED）** |
| 3 | 可写权限 + 组件库发布席位 | Owner | **缺（BLOCKED）** |
| 4 | MCP / connector 绑定（若走工具链） | Owner | **缺（历史记录：No connectors installed）** |
| 5 | node-id 回填授权 | Owner | **缺（BLOCKED）** |
| 6 | **V21 七屏**的帧清单（既有 `frames.csv` 是 10 个公开页 × 2 断点，**不含七屏**） | 设计负责人 + 前端 | **缺（本批不补，见下）** |
| 7 | **V21 组件清单**（既有 `components.csv` 是 9 个共享组件，未含 `execution-panel`/`spec-editor`/`mission-board` 等第二批组件） | 设计负责人 + 前端 | **缺** |
| 8 | 本批 §3 映射表 ↔ Figma 主组件的逐条对账 | 设计负责人 | **缺（需 Figma 侧数据）** |
| 9 | 指定验收人 | Owner | **缺** |

> 本批**不修改**既有 `figma-import-kit/`（其它线/历史资产，禁改）。§3 的映射表是本批新建的
> `docs/v21/batch2/` 交付物，可作为「凭据到位后补帧/补组件」的输入，但**不冒充**已写入 Figma。

### 5.2 交付格式（凭据到位后沿用仓库既有约定）

沿用 `docs/release/lokfeel-final-20261110/figma-import-kit/` 的机器可读格式，并补齐 V21 增量：

| 文件 | 内容 | 本批状态 |
|---|---|---|
| `tokens.json` | `--lf-*` color token（field / paper 两套）+ typography，含源码行号、用途、对比度备注 | 既有资产包已有 33 token / 3 systems；V21 增量待核 |
| `frames.csv` | 每帧 `frame_name, route, code_path, width, height, ...`；**V21 需补七屏 × 6 视口** | 缺 V21 帧 |
| `components.csv` | `component, code_path, states, spec_ref`；**V21 需补 §3 的 19 个组件** | 缺 V21 组件 |
| `README.md` | 导入步骤、边界、不假绿声明 | 既有；V21 版待写 |
| **可编辑 `.fig` 文件** | Figma 原生、含 Frames / Auto Layout / Variables / Component Sets / Prototype | **本批未产出（无凭据）** |
| **Variables Collection** | 按 `landing-light` / `public-dark` / `--lf-* field|paper` 分 Collection 与 Mode | **本批未产出** |
| **node-id 映射回填** | 每帧/每组件 `file URL + node id` 回填到 CSV 与验收矩阵 | **本批未产出** |
| 截图对照 | `docs/v21/batch2/shots/*.png`（由 `v21-batch2-visual.mjs` 产出，待运行） | 工具已交付，截图待主代理运行 |

导入步骤（沿用既有 README §2，凭据到位后执行）：
1. Tokens/Variables 导入 `tokens.json`，按 system 建 Collection、按 type 建 Color/Text styles；
2. 按 `frames.csv` 逐行建 Frame（移动端用 Auto Layout 纵向排列）；
3. 按 `components.csv` 建主组件并补齐 `default/hover/focus/disabled/loading/error/empty` 变体；
4. 连 Prototype（七屏 `?view=` 切换流）；
5. 每帧/组件标注 `code_path`，回填 `file URL + node id` 到 CSV 与 G02 验收行 —— **做完这步 G02 才可由 Owner 改判 PASS**。

### 5.3 验收人

| 角色 | 职责 |
|---|---|
| **Owner**（必需） | 提供凭据/文件 key/权限、签署 G02 结论、批准改判 |
| 设计负责人 | 确认 Frame / Component Set / Variables 与 §3 语义一致、命名对齐 |
| 前端代表 | 确认 `code_path` 与源码组件一一对应、Token 取值与 `globals.css` 一致 |
| QA / 本批 Agent | 提供 §3 映射表、视觉截图、可复跑校验；**不代签 G02** |

### 5.4 验收判据（G02 由 BLOCKED → PASS 的条件，全部满足才可改判）

- [ ] §0.3 的 1–7 项凭据/权限全部到位且实测可读（不是「应该能读」）；
- [ ] 产出**可编辑 `.fig`**（非 HTML/代码预览），含七屏 Frames + Variables + 主组件；
- [ ] `frames.csv` / `components.csv` 覆盖 V21 七屏与 §3 组件，且每帧/组件有 `code_path + node id`；
- [ ] Token 取值与 `globals.css` 的 `--lf-*` 逐条对账无漂移；
- [ ] 由 Owner 或指定验收人签署，未签署前 **G02 保持 BLOCKED**。

---

## 6. 状态与交接

| 项 | 状态 |
|---|---|
| Figma 权限核查（env / 文件 / MCP） | 本批复核 `env` 为空；其余沿用历史「四类全空」结论 |
| Phase 3 组件识别与拆分映射表（§3） | **本批已交付**（基于源码推断，非 Figma API 元数据） |
| Phase 4 自查清单（§4） | **本批已交付**（清单，未执行写回） |
| 可编辑设计交付准备清单（§5） | **本批已交付** |
| 可编辑 `.fig` / Variables / node-id 回填 | **BLOCKED / 未产出** |
| G02 结论 | **BLOCKED（保持），未对齐、未签署、不得改判 PASS** |

> 再次声明：本文件没有读取任何 Figma 帧、node 或 Variables；所有「组件/语义/Token/复用次数」均为
> **源码推断**。把它写成「Figma 已对齐」或伪造一个文件 key / node id，等同于伪造设计证据。
