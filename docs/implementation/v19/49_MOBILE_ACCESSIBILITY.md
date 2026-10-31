# 49 · 移动端与可访问性审计（V19-85 · Batch 6）

- 日期：2026-10-31
- 探针：`scripts/qa/v198-visual-audit.mjs`（本批新增，只读探针 + 触控/溢出断言）
- 取证：13 屏 × 4 视口 × 双主题 = **104 格，104 PASS / 0 FAIL**（Before 与 After 各一轮，见 48 号文档）
- 截图：`/tmp/v198-visual-before/`、`/tmp/v198-visual-after/`（各 104 张 + `visual-results.json`）

## 1. 四视口矩阵结论

| 检查项 | 360×800 | 390×844 | 768×1024 | 1440×900 |
|---|---|---|---|---|
| 水平溢出（≤1px） | 0px（26/26 格） | 0px（26/26 格） | 0px（26/26 格） | 0px（26/26 格） |
| 触控 ≥24×24（门禁视口） | ✅ 0 违规 | ✅ 0 违规 | （不适用） | （不适用） |
| 触控 ≥24×24（非门禁实测） | — | — | ✅ | 修复前 3 屏命中 → 修复后 0（§3） |
| 内容非空（settle 后 len>60） | ✅ | ✅ | ✅ | ✅ |
| h1 存在 | ✅（含加载/错误态，D-1/D-2） | ✅ | ✅ | ✅ |

每格 = 一屏；26 格/视口 = 13 屏 × 2 主题。双主题说明见 §4。

## 2. 移动端导航

- Workspace 六页签在 360/390 下全部可点、`aria-current="page"` 正确转移
  （探针在采样前断言转移成功，转移失败即 FAIL —— 全部通过）。
- Console 侧栏在窄视口渲染移动布局，七屏无溢出、CTA 可达。
- 无 `horizontal scroll` 出现：所有 104 格 `scrollWidth - clientWidth ≤ 1px`。

## 3. 触控目标（WCAG 2.5.8 · 最低 24×24）

移动门禁视口（360/390）全绿，但**桌面复测**抓到 3 类同组件缺陷（20–23px 高），
按「同一组件在任何视口不达标即应修」处理，全部已修（`min-h-6` = 24px，交互与布局不变）：

| 组件 | Before 实测 | After |
|---|---|---|
| `consent-gate.tsx` FieldRow 字段名按钮 | 昵称/头像/个人简介/城市/国家地区/职业/公司/行业 = 28×20 … 61×20 | ≥24px |
| `agent-board.tsx` 运行选择按钮 | 意图抽取/介绍草稿 = 58×23 | ≥24px |
| `outcome-observatory.tsx` 级别选择按钮 | 外部已核验 = 69×23 | ≥24px |

豁免项（保留）：`display:inline` 的句内文本链接（WCAG 2.5.8 同款豁免，正文阅读流不适用按钮尺寸）。

## 4. 双主题（Adaptive Dual World）

- `dark`（Deep Field）与 `light`（Paper，`prefers-color-scheme` 模拟）各跑 52 格。
- **实测**：Workspace/Console 十三屏在 `light` 下渲染的仍是 Deep Field ——
  双世界 `readThemeSnapshot` 的 `dualDefault` 分支**强制默认 Deep Field**，这是 V16 设计 C 的既定行为
  （防止「跟随系统浅色把画布盖成纸面」）。`-light` 格的价值在于守住该行为：若未来默认分支改变，
  这批格会立即暴露（渲染差异 → 截图与内容长度变化）。
- **不含** `landing` / `login` / 交友面（legacy B2C）的浅色取证 —— 那些屏不在本批 13 屏范围内
  （公开面浅色由 `v19-a11y-public-audit.mjs` 与 24 格 axe 基线覆盖）。

## 5. 键盘与屏幕阅读器

- 全部修复点均保持 `<button type="button">` 语义（键盘可达、可聚焦），`aria-pressed` 状态保留。
- D-1/D-2：加载/错误态补 `sr-only` h1 —— 慢网下屏幕阅读器不丢页面身份（48 号文档 §2）。
- 忙碌指示器：加载态用 `.animate-spin` 图标 + 文案（aria 需要时 `role="status"`，见 living-workspace）。
- axe：Console 七屏 wcag2a+2aa 0 违规（Batch 5 深审 49 格）；24 格公开面基线由
  `v196-axe-scan.mjs --gate` 常态把守（Batch 7 复跑）。

## 6. 复跑命令

```bash
NO_PROXY='localhost,127.0.0.1' PW_CHANNEL=chrome node scripts/qa/v198-visual-audit.mjs --shot-dir=/tmp/v198-visual-after
env -u NODE_OPTIONS node scripts/qa/v196-axe-scan.mjs --base=http://localhost:3000 --gate
```
