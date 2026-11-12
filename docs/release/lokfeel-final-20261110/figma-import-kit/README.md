# Figma 可导入设计资产包（lokfeel-final-20261110）

> **结论先行：这不是 Figma 文件，G3 仍然 `BLOCKED`。**
> 2026-11-12 第四轮凭据复核：进程 `env`、仓库 `.env*`、`~/.workbuddy/mcp.json`、`list_installed_plugins(type=connector)` = **No connectors installed**，四类全空 ⇒ 无可编辑 Figma 交付、无文件 URL、无 node id。
> 本目录交付的是「凭据到位后可一键导入/建稿」的机器可读资产，**不伪称已交付 Figma**。

## 1. 目录内容

| 文件 | 内容 | 单一来源 |
|---|---|---|
| `tokens.json` | 两套设计系统共 20 个 color token + 3 条 typography（含源码行号、用途、对比度备注） | `src/app/(landing)/page.tsx` §1 · `src/app/globals.css` `:root` |
| `frames.csv` | 10 个页面 × 2 断点（1440×900 / 390×844）= 20 帧，每帧标注代码文件与文案来源 | `03_FIGMA_IMPLEMENTATION_MAP.md` §2 · `01b_*` |
| `components.csv` | 9 个共享组件 + 状态集合 + 代码路径 + 规格引用 | `03_FIGMA_IMPLEMENTATION_MAP.md` §1.2 |
| `README.md` | 本说明 | — |

## 2. 凭据到位后的导入步骤

1. 用 Figma 的 **Tokens / Variables** 导入能力读 `tokens.json`：按 `system` 分两个 Collection（`landing-light` / `public-dark`），按 `type` 建 Color / Text styles；`SIGNAL`、`foreground-subtle` 按 `a11y` 备注限制用途。
2. 按 `frames.csv` 逐行建 Frame：每行一个 Frame，尺寸取 `width × height`，Frame 名取 `frame_name`；移动端帧用 Auto Layout 纵向排列（避免塌版）。
3. 按 `components.csv` 建主组件并补齐 `states`（默认/悬停/聚焦/禁用），组件名与 `code_path` 一一对应。
4. 按 `03_FIGMA_IMPLEMENTATION_MAP.md` §3 第 4 步连 Prototype：`/` → `/product` → `/how-it-works` → `/register` 的 CTA 流。
5. 每帧标注 `code_path`，回填「文件 URL + node 映射」到 03 文档与 `07_ACCEPTANCE_MATRIX.csv` 的 G3 行，G3 才可由 `BLOCKED` 改判 `PASS`。

## 3. 自检（可复跑）

```
node --test scripts/qa/verify-figma-import-kit.test.mjs
node scripts/qa/verify-figma-import-kit.mjs
```

自检覆盖三类负控：资产文件缺失必须 FAIL、帧清单 `code_path` 指向不存在文件必须 FAIL、统计分母不得为空（防「空集恒真」）。

## 4. 本轮核对出的差异（如实登记，不静默改）

| # | 差异 | 处置 |
|---|---|---|
| 1 | `03` §1.1 把 FAINT 记为 `#8a9298`（2.9:1 不达标），但 B4 已把源码改为 `FAINT = #626a70`（对比达标版） | 本资产包以**源码真实值** `#626a70` 为准；03 文档需同步更正 |
| 2 | `src/app/globals.css` 头部注释仍写历史品牌名 `LOKFEE!` / `LokFee!` | 仅注释、非对外可见文案，`verify:brand-scan` 未命中；属存量注释债，不在本轮清理范围 |
| 3 | `src/app/sitemap.ts` 有 18 条路由，本资产包按 03 规格只建 10 个核心页 × 2 帧 | 其余 8 条为法律/认证/低频页（`/faq` `/cookies` `/press` `/safety-tips` 等），需要时按同一格式补帧，不冒充已全覆盖 |

## 5. 边界

- 禁止把本目录或任何 HTML/代码预览当作「Figma 可编辑交付」（经验库已登记为踩雷项）。
- 禁止在凭据未到位时把 G3 写成 `PASS`；`BLOCKED` 不计入完成率。
- 两套公开面视觉语言（落地页编辑风 / 子页深色玻璃）并存，全站单语言需用户拍板方向，不在本资产包内擅自统一。
