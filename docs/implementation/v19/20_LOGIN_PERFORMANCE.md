# V19-20 · `/login` 性能专项（WB19-45）

> **状态：`PERF_TARGET_NOT_MET`（2026-10-23 重测）。** 目标 LCP ≤2500ms；实测冷态中位 **6544ms**（4608–9796）、暖态 **5472ms**。未达目标，且不做修饰。
> 数据：`screenshots/v194-perf/perf-2026-10-23.json`（5 冷 + 5 暖 × 4 路由原始样本）。

## 1. 测量条件（可复算）

390×844 / DPR2 · CDP 节流 1.6Mbps ↓ / 750kbps ↑ / 150ms RTT · CPU 4× · 冷 = 全新 context，暖 = 同 context 二次导航 · 每路由 5+5 样本。与 WB18-36 完全同一脚本（`scripts/qa/perf-baseline.mjs`）。

## 2. 本轮结果（中位数）

| 路由 | 冷 LCP | 暖 LCP | 冷 TBT | JS 传输 | 第三方 |
|---|---|---|---|---|---|
| `/` | 8028ms | — | 8945ms | 272KB/14req | — |
| `/login` | **6544ms** | **5472ms** | **3450ms** | **244KB/13req** | **cloudflareinsights 1029–2072ms** |
| `/pricing` | 3540ms | — | 1190ms | 11KB/2req | — |
| `/pay.html` | 4592ms | — | 1496ms | 11KB/2req | — |

## 3. 与上一轮基线（WB18-36，`36_PERFORMANCE_BASELINE.md`）的对照

| 路由 | 上轮 | 本轮 | 差异 |
|---|---|---|---|
| `/` 冷 LCP | 3784ms | 8028ms | **+112%** |
| `/login` 暖 LCP | 3172ms | 5472ms | **+73%** |
| `/pricing` 冷 LCP | 3044ms | 3540ms | +16% |

🔴 **同代码（生产 `dc102cd` 未变）、同脚本、同标称条件，数字却大幅变差** —— 两种可能：① 本机会话状态差异（上轮测试前后台负载不同）；② 生产侧注入内容变化（如 Cloudflare Insights beacon 行为）。**这正是"不能根据单次测量下结论"的实证**：绝对值不可跨会话直接比，但**结构性结论两轮一致**（见 §4）。后续测量应在同一会话内完成"优化前/后"对照（PERF-03 要求的正是这个，不是跨会话对比）。

## 4. 结构性结论（两轮一致，可行动）

1. **瓶颈在主线程，不在网络**：FCP≈LCP（`/login` 5792 vs 6544），首字节只占 LCP **9%**（上轮 8–20% 同量级）。
2. **JS 体积与 TBT 强相关**：`/login` 244KB/13req → TBT 3450ms；`/pricing` 11KB/2req → TBT 1190ms 且 LCP 3540（同为节流条件）。`/login` 的 JS 是 `/pricing` 的 **22 倍** —— 登录页装了与登录无关的东西。
3. **第三方实锤**：`static.cloudflareinsights.com` 单个 beacon 占 **1.0–2.1s** —— 生产（Cloudflare DNS）自动注入的 Web Analytics。这是零成本优化点（对自托管分析或 defer 策略复核）。

## 5. 优化路线（按预期收益排序，未实施 —— 等排期）

1. **审 `/login` 的客户端 JS 清单**：239KB（上轮）→ 现测 244KB，13 个请求。逐项归因（auth 组件、共享 bundle、图标库），目标砍到 `/pricing` 量级；
2. **复核 Cloudflare Insights 注入**：1–2s 的主线程/网络占用，评估关闭或改自托管；
3. 字体与关键 CSS 复核（`/` 同病：272KB JS、TBT 8945ms）。

## 6. 验收判定

- PERF-01（条件可复现）：✅ 脚本与参数写死可复算
- PERF-02（冷暖分离）：✅
- PERF-03（优化前后数据）：⬜ **未实施优化** —— 本轮仅测量与归因
- PERF-04（无安全/功能回退）：⬜ 同上
- **目标 LCP ≤2500ms：NOT MET（6544ms 冷 / 5472ms 暖）**

---

## 7. 【2026-10-25 实施】优化 #1：LazyMotion 下放（framer-motion 迁出根布局）

### 7.1 归因（代码级，扫描脚本 `scripts/qa/scan-framer-usage.mjs`）

- 全仓 **30 个文件** import framer-motion；其中依赖根布局 `LazyMotion` 的只有 **`m.`** 用法：
  `chats`（chat-container / message-bubble / message-list / conversation-item）与
  `explore/page-content` —— **全部位于 `(dashboard)`**。
- `UserAvatarMenu`（用 `m.`）经全仓引用扫描确认为**零挂载死代码**。
- `console/*` 与 `workspace/*` 组件全部用 `motion.`（全量导入，自带特性），不依赖 LazyMotion。
- 结论：根布局的 `<LazyMotion features={domAnimation}>` 迫使 `/login`、`/register`、
  `/pricing`、`/` 等零动画页面也加载 framer-motion 运行时 —— 纯浪费。

### 7.2 代码改动（2 文件）

| 文件 | 改动 |
|---|---|
| `src/app/layout.tsx` | 删除 `LazyMotion` import 与 JSX 包裹（根布局 0 framer 残留，机械核对） |
| `src/app/(dashboard)/dashboard-ui.tsx` | `<LazyMotion features={domAnimation}>` 挂到 `(dashboard)` 客户端壳，包裹 `ProfileContext` 全树。**不加 `strict`**：dashboard 内还有多个 `motion.` 全量组件，strict 会抛错 |

### 7.3 风险评估

- `m.` 组件失去 provider 会抛 `lazy functionality` 错 —— 已核实全部存活 `m.` 挂载点都在
  `(dashboard)` 内（`conversation-list` 挂在 `chats/layout.tsx` ✓）。判定为**零行为变化**。
- E2E 门禁（认证 18 条 + 页签 12 条 + chats 相关）将在 PR CI 里复跑，作为行为不变的证据。

### 7.4 前后对照（PERF-03）

- 测量环境：PR 的 **Netlify deploy preview**（与生产同构构建，但不触碰生产）。
- 流程：preview 就绪后，同会话内跑 `perf-baseline.mjs --samples=5` 指向 preview URL，
  与本文件 §2 的生产基线（同会话测得）对照。**跨会话绝对值不可比（§3 已实证），
  对照口径 = 同会话先测生产、再测 preview。**

### 7.5 第三方注入的处置（代码之外，需人工/面板操作）

| 注入源 | 实测影响 | 处置 | 谁能做 |
|---|---|---|---|
| `static.cloudflareinsights.com` | beacon 占 **1.0–2.1s** | Cloudflare 控制台关闭 Web Analytics 的 Auto-Inject（或换自托管） | **你**（DNS/CF 面板） |
| GTM（`NEXT_PUBLIC_GTM_ID` 已在生产生效） | `googletagmanager.com/gtm.js` 进首屏 | 若分析非必需，清掉 Netlify 变量即全站少一个阻塞脚本 | **你**（Netlify env） |
| Netlify "Powered by" 徽章 | 品牌一致性 P2，404 页可见 | Netlify 账户设置可关（免费档允许） | **你**（Netlify 面板） |

### 7.6 本轮判定更新

- PERF-03：**部分达成** —— 优化已实施，前后对照待 preview 测量（本节 §7.4）
- PERF-04：⬜ 待 CI E2E 绿 + preview 走查
- **总体仍标 `PERF_TARGET_NOT_MET`**，直到同会话对照数据证明目标达成或确认不可达。
