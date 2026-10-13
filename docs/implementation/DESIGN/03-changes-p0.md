# Living Connection OS — P0 Design Foundation 交付记录

> 阶段定义见 `02-plan.md`。本文只记录**已交付的事实与证据**，不含计划。

## 1. 交付物

| 文件 | 作用 |
|---|---|
| `src/app/globals.css`（追加段） | **设计令牌层**：`--lf-*` 命名空间 + `[data-lf-theme="field"\|"paper"]` 双主题 + 动效四档 + 可见焦点环 + Signal 脉冲 |
| `src/components/living/living-shell.tsx` | **五区外壳**：Dock(64–80) / ContextBar(56–64) / Canvas / Inspector(320–360，可收起) / Composer(浮动) |
| `src/app/workspace/layout.tsx` | `/workspace` 鉴权守卫（保留回跳地址；与 `(dashboard)`、`console` 同款做法） |
| `src/app/workspace/page.tsx` | 路由入口（薄装配） |
| `src/app/workspace/living-workspace.tsx` | 工作区主体：**真实端点** + 诚实三态 + Evidence Lens |
| `scripts/check-ui-invariants.mjs` | **新增门禁**（R1–R5，见 §3） |
| `package.json` | 新增 `check:ui-invariants` |

## 2. 三个关键设计决定

### 2.1 令牌层是**加性 + 作用域化**的（不覆盖既有品牌）

本仓现役品牌是 Lime `#a3e635`（`globals.css` `:root`），在 76 个页面 + 12,922 个用户上生效。
设计基准的 Warm Signal `#D7AC78` 若直接改 `--primary`，等于**全站换皮**（风险 D1）。
因此新令牌一律走 **`--lf-*` 命名空间**，且只在**设置了 `[data-lf-theme]` 的子树内**生效：

- 未设置 → 不产生任何影响（既有页面零变化）；
- 设置 `data-lf-theme="field"` → 深色（Deep Field）；
- 设置 `data-lf-theme="paper"` → 明亮（Living Paper）。

这样 P0 可以在 `/workspace` 内先跑起来，而"要不要全站换皮"留作**单独的产品决定**。

### 2.2 主题状态用 `useSyncExternalStore`，**不用** effect 里 setState

首版写成 `useEffect(() => setTheme(readInitialTheme()), [])` —— 被 ESLint
`react-hooks/set-state-in-effect` 拦下（effect 内同步 setState 会触发级联渲染）。
改为把"主题"当成**外部系统状态**（localStorage + `prefers-color-scheme`）订阅：

- `subscribeTheme` / `readThemeSnapshot` / `writeTheme` 三个模块级函数；
- `useSyncExternalStore(subscribeTheme, readThemeSnapshot, () => 'field')`
  —— 服务端快照固定 `'field'`，**首屏与 SSR 一致，不会 hydration 失配**。

### 2.3 P0 **不引入** P1/P2 依赖

P0 不装 `@xyflow/react` / `three` / `@radix-ui/*`。理由：设计基准 §十 明确警告
"不能先把 3D 首页做完，再发现 SaaS 内部还是静态页面"。
组件缺口（Switch / Drawer / Command palette）先按既有 `cva` + `cn()` 手写风格补齐，
**不引入第二套组件范式**（现仓 22 个 UI 组件全部手自研、无 Radix）。

## 3. 新增门禁 `check:ui-invariants`（R1–R5）

把设计基准里"否则就是假功能"的几条变成**可复跑的静态检查**（扫描 `src/components/living`、`src/app/workspace`）：

| 规则 | 判据 | 对应基准 |
|---|---|---|
| R1 | 不得出现 `setTimeout` / `setInterval` | 阻断标准 #6（不许 `setTimeout` 伪装 AI 执行成功） |
| R2 | 每个 `<button>` 必须有 `onClick`、`disabled` 或 `type="submit"` | AC-18（无空按钮） |
| R3 | 不得 `import` `three` / `@react-three/*` | P0 范围纪律（3D 属 P3） |
| R4 | `ready: false` 的导航项必须写 `reason` | 未就绪能力要写明原因 |
| R5 | 不得出现 `mockData` / `fakeData` / `dummyData` | 阻断标准 #6（不放假数据） |

实现要点：**先剥离注释再匹配**（把注释字符换成空格、保留换行与偏移），
否则注释里描述规则的散文会被当成真代码命中 → 假阳性（首版就踩到一次）。

## 4. 证据（全部可复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | **0 error** |
| Lint | `node ./node_modules/eslint/bin/eslint.js src/components/living src/app/workspace scripts/check-ui-invariants.mjs --max-warnings=0` | **0 error / 0 warning** |
| 脚本守卫 | `npm run check:script-decls` | **62 脚本 / 0**（新增 1 个脚本） |
| UI 不变量 | `npm run check:ui-invariants` | ✅ 通过（5 条规则） |
| **变异自证** | 注入 `setTimeout` + 空 `<button>` + 抽掉 `reason` | ✅ **三条规则都报警且 exit 1**；文件**逐字节无损还原** |
| CSS 真编译 | PostCSS + `@tailwindcss/postcss` 编译 `globals.css` | ✅ 产物 255,517 字节；`--lf-surface` / `.bg-lf-surface` / `.text-lf-text` / `rounded-lf` 均生成 |

> 没有"变异自证"这一步，`check:ui-invariants` 通过就无法排除"规则根本没生效"。

## 5. 已知边界（诚实声明）

1. **本仓 `Organization` 1 / `Membership` 0**（实测 `scripts/qa/probe-tenancy.mjs`）
   → 租户域端点对当前账号一律 403。故 `/workspace` 的 **Missions / Outcomes** 两项
   **显式标注"需要 ACTIVE 社群成员身份"**并**不可点**；**Agents** 标注"T09 未交付"。
   已完成并接真实数据的是 **Now**（`/api/notifications`、`/api/chats/unread-count`）与
   **Field**（`/api/matches`）。
2. **Composer 的「生成 Mission」按钮是 `disabled` 的** —— 因为唯一后端动作
   （`POST /api/v1/missions`）需要租户身份。**这是刻意的**：与其放一个点了没反应的按钮，
   不如禁用 + 写明原因（R2 会把守）。
3. **`/workspace` 尚未接入主导航**（避免影响线上 IA）；P1 再决定入口与迁移策略。
4. 本阶段**未发版**：提交带免构建标记，生产仍是 `6acde3962c8778501cd81f27`。

## 6. 踩坑记录

1. **注释里的散文会被正则当成代码** → `check-ui-invariants` 首版误报 R4；修法是**剥离注释**。
2. **`useEffect` 内同步 `setState` 会被 lint 拦**（`react-hooks/set-state-in-effect`）
   → 用 `useSyncExternalStore`（见 §2.2）。
3. **`@theme inline` 不发射 `--color-*` 变量**：探针查 `--color-lf-surface` 会"查不到"，
   但那不是缺陷 —— `inline` 就是把值直接内联进工具类。**验证要看工具类（`.bg-lf-surface`）**。
4. **heredoc 里的 `${}` 会被 shell 吃掉**（本仓老坑）：复杂脚本一律用 Write 落盘再跑。
5. **变异脚本的注入锚点必须自证命中**：第一次 R2 的注入串没匹配上，
   导致"R2 没被验证"却看起来像"R2 没问题" —— 所以变异脚本必须断言 `mutated !== original`。

## 7. 下一步（P1）

- `Intent-to-UI Compiler`（自然语言 → `zod` 校验的 `WorkspaceSpec` → 白名单组件渲染）。
- `Mission Studio`：`POST /api/v1/missions`（幂等键）→ 画布出现 `intent` 节点。
- `Living Canvas`：P1 用 DOM/SVG 混合（不引 3D）。
- 组件补齐：`Switch` / `Drawer` / `Command palette`。
- `/workspace` 接入导航 + Playwright 冒烟（360px 无溢出）。
