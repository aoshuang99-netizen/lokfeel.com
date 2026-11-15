# 七屏 UI/UX 自查清单（V21 第二批 · P1-06）

> 配套脚本：`scripts/qa/v21-batch2-visual.mjs`（视觉/无障碍）、`scripts/qa/v21-batch2-perf.mjs`（性能）。
> 本报告是**自查清单（协议级）**，不是实测结论。理由见 §0。

---

## 0. 范围、方法与诚实边界

**范围**：`/workspace` 单路由下的七屏（`?view=` 深链接）+ 三类状态截图态 + 无障碍面。

**依据（全部源码/测试可读，非实测截图）**：

| 依据 | 路径 |
|---|---|
| 七屏标签 / hint / 装配 | `src/app/workspace/living-workspace.tsx:123-131`、`919-1198` |
| 七屏术语逐字对照 | `tests/e2e-ci/workspace-tabs.spec.ts:29-37` |
| 首屏无工程噪声 / 证据面板默认收起 | `tests/e2e-ci/workspace-now.spec.ts:40-65` |
| 共享三态 / `null != 0` | `src/app/workspace/living-workspace.tsx:180-216`、`225-248`、`991-1029` |
| 任务三态 + 前置非空断言 | `src/components/living/missions/mission-board.tsx:78-124`、`190-199` |
| 导航 / 证据抽屉语义 | `src/components/living/living-shell.tsx:136`、`163`、`192`、`224`、`244` |
| 移动版面既有判据 | `tests/e2e-ci/lib/measure.ts:45-67`、`134-162` |
| Design Token / reduced-motion | `src/app/globals.css:1727-1754`、`1938-1940` |

**标签定义（先定，避免把「写了脚本」说成「已通过」）**：

| 标签 | 含义 |
|---|---|
| **已由脚本覆盖** | 本批 `v21-batch2-visual.mjs` / `v21-batch2-perf.mjs` **已实现该检查项**。⚠️ 但**脚本本批未运行**（本地服务重建中，用户明确禁止启动/运行），因此是「覆盖能力已具备」，**不等于已验证通过**；实测值待主代理统一运行后写入 `visual-report.json` / `perf-trace.json` 再回填。 |
| **待人工** | 自动化无法替代，需真人 / 读屏 / 视觉评审 / Owner 判定。括号内若写「脚本部分覆盖」，仍归入本类，不冒充已覆盖。 |

**不假绿条款**：本文件不出现「已通过 / 全部达标 / 0 violations（实测）」等结论性表述；涉及数值一律指向「待运行回填」。

---

## 1. 七屏人话术语核对

判据：标签是**用户动作/对象**短语，不是设计/工程术语（源码 `living-workspace.tsx:114-121` 注释明确：hint 写给用户看，不写「2.5D」「逐字段披露」这类设计术语）；且与 `workspace-tabs.spec.ts` 的 `VIEWS` 逐字一致。

| view key | 人话术语 | Nav hint（写给用户的话） | 屏内标题/主文案 | 人话? | 工程噪声风险 | 核对结论 |
|---|---|---|---|---|---|---|
| `now` | **开始** | 今天要推进什么 | `h1`「今天想推进什么？」+ 输入框 + 种子示例 | ✅ | 首屏曾被实截图吐槽为「六行 `GET /api/notifications`」 | 由 `workspace-now.spec.ts:40-46` 断言可见文本无 `/api/`、无裸 `GET /`；证据面板默认收起（`:48-65`，`complementary` 计数 0），接口只在折叠 `<details>` 内 |
| `studio` | **工作区** | 把一句话摊成能跑的方案 | `<h1>工作区</h1>` + 方案全貌 | ✅ | 空态曾写工程自辩 | 空态改人话「还没有方案。先写下一个目标。」并给「去写下目标」按钮（`living-workspace.tsx:1106-1123`）；`workspace-now.spec.ts:124-138` 断言不出现「不会为了填满」 |
| `field` | **关系网络** | 谁认识谁，谁在等你 | `FieldCanvas` | ✅ | 图节点可能暴露内部 id | 详情走 `FieldInspector`，图由纯函数装配；**待人工**确认节点标签是人名/关系而非 id |
| `consent` | **授权** | 谁能看到你的哪个字段 | `同意与披露` / `跨社群` 两个子面板 | ✅ | 「受众档位」「CONSENT_AUDIENCES」等枚举词 | 子面板不新增第八屏（`living-workspace.tsx:263-307`）；**待人工**确认无枚举名外泄 |
| `outcomes` | **成果** | 做成了什么，怎么核验 | `OutcomeObservatory` | ✅ | 验证档位枚举（SELF_REPORTED 等） | `missionStatusLabel` / 标签层做人话映射；**待人工**确认逐屏可见文本 |
| `agents` | **执行团队** | Agent 干了什么，哪一步等你批 | `AgentBoard` | ✅ | 能力不足时每屏吃 403 | 以能力集开关取数（`living-workspace.tsx:427-433`）；**待人工**确认 403 不在正文裸show |
| `missions` | **任务** | 你交代过的事都在这里 | `我的任务` + 列表 → 详情 | ✅ | 把权限错误读成「没有任务」 | `mission-board.tsx:190-199` 前置非空断言 + 权限错误原文（`Loadable` `errorSuffix`） |

**一致性**：`NAV`（7 项）与 `workspace-tabs.spec.ts` `VIEWS`（7 项）**逐字一致，7/7**；改名不改 key（`?view=` 深链接兼容，`workspace-view.ts:16-20`）。

**术语核对结论**：七屏标签全部为人话，未发现设计/工程术语混入导航；`now` 的 h1 与导航标签「开始」是「屏内标题」与「导航项」的正常分工，不记为不一致。
**残留风险（待人工）**：各屏**正文**是否还有英文枚举 / 接口路径 / 内部 id 外泄，脚本未做全文人话扫描，需人工逐屏过一遍（见 §6）。

---

## 2. 三态（loading / error / empty）核对

判据：每个数据区必须有三态**真实**反馈（`living-workspace.tsx:179-180` 硬约束）；读不到 ≠ 0；错误不当空态。

| 数据区 | loading | error | empty | 源码证据 | 标签 |
|---|---|---|---|---|---|
| Now 待处理区 | 「正在读取…」`role=status` | 「读取失败：{error}」`role=alert` | 人话空态「没有需要你处理的事…」 | `living-workspace.tsx:180-216`、`1077-1094` | **待人工**（三态存在性由源码/e2e 保证；本批脚本未对每态单独截图） |
| Now 理解请求 | 「正在让系统理解你的目标…」真实 pending（不用假流式） | 服务端原因 + 支持的目标类型 | 无结果态 = 尚未提交 | `living-workspace.tsx:991-1029`、`intent-gateway.ts:93-104` | **待人工**（`now-initial`/`now-result` 截图间接覆盖 2 态，error 态未专项取证） |
| 三个计数格 | `null` → 「—」 | 读不到写「暂时读不到」 | 0 写「没有新消息」等 | `living-workspace.tsx:225-248`（`MetricCell`，null≠0） | **待人工** |
| Missions 列表 | 「正在读取…」 | 权限错误原文（不读成空） | 人话空态「还没有任务…」 | `mission-board.tsx:78-124`、`190-199`、`234-275` | **待人工**（`kind=ok & count=0` 视为异常，不假绿） |
| Missions 详情 | 详情读取态 | 读取失败 / 数据异常 | 未选中 = 不渲染详情 | `mission-board.tsx:284-368` | **待人工**（`missions-detail` 截图覆盖 selected 态） |
| ExecutionPanel 四段 | `role=status aria-live` | `role=alert` | 无运行/无回执如实说明 | `execution-panel.tsx:288`、`310`、`635`（honesty-note） | **待人工** |
| 方案版本 / 编辑器 | 读取态 | `mission-spec-invalid` | `mission-spec-empty` | `mission-spec-section.tsx:86-125`、`spec-editor.tsx:415-441` | **待人工** |
| 共享三态组件 | `living-states.tsx`（被 4 个屏内组件复用） | | | `FIGMA_MAPPING.md` §3 #4 | **待人工** |

> 三态的**代码存在性**由源码与既有 e2e 断言把守；**逐态视觉取证**本批脚本未做，统一标「待人工」，不冒充已覆盖。
> 建议后续在 `visual.mjs` 增补 `loading/error/empty` 三态截图（本批范围外，登记为待办，不改其它线）。

---

## 3. 移动优先

| 项 | 判据 | 覆盖 | 标签 |
|---|---|---|---|
| 6 档视口无横向溢出 | `scrollWidth <= clientWidth`（`overflowPx=0`），360/390/768/1280/1440/1920 | `visual.mjs` 每视口每状态测 overflow | **已由脚本覆盖** |
| 结果态 / 任务详情态无横向溢出 | 同上，在 `now-result` / `missions-detail` 两态复测 | `visual.mjs` | **已由脚本覆盖** |
| 200% 缩放无横向溢出 | CSS `zoom=2` 后 `overflowPx=0` | `visual.mjs` `zoom200Of()` | **已由脚本覆盖** |
| 触控目标 ≥24×24（WCAG 2.2 AA 2.5.8） | `measure()` 逐元素量，句内链接豁免 | 既有 `tests/e2e-ci/lib/measure.ts:134-162`（390/360）；**本批脚本未测** | **待人工**（既有 e2e 有判据，需主代理确认该 spec 在候选上跑过） |
| 首屏输入在正中（移动端） | `#lf-composer` 唯一实例、在首屏 hero 区 | `workspace-now.spec.ts:28-38`；`living-workspace.tsx:945-984`、`752-806` | **待人工**（视觉评审确认「一眼看到输入框」） |
| 移动端不塌版（长任务标题/四位数计数） | 等 DOM 稳定后再量，避免量到骨架 | 既有 `measure.ts:45-67` `waitForStableDom`；`visual.mjs` 亦在状态就绪后测量 | **已由脚本覆盖**（部分：溢出）/ **待人工**（其余视觉） |

---

## 4. 无障碍自查清单（逐项标注）

| # | 项 | 判据 | 证据 / 说明 | 标签 |
|---|---|---|---|---|
| 4.1 | axe WCAG 2.x AA 0 violations | 390 / 1280 两档、`wcag2a/2aa/21a/21aa`、逐状态 0 violations | `visual.mjs` `runAxe()`：now-initial + missions-detail 两状态 × 2 视口 | **已由脚本覆盖** |
| 4.2 | 键盘可达：Tab → `intent-submit` | 顺序 Tab 扫描能聚焦 `[data-testid=intent-submit]`（先 fill 使其 enabled） | `visual.mjs` `scanTabOrder()` | **已由脚本覆盖** |
| 4.3 | 键盘可达：Tab → 任务详情按钮 | 能聚焦 `[data-testid=mission-item]`（点击进入 `mission-detail`） | `visual.mjs`；无夹具时该项 **BLOCKED**（不假绿） | **已由脚本覆盖** |
| 4.4 | 200% 缩放 | CSS zoom=2 后无横向溢出 | `visual.mjs` `zoom200Of()`；`deviceScaleFactor` 仅记录、不作独立判据 | **已由脚本覆盖** |
| 4.5 | 焦点可见 | 每个可聚焦元素有 `lf-focus-ring`，焦点环肉眼可辨 | 源码广泛使用 `lf-focus-ring`；Tab 扫描能看到焦点移动 | **待人工**（脚本部分覆盖：仅证明可聚焦，不证明焦点环可见） |
| 4.6 | 焦点顺序合理 / 无键盘陷阱 | Tab 顺序符合 DOM，证据抽屉 `role=dialog` 打开后可返回 | `living-shell.tsx:244` dialog；顺序合理性需人工 | **待人工**（脚本部分覆盖：4.2/4.3 只验到达，不验全序） |
| 4.7 | 读屏（NVDA / VoiceOver） | 七屏朗读顺序、landmark、`aria-live` 动态播报正确 | `navigation[aria-label=工作区导航]`、`complementary[aria-label=证据与详情]`、`role=status/alert` | **待人工**（自动化不可替代） |
| 4.8 | 语义角色 / 标题层级 | 每屏单一 `h1`、landmark 完整、按钮 `aria-current` | `living-shell.tsx:163/192`；`living-workspace.tsx:954`（h1） | **待人工**（脚本部分覆盖：axe 覆盖部分语义规则） |
| 4.9 | 颜色对比度 | 文本三级（`--lf-text/-muted/-faint`）达 AA | `globals.css:1734-1736`；既有 `scripts/qa/contrast-tokens.mjs`（**非本批**） | **待人工** |
| 4.10 | 表单 label 关联 | `#lf-composer` 有 `sr-only` label；`intent-submit` 有 title/aria-disabled | `living-workspace.tsx:756-758`、`781-784` | **待人工**（脚本部分覆盖：axe 含 label 规则） |
| 4.11 | 400% 缩放 / 文本间距 / 高对比模式 | WCAG 1.4.10 / 1.4.12 / 强制颜色 | 本批只做 200% | **待人工** |
| 4.12 | reduced-motion | 动效尊重 `prefers-reduced-motion` | `globals.css:1938-1940` 把 `--lf-dur-*=0ms`；`living-workspace.tsx:472-475` 滚动降级 | **待人工**（需真机/系统设置验证） |
| 4.13 | 性能可用状态（G15） | TBT/LCP/CLS/INP 近似逐页如实记录 | `perf.mjs`（**未运行**）；本地 lab ≠ 生产达标 | **已由脚本覆盖**（采集能力）/ 结论 **待人工**（Owner 判读） |
| 4.14 | 真人理解（G04） | ≥8/10 理解并完成首屏任务 | `G04_USABILITY_PROTOCOL.md`；**BLOCKED/UNTESTED** | **待人工**（且需 Owner 组织，不得自签） |

---

## 5. 覆盖矩阵汇总

| 维度 | 已由脚本覆盖（能力） | 待人工 | 关联交付物 |
|---|---|---|---|
| 视觉 / 溢出 | 6 视口 × 3 状态 `overflowPx=0`、200% 缩放 | 首屏视觉评审、长文本塌版观感 | `visual-report.json`、`shots/*.png` |
| 无障碍 | axe 两档零违规、Tab 到 2 个关键控件、zoom | 读屏、焦点环/顺序、对比度、400%、reduced-motion、`aria-live` 人工复核 | `visual-report.json` |
| 三态 | `now-initial`/`now-result`/`missions-detail` 三态截图（间接） | loading/error/empty 逐态专项取证 | `shots/*.png`（待运行） |
| 性能 | 9 页 × 3 轮 TBT/LCP/CLS/INP 近似 + Trace 摘要 | 门槛判读、生产/字段数据、GA 判定 | `perf-trace.json` |
| 术语 | 七屏标签逐字对照（源码层） | 各屏正文全文人话扫描 | 本文件 §1 |
| Figma / 真人 | — | G02 权限/对齐、G04 招募/执行 | `FIGMA_MAPPING.md`、`G04_USABILITY_PROTOCOL.md` |

**实测状态**：以上「已由脚本覆盖」的**证据文件当前均不存在**（脚本未运行）。
待主代理在服务就绪后统一运行，再用 `visual-report.json` / `perf-trace.json` / `shots/` 回填本表实测列。

---

## 6. 待人工项清单（交 Owner / 人工评审）

1. 七屏**正文**全文人话扫描：英文枚举、接口路径、内部 id、403/错误原文是否外泄（§1 残留风险）。
2. 三态 `loading / error / empty` 逐态视觉截图与文案复核（§2）。
3. 读屏（NVDA + VoiceOver）七屏全流程朗读、焦点顺序、动态区域播报（§4.5–4.8）。
4. 焦点环可见性、焦点陷阱（证据抽屉 `role=dialog`）（§4.5–4.6）。
5. 颜色对比度实测、400% 缩放、文本间距、强制颜色/高对比模式（§4.9、4.11）。
6. reduced-motion 真机验证（§4.12）。
7. 触控目标 ≥24px 在候选构建上的既有 e2e 复核（§3）。
8. 独立视觉评审（W01，历史 `V21_STATUS.md` G03 缺口）。
9. 性能门槛的**生产/字段**判读与 GA 结论（§4.13）——本地 lab 结果不得写成生产达标。
10. G02 凭据与 Figma 对齐、G04 真人招募与签署（分别见两份文档）。

---

## 7. 诚实边界（再声明一次）

- **两个脚本本批均未运行**：本地服务重建中，用户明确「不要启动服务器、不要跑需要服务的脚本」。
  已做的只有 `node --check` 语法检查（通过）与静态源码核对。
- 因此本文件是**协议级自查清单**，不是实测报告；所有「已由脚本覆盖」= **脚本已实现该检查**，
  **不等于已通过**。把本文件写成「验收通过」等同于伪造实测。
- 关联门禁现状（与 `docs/v21/V21_STATUS.md` 一致，本批不改判）：
  `G02 BLOCKED` · `G04 UNTESTED` · `G14 PARTIAL（键盘/200%/读屏缺口）` · `G15 UNTESTED（Trace/LCP/INP 未采）` · `G20 NO-GO`。
- 本批新增能力：把 G14 的「键盘 / 200% 缩放」、G15 的「Trace/Vitals 采集」从**未做**推进到
  **工具已交付、待主代理运行取证**——**状态仍不是 PASS**，不自行改判任何门禁。
