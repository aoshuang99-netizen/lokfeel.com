# 03 · FIGMA IMPLEMENTATION MAP — lokfeel-final-20261110

> 结论先行：**G3（Figma 可编辑交付）= BLOCKED**。
> 实测（2026-11-10）：本环境无 Figma 写入凭据 —— 用户级 skill（`~/.workbuddy/skills/figma`）为操作知识库，不含 token；环境变量、`.env*`、Netlify env（44 键）中均无 `FIGMA_*` 凭据；上轮已实测登记 `BLOCKED_FIGMA_WRITE`，本轮复核结论不变。
> 按总令口径：**不伪称已交付 Figma**。本文档交付「设计规格 + 页面到代码映射」，供任意设计工具按规格建稿，或凭据到位后一键还原。

## 1. 设计规格（Design Spec · 可在任何工具中重建）

### 1.1 Tokens（两套并存的公开面设计系统）

**A. 落地页编辑风（/ 专用 · light）**

| Token | 值 | 用途 |
|---|---|---|
| PAPER | `#f7f5f0` | 页面底色 |
| INK | `#0b0e11` | 正文/标题/主按钮底 |
| SIGNAL | `#b8863f` | 装饰性青铜强调（**大字对比 2.96:1，仅限装饰与非文字用途**） |
| SIGNAL_DEEP | `#8a5a1e` | 文字级青铜强调（对比 5.4:1，达标） |
| MUTED | `#5a636b` | 次级文字（5.6:1 达标） |
| FAINT | `#8a9298` | ⚠️ 仅装饰性 mono 眉标存量（2.9–3.2:1，**B4 清偿清单**，新代码禁用） |
| 字体 | Outfit（正文）+ Sora（`font-display` 展示字） | 16px 正文起步 |
| 按钮 | 圆角胶囊（`rounded-full`），主=INK 底白字，次=1px INK/16% 描边 |

**B. 公开子页深色玻璃风（/product /solutions /stories /how-it-works /help /about /pricing /contact /support…）**

| Token | 类名 | 值 |
|---|---|---|
| Background | `background` / `background-secondary` | `#0a0a0a` / `#111111` |
| Foreground | `foreground` / `foreground-muted` / `foreground-subtle` | `#ffffff` / `#aaaaaa` / `#888888` |
| Primary | `primary`（lime） | `#a3e635`（hover `#bef264`） |
| Secondary | `secondary`（purple） | `#4c1d95` |
| 卡片 | `glass-card` | 深色玻璃卡（globals.css:298） |
| 光晕 | `glow-orb` / `glow-orb-primary` / `-secondary` | 装饰光球（globals.css:549） |
| 按钮 | `btn-primary` / `btn-secondary` / `btn-ghost` | lime 主按钮（globals.css:658+） |
| 渐变强调 | `text-gradient` | lime→purple 标题渐变（globals.css:317） |
| 字体 | 同上（Outfit+Sora，`font-display`=Sora） | globals.css:243 |

**完整 Token 单一来源**：`src/app/globals.css`（Dateasy Dark v7）+ 落地页内联常量（`(landing)/page.tsx` §1）。

### 1.2 共享组件规格（公开面）

| 组件 | 规格要点 | 代码 |
|---|---|---|
| Navbar | fixed 顶栏；滚动后 `glass-strong`；桌面 5 链接 + Log in + Get Started；移动汉堡 + 右滑菜单 | `src/components/layout/navbar.tsx` |
| Footer | 5 栏（PRODUCT/COMPANY/SUPPORT/LEGAL/FOLLOW）+ 底部版权；栏题 h2、白/60（6.9:1） | `src/components/layout/footer.tsx` |
| 章节骨架 | `pt-24`（让位 fixed 导航）→ hero（glow-orb + 居中 h1 + text-gradient 强调）→ 内容区（glass-card 网格）→ CTA 区 | 五个新页统一 |
| 步骤卡 | 12×12 渐变图标位（primary/20→secondary/20）+ mono 序号 + 标题 + dl（Input/Output/Who can）+ 边界小字 | `product/page.tsx` |
| 演示标注 | 页首通栏 `bg-primary-muted` + `border-primary/30`，粗体声明"Demo scenario — not a real customer results" | `stories/page.tsx` |

### 1.3 响应式与无障碍规格（B2 已执行）

- 断点：移动单列 → `md:grid-cols-2/3` → 桌面 `lg:` 放大；表格类内容全部转卡片（无横向溢出）。
- axe 实测（390×844 / 1440×900，serious/critical）：**五个新页 10/10 = 0 违规**；落地页棘轮回归修复后 ≤ 基线。
- 语义层级：h1（每页 1 个）→ h2（区块）→ h3（卡内分组）；图标 `aria-hidden`；列表用 `ol/li`；页脚栏题用 h2。

## 2. 页面 → 代码映射（实现清单）

| 页面 | 路由 | 状态 | 代码 | 文案来源 |
|---|---|---|---|---|
| 首页 | `/` | ✅ 改造 | `src/app/(landing)/page.tsx`（hero H1/CTA/导航/页脚，编辑风） | 01b §P1 |
| 产品 | `/product` | ✅ 新增 | `src/app/(public)/product/page.tsx` | 01b §P2 |
| 场景 | `/solutions` | ✅ 新增 | `src/app/(public)/solutions/page.tsx` | 01b §P3 |
| 案例 | `/stories` | ✅ 新增 | `src/app/(public)/stories/page.tsx`（顶部演示声明通栏） | 01b §P4 |
| 使用说明 | `/how-it-works` | ✅ 新增 | `src/app/(public)/how-it-works/page.tsx` | 01b §P5 |
| 帮助中心 | `/help` | ✅ 新增 | `src/app/(public)/help/page.tsx` | 01b §P5/P8 |
| 订阅 | `/pricing` | ✅ 存量（commercial-gate 接入见 B0） | `src/app/(public)/pricing/page.tsx` | 01b §P6 |
| 公司 | `/about` | ✅ 存量 + chrome | `src/app/(public)/about/page.tsx`（团队段 BLOCKED→D8） | 01b §P7 |
| 联系 | `/contact` | ✅ 存量 + chrome | `src/app/(public)/contact/page.tsx` | 01b §P8 |
| 法律 | `/privacy /terms /refunds` | ✅ 存量（terms 支付商修正） | `(public)/terms/page.tsx:156` Stripe→Dodo | 01b §P9 |

## 3. 若 Figma 凭据到位后的建稿清单（供恢复 G3 用）

1. Foundations：两套 token（§1.1）建 color/text styles。
2. Components：Navbar/Footer/glass-card/btn-primary/步骤卡/演示标注条（§1.2）→ 主组件 + 状态（默认/悬停/聚焦/禁用）。
3. Public Pages：上表 10 页各 1440 frame + 390 frame。
4. Prototype：首页 → /product → /how-it-works → /register 的 CTA 流。
5. 每帧标注对应代码文件（§2），保证「实现与设计一致」可核对。

## 4. 遗留债务（如实登记，B4 清偿）

- 落地页存量 FAINT mono 眉标/轨道图标签 25+ 处 2.9–4.5:1（v196 基线冻结中；G4 目标 = 全清零）。
- 页脚 FOLLOW 栏社媒链接可达性未实测（blog/twitter/instagram/facebook @lokfeel 是否存在）→ G2 债 C-31。
- 两套公开面视觉语言（编辑风 vs 深色玻璃）并存 —— 本轮按"落地页保留、子页统一深色"收敛，全站单语言为后续迭代项（需用户拍板方向）。
