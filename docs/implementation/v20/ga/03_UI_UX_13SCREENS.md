# 03 · 世界级 UI/UX —— 13 屏 × 4 视口 × 2 主题（Batch 2）

> 结论先行：**13 屏 × 4 视口 × 2 主题 = 104 格，104 PASS / 0 FAIL，且 104 格全部
> `THEME_PASS`（主题属性与 `--lf-bg` 计算值双重一致）。WCAG 2.2 AA 扫描 13 屏 × 3 组合
> = 39 格，39 PASS / 0 FAIL / 0 NOT_TESTED，serious 以上违规归零。**
>
> 但这一轮真正的产出是**六个缺陷**，其中三个是"审计不说、用户会疼"的：
> Console 七屏根本切不了主题（56 格 N/A）、Inspector 的标题在 1440 深色下是
> **浅字压白底 1.13:1**（几乎不可见）、纸面信号色在 11px 小字上只有 4.28:1。
> 这三条都不是"视觉不够美"，是"看不清楚"。

---

## 0. 基线与口径

| 项 | 值 |
| --- | --- |
| 代码 SHA（本轮证据） | `6908731` + 本轮改动（见 §7 提交） |
| 运行形态 | `next build` 产物 + `next start -p 3111`（生产构建，非 dev） |
| 数据源 | 生产 Turso 库（`qa.male@lokfeel.com`，default 组织 OPERATOR） |
| 视觉审计 | `scripts/qa/v204-visual-audit.mjs`（V20.4 起就是 13×4×2 的口径） |
| 无障碍审计 | `scripts/qa/v205-a11y-13screens.mjs`（本轮新增，见 §5） |
| 浏览器 | Chromium 1223（Playwright 内置构建） |

### 环境事实：为什么固定 Chromium 版本

`npx playwright install chromium` 在本机直接失败：

```
Error: ERROR: Playwright does not support chromium on mac13
```

Playwright 新版本已放弃 macOS 13。本机缓存里有 `chromium-1223`，实测可与当前
`playwright` 包正常通信（启动 + 导航 + axe 注入全部可用）。因此两个审计脚本都支持
`PW_EXECUTABLE` 指定已缓存浏览器，**并把版本写进报告** —— 换浏览器等于换证据，
不能悄悄换。

### Figma：`BLOCKED_FIGMA_WRITE`

`list_installed_plugins` 返回 **No connectors installed**，环境里不存在 Figma 连接器，
因此**无法**写入 Figma 文件。

按纪律：**不伪造 Figma 文件**，也不因此停摆前端工作。本轮的设计交付形态改为
「代码 + 可复现的浏览器证据（104 格截图 + 39 格 axe 报告）」，
Figma 交付记为 `BLOCKED_FIGMA_WRITE`，作为需要人工补的环境能力列在 §8。

---

## 1. 审计口径（为什么不是"截图数凑够 104"）

`v204-visual-audit.mjs` 的三条硬判据，都是被具体的假绿逼出来的：

1. **主题真值双证**：既要比 `[data-lf-theme]` 属性，也要比计算出的 `--lf-bg`
   （field `#0b0e11` / paper `#f7f5f0`）。只改属性不改样式、或只改样式不改属性，
   都判 FAIL。
   > 上一代脚本用 `colorScheme` 模拟主题，而 `/workspace` 在 dual 模式下
   > `readThemeSnapshot()` **恒返回 field** —— 于是"light"截图 100% 还是深色，
   > 那是**文件名造假**，不是取证。
2. **内容就绪**：忙碌指示器消失 + 连续三次采样文本量不变 + 存在非空 `h1`。
   否则拍到的是骨架屏，`overflow=0px` 毫无意义。
3. **溢出为 0**：`scrollWidth - clientWidth`，360 宽度下最容易露馅。

---

## 2. 第一轮结果（Before）—— 104 PASS 但 56 格是 N/A

```
=== 汇总 104 PASS / 0 FAIL / 共 104 格（期望 104）===
    主题：PASS 48 · N/A 56 · FAIL 0
```

`104 PASS` 看起来满分，但 `THEME_NA 56` 的含义是：
**Console 七屏（7 × 4 视口 × 2 主题）完全不参与主题体系**。

这不是审计脚本的保守，而是代码事实：`console-shell.tsx` 只有 `data-lf-console`，
组件用 Tailwind 语义令牌（`bg-background` / `text-foreground` / `border-card-border`），
**一个 `--lf-*` 都没用**。也就是说：

- 用户在产品的一半里能切 Deep Field / Living Paper；
- 在另一半（组织态七屏）里连切换入口都没有。

同一产品的两半，一半能换肤、一半不能 —— 这就是缺口本身，不是"统计口径问题"。

---

## 3. 缺陷 #1 · Console 七屏无法切主题

### 故障形态
`THEME_NA 56`（104 格里 56 格）。Console 根节点没有 `data-lf-theme`，
也没有任何切换控件。

### 修法（三处，都以"只有一份真值"为原则）

1. **抽出共享主题模块** `src/components/theme/living-theme.ts`：
   `readThemeSnapshot` / `writeTheme` / `useLivingTheme`。
   LivingShell 与 ConsoleShell 从此用**同一份**实现。
   为什么抽出来而不是复制：复制必然出现"改一处忘一处"，而两份真值的分歧
   最终会表现为"同一个 localStorage 值在两个页面解释不同"。
2. **ConsoleShell 接线**：`data-lf-theme={theme}` + 顶栏真实可点的对比度按钮
   （`aria-pressed` 反映当前是否纸面，`aria-label` 说明点下去会变成什么）。
   按钮是**真控件** —— 不是装饰，点了 `--lf-bg` 会真的从 `#0b0e11` 变 `#f7f5f0`，
   由 104 格审计的属性 + 计算值双证。
3. **令牌映射**（`globals.css`）：仅在 `[data-lf-console='1'][data-lf-theme='paper']`
   下把语义令牌映射到深色可读值。

> **为什么只映射 paper，不动 field**：Console 现在就是深色，字段值已验收。
> "统一"不该以改掉已验收的视觉为代价。field 一个值都不动 —— 这也是为什么
> 第一轮的 48 格 THEME_PASS 在改动后**仍然**全绿。

> **为什么改令牌而不是改组件**：13 屏里上百处 `bg-background-secondary` 这类工具类。
> 逐个改既会漏，也会把"某个角落写了死色"变成长期债；改令牌只需一处，
> 整棵子树的工具类自动换肤。

---

## 4. 缺陷 #2~#4 · 三个"看不见"的对比度问题

WCAG 2.2 AA 扫描第一轮：**28 PASS / 11 FAIL**，两条规则：

```
color-contrast:serious                 nodes=11
scrollable-region-focusable:serious    nodes=1
```

### #2 Inspector 标题：浅字压白底，1.13:1

- **节点**：`<h2 class="text-sm font-medium">详情</h2>`（右侧证据面板标题）
- **实测**：`foreground #f2f1ec` on `background #ffffff` = **1.13:1**（要求 4.5:1）
- **为什么发生**：这是 CSS 变量作用域的经典坑。`color` 是**继承的计算值**，
  不是重新求值。根节点按 field 主题算出 `color: #f2f1ec`；Inspector 子树在
  `[data-lf-world='inspector']` 里把 `--lf-surface` 改成了 `#ffffff`，
  但**没有重新声明 `color`** —— 于是"深色主题的文字色"被画在"纸面主题的背景"上。
- **为什么只在 1440 出现**：Inspector 在 `lg` 以下收进浮层，桌面才有这块面板。
- **修法**：给 Inspector 的两个容器（桌面 `aside` 与移动浮层 `div`）都加
  `text-lf-text`，让颜色在作用域内**重新解析**。
- **一句话**：变量作用域只管变量，不管已经算出来的继承值。换肤必须同时重设 `color`。

### #3 纸面信号色：4.28:1（差 0.22）

- **节点**：`.bg-lf-signal-soft > .font-medium`（状态标签，11px 常规字重）
- **实测**：`#906931` on `#f5eee4` = **4.28:1**
- **修法**：纸面 `--lf-signal` 由 `#906931` → `#86602c`（实测 4.9:1）。
  同时改了**三处**出现：`[data-lf-theme='paper']`、双世界 Inspector、双世界纸面覆盖 ——
  否则同一色值会在不同作用域里给出不同可读性。
- **为什么不是"调小字号/加粗"绕过去**：那是把不合规的文字伪装成"大字号文本"
  （AA 对大字号只要求 3:1）。**改的是颜色，不是豁免条件。**

### #4 成员屏角色徽章：深灰压深灰

- **节点**：`.bg-accent\/15`（`ADMIN` 角色徽章，本轮新增的 UI）
- **根因**：`--color-accent` 在令牌表里等于 `--background-tertiary`
  （深色主题 `#1a1a1a`）。`text-accent` 于是是**近黑**，压在同色系 15% 底纹上。
  这个令牌本身是历史遗留的语义空洞（"accent" 指向了一个背景色）。
- **修法**：徽章改用 Living 令牌 `bg-lf-signal-soft text-lf-signal`
  （深色=暖金 / 纸面=深棕，两套主题都可读），并在代码里写明为什么不用 `accent`。
- **为什么值得单独记**：这是我**自己新写**的 UI 引入的 serious 违规。
  如果只跑"功能 E2E"，它永远不会被发现。

### #5 可滚动区域键盘不可达（WCAG 2.2 · 2.5.8 家族）

- **节点**：`/console/agents` 的名册表容器 `.overflow-x-auto.rounded-2xl.bg-background-secondary`
- **为什么是 serious**：窄视口下表格需要横向滚动，但容器不可聚焦 ⇒
  **键盘用户永远看不到右侧那几列**（成本、最近活跃时间）。
- **修法**：`role="region"` + `aria-label` + `tabIndex={0}` + 可见焦点环。
- **为什么不做"仅在溢出时加 tabindex"**：那需要 resize 监听 + 首帧判断，
  会带来 hydration 抖动；不溢出时多一个 Tab 停留点，代价远小于"某几列键盘永远读不到"。

---

## 5. 新增：13 屏无障碍扫描脚本

`scripts/qa/v205-a11y-13screens.mjs`

与既有 `v196-axe-scan.mjs` **分工而不是重复**：

| | v196（V19.6 起） | v205（本轮新增） |
| --- | --- | --- |
| 范围 | 公开面 + B2C 面（6 页） | V20.5 主战场 13 屏 |
| 主题 | 单一（跟随 colorScheme） | **按主题分开扫**（field + paper） |
| 门禁 | 棘轮基线 `axe-baseline.json` | serious/critical = 0 |

**为什么必须按主题分扫**：对比度违规几乎全部是主题相关的。只扫深色，纸面那套
调色板里的死色永远不会暴露 —— 缺陷 #2、#3 就只在 paper 或 dual 下出现。

**为什么注入源码而不是 `addScriptTag({path})`**：Next 的静态资源路径下 `path`
会 404；`content` 方式绕开路径问题（这条在 V19.6 已踩过，这里沿用）。

**假绿防护**：登录态被重定向到 `/login` 的格子记 `NOT_TESTED`，**不计入 0 违规**。
空集恒真是最容易骗过评审的一种绿。

---

## 6. 结果（After）

### 6.1 视觉矩阵

```
=== 104 PASS / 0 FAIL / 共 104 格（期望 104）===
    主题：PASS 104 · N/A 0 · FAIL 0
```

13 屏：Workspace 六屏（now / studio / field / consent / outcomes / agents）
+ Console 七屏（overview / missions / members / connections / agents / outcomes / settings）。
4 视口：360×800 / 390×844 / 768×1024 / 1440×900。2 主题：field / paper。

每一格都同时满足：`overflow=0px`、`h1` 非空、`data-lf-theme` 正确、
`--lf-bg` 等于该主题真实色值。

### 6.2 无障碍

```
=== 39 PASS / 0 FAIL / 0 NOT_TESTED · 共 39 格 ===
（无 serious / moderate / minor 违规输出）
```

39 格 = 13 屏 × (1440-field、1440-paper、390-field)。
移动视口只扫 field 的理由写进脚本注释：对比度与视口无关；
2.5.8 触控目标与主题无关。这不是省略，是把重复的格子去掉。

---

## 7. 改动清单

| 文件 | 性质 |
| --- | --- |
| `src/components/theme/living-theme.ts` | **新增**：主题真值唯一实现（含三约束注释） |
| `src/components/living/living-shell.tsx` | 改为消费共享实现；删除本地重复逻辑 |
| `src/app/console/console-shell.tsx` | 接双主题 + 真实对比度切换按钮 |
| `src/app/globals.css` | Console paper 令牌映射；`--lf-signal` 纸面加深（3 处） |
| `src/app/console/members/page.tsx` | 角色徽章配色修正 |
| `src/app/console/agents/page.tsx` | 可滚动表格键盘可达 |
| `scripts/qa/v205-a11y-13screens.mjs` | **新增**：13 屏 × 2 主题 axe 扫描 |
| `docs/implementation/v20/ga/03_UI_UX_13SCREENS.md` | 本文件 |

---

## 8. 未尽事项与残留风险

| # | 事项 | 状态 | 说明 |
| --- | --- | --- | --- |
| B2-1 | Figma 设计文件 | **BLOCKED_FIGMA_WRITE** | 环境无 Figma 连接器（`list_installed_plugins` = 0）。需人工安装并授权后才能补；**本轮未伪造任何 .fig** |
| B2-2 | 线上地址的同一套审计 | **NOT_TESTED** | 线上仍是 `bc46a22`，Console 双主题未发布。Batch 8 发布后用同两条命令重跑 |
| B2-3 | Playwright trace 归档 | `NOT_TESTED` | 本轮证据是 104 张截图 + 2 份 JSON 报告；追帧视频未采集（体积与时长不划算），若评审要求可补 |
| R1 | Console 纸面主题是新实现 | 已知 | 令牌映射覆盖了颜色，但**图标/插画类资源**仍是深色版（无描边反色）。视觉上可接受，未做资源级适配 |
| R2 | `--color-accent` 语义空洞 | 已知 | 该令牌等于 `--background-tertiary`，是个历史遗留。本轮只修了用到它的徽章，未做全仓语义清理（会牵动 B2C 面，超出 GA 范围） |
| R3 | Chromium 1223 非最新 | 已知 | macOS 13 上无法安装新构建；版本已写进报告头部。换机器（macOS 14+）应重跑并更新证据 |
| R4 | 13 屏的"世界级"是判据级达成，不是审美认证 | 说明 | 本文所有 PASS 都指**可验证判据**（无溢出、有标题、主题双证、axe 零 serious）。审美好坏不由脚本判定，也不在这份报告里自我加冕 |
