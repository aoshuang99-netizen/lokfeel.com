# Living Connection OS —— 前端资产审计（P0 前置）

> 依据：`docs/implementation/DESIGN` 设计基准 §十「正式开发前仍需要对现有仓库进行资产审计」。
> 方式：只读盘点（未修改任何文件）。仓库：`nexus-app`，审计时 `HEAD = 0190da8`。

## 0. 一句话结论

现有前端是一套**暗色优先（无亮色模式）**、**手自研 shadcn 风格组件（无 Radix）**、
**自研 SWR 风格数据层（无 TanStack Query/SWR）** 的 Next.js 16 App Router 应用。
令牌体系完整但不是新基准的品牌色（现 Lime `#a3e635`，基准要求 Warm Signal `#D7AC78`）。
个人态 `(dashboard)` 与组织态 `/console` **双 shell 已拆分** —— 正是新五区布局的雏形。
**无任何画布/关系图能力**，`Living Canvas` 需从零引入。

## 1. 规模

| 项 | 数量 |
|---|---|
| `page.tsx` | **76** |
| `route.ts`（API） | **182** |
| `layout.tsx` | **10** |
| `src/components/ui/*` | **22** |
| `globals.css` | **1707 行** |

## 2. 路由分布（按区域）

| 区域 | 数量 | 代表路径 |
|---|---|---|
| 公开/营销 `(public)` | 18 + 首页 | `/`、`/about`、`/terms`、`/privacy`、`/faq`、`/support`… |
| 认证 `(auth)` | 7 | `/login`、`/register`、`/admin-login`、`/auto-login`… |
| 个人态 `(dashboard)` | 14 + 1 | `/dashboard`、`/connections`、`/explore`、`/matches/[id]`、`/notifications`、`/profile`、`/settings`、`/chats` |
| 组织态 `/console`（B2B） | 7 | `/console`、`missions`、`missions/[id]`、`members`、`connections`、`outcomes`、`settings`（**`agents` 未就绪、无路由**） |
| 管理端 `(admin)` | 21 + 1 | `/admin/users`、`/admin/rbac`、`/admin/analytics*`… |
| 公开分享页 | 4 | `/m/[token]`、`/m/[token]/intent`、`/matches`、`/proposals` |

## 3. 布局与导航

- `src/app/layout.tsx` — 根：`next/font`（Outfit/Sora）、`LazyMotion`、AuthProvider、GTM、SW 注册。
- `(dashboard)/layout.tsx` — **服务端鉴权守卫** + `<DashboardUI>`；导航来自
  `src/components/layout/sidebar-v2.tsx`（桌面侧栏）+ `bottom-nav.tsx`（移动底栏）。
- `src/app/console/layout.tsx` — **组织态守卫**：未登录跳登录（保留回跳）；无 ACTIVE 租户渲染
  `no-org.tsx`（说明页，非错误页）；正常则 `<ConsoleShell>`。导航 = `console-shell.tsx` 内
  `CONSOLE_NAV` 常量（RBAC `capability` 门禁 + `ready` 标志）。
- 🔴 **「无空按钮」AC-18 的既有落点**：`console-shell.tsx` 对**未就绪**导航项渲染为**不可点
  `<span>` + "施工中"标签**，而非死链。这是新五区布局必须继承的硬约束。

## 4. 样式与令牌

- **Tailwind v4**（`^4`）：**无 `tailwind.config.*`**；`postcss.config.mjs` 仅挂 `@tailwindcss/postcss`；
  主题写在 CSS 内（`globals.css` 的 `@theme inline`）。
- `globals.css`：`:root`（L14–131）定义完整令牌；`@theme inline`（L136+）映射为 Tailwind 语义色。
- 现有品牌：**Lime `#a3e635`** / Accent Purple `#4c1d95` / Accent Pink `#f472b6` / 底色 `#0a0a0a`。
- **深色模式**：**仅暗色**（L10 注释 `no light mode`）；无 `.dark` 类、无 `@custom-variant dark`、
  无 `prefers-color-scheme` → 基准要求的亮色 `#F7F5F0` **须新建**。
- 字体：`next/font` 自托管 `Outfit`(`--font-outfit`) / `Sora`(`--font-sora`)；基准建议 Inter/Geist + 思源黑体。

## 5. 组件库

- shadcn **风格但全手自研**（非 CLI）：`src/components/ui/`（22 文件），用 `cva` + `clsx` + `tailwind-merge`(`cn()`)。
- **无 `@radix-ui` 直接依赖**；Dialog/Tabs/Tooltip/Checkbox 均手写。
- 已有：button / card / input / dialog / tabs / tooltip / checkbox / data-table / badge / skeleton /
  spinner / avatar / empty-state / error-boundary / image-crop-modal / location-picker / inline-error / motion-lazy。
- **缺失**：Drawer / Select / Combobox / Switch / Popover / **Command palette**。
- Toast = `sonner ^2.0.8`（`<Toaster>` 挂在 `(dashboard)/dashboard-ui.tsx`；**console 范围可能未挂**）。

## 6. 数据与状态（🔴 新基准的「真实 API」落点）

- **无 TanStack Query / SWR / Redux**。客户端惯例 = 自研 SWR 风格 hook **`src/hooks/use-api.ts`**
  （`useApiGet/Post/Delete`，模块级 `Map` 缓存 + 5min TTL + stale-while-revalidate + `invalidateCache`）。
- 服务端：RSC + 182 个 route handler；`src/lib/api.ts`、`src/lib/http/public-origin.ts`。
- 状态：`zustand ^5.0.15`（`src/store/videoCallStore.ts`）+ React context（AuthProvider）；无全局 UI store。
- **既有真实端点（可直接给新 UI 用）**：`/api/v1/missions`(列表/创建)、`/api/v1/members`、
  `/api/v1/connections/pipeline`、`/api/v1/outcomes`、`/api/v1/outcomes/metrics`、
  `/api/v1/billing/{usage,subscription,charges}`、`/api/v1/org`、`/api/v1/proposals*`、`/api/v1/intents`。

## 7. 动画

- **`framer-motion ^13.4.4`** 已装；根布局 `<LazyMotion features={domAnimation}>`。
- 既有约定：`animate-fadeIn`/`animate-fadeInUp`（globals.css keyframes）、`motion-lazy.tsx`。
- **无统一过渡封装**；基准的 `Signal→Connect→Resolve→Form→Morph→Outcome` 六拍需新建。

## 8. 画布 / 可视化

- **无 React Flow / Three.js / cytoscape / d3 主包**（仅 `recharts ^3.10.1` 带 `d3-*` 子包）。
- `globals.css` 有 `--radar-*`（五维雷达）。**Living Canvas / 关系图能力为零 → 需从零引入。**

## 9. 测试与门禁

- **Playwright `^1.63.0`**：`playwright.config.ts` + `playwright.t02.config.ts`；`tests/e2e/*`（auth、api-health、dashboard-access…）。
- **Jest `^30`**：`tests/{integration,connection,outcome,tenancy,lifecycle,webrtc,manual}`。
- **无 Storybook**（无 `.storybook`，无依赖）。UI 脚本仅 `dev/build/start/lint/test`。
- 既有前端相关门禁：`tsc --noEmit`、`eslint --max-warnings=0`、`check:script-decls`（脚本层）。

## 10. 既有设计文档与 AC-18

- `docs/` 下**无前端设计系统文档**（`DESIGN*`/`UI*` 均不存在）。
- 相关产品文档：`lokfeel-product-optimization-prd.md`、`admin-dashboard-product-spec*.md`、`MULTI-TENANCY-DESIGN.md`。
- **AC-18 现状：未认领**（定义于 `docs/implementation/T07/plan.md`：七屏可达 + 无空按钮；Agents 屏与部分 Outcomes 未就绪）。

## 11. 响应式现状

- 断点使用广泛：`sm:`154 / `md:`75 / `lg:`144 / `xl:`4。
- `(dashboard)/dashboard/page.tsx`：`grid-cols-2 md:grid-cols-4`；移动横向轮播 `overflow-x-auto snap-x`
  + `w-[calc(100vw-48px)]`（处理得当）。
- `console/page.tsx` / `console-shell.tsx`：`grid-cols-2 sm:grid-cols-4`；导航 `lg:w-52` 侧栏 + 移动横向 `shrink-0` 列表。
- **未发现全局横向溢出的风险标记**；新五区布局须显式加 `min-w-0` 防 flex/grid 溢出。

## 12. 关键依赖版本（`package.json`）

```
next 16.3.6 · react/react-dom 19.3.0 · tailwindcss ^4 · @tailwindcss/postcss ^4（无 config 文件）
framer-motion ^13.4.4 · zustand ^5.0.15 · zod 4.3.6 · sonner ^2.0.8 · recharts ^3.10.1 · lucide-react ^1.48.0
cva ^0.7.1 · clsx ^2.1.1 · tailwind-merge ^3.7.0
@playwright/test ^1.63.0 · jest ^30.5.2
```

**缺失（基准建议但当前没有）**：`@radix-ui/*`、`@tanstack/react-query`、`swr`、`three`/`@react-three/*`、
`@xyflow/react`（React Flow）、`d3`、`cytoscape`、`storybook`。

## 13. 结论：四个主要投入点

1. **设计令牌 + 明暗双主题** —— 现只有暗色，且品牌色与基准不同 → 必须新增（建议**加性、作用域化**，不覆盖既有品牌）。
2. **引入 Radix / React Flow / Three.js** —— 缺可访问原语、缺画布、缺 3D。
3. **数据层是否迁移 TanStack Query** —— 现有 `use-api.ts` 可用但无重试/去重/失效广播的完整语义。
4. **Living Canvas / Command Composer 等新区域从零搭建** —— 并为未就绪动作保留「不可点 + 原因」而非假按钮。
