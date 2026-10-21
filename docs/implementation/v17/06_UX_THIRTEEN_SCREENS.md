# 06 · 十三屏 UX 验收（WB17-06）

**任务包**：WB17-06 · 十三屏 UX 收口
**执行日期**：2026-10-21
**基线**：HEAD `de7a835`
**判定**：**代码级不变量 PASS / 可视证据 BLOCKED / 两个真 UX 问题待修**

| 项 | 判定 | 依据 |
|---|---|---|
| 十三屏是否存在且接线到真实端点 | **PASS** | 逐屏核对路由 → 组件 → 端点，见 §1 |
| 无伪成功 / 无空按钮 / 未就绪有原因 | **PASS** | `check-ui-invariants` 扫 49 文件，R1–R10 全通过 |
| 对比度（WCAG AA） | **PASS** | `verify:contrast`：5 个调色板块 × 15 组组合全达标 |
| 枚举漂移守卫（防"界面与契约脱节"） | **PASS（CI）** / BLOCKED（本机） | 本机无 `typescript`，`npx tsc` 去拉包被 broker 杀；已进 CI |
| 十三屏的**可视证据**（截图） | **BLOCKED** | 全部需要登录，无 QA 账号；不得用真实客户数据 |
| 空态 / 错误态 / 无权限态的**实测** | **BLOCKED** | 同上（代码里有三态渲染器，但没有跑过） |
| 移动端可用性 | **BLOCKED** | 同上 |

> 这一份的核心结论要说清楚：**能静态证的都证了，能动态证的都没证。**
> 我不把"代码里有 `Loadable` 三态渲染器"写成"空态已验证" —— 那是两件事。

---

## 1. 十三屏清单

「十三」= Living Workspace 的 **6 屏可用视图** + Console 的 **7 屏**。
（`NAV` 里有 7 个条目，但 `missions` 是 `ready: false`，点击不可达，不计入可用屏。）

### 1.1 Living Workspace（`/workspace`）· 6 屏

| # | 屏 | 组件 | 数据源（真实端点） | 就绪 |
|---|---|---|---|---|
| 1 | **Now** 今日工作台 | `LivingCanvas` + `StageRail` | 聚合三端点：`/api/v1/connections/proposals`、`/api/v1/agents/runs`、`/api/v1/outcomes/timeline` | ✅ |
| 2 | **Studio** 目标编译器 | `compileWorkspaceSpec`（纯函数） | 用户输入 → `WorkspaceSpec`（本地编译，不写库） | ✅ |
| 3 | **Field** 连接场 | `field/field-canvas` + `field-inspector` | `assembleTenantNodes` / `mergeTenantNodes` | ✅ |
| 4 | **Consent** 同意与披露 | `consent/consent-gate`（含「跨社群」子面板） | `/api/v1/im/consent`、`/api/v1/bridges/*` | ✅ |
| 5 | **Outcomes** 成果时间轴 | `observatory/outcome-observatory` | `/api/v1/outcomes/timeline` | ✅ |
| 6 | **Agents** 运行与审批 | `agents/agent-board` | `/api/v1/agents/runs`、`/api/v1/agents/usage` | ✅ |
| — | ~~Missions~~ 连接任务 | — | — | ❌ `ready:false`，禁用并展示原因 |

### 1.2 Console（`/console/*`）· 7 屏

| # | 屏 | 路由 | 主数据源 | 体量 |
|---|---|---|---|---|
| 7 | **需人处置**（总览） | `/console` | `/api/v1/workflow/overview`、`/api/v1/missions`、`/api/v1/workflow/jobs/{id}/takeover` | 305 行 |
| 8 | **智能体** | `/console/agents` | `/api/v1/agents/runs`、`/api/v1/agents/usage` | 427 行 |
| 9 | **连接** | `/console/connections` | `/api/v1/connections/pipeline`、`/api/v1/connections/{id}` | 350 行 |
| 10 | **成员** | `/console/members` | `/api/v1/members` | 276 行 |
| 11 | **连接任务** | `/console/missions` | `/api/v1/missions` | 206 行 |
| 12 | **成果** | `/console/outcomes` | `/api/v1/outcomes`、`/api/v1/connections/proposals` | 378 行 |
| 13 | **设置** | `/console/settings` | `/api/v1/org` | 329 行 |

另有 `/console/missions/[missionId]`（详情页），是对第 11 屏的展开，不计入十三屏。

---

## 2. UX-01 ~ UX-12 逐条判定

判据口径（全套 v17 文档统一用这一份，`15_ACCEPTANCE_MATRIX_V17.md` 引用同一编号）：

| ID | 判据 | 判定 | 证据 / 缺口 |
|---|---|---|---|
| UX-01 | 不得有"点了没反应"的按钮 | **PASS** | `check-ui-invariants` R2（无空按钮）+ R1（无伪成功）：49 文件全通过 |
| UX-02 | 未就绪能力必须 `disabled` 且给出**具体**原因 | **PASS** | R4 通过；`MISSIONS_REASON` 是具体句子，不是"敬请期待" |
| UX-03 | 三态（loading / error / empty）都必须是**真的** | **PASS（代码级）** | `living-workspace.tsx` 的 `Loadable` 统一渲染三态；不给"空数组当成功" |
| UX-04 | 计数不得把"读不到"显示成 0 | **PASS** | `buildOsStages` 用 `null` → 渲染 `—`；`countHint` 说明口径；有单测 + 变异 |
| UX-05 | 文本对比度达 WCAG AA | **PASS** | `verify:contrast`：5 板块 × 15 组全达标 |
| UX-06 | 深色/浅色双世界切换不产生死色 | **PASS（设计层）** | 令牌作用域 `[data-lf-dual][data-lf-world]`，组件不传 theme；对比度门禁覆盖两个世界 |
| UX-07 | `prefers-reduced-motion` 必须降级 | **PASS（代码级）** | 动效四档 L0–L3 + 全局媒体查询强制 L0 |
| UX-08 | 移动端（<1024px）不溢出、可操作 | **BLOCKED** | `living-shell` 有 Dock 退化与 `min-w-0`，但**未在真机/真浏览器验证** |
| UX-09 | 界面元素与实际契约不得脱节（枚举漂移） | **PASS（CI）** | `verify:workspace-drift` 变异自证；本轮已修"从未进 CI"的问题 |
| UX-10 | 不得渲染假数据 / 示例数据当真实数据 | **PASS** | R5（无假数据标识）、R6（agent 节点必须有源）通过 |
| UX-11 | 空态必须告诉用户**下一步做什么** | **BLOCKED** | 代码里有 `emptyText`，但没有逐屏实测是否可操作 |
| UX-12 | 十三屏在**真实登录态**下可完整走通 | **BLOCKED** | 无 QA 账号；不得用真实客户数据 |

**为什么 UX-08 / UX-11 / UX-12 不是 PASS**：它们都需要"真的用一遍"。代码级证据只能说明"写了这段逻辑"，不能说明"用户看到了正确的东西"。V17 明确禁止用 SKIPPED 冒充 PASS，这里同理。

---

## 3. 代码级门禁（可复跑）

```
node scripts/check-ui-invariants.mjs      → 扫描 49 个文件：R1–R10 全通过
node scripts/qa/contrast-tokens.mjs       → 5 个调色板块，全部组合达 WCAG AA
node scripts/qa/verify-workspace-spec-drift.mjs   → CI 内跑（本机缺 typescript）
```

R1–R10 的十条不变量（原文照录，因为它们比任何叙述都准）：

> R1 无伪成功 · R2 无空按钮 · R3 无 3D 依赖 · R4 未就绪有原因 · R5 无假数据标识 ·
> R6 agent 节点有源 · R7 无代码执行面 · R8 画布库作用域收敛 · R9 无 markdown 字面量 ·
> R10 服务端模块仅类型导入

这十条里最有价值的是 **R1（无伪成功）** 和 **R5（无假数据标识）**：
它们拦的正是"看起来能用、其实是假的"这类问题 —— 也是这份文档里一切 BLOCKED
的存在理由。

### 3.1 本轮修掉的门禁本身的问题

`verify:workspace-drift` 有两个缺陷，都已修（commit `de7a835`）：

1. **从没进过 CI**。`npm run verify:workspace-drift` 在任何 workflow 里都没有引用
   ⇒ 一道只在人想起来时才跑的门禁，等于没有。已加进 test job。
2. **就地改写真实源文件，被打断就污染工作树**。SIGKILL 不可捕获，所以原有的
   SIGINT/SIGTERM 处理堵不住。实测被打断两次，`schema.ts` 两次都留在变异后的状态
   （`COORDINATION_ADVICE` → 不存在的 `OUTCOME_NARRATIVE`）。
   现改为"落盘快照 + 下轮启动自愈"，并把快照与临时 tsconfig 写进 `.gitignore`。

> 这条值得单独记：**门禁脚本自己也是被审查对象**。一个会破坏被测系统的校验器，
> 比没有校验器更危险 —— 因为它让人误以为"已经检查过了"。

---

## 4. 本轮发现的真问题（不是"待优化"）

### 4.1 🔴 `/pricing` 直接 307 到 `/pay.html` —— 没有定价页

实测：

```
GET https://app.lokfeel.com/pricing  →  307  →  /pay.html
```

`/plans` `/subscribe` `/membership` `/pass` 同理（都是别名）。意味着：

- 用户点"定价"，看到的是**付款页**，而不是"有哪些档、各多少钱、能做什么"；
- 付款页是自托管的 Gumroad 店面（英文），与站点其余部分的样式与文案体系不一致；
- 购买前的最后一个页面**没有退路**（没有"先看看档位对比"的位置）。

这不是样式问题，是**转化漏斗少了一环**。修复成本不高（一个静态定价页 + 保留 `/pay.html` 作为结账入口），但需要产品决定档位文案。

**关于 307 本身**：这里用**临时**重定向是对的，**不要**改成 308/301。
理由是"别名是临时措施" —— 哪天真的做了定价页，308 会被浏览器**永久缓存**，
老用户会一直被钉回付款页，且没有任何办法从服务端撤销。临时重定向在这个
"迟早要替换"的场景下是正确选择，不是疏漏。

### 4.2 🔴 全站 `lang="en"`，退款/隐私/条款只有英文

| 页面 | `lang` | 含中文 |
|---|---|---|
| `layout.tsx`（全站） | `en` | 否 |
| `public/pay.html`（店面） | `en` | 否 |
| `/refunds` | （继承） | 否 |
| `/privacy` | （继承） | 否 |

如果首发面向中文用户，那么**退款条件与隐私政策没有中文版本**这件事，
本身就是合规风险（用户无法用母语理解自己同意的条款）。
它同时放大了 WB17-04 记的那个冲突：英文页写 14 天、英文店面写 7 天。

**这是产品/法务决策，不是工程缺口**，已列入 §6。

### 4.3 `Missions` 导航项永久禁用

`NAV` 里第 7 项 `missions` 是 `ready: false`，且原因是常量 `MISSIONS_REASON`。
它满足"未就绪必须给原因"的规则（所以 UX-02 是 PASS），但产品上是
**一个永远点不亮的入口**。要么接上，要么从导航里拿掉 —— 长期挂在那里会训练用户忽略导航。

### 4.4 `/workspace` 的 307 响应体带错误页壳 —— 查过了，**不是问题**

实测：

```
GET /workspace  →  307  location: /login?callbackUrl=%2Fworkspace
```

响应体里带 `id="__next_error__"` 的 HTML 壳（约 15 KB），第一眼容易当成"页面坏了"。
**但这不是缺陷**：3xx 的响应体浏览器不会渲染，搜索引擎也不会把受保护页当内容收录；
这个壳是 Next 在服务端 `redirect()` 时生成的内部产物。跳转目标正确，
且 `callbackUrl` 保留了原始意图路径（登录后能回到 `/workspace`）。

**结论：不改。**记在这里是因为我自己第一眼误判成了"错误页泄露"，
把这个误判写下来，比删掉它更有用 —— 下一个人会看到同样的东西。

---

## 5. 截图证据：现状

| 层 | 状态 | 说明 |
|---|---|---|
| 公开页（落地页 / `/pay.html` / 登录页） | 可截 | 但本轮未截 —— 见下 |
| 十三屏（全部需登录） | **BLOCKED** | 无 QA 账号 |
| 空态 / 错误态 / 无权限态 | **BLOCKED** | 需要构造特定数据状态 |

**本轮没有生成截图**，理由：这十三屏**全都需要登录**，能截的只有公开页，
而公开页的截图对"十三屏 UX 验收"没有证明力。放一堆公开页截图进
`screenshots/` 只会让目录看起来更满，不会让结论更可信。

（对比：V16 的 `reports/ui-gallery` 有 26 张 before/after —— 那是**当时有可用登录态**。）

### 5.1 解除 BLOCKED 的最短路径

1. 生产注册一个一次性测试账号（邮箱密码，不走 OAuth）；
2. 建一个组织（`org_default`）+ 至少 2 条 mission、2 条 proposal、1 条 agent run；
3. 用 Chrome 无头（本机需 `--no-sandbox`）逐屏截图，命名 `{屏号}-{状态}.png`：
   - `01-now.empty.png` / `01-now.loaded.png` / `01-now.error.png`
   - … 十三屏 × 三态
4. 落到 `docs/implementation/v17/screenshots/`；
5. 移动端视口再跑一轮（375×812）。

预计 1.5–2 小时。需要一次"允许往生产写测试账号"的确认（与 WB17-04 §9.3 是同一个确认）。

---

## 6. 需要拍板的事

| # | 事项 | 为什么需要人定 |
|---|---|---|
| 1 | 是否补一个真正的定价页（`/pricing` 不再 307） | 需要定档位文案与"哪个档是主推" |
| 2 | 是否做中文版（至少退款/隐私/条款三页） | 涉及首发市场与法律主体，不是翻译工作量问题 |
| 3 | `Missions` 导航项：接上还是移除 | 取决于该功能是否在本期范围 |
| 4 | 是否允许建测试账号做十三屏截图 | 会往生产库写入并删除一个真实账号 |

---

## 7. 行动清单

| # | 动作 | 类型 | 状态 |
|---|---|---|---|
| 1 | `verify:workspace-drift` 进 CI | 工程 | **已完成**（`de7a835`） |
| 2 | 漂移守卫加落盘快照 + 启动自愈 | 工程 | **已完成**（`de7a835`） |
| 3 | R1–R10 + 对比度门禁复跑取证 | 工程 | **已完成**（§3） |
| 4 | 十三屏截图（含三态 + 移动端） | 工程 | **BLOCKED**（需 §6-4 确认） |
| 5 | 补定价页 | 产品/工程 | 待拍板（§6-1） |
| 6 | 退款/隐私/条款中文化 | 内容/法务 | 待拍板（§6-2） |
| 7 | `Missions` 导航项处置 | 产品 | 待拍板（§6-3） |
| 8 | ~~`/workspace` 307 响应体~~ | — | **不改**（§4.4 已证伪，非缺陷） |
