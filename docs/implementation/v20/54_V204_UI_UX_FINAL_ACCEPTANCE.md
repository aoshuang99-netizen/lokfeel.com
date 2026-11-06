# 54 · V20.4 UI/UX Final Acceptance（13 屏 × 4 视口 × 2 主题）

> 执行环境：本地 **production build**（`next build` 4m36s → `next start -p 3099`），非 dev。
> 账号：`qa.male@lokfeel.com`（真实 Turso 库，`OPERATOR/ACTIVE`，属 `org_default`）。
> 浏览器：Chromium 148（`chrome-headless-shell-1223`，`--proxy-server=direct://`）。
> 证据目录：`test-results/v204-visual/`（104 张 PNG + 2 份 JSON）。

---

## 0. 先说这一轮推翻的两个「假证据」

在做验收前，必须先否掉上一版取证方法，否则 104 格就是 104 个假绿。

### ① 用 `colorScheme` 模拟主题，在 `/workspace` 上完全无效

`living-shell.tsx` L69–78：

```ts
function readThemeSnapshot(dualDefault = false): LivingTheme {
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'field' || saved === 'paper') return saved
  if (dualDefault) return 'field'          // ← /workspace 传了 dualWorld
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'field'
}
```

而 `living-workspace.tsx` L718 传的是 `dualWorld`。**结论：`/workspace` 上 `prefers-color-scheme: light` 永远拿不到 `paper`。**

`scripts/qa/v198-visual-audit.mjs` 正是用 `newContext({ colorScheme: theme })` 取证的 —— 它拍出的 48 张 "light" 截图，**实际全部是 Deep Field**。文件名写了 light，画面是 dark。这是文件级造假，不是取证。

**本轮改法**：`addInitScript` 预置 `localStorage['lf-theme']`，再**双重断言**：

| 断言 | 取值方式 | 期望值 |
|---|---|---|
| 属性生效 | `document.querySelector('[data-lf-theme]').getAttribute('data-lf-theme')` | `field` / `paper` |
| 样式生效 | `getComputedStyle(el).getPropertyValue('--lf-bg')` | `#0b0e11` / `#f7f5f0` |

> 踩坑记录：`--lf-bg` 的 computed 值返回的是**原文 token（hex）**，不是 `rgb()`。第一版把期望值写成 `rgb(11, 14, 17)`，48 格全部误判 `THEME_FAIL`（详情里 `expect=` 为空）。这不是产品缺陷，是断言器写错——已修正并复跑。

### ② Console 七屏不接 `--lf-*`

`console-shell.tsx` L82：`<div data-lf-console className="min-h-screen bg-background">`。

全仓 `data-lf-theme` 的写入点**只有** `living-shell.tsx` 一处。因此 Console 七屏的 56 格主题判定为 **`THEME_NA`**，**不计入 PASS**，单独统计。

它不是"失败"，但也不是"通过"——它是一个**设计系统一致性缺口（P2）**：同一个产品里，Workspace 走 `--lf-*`，Console 走 Tailwind `bg-background`，两套色源并存。本轮不改（V20.4 明令不新建视觉体系），如实登记。

---

## 1. 总账

| 分组 | 格数 | PASS | FAIL | 主题判定 |
|---|---|---|---|---|
| Console 七屏 × 4 视口 × 2 主题 | 56 | **56** | 0 | THEME_NA 56 |
| Workspace 六屏 × 4 视口 × 2 主题 | 48 | **48** | 0 | THEME_PASS 48 |
| **合计** | **104** | **104** | **0** | THEME_PASS 48 / NA 56 / FAIL 0 |

复现命令：

```bash
export PW_EXECUTABLE="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-x64/chrome-headless-shell"
node scripts/qa/v204-visual-audit.mjs --base=http://127.0.0.1:3099 --shot-dir=test-results/v204-visual --only=console
node scripts/qa/v204-visual-audit.mjs --base=http://127.0.0.1:3099 --shot-dir=test-results/v204-visual --only=workspace
# 报告：visual-results-console.json / visual-results-workspace.json
```

> `--only` 是后加的：改断言后不必重跑全量 104 格。两次跑的截图同名覆盖，最终 104 张齐全。

每格断言 4 项 + 主题 1 项：

| 断言 | 阈值 | 本次结果 |
|---|---|---|
| 水平溢出 | `scrollWidth - clientWidth ≤ 1px` | **全部 0px** |
| 触控目标（仅 360/390） | 可交互元素 ≥ 24×24（`display:inline` 的行内链接豁免） | 全部达标 |
| 内容非空 | `main.textContent.length > 60` | 最小 166 |
| 有标题 | `h1` 非空 | 全部 ≥1 |
| 主题真实生效 | 属性 + 计算样式双断言 | Workspace 48/48；Console N/A |

---

## 2. 逐屏内容量（真实数据，非占位）

Console（`len` = 主区文本长度，反映真实渲染内容）：

| 屏 | len | 说明 |
|---|---|---|
| Overview | 250 | 空态（org 无 mission/connection） |
| Agents | **798 → 1222** | ⚠️ 见下方说明：两次测量之间 Agent 屏内容增加了 424 字符 |
| Connections | 188 | 空态 |
| Members | 222 | 2 名成员（qa.male / qa.female） |
| Missions | 166 | 空态 |
| Outcomes | 170 | 空态 |
| Settings | 367 | 表单 |

Workspace：

| 屏 | len |
|---|---|
| Now | 219 |
| Studio | 187 |
| Field | 170 |
| Consent | 394–397 |
| Outcomes | 698 |
| Agents | 215 |

**Agents 屏 798→1222 的变化值得单独说明**：两轮测量之间，我跑了一次真实的 `verify-llm-live`（生产），它在库里创建了真实的 `AgentRun`。Console·Agents 屏如实渲染出了这条新记录。

这不是渲染 bug，恰恰是**「数据真实」的反证**：页面内容随真实 DB 变化，说明它不是硬编码的假数据。同理，其余屏 `len ≈ 166–250` 是**真实的空态**（org_default 里确实没有 mission / connection），不是加载失败——判据是 `h1` 存在且静默期稳定（连续 3 次采样不变）。

---

## 3. G-03 Continuity 专项（攻坚令点名的 6 条）

脚本：`scripts/qa/v204-workspace-deeplink.mjs`，**22 项断言，22 PASS / 0 FAIL**。

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 六屏切换 URL 正确 | **PASS** 5/5 | `click-studio` → `?view=studio` 且 `history.state.lfWorkspaceView=true` |
| 2 | 刷新后恢复当前屏 | **PASS** | `/workspace?view=outcomes` reload 后 `aria-current=Outcomes` |
| 3 | 前进 / 后退正确 | **PASS** 3/3 | 点击序列 now→studio→field→agents；back→field、back→studio、forward→field |
| 4 | 分享深链接正确 | **PASS** 6/6 | 直接打开 `?view=<x>` 六屏全部落到对应屏 |
| 5 | 非法 view 安全回退 | **PASS** 5/5 | `missions` / `../../etc/passwd` / `<script>alert(1)</script>` / `NOW` / 空值 → 全部回 `Now`，页面存活 |
| 6 | Missions 不伪装可用 | **PASS** 2/2 | 导航项为 `{"text":"Missions未就绪","disabled":true,"href":""}`；`?view=missions` 回落到 Now |

判据一律取真实浏览器状态：当前屏 = `[aria-label="工作区导航"] [aria-current="page"]` 的文本；URL = `location.pathname + search`。不看源码、不看文件名。

> 一条自我修正：首轮我把「`?view=now` 时 URL 必须不带 `view`」写成硬断言，判了 FAIL。复核后确认这是**断言过严**——`now` 是默认屏，手工带参打开不算错，且点击导航回 Now 时会自动去掉参数（`withWorkspaceView` 的做法）。已改为「active 正确 + URL 不指向其他屏」即通过，并把「冗余参数不自动规范化」记为 P3 建议。

---

## 4. 控制台错误与网络失败（不掩盖）

每格都采集 `console.error` / `pageerror` / `requestfailed`（已过滤 cloudflareinsights / GTM / GA / Sentry 等第三方 beacon）。

| 现象 | 数量 | 定性 |
|---|---|---|
| `requestfailed`：`/console/*?_rsc=…`、`/dashboard/*?_rsc=…`，`net::ERR_ABORTED` | 每格 0–16 条 | **正常**：Next 路由预取在 context 关闭时被 abort |
| `console.error: Failed to load resource: net::ERR_FAILED` | 16 格（仅 Members 屏） | `https://api.dicebear.com/9.x/avataaars/svg?seed=…` 头像加载失败 |
| 真实业务资源失败 | **2 条** | 即上述 DiceBear（qa.male / qa.female 两个头像） |

**DiceBear 失败的定性**：本地网络出口无法访问 `api.dicebear.com`（同一环境下 `*.workers.dev` 也超时）。生产 CSP 已放行该域（`img-src` 含 `https://api.dicebear.com`），且生产页面历史上能正常显示头像。因此这是**本地环境限制**，不是产品缺陷；但因**未在生产复验头像加载**，这一条记为 `NOT_TESTED`，不写成 PASS。

---

## 5. Figma

| 项 | 状态 |
|---|---|
| Figma 账号连通（`GET /v1/me`） | PASS（AO SHUANG / aoshuang99@gmail.com） |
| 可编辑节点写入 / Node ID | **BLOCKED_FIGMA_WRITE**（`POST /v1/files`、Variables 读写端点均 404） |
| 是否虚构 Node ID | **否** |
| 是否用静态 HTML 规格冒充交付 | **否**（V20.3 已判定该做法无效，本文件不重复） |

按攻坚令「Figma 与生产安全阻塞不同级」：Figma 是设计追溯缺口，**并行未解决，但不阻断代码侧验收**。

---

## 6. 本批次结论

| 验收项 | 判定 |
|---|---|
| 104 个截图场景 | **PASS** 104/104（PNG 齐全） |
| 每个场景断言真实主题生效 | **PASS（48/48 有断言且通过）** / Console 56 格为 `THEME_NA`（无 `--lf-*` 作用域，不适用） |
| G-03 六条 | **PASS** 22/22 |
| 移动端布局 | **PASS** 360/390 视口 0 溢出、触控达标 |
| Loading / Empty / Error 完整 | **NOT_TESTED**（本轮只覆盖稳定态；空态真实但未逐一触发 Error 分支） |
| axe 无障碍扫描 | **NOT_TESTED**（本轮未跑，历史 PASS 不作本轮证据） |
| Playwright Trace（核心交互） | **NOT_TESTED**（本轮用断言 + 截图，未落 trace） |
| 生产环境 13 屏复验 | **BLOCKED**（生产版本落后于 RC；见 `59`） |

**Batch 2 判定：视觉与连续性验收 PASS（104/104 + 22/22），但 axe / Trace / Error 分支 / 生产复验 4 项 NOT_TESTED。**

**已登记的缺口（不因 104 绿而消失）**

| ID | 级别 | 内容 |
|---|---|---|
| U-1 | P2 | Console 七屏不接 `--lf-*`，与 Workspace 双色源并存 |
| U-2 | P3 | `/workspace?view=now` 不自动去冗余参数 |
| U-3 | P3 | 本地无法验证 DiceBear 头像；生产未复验 |
