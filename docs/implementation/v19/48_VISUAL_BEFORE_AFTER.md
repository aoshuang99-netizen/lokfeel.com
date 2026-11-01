# 48 · 视觉改动 Before/After 台账（V19-85 · Batch 6）

- 日期：2026-10-31
- 基线：Batch 5 收口提交 `048c90f`（分支 `v19/design-exploration`）
- 视觉探针：`scripts/qa/v198-visual-audit.mjs`（13 屏 × 4 视口 × 双主题 = 104 格）
- 取证环境：本地生产构建（`.next-v203` = Before / `.next-v204` = After）@ localhost:3000 + `file:/tmp/v196-e2e.db`
- 证据目录：
  - Before：`/tmp/v198-visual-before/`（104 截图 + `visual-results.json`，**104 PASS / 0 FAIL**，触控<24 明细见 §3）
  - After：`/tmp/v198-visual-after/`（104 截图 + `visual-results.json`）

## 0. 本批改动总览（每项：Before → 问题 → 改动 → After → 门禁）

| # | 改动 | 文件 | 性质 | Before 证据 | After 证据 |
|---|---|---|---|---|---|
| D-1 | 加载/错误态补 `sr-only` h1 | `src/app/console/page.tsx` | a11y（屏幕阅读器页面身份） | Batch5 深审发现：加载态 h1=0 | 104 格 h1=1；axe 0 违规 |
| D-2 | 加载/错误态补 `sr-only` h1 | `src/app/console/settings/page.tsx` | a11y | 同上 | 同上 |
| T-1 | 字段名按钮 min-h-6（24px） | `src/components/living/consent/consent-gate.tsx` | 触控目标（WCAG 2.5.8） | `BUTTON:昵称(28x20)`…共 8 项 | 复跑无触控<24 |
| T-2 | 技能选择按钮 min-h-6 | `src/components/living/agents/agent-board.tsx` | 触控目标 | `BUTTON:意图抽取(58x23)`、`介绍草稿(58x23)` | 复跑无触控<24 |
| T-3 | 级别选择按钮 min-h-6 | `src/components/living/observatory/outcome-observatory.tsx` | 触控目标 | `BUTTON:外部已核验(69x23)` | 复跑无触控<24 |
| O-1 | 对价抽取加模糊措辞守卫 | `src/lib/workspace-spec/compile.ts` | 诚实性（意向≠承诺） | 「看情况可以给…」会被当 offer | 新增 4 条回归全绿 |
| O-2 | `MISSION_MIN` 改为派生自服务端 `LIMITS` | `src/lib/workspace-spec/assemble.ts` | 前后端校验一致性 | 手抄数字，可漂移 | 新增 3 条回归全绿 |

## 1. 视觉审计矩阵（104 格）

13 屏 = Console 七屏（overview / agents / connections / members / missions / outcomes / settings）
+ Living Workspace 六页签（Now / Studio / Field / Consent / Outcomes / Agents）。

4 视口 = 360×800 / 390×844 / 768×1024 / 1440×900；双主题 = dark（Deep Field）/ light（Paper，经
`prefers-color-scheme` 模拟，**不注入任何 theme 覆盖** —— 保留 Adaptive Dual World 与 `--lf-*` 令牌作用域）。

### Before（`.next-v203`，含 D-1/D-2、不含触控修复）

**104 PASS / 0 FAIL**（无水平溢出、内容非空、360/390 触控全达标）。
两处非门禁记录：

1. **桌面视口触控目标 <24px**（1440，非 360/390）：Consent 字段名按钮 8 项 20px 高、
   Agents 技能选择 23px、Outcomes 级别选择 23px —— 触发本轮 T-1/T-2/T-3 修复（见 §3）。
   360/390 移动视口无此问题（移动端布局渲染的是不同的控件组合），但这三类按钮是
   **同一组件**，桌面命中说明 WCAG 2.5.8 在所有视口都不达标，属于应修缺陷而非豁免项。
2. **`-light` 格实际渲染 Deep Field 暗色**：双世界 `readThemeSnapshot` 的 `dualDefault`
   分支强制默认 Deep Field，跟随系统浅色不会把画布盖成纸面（V16 设计 C 的既定行为，
   见记忆与 `design/` 概念稿）。审计的 `-light` 格因此与 `-dark` 格渲染一致 ——
   这不是缺陷：它证伪的是「跟随系统浅色导致浅色画布」这一回归方向，保留双主题格
   正是为了在行为改变时立刻暴露。

### After（`.next-v204`，含全部 Batch 6 修复）

**104 PASS / 0 FAIL**（2026-10-31 复跑，`BUILD_ID=hShxF-Fl0SCrWEOqzJXTB`）：

| 指标 | Before（v203） | After（v204） |
|---|---|---|
| 总格数 / 通过 | 104 / 104 | 104 / 104 |
| 水平溢出 >1px | 0 格 | 0 格 |
| 触控 <24px 命中（任意视口） | 3 屏 10 处（Consent 8 + Agents 2 + Outcomes 1 类） | **0 处** |
| 360/390 触控门禁 | ✅ | ✅ |
| h1 缺失格 | 0（加载/错误态已由 D-1/D-2 覆盖） | 0 |
| 截图 | 104 张 | 104 张 |

（Before 轮曾出现 6 格假 FAIL，根因是探针 settle 量到加载态 —— 已在探针层修复
（忙碌指示器判据），见 §5；该 6 格在 Before 修正判据后的正式轮次为 PASS。）

## 2. D-1 / D-2：加载与错误态的页面身份（屏幕阅读器）

- **Before Screenshot**：`/tmp/v198-visual-before/console-overview-1440-light.png`
  （加载态：「正在读取队列状态…」，`h1=0` —— Batch 5 深审发现）
- **Problem**：`/console` 与 `/console/settings` 的加载/错误分支不渲染标题层级。
  屏幕阅读器用户在慢网下进入这两个状态会丢失页面身份（不知道自己在哪页）。
- **Code Change**：两文件的 `isLoading` 与 `error` 分支各补 `<h1 className="sr-only">…</h1>`。
  常态标题不受影响（同一页面恒有且仅有一个 h1 语义项）。
- **After Screenshot**：`/tmp/v198-visual-after/console-overview-1440-light.png`（h1=1）
- **axe Result**：Batch 5 深审 49 格 0 违规；本轮 104 格无新增违规。
- **E2E Result**：视觉审计 104 格 `h1=1`；Console 深审可复跑（`node scripts/qa/v198-console-deep-audit.mjs`）。
- **Commit SHA**：见本文件提交记录（Batch 6 提交）。

## 3. T-1/T-2/T-3：触控目标 ≥24px（WCAG 2.5.8）

- **Before Screenshot**：`/tmp/v198-visual-before/ws-consent-1440-dark.png`（Consent 表格）、
  `ws-agents-1440-dark.png`、`ws-outcomes-1440-dark.png`
- **Problem**（探针实测，`visual-results.json` detail 字段）：
  - Consent 字段名按钮：`昵称(28x20) 头像(28x20) 个人简介(56x20) 城市(28x20) 国家/地区(61x20) 职业(28x20) 公司(28x20) 行业(28x20)`
  - Agents 运行选择：`意图抽取(58x23) 介绍草稿(58x23)`
  - Outcomes 级别选择：`外部已核验(69x23)`
  高度 20/23px < 24px 最低目标尺寸。
- **Code Change**：三处按钮统一 `inline-flex min-h-6 items-center`（`min-h-6` = 24px），
  水平 padding 由 `px-1.5` 提到 `px-2`。不做大改：布局、字号、交互全部保留。
- **After Screenshot**：`/tmp/v198-visual-after/` 对应三屏（复跑 detail 无 `触控<24`）。
- **axe Result**：无新增违规（改动只加高度，不引入新元素）。
- **E2E Result**：视觉审计 104 格复跑全绿（触控维度门禁 360/390 本就达标，修复后桌面也达标）。
- **Commit SHA**：同上。

## 4. O-1 / O-2：对价抽取诚实性与前后端校验一致性（执行令附加回归）

执行令五条要求与落点：

| 要求 | 落点 | 结果 |
|---|---|---|
| 无 offer 不得自动生成虚假对价 | 既有「没写对价 → 不补默认值」+ 本批 compile 回归 | ✅ |
| 含模糊描述不得误判为明确 offer | **新增**模糊措辞守卫（`OFFER_VAGUE_RE`）+ 4 条回归 | ✅ |
| 用户修改描述后可以重新编译 | **新增**「before 无 offer → 修改后 body 可用」回归 | ✅ |
| 前端与服务端校验规则一致 | `MISSION_MIN` 改为**派生自** `LIMITS`（不可能漂移）+ 3 条回归 | ✅ |
| 重复提交不产生第二个 Mission | 三层防护已在位（无需改码）：按钮 `disabled={pending}` → 同 body 复用同一 `Idempotency-Key` → 服务端重放返回同一任务（Batch 4 O-01 已证） | ✅ |

守卫语义：命中 `看情况|视情况|再说|再议|待定|暂定|到时候|不一定|不确定|也许|或许|尽量|酌情|考虑一下|如果方便|有需要的话|可能`
的句子**跳过**（不终止匹配 —— 后面可能还有具体承诺句）。测过不误伤：明确承诺句（"我们愿意承担全部活动经费"）仍正常抽取。

单测：`tests/workspace-spec/compile.test.ts` + `tests/workspace-spec/assemble.test.ts`
= **71 tests / 71 passed**（`node node_modules/.bin/jest tests/workspace-spec/compile.test.ts tests/workspace-spec/assemble.test.ts`）。

## 5. 探针自身的三次防假绿升级（本轮踩坑记录）

1. 固定等待 → 量到骨架（`console-agents-768 len=155`）→ 改「连续 3 次采样不变」；
2. 骨架态**也是稳定的**（`overview-1440-light len=13`）→ 加「忙碌指示器
   （`.animate-spin`/`.animate-pulse`/`[aria-busy]`）必须消失」；
3. D-1 的 `sr-only h1` 让 `hasH1` 判据在加载态为真 → 判据改为三者同时满足。
   另：页签切换前断言 `aria-current="page"` 转移 + `resetSettle` 清稳定计数，杜绝量到上一屏。

## 6. 复跑命令

```bash
# 服务（生产构建）
DATABASE_URL=file:/tmp/v196-e2e.db NEXT_DIST_DIR=.next-v204 npx next start -p 3000
# 视觉审计（104 格）
NO_PROXY='localhost,127.0.0.1' PW_CHANNEL=chrome node scripts/qa/v198-visual-audit.mjs --shot-dir=/tmp/v198-visual-after
# 单测
node node_modules/.bin/jest tests/workspace-spec/compile.test.ts tests/workspace-spec/assemble.test.ts
```

---

## 7. 52a · T-4 三屏视觉升级（V19.9 · 2026-11-01）

- 分支：`t4/v199-visual`（基于 `release/v19.9` = `ff57b53`）· 代码提交：**`5248223`**
- 参考图映射见 `52_NEXT_CYCLE_DIRECTIVE.md` §T-4；**只做视觉/信息层级升级，不动契约与状态机**
- 取证环境：本地生产构建（`.next-v206` = Before / `.next-v207` = After，`BUILD_ID=LcNIwG6mFkhqcydIEZo6O`）@ localhost + `file:/tmp/v196-e2e.db`
- 证据目录（**这次进了仓库**，不再放 /tmp）：
  - Before：`docs/implementation/v19/screenshots/v199-t4/before/`（104 截图 + `visual-results.json`，**104 PASS / 0 FAIL**）
  - After：`docs/implementation/v19/screenshots/v199-t4/after/`（104 截图 + 3 张整页补拍，**104 PASS / 0 FAIL**）

### 7.1 改动总览

| # | 屏 | 改动 | 文件 | 参考图要点 |
|---|---|---|---|---|
| A-1 | `/console/agents` | 「运行概览」三卡：需要人工介入（含按状态分解 + 注入旁证）/ 进行中 / 本期成本 | `src/app/console/agents/page.tsx` | ① Needs Attention 聚合卡 |
| A-2 | `/console/agents` | 「按技能名册」表：技能 / 运行 / 调用 / 成本（含条形分解）/ 最近活跃 / 需关注 | 同上 | ① roster 表 + Cost Breakdown |
| A-3 | `/workspace` Consent | 「待你裁决」横幅前置（动作逐个来自服务端 `availableActions`） | `src/components/living/consent/consent-gate.tsx` | ② Human approval required |
| A-4 | `/workspace` Consent | 提案四步进度清单（已发起 → 我方 → 对方 → 已介绍，逐步打勾） | 同上 | ② Latest actions 勾选清单 |
| A-5 | `/workspace` Consent | 审批时间线（`introducedAt` / `expiresAt` / 当前状态，标注来源字段） | 同上 | ② Audit log 时间线 |
| A-6 | `/workspace` Outcomes | 三段验证流程条：已自报 → 验证记录 → 服务端判定 | `src/components/living/observatory/outcome-observatory.tsx` | ③ 四步流程条（见 7.3 诚实取舍） |
| A-7 | `/workspace` Outcomes | 三栏证据分栏：文字 / 验证记录 / 媒体证据（如实标注契约未包含） | 同上 | ③ Photo/Notes/Audio 证据 |

### 7.2 诚实性红线（本批刻意"少画"的三处）

1. **名册不显示「质量分 / 趋势」**：接口没有这两类字段，画出来就是前端编数据。
   页面注明「要显示它们得先在服务端定义口径」。
2. **审批时间线不画逐动作事件流**：契约只下发 `introducedAt` / `expiresAt` / 当前状态；
   「谁在几点点了接受」那种最像审计日志的时间线全靠推断，每行反而标注了来源字段。
3. **验证流程只画三段**：参考图的第 4 步「批准关闭」在本域没有对应状态，
   画一个永远不亮的步骤等于骗人；`verified` 仍然**只读服务端布尔**，不比较 level 字面量。

### 7.3 聚合口径（A-1/A-2 的一个细节）

名册与「需要关注」聚合**不受列表筛选影响**：列表仍按服务端 `status` 参数过滤；
聚合走独立的 ALL 请求（`filter=ALL` 时复用同一请求，不多发一次）。
否则「切到已执行」时"待批准 3 条"会变成 0 —— 那是筛选副作用，不是事实。
「需要人工介入」的档位口径与 living 侧 `LIVING_AGENT_ATTENTION_STATUSES` 一致
（`AWAITING_APPROVAL / FAILED / BLOCKED_QUOTA / DEGRADED`），页面内注明"这不是权限判定"。

### 7.4 门禁（全部在 `.next-v207` 上实测）

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **0 error** |
| eslint（3 个改动文件） | **0 条** |
| 104 格视觉审计（After） | **104 PASS / 0 FAIL**（溢出 ≤1px、360/390 触控 ≥24px、内容非空） |
| axe 四视口棘轮（`--gate`） | **零新增** |
| Playwright（`playwright.ci.config.ts`） | **113 / 113 通过**（5.0m） |
| `v198-agent-consent-outcome.mjs` | **16 PASS / 1 BLOCKED / 0 FAIL**（与基线一致，BLOCKED 仍为 A-03b 需真实 Provider） |

### 7.5 Before/After 观感差异（一句话版）

- `/console/agents`：Before 是「额度面板 + 平铺运行列表」；After 先给**概览三卡 + 名册表**，
  管理员不滚动就能回答"现在有什么要我处理、钱花在哪"。
- Consent：Before 顶部是意图选择；After **待裁决横幅前置**，每条提案自带四步进度，
  底部有时间线（且诚实标注了它不包含什么）。
- Outcomes：Before 条目只有档位徽章与验证按钮；After 每条先给**自报→记录→判定**流程条
  与三栏证据，"自报不算验证"从一句口号变成了可见的流程。

### 7.6 复跑命令

```bash
# Before/After 各一次（改动前后分别跑）
node scripts/qa/v198-visual-audit.mjs --base=http://127.0.0.1:<port> \
  --shot-dir=docs/implementation/v19/screenshots/v199-t4/{before|after}
node scripts/qa/v196-axe-scan.mjs --base=http://127.0.0.1:<port> --gate
npx playwright test --config=playwright.ci.config.ts
node scripts/qa/v198-agent-consent-outcome.mjs --base=http://127.0.0.1:<port> --db=file:/tmp/v196-e2e.db
```
